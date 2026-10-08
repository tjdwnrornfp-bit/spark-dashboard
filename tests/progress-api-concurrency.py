"""Real PostgreSQL concurrency, disposable CI database only."""
import concurrent.futures, json, os, subprocess, time, uuid
assert os.environ.get('PROGRESS_CONCURRENCY_TEST') == 'isolated-ci'
PSQL=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
    p=subprocess.run(PSQL,input=sql,text=True,capture_output=True,timeout=25)
    assert p.returncode==0,p.stderr
    return p.stdout.strip().splitlines()[-1] if p.stdout.strip() else ''
run(subprocess.check_output(['node','tests/progress-api-fixture.mjs','--dump'],text=True))
admin,member,key=[str(uuid.uuid4()) for _ in range(3)]
for uid,name,role in [(admin,'admin','admin'),(member,'copy','agency')]:
    run(f"insert into auth.users values('{uid}');insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot) values('{uid}','{name}','{name}','{name}','{role}','approved',true,20);")
identity=f"select set_config('request.jwt.claim.sub','{admin}',false);set role authenticated;"
run(identity+f"select issue_progress_api_key_v1015('{key}','{member}','{'a'*64}','ci',now()+interval '1 day');")
lookup=f"set role service_role;select get_order_progress_inputs_v1015('{'a'*64}',array['UNKNOWN']);"
# Start clear of a minute boundary so all simultaneous calls share a bucket.
sec=float(run('select extract(second from clock_timestamp());'))
if sec>48: time.sleep(61-sec)
with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:
    results=list(pool.map(lambda _:json.loads(run(lookup)),range(40)))
assert sum('error' not in r for r in results)==30,results
assert sum(r.get('error')=='rate_limited' for r in results)==10,results
assert run('select total_count from spark_private.progress_api_usage_v1015;')=='30'
# Requests queued behind the usage lock must recheck a revoked credential.
p=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
p.stdin.write("begin;select member_id from spark_private.progress_api_usage_v1015 for update;\n\\echo READY\n");p.stdin.flush()
while 'READY' not in p.stdout.readline():
    assert p.poll() is None,'lock session failed'
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    pending=[pool.submit(run,lookup) for _ in range(4)]
    for _ in range(60):
        if int(run("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%get_order_progress_inputs_v1015%';"))>=4: break
        time.sleep(.1)
    else: raise AssertionError('requests did not reach lock')
    assert run(identity+f"select revoke_progress_api_key_v1015('{key}','concurrency test');")=='t'
    p.stdin.write('rollback;\n');p.stdin.close();p.wait(timeout=10)
    assert p.returncode==0,p.stderr.read()
    assert all(json.loads(f.result())=={'error':'unauthorized'} for f in pending)
print('PASS real PostgreSQL: exactly 30/40 concurrent calls accepted; revoked queued calls rejected')
