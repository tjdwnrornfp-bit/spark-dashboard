"""PostgreSQL close/retry serialization. Disposable CI database only."""
import concurrent.futures,json,os,subprocess,uuid
assert os.environ.get('MONTHLY_CONCURRENCY_TEST')=='isolated-ci'
PSQL=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(PSQL,input=sql,text=True,capture_output=True,timeout=25);assert r.returncode==0,r.stderr
 return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''
run(subprocess.check_output(['node','tests/monthly-settlement-fixture.mjs','--dump'],text=True))
admin=str(uuid.uuid4());run(f"insert into auth.users values('{admin}');insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot) values('{admin}','admin','admin','admin','admin','approved',true,20);")
identity=f"select set_config('request.jwt.claim.sub','{admin}',false);set role authenticated;"
revision=json.loads(run(identity+"select get_admin_monthly_settlement_v1016('2001-09-01');"))['revision']
def save(request):return json.loads(run(identity+f"select save_admin_monthly_settlement_v1016('2001-09-01','{request}','{revision}','CI verified close');"))
same=str(uuid.uuid4())
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(lambda _:save(same),range(8)))
assert len(set(r['id'] for r in results))==1
assert run("select count(*) from spark_private.settlement_closes_v1016;")=='1'
assert run("select count(*) from audit_logs where action='settlement.month_closed';")=='1'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(lambda _:save(str(uuid.uuid4())),range(8)))
assert sorted(r['version'] for r in results)==list(range(2,10))
assert run("select count(distinct version) from spark_private.settlement_closes_v1016;")=='9'
print('PASS PostgreSQL monthly: 8 concurrent same-request saves yield one close/audit; distinct saves get unique sequential versions')
