"""Disposable PostgreSQL only: locks, stale previews and replay after lost response."""
import json, os, subprocess, uuid
assert os.environ.get('LIFECYCLE_CONCURRENCY_TEST') == 'isolated-ci'
PSQL=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):
 r=subprocess.run(PSQL,input=sql,text=True,capture_output=True,timeout=25)
 assert r.returncode==0,r.stderr
 return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ''
run(subprocess.check_output(['node','tests/order-lifecycle-fixture.mjs','--dump'],text=True))
admin,member=str(uuid.uuid4()),str(uuid.uuid4())
for id,name,role in [(admin,'admin','admin'),(member,'member','agency')]:
 run(f"insert into auth.users values('{id}');insert into profiles(id,username,username_key,referral_code,role,approval_status,active,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot) values('{id}','{name}','{name}','{name}','{role}','approved',true,20,20,30,40,50);")
def identity(id):return f"select set_config('request.jwt.claim.sub','{id}',false);set role authenticated;"
def create():return json.loads(run(identity(member)+"select to_jsonb(create_order_v10('spark','https://m.place.naver.com/place/123/home','123','test','key',100,10,'2099-01-10',''));"))
def preview(action,o):return json.loads(run(identity(admin)+f"select preview_admin_order_lifecycle_v1014('{action}',array['{o['order_number']}'],'{{\"programs\":[\"spark\"]}}');"))['items']
def apply_sql(action,items,rid=None):
 payload=[{k:i[k] for k in ['id','version','fingerprint']} for i in items]
 return identity(admin)+f"select apply_admin_order_lifecycle_v1014('{action}',$j${json.dumps(payload)}$j$,'CI 정리','{rid or uuid.uuid4()}','{'영구 삭제' if action=='delete' else '확인'}');"
def session(sql):
 p=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 p.stdin.write(sql+'\n\\echo READY\n');p.stdin.flush()
 while True:
  line=p.stdout.readline()
  if 'READY' in line:return p
  if line=='' and p.poll() is not None:raise AssertionError(p.stderr.read())
def close(p):p.stdin.write('rollback;\n');p.stdin.close();p.wait(timeout=10);assert p.returncode==0,p.stderr.read()
a,b=create(),create();items=preview('archive',a)+preview('archive',b)
# Payment-first lock: skip that order, process the other, no waiting/deadlock.
p=session(f"begin;select id from payment_steps where order_id='{a['id']}' for update;")
r=json.loads(run(apply_sql('archive',items)))['results'];assert sum(x['success'] for x in r)==1,r
close(p)
assert run(f"select archived_at is null from orders where id='{a['id']}'")=='t'
# Order-first lock is handled in the same per-row way.
p=session(f"begin;select id from orders where id='{a['id']}' for update;")
assert not json.loads(run(apply_sql('archive',preview('archive',a))))['results'][0]['success'];close(p)
assert json.loads(run(apply_sql('archive',preview('archive',a))))['results'][0]['success']
stale=preview('delete',a)
run(f"update payment_steps set confirmed_at=now(),confirmed_by='{admin}' where order_id='{a['id']}';update payment_steps set confirmed_at=null,confirmed_by=null where order_id='{a['id']}';")
assert not json.loads(run(apply_sql('delete',stale)))['results'][0]['success']
# Successful request can be replayed after physical deletion without a new audit.
snapshot=preview('delete',b);rid=str(uuid.uuid4());sql=apply_sql('delete',snapshot,rid)
first=run(sql);assert json.loads(first)['results'][0]['success'];assert run(sql)==first
assert run(f"select count(*) from audit_logs where entity_id='{b['id']}' and action='order.permanently_deleted'")=='1'
print('PASS real PostgreSQL: payment/order lock contention, per-row partial success, reversed confirmation race, replay after permanent delete')
