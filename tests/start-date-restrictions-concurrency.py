"""Real PostgreSQL sessions in a disposable CI database, never production."""
import os, subprocess, time, uuid
from pathlib import Path
assert os.environ.get('BLACKOUT_CONCURRENCY_TEST') == 'isolated-ci', 'Explicit isolated test opt-in required'
PSQL=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql,ok=True):
 r=subprocess.run(PSQL,input=sql,text=True,capture_output=True,timeout=20)
 if ok and r.returncode: raise AssertionError(r.stderr)
 return r
for f in ['tests/fixtures/v105-intake.sql','tests/fixtures/v105-quotes.sql','supabase/migrations/20260903094128_v10_6_admin_order_assignment.sql']:
 run(Path(f).read_text())
run("create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active and approval_status='approved')$$;")
run(next(Path('supabase/migrations').glob('*_v10_12_start_date_restrictions.sql')).read_text())
run("grant select on public.profiles to authenticated;")
admin,member=str(uuid.uuid4()),str(uuid.uuid4())
for id,name,role in [(admin,'admin','admin'),(member,'member','agency')]:
 run(f"insert into auth.users values('{id}'); insert into profiles(id,username,username_key,referral_code,role,approval_status,active,approved_at,price_per_shot,spark_price_per_shot,spark_plus_price_per_shot,spark_s_price_per_shot,spark_s_plus_price_per_shot) values('{id}','{name}','{name}','{name}','{role}','approved',true,now(),20,20,30,40,50);")
def identity(id):return f"select set_config('request.jwt.claim.sub','{id}',false); set role authenticated;"
def create(date):return f"select (public.create_order_v10('spark','https://m.place.naver.com/place/123/home','123','test','key',100,10,'{date}','')).id;"
def save(date):return f"select public.save_order_start_restriction_v1012('{uuid.uuid4()}','{date}','{date}','CI test',true,0);"
def session(sql):
 p=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 p.stdin.write(sql+'\n');p.stdin.flush()
 # Commands before marker are guaranteed successful by ON_ERROR_STOP.
 while True:
  line=p.stdout.readline()
  if 'READY' in line:return p
  if line=='' and p.poll() is not None:raise AssertionError(p.stderr.read())
# Intake first: saving the policy cannot overtake an already accepted transaction.
p=session(identity(member)+" begin; "+create('2099-01-10')+"\n\\echo READY\nselect pg_sleep(2); commit;")
t=time.monotonic();run(identity(admin)+save('2099-01-10'));elapsed=time.monotonic()-t
assert elapsed>1.0,('save failed to wait for accepted intake',elapsed)
p.stdin.close();p.wait(timeout=10);assert p.returncode==0
assert run("select count(*) from orders where start_date='2099-01-10'").stdout.strip()=='1'
# Policy first: a waiting new intake must observe the new policy after commit.
p=session(identity(admin)+" begin; "+save('2099-02-01')+"\n\\echo READY\nselect pg_sleep(2); commit;")
t=time.monotonic();r=run(identity(member)+create('2099-02-01'),ok=False)
assert r.returncode!=0 and '접수 제한 기간' in r.stderr,r.stderr
assert time.monotonic()-t>1.0
p.stdin.close();p.wait(timeout=10);assert p.returncode==0
assert run("select count(*) from orders where start_date='2099-02-01'").stdout.strip()=='0'
# REPEATABLE READ snapshot predating the policy cannot silently accept a blocked date.
p=session(identity(member)+" begin isolation level repeatable read; select count(*) from public.profiles;\n\\echo READY")
run(identity(admin)+save('2099-03-01'))
p.stdin.write(create('2099-03-01')+' commit;\n');p.stdin.close();p.wait(timeout=10);error=p.stderr.read()
assert p.returncode!=0 and 'serialize' in error,error
assert run("select count(*) from orders where start_date='2099-03-01'").stdout.strip()=='0'
print('PASS: real PostgreSQL concurrent intake-before-save, save-before-intake, and stale REPEATABLE READ serialization; no blocked orders committed')
