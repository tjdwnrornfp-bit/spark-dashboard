-- Reporting only. Existing settlement functions, amounts, ownership and policies remain intact.
create table spark_private.settlement_events_v1016 (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null, payee_id uuid not null, occurred_at timestamptz not null,
  kind text not null check(kind in ('confirmation','reversal')),
  amount bigint not null, source text not null check(source in ('legacy_current','live')),
  row_data jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index settlement_events_payee_time_v1016_idx on spark_private.settlement_events_v1016(payee_id,occurred_at,id);
create index settlement_events_step_v1016_idx on spark_private.settlement_events_v1016(step_id);
create table spark_private.settlement_closes_v1016 (
  id uuid primary key, owner_id uuid not null, month date not null check(extract(day from month)=1),
  version integer not null, created_at timestamptz not null default clock_timestamp(),
  reason text not null, revision text not null, document jsonb not null,
  unique(owner_id,month,version)
);
alter table spark_private.settlement_events_v1016 enable row level security;
alter table spark_private.settlement_closes_v1016 enable row level security;
revoke all on spark_private.settlement_events_v1016,spark_private.settlement_closes_v1016 from public,anon,authenticated,service_role;
create index orders_monthly_start_v1016_idx on public.orders(start_date,id);
create index payment_steps_monthly_payee_v1016_idx on public.payment_steps(payee_id,order_id);

create function spark_private.settlement_row_v1016(p public.payment_steps)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p.id,'orderId',p.order_id,'orderNumber',p.order_number,'storeName',p.store_name,
    'registrantId',o.created_by,'username',o.creator_username,'groupName',coalesce(nullif(btrim(u.group_name),''),'미지정 그룹'),
    'payer',p.payer_username,'program',p.program_type,'startDate',o.start_date,'status',o.status,
    'archived',o.archived_at is not null,'stepKind',p.step_kind,'amount',p.total_amount,'confirmedAt',p.confirmed_at)
  from public.orders o left join public.profiles u on u.id=o.created_by where o.id=p.order_id
$$;

-- Bootstrap only extant confirmations. Do not invent missing historical events.
-- Live preflight checked available confirmation audits: no reversals, duplicates,
-- missing steps, amount differences or confirmation-month differences.
insert into spark_private.settlement_events_v1016(step_id,payee_id,occurred_at,kind,amount,source,row_data)
select p.id,p.payee_id,p.confirmed_at,'confirmation',p.total_amount,'legacy_current',spark_private.settlement_row_v1016(p)
from public.payment_steps p where p.confirmed_at is not null;

create function spark_private.capture_settlement_event_v1016()
returns trigger language plpgsql security definer set search_path='' as $$
declare captured_at timestamptz:=clock_timestamp(); changed boolean;
begin
  if tg_op='INSERT' then changed:=new.confirmed_at is not null;
  else changed:=(old.confirmed_at,old.total_amount,old.payee_id) is distinct from (new.confirmed_at,new.total_amount,new.payee_id); end if;
  if not changed then return new; end if;
  if tg_op='UPDATE' and old.confirmed_at is not null then
    insert into spark_private.settlement_events_v1016(step_id,payee_id,occurred_at,kind,amount,source,row_data)
      values(old.id,old.payee_id,captured_at,'reversal',-old.total_amount,'live',spark_private.settlement_row_v1016(old));
  end if;
  if new.confirmed_at is not null then
    insert into spark_private.settlement_events_v1016(step_id,payee_id,occurred_at,kind,amount,source,row_data)
      values(new.id,new.payee_id,case when tg_op='UPDATE' and old.confirmed_at is not null then captured_at else new.confirmed_at end,
        'confirmation',new.total_amount,'live',spark_private.settlement_row_v1016(new));
  end if;
  return new;
end $$;
create trigger capture_settlement_event_v1016 after insert or update on public.payment_steps for each row execute function spark_private.capture_settlement_event_v1016();

create function spark_private.require_settlement_admin_v1016()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or actor.role is distinct from 'admin'::public.member_role or not actor.active or actor.approval_status<>'approved' or actor.is_operations_manager then raise exception '활성 승인 관리자만 월별 정산을 조회할 수 있습니다.'; end if;
  return actor.id;
end $$;

create function spark_private.settlement_document_v1016(p_owner uuid,p_month date)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'work',coalesce((select jsonb_agg(spark_private.settlement_row_v1016(p) order by p.id) from public.payment_steps p join public.orders o on o.id=p.order_id
      where p.payee_id=p_owner and o.start_date>=p_month and o.start_date<(p_month+interval '1 month')::date),'[]'::jsonb),
    'receipts',coalesce((select jsonb_agg(e.row_data||jsonb_build_object('id',e.id,'stepId',e.step_id,'amount',e.amount,'kind',e.kind,'occurredAt',e.occurred_at,'source',e.source) order by e.id)
      from spark_private.settlement_events_v1016 e where e.payee_id=p_owner
      and e.occurred_at>=(p_month::timestamp at time zone 'Asia/Seoul') and e.occurred_at<((p_month+interval '1 month')::timestamp at time zone 'Asia/Seoul')),'[]'::jsonb))
$$;

create function spark_private.monthly_totals_v1016(p_rows jsonb,p_mode text)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('count',count(*),'totalAmount',coalesce(sum((r->>'amount')::bigint),0),
    'confirmedAmount',coalesce(sum((r->>'amount')::bigint) filter(where r->>'confirmedAt' is not null),0),
    'waitingAmount',coalesce(sum((r->>'amount')::bigint) filter(where r->>'confirmedAt' is null),0),
    'confirmationAmount',coalesce(sum((r->>'amount')::bigint) filter(where r->>'kind'='confirmation'),0),
    'reversalAmount',-coalesce(sum((r->>'amount')::bigint) filter(where r->>'kind'='reversal'),0))
  from jsonb_array_elements(p_rows) r
$$;

create function spark_private.get_monthly_settlement_v1016(p_month date,p_mode text,p_program text,p_query text,p_registrant uuid,p_page integer,p_view text,p_snapshot uuid,p_expected_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=spark_private.require_settlement_admin_v1016(); doc jsonb; live_doc jsonb; selected spark_private.settlement_closes_v1016;
  rows jsonb; revision text; companies jsonb; details jsonb; trend jsonb; closes jsonb; count_rows integer; company_count integer; page_count integer; safe_page integer;
begin
  if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01' or p_month>'2100-12-01' or p_mode is null or p_mode not in ('work','receipts')
    or p_view is null or p_view not in ('companies','details') or p_page is null or p_page<1 or p_page>100000
    or (p_program is not null and p_program not in ('spark','spark_plus','spark_s','spark_s_plus')) or p_query is null or length(p_query)>100 then raise exception '조회 조건을 확인해 주세요.'; end if;
  live_doc:=spark_private.settlement_document_v1016(actor,p_month);
  if p_snapshot is not null then
    select * into selected from spark_private.settlement_closes_v1016 where id=p_snapshot and owner_id=actor and month=p_month;
    if not found then raise exception '마감 기록을 조회할 수 없습니다.'; end if;
    doc:=selected.document;
  else doc:=live_doc; end if;
  revision:=md5(doc::text);
  if p_expected_revision is not null and p_expected_revision<>revision then raise exception '조회 중 정산 내역이 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  select coalesce(jsonb_agg(r order by r->>'id'),'[]') into rows from jsonb_array_elements(doc->p_mode) r
    where (p_program is null or r->>'program'=p_program) and (p_registrant is null or r->>'registrantId'=p_registrant::text)
      and (btrim(p_query)='' or position(lower(btrim(p_query)) in lower(concat_ws(' ',r->>'groupName',r->>'username',r->>'storeName',r->>'orderNumber',r->>'payer')))>0);
  count_rows:=jsonb_array_length(rows);
  with grouped as (select r->>'registrantId' id,jsonb_agg(r order by coalesce(r->>'occurredAt',r->>'startDate') desc,r->>'id') items from jsonb_array_elements(rows) r group by 1),
  totals as (select id,items,spark_private.monthly_totals_v1016(items,p_mode) summary from grouped)
  select count(*),coalesce(jsonb_agg(jsonb_build_object('registrantId',id,'groupName',items->0->>'groupName','username',items->0->>'username','summary',summary)
    order by case when p_mode='work' then (summary->>'waitingAmount')::bigint else (summary->>'totalAmount')::bigint end desc,id),'[]') into company_count,companies from totals;
  page_count:=greatest(1,ceil((case when p_view='companies' then company_count else count_rows end)::numeric/50)::integer);safe_page:=least(p_page,page_count);
  if p_view='companies' then
    select coalesce(jsonb_agg(x),'[]') into companies from (select value x from jsonb_array_elements(companies) with ordinality where ordinality>(safe_page-1)*50 and ordinality<=safe_page*50 order by ordinality) s;
    details:='[]';
  else
    select coalesce(jsonb_agg(x),'[]') into details from (select r x from jsonb_array_elements(rows) r order by coalesce(r->>'occurredAt',r->>'startDate') desc,r->>'id' limit 50 offset (safe_page-1)*50) s;
    companies:='[]';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'createdAt',created_at,'reason',reason,'revision',c.revision) order by version desc),'[]') into closes from spark_private.settlement_closes_v1016 c where owner_id=actor and month=p_month;
  -- The comparison chart always uses current records and the same filters, labelled in UI.
  with months as (select generate_series((p_month-interval '11 months')::date,p_month,interval '1 month')::date as month),
  facts as (
    select date_trunc('month',o.start_date)::date as month,p.total_amount amount,o.created_by registrant,p.program_type program,
      concat_ws(' ',u.group_name,o.creator_username,p.store_name,p.order_number,p.payer_username) label
    from public.payment_steps p join public.orders o on o.id=p.order_id left join public.profiles u on u.id=o.created_by
    where p_mode='work' and p.payee_id=actor and o.start_date>=(p_month-interval '11 months')::date and o.start_date<(p_month+interval '1 month')::date
    union all
    select date_trunc('month',e.occurred_at at time zone 'Asia/Seoul')::date,e.amount,(e.row_data->>'registrantId')::uuid,e.row_data->>'program',
      concat_ws(' ',e.row_data->>'groupName',e.row_data->>'username',e.row_data->>'storeName',e.row_data->>'orderNumber',e.row_data->>'payer')
    from spark_private.settlement_events_v1016 e where p_mode='receipts' and e.payee_id=actor
      and e.occurred_at>=((p_month-interval '11 months')::timestamp at time zone 'Asia/Seoul') and e.occurred_at<((p_month+interval '1 month')::timestamp at time zone 'Asia/Seoul')
  ), sums as (select month,sum(amount) amount from facts where (p_program is null or program=p_program) and (p_registrant is null or registrant=p_registrant)
    and (btrim(p_query)='' or position(lower(btrim(p_query)) in lower(label))>0) group by month)
  select jsonb_agg(jsonb_build_object('month',m.month,'amount',coalesce(s.amount,0)) order by m.month) into trend from months m left join sums s using(month);
  return jsonb_build_object('month',p_month,'mode',p_mode,'asOf',coalesce(selected.created_at,statement_timestamp()),'revision',revision,
    'summary',spark_private.monthly_totals_v1016(rows,p_mode),'companies',companies,'rows',details,'totalCount',case when p_view='companies' then company_count else count_rows end,
    'page',safe_page,'totalPages',page_count,'trend',trend,'snapshots',closes,'snapshotId',p_snapshot,'liveRevision',md5(live_doc::text),
    'changedSinceClose',p_snapshot is not null and selected.revision<>md5(live_doc::text),
    'liveTotals',jsonb_build_object('work',spark_private.monthly_totals_v1016(live_doc->'work','work'),'receipts',spark_private.monthly_totals_v1016(live_doc->'receipts','receipts')),
    'coverage',jsonb_build_object('legacyCount',(select count(*) from jsonb_array_elements(rows) r where r->>'source'='legacy_current'),
      'trackingSince',(select min(recorded_at) from spark_private.settlement_events_v1016)));
end $$;

create function spark_private.save_monthly_settlement_v1016(p_month date,p_request_id uuid,p_expected_revision text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=spark_private.require_settlement_admin_v1016(); doc jsonb; revision text; saved spark_private.settlement_closes_v1016; next_version integer;
begin
  if p_month is null or extract(day from p_month)<>1 or p_month<'2000-01-01' or p_month>=date_trunc('month',now() at time zone 'Asia/Seoul')::date
    or p_request_id is null or p_expected_revision is null or p_reason is null or length(btrim(p_reason)) not between 2 and 300 then raise exception '지난달까지 저장할 수 있습니다. 마감 사유를 2~300자로 입력해 주세요.'; end if;
  -- Serialize concurrent saves for one administrator/month, without locking operations.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_month::text,1016));
  select * into saved from spark_private.settlement_closes_v1016 where id=p_request_id;
  if found then
    if saved.owner_id<>actor or saved.month<>p_month or saved.reason<>btrim(p_reason) or saved.revision<>p_expected_revision then raise exception '같은 마감 요청의 내용이 변경되었습니다.'; end if;
    return jsonb_build_object('id',saved.id,'version',saved.version,'createdAt',saved.created_at);
  end if;
  doc:=spark_private.settlement_document_v1016(actor,p_month);revision:=md5(doc::text);
  if revision<>p_expected_revision then raise exception '마감 대상이 변경되었습니다. 새로고침 후 다시 확인해 주세요.'; end if;
  select coalesce(max(version),0)+1 into next_version from spark_private.settlement_closes_v1016 where owner_id=actor and month=p_month;
  insert into spark_private.settlement_closes_v1016(id,owner_id,month,version,reason,revision,document)
    values(p_request_id,actor,p_month,next_version,btrim(p_reason),revision,doc) returning * into saved;
  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
    select id,username,role,'settlement.month_closed','system',saved.id,to_char(p_month,'YYYY-MM'),
      jsonb_build_object('month',p_month,'version',saved.version,'reason',btrim(p_reason),'revision',revision) from public.profiles where id=actor;
  return jsonb_build_object('id',saved.id,'version',saved.version,'createdAt',saved.created_at);
end $$;

create function public.get_admin_monthly_settlement_v1016(p_month date,p_mode text default 'work',p_program text default null,p_query text default '',p_registrant uuid default null,p_page integer default 1,p_view text default 'companies',p_snapshot uuid default null,p_expected_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$select spark_private.get_monthly_settlement_v1016(p_month,p_mode,p_program,p_query,p_registrant,p_page,p_view,p_snapshot,p_expected_revision)$$;
create function public.save_admin_monthly_settlement_v1016(p_month date,p_request_id uuid,p_expected_revision text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$select spark_private.save_monthly_settlement_v1016(p_month,p_request_id,p_expected_revision,p_reason)$$;

revoke all on function spark_private.settlement_row_v1016(public.payment_steps),spark_private.capture_settlement_event_v1016(),spark_private.require_settlement_admin_v1016(),spark_private.settlement_document_v1016(uuid,date),spark_private.monthly_totals_v1016(jsonb,text),spark_private.get_monthly_settlement_v1016(date,text,text,text,uuid,integer,text,uuid,text),spark_private.save_monthly_settlement_v1016(date,uuid,text,text),public.get_admin_monthly_settlement_v1016(date,text,text,text,uuid,integer,text,uuid,text),public.save_admin_monthly_settlement_v1016(date,uuid,text,text) from public,anon,authenticated,service_role;
grant usage on schema spark_private to authenticated;
grant execute on function spark_private.get_monthly_settlement_v1016(date,text,text,text,uuid,integer,text,uuid,text),spark_private.save_monthly_settlement_v1016(date,uuid,text,text),public.get_admin_monthly_settlement_v1016(date,text,text,text,uuid,integer,text,uuid,text),public.save_admin_monthly_settlement_v1016(date,uuid,text,text) to authenticated;
insert into public.app_schema_versions(version,description) values('10.16.0','관리자 월별 정산 조회 및 마감 기록');
notify pgrst,'reload schema';
