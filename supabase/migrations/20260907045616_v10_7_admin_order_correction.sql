begin;
do $$ begin
  if not exists (select 1 from public.app_schema_versions where version='v10.6.0') then
    raise exception 'v10.6.0 must be applied first';
  end if;
end $$;

-- One shared preview is re-evaluated under row locks during apply.
create function public.admin_preview_order_correction_v107(p_order_id uuid, p_expected_version integer, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles; o public.orders; n public.orders;
  impact text; difference bigint; blocked text; cnt integer; confirmed integer;
  today date := (now() at time zone 'Asia/Seoul')::date;
  s record; qty bigint; target_supply bigint; target_vat bigint;
begin
  select * into a from public.profiles where id=auth.uid();
  if a.id is null or a.role is distinct from 'admin' or a.approval_status is distinct from 'approved'
    or a.active is not true or coalesce(a.is_operations_manager,false) then
    raise exception '승인된 활성 관리자만 작업을 수정할 수 있습니다.' using errcode='42501';
  end if;
  select * into o from public.orders where id=p_order_id;
  if o.id is null then raise exception '작업을 찾을 수 없습니다.'; end if;
  if p_expected_version is null or p_expected_version <> o.lock_version then
    raise exception '다른 사용자가 먼저 작업을 변경했습니다. 새로고침 후 다시 시도해 주세요.' using errcode='40001';
  end if;
  if coalesce(length(trim(p_reason)),0) not between 2 and 500 then raise exception '수정 사유는 2~500자로 입력해 주세요.'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' then raise exception '수정 항목이 필요합니다.'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('store_name','keyword','place_url','daily_shots','operation_days','start_date','memo')) then
    raise exception '허용되지 않은 수정 항목입니다. 프로그램과 등록자 관계는 변경할 수 없습니다.';
  end if;
  if exists(select 1 from jsonb_each_text(p_changes) where key in ('daily_shots','operation_days') and (value is null or value !~ '^[0-9]+$')) then
    raise exception '수량과 기간은 1 이상의 정수여야 합니다.';
  end if;
  n := jsonb_populate_record(o,p_changes);
  n.store_name := trim(n.store_name); n.keyword := trim(n.keyword); n.place_url := trim(n.place_url);
  if coalesce(length(n.store_name),0) not between 1 and 50 or coalesce(length(n.keyword),0) not between 1 and 50 then raise exception '상호명과 키워드는 1~50자로 입력해 주세요.'; end if;
  if n.memo is null or length(n.memo)>300 then raise exception '메모는 300자 이하로 입력해 주세요.'; end if;
  if n.daily_shots is null or n.operation_days is null or n.daily_shots<1 or n.operation_days<1 then raise exception '수량과 기간은 1 이상의 정수여야 합니다.'; end if;
  if n.start_date is null then raise exception '시작일이 필요합니다.'; end if;
  if n.place_url is null or n.place_url !~* '^https?://([a-z0-9-]+\.)*(naver\.com|naver\.me)([/:?#]|$)' then raise exception '네이버 플레이스 URL을 확인해 주세요.'; end if;
  n.mid := spark_private.assignment_mid_v106(n.place_url);
  if n.mid='' then raise exception '플레이스 URL에서 MID를 확인할 수 없습니다.'; end if;
  qty := n.daily_shots::bigint*n.operation_days::bigint;
  n.end_date := n.start_date+(n.operation_days-1);
  n.supply_amount := qty*o.price_per_shot::bigint;
  n.vat_amount := round(n.supply_amount*0.1);
  n.total_amount := n.supply_amount+n.vat_amount;
  difference := n.total_amount-o.total_amount;
  impact := case when difference=0 then 'financial_neutral' when difference>0 then 'increase' else 'decrease' end;
  select count(*),count(*) filter(where confirmed_at is not null) into cnt,confirmed from public.payment_steps where order_id=o.id;
  if o.archived_at is not null then blocked := '보관된 작업은 복원 후 수정해 주세요.';
  elsif o.status not in ('입금대기','입금완료','구동중','정지','만료') then blocked := '현재 상태에서는 수정할 수 없습니다.';
  elsif o.price_per_shot<=0 then blocked := '기존 주문 단가를 확인할 수 없습니다.';
  elsif n.start_date is distinct from o.start_date and (o.status not in ('입금대기','입금완료') or o.activated_at is not null or o.start_date<=today or n.start_date<=today) then blocked := '시작 전 입금대기·입금완료 작업만 시작일을 변경할 수 있습니다.';
  elsif o.status='만료' and (n.daily_shots<>o.daily_shots or n.operation_days<>o.operation_days or n.start_date<>o.start_date or difference<>0) then blocked := '만료 작업은 상호명·키워드·URL·메모 정정만 가능합니다.';
  elsif o.status<>'만료' and n.end_date<today then blocked := '변경 종료일이 오늘보다 과거입니다. 기간과 운영 상태를 먼저 확인해 주세요.';
  elsif difference<0 and (confirmed>0 or o.status<>'입금대기') then blocked := '환불/크레딧 처리가 필요한 수정입니다. 자동 수정할 수 없습니다.';
  elsif difference<>0 and o.status in ('구동중','정지') then blocked := '구동중·정지 작업의 금액 변경은 별도 추가정산 정책 확인이 필요합니다. 정산 영향 없는 정정만 가능합니다.';
  elsif difference<>0 and (cnt=0 or o.program_transfer_state<>'none' or coalesce(o.settlement_reversal_pending,false)) then blocked := '기존 변경 정산 또는 입금확인 취소를 먼저 처리해 주세요.';
  end if;
  -- Preserve each party's stored unit price and original history. Never reprice from profiles.
  if difference<>0 and blocked is null then
    if not exists(select 1 from public.payment_steps where order_id=o.id and payer_id=o.created_by)
      or (select coalesce(sum(total_amount),0) from public.payment_steps where order_id=o.id and payer_id=o.created_by)<>o.total_amount then
      blocked := '주문 총액과 등록자 정산 금액이 일치하지 않습니다. 정산 이력을 확인해 주세요.';
    elsif exists(select 1 from public.payment_steps where order_id=o.id and (program_type<>o.program_type or step_kind<>'standard' or program_transfer_id is not null)) then
      blocked := '프로그램 변경 정산 이력이 있어 금액 변경은 별도 확인이 필요합니다.';
    else
      for s in select payer_id,payee_id,min(unit_price) unit_price,count(distinct unit_price) prices,
        sum(supply_amount) supply,sum(vat_amount) vat,
        coalesce(sum(supply_amount) filter(where confirmed_at is not null),0) paid_supply,
        coalesce(sum(vat_amount) filter(where confirmed_at is not null),0) paid_vat,
        count(*) filter(where confirmed_at is null) pending
        from public.payment_steps where order_id=o.id group by payer_id,payee_id
      loop
        target_supply := qty*s.unit_price; target_vat := round(target_supply*0.1);
        if s.prices<>1 or s.unit_price<=0 or s.pending>1
          or s.supply<>o.daily_shots::bigint*o.operation_days::bigint*s.unit_price
          or s.vat<>round(s.supply*0.1)
          or target_supply<s.paid_supply or target_vat<s.paid_vat then
          blocked := '정산 단계의 단가·금액 이력을 확인해야 합니다. 자동 수정할 수 없습니다.'; exit;
        end if;
      end loop;
    end if;
    if difference>0 and o.status='입금완료' then n.status:='입금대기'; end if;
  end if;
  return jsonb_build_object('allowed',blocked is null,'blockReason',blocked,'financialImpact',impact,
    'differenceAmount',difference,'before',to_jsonb(o),'after',to_jsonb(n),'confirmedPaymentCount',confirmed);
end $$;

create function public.admin_apply_order_correction_v107(p_order_id uuid, p_expected_version integer, p_changes jsonb, p_reason text)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles; o public.orders; n public.orders; preview jsonb;
  s record; pending_id uuid; supply bigint; vat bigint; next_step integer;
  adjusted boolean := false; prior_reason text := current_setting('spark.change_reason',true);
begin
  select * into a from public.profiles where id=auth.uid() for share;
  if a.id is null or a.role is distinct from 'admin' or a.approval_status is distinct from 'approved'
    or a.active is not true or coalesce(a.is_operations_manager,false) then
    raise exception '승인된 활성 관리자만 작업을 수정할 수 있습니다.' using errcode='42501';
  end if;
  select * into o from public.orders where id=p_order_id for update;
  perform 1 from public.payment_steps where order_id=p_order_id order by step_order,id for update;
  preview := public.admin_preview_order_correction_v107(p_order_id,p_expected_version,p_changes,p_reason);
  if not (preview->>'allowed')::boolean then raise exception '%',preview->>'blockReason'; end if;
  n := jsonb_populate_record(null::public.orders,preview->'after');
  if preview->>'financialImpact'<>'financial_neutral' then
    -- Expire pending settlement quotes, retain all quote/history rows and step IDs.
    update public.settlement_quotes q set expires_at=least(q.expires_at,now())
    where exists(select 1 from public.settlement_quote_items qi join public.payment_steps ps on ps.id=qi.payment_step_id
      where qi.quote_id=q.id and ps.order_id=o.id and ps.confirmed_at is null);
    select coalesce(max(step_order),0) into next_step from public.payment_steps where order_id=o.id;
    for s in select payer_id,payee_id,max(payer_username) payer_username,max(payee_username) payee_username,
      min(unit_price) unit_price,min(step_order) first_step,
      coalesce(sum(supply_amount) filter(where confirmed_at is not null),0) paid_supply,
      coalesce(sum(vat_amount) filter(where confirmed_at is not null),0) paid_vat
      from public.payment_steps where order_id=o.id group by payer_id,payee_id order by min(step_order)
    loop
      supply := n.daily_shots::bigint*n.operation_days::bigint*s.unit_price;
      vat := round(supply*0.1)-s.paid_vat; supply:=supply-s.paid_supply;
      select id into pending_id from public.payment_steps where order_id=o.id and payer_id=s.payer_id and payee_id=s.payee_id and confirmed_at is null;
      if pending_id is not null then
        update public.payment_steps set supply_amount=supply,vat_amount=vat,total_amount=supply+vat,updated_at=now() where id=pending_id;
        if (preview->>'confirmedPaymentCount')::integer>0 then
          next_step:=next_step+1;
          if next_step>100 then raise exception '정산 보정 단계가 허용 범위를 초과했습니다.'; end if;
          update public.payment_steps set step_order=next_step where id=pending_id;
        end if;
      elsif supply+vat>0 then
        next_step:=next_step+1;
        if next_step>100 then raise exception '정산 보정 단계가 허용 범위를 초과했습니다.'; end if;
        insert into public.payment_steps(order_id,order_number,store_name,program_type,step_kind,step_order,payer_id,payer_username,payee_id,payee_username,unit_price,supply_amount,vat_amount,total_amount)
        values(o.id,o.order_number,n.store_name,o.program_type,'standard',next_step,s.payer_id,s.payer_username,s.payee_id,s.payee_username,s.unit_price,supply,vat,supply+vat);
        adjusted:=true;
      end if;
    end loop;
  end if;
  perform set_config('spark.change_reason',trim(p_reason),true);
  update public.orders set store_name=n.store_name,keyword=n.keyword,place_url=n.place_url,mid=n.mid,
    daily_shots=n.daily_shots,operation_days=n.operation_days,start_date=n.start_date,end_date=n.end_date,memo=n.memo,
    supply_amount=n.supply_amount,vat_amount=n.vat_amount,total_amount=n.total_amount,status=n.status,
    lock_version=o.lock_version+1,updated_at=now()
    where id=o.id returning * into n;
  insert into public.audit_logs(actor_id,actor_username,actor_role,action,entity_type,entity_id,entity_label,metadata)
  values(a.id,a.username,a.role,'order.corrected','order',o.id,o.order_number,jsonb_build_object(
    'order_id',o.id,'order_number',o.order_number,'actor_admin_id',a.id,'actor_admin_username',a.username,
    'reason',trim(p_reason),'before',to_jsonb(o),'after',to_jsonb(n),'financial_impact',preview->>'financialImpact',
    'difference_amount',(preview->>'differenceAmount')::bigint,'payment_adjustment_created',adjusted,'corrected_at',now()));
  perform set_config('spark.change_reason',coalesce(prior_reason,''),true);
  return n;
end $$;
revoke all on function public.admin_preview_order_correction_v107(uuid,integer,jsonb,text) from public,anon;
revoke all on function public.admin_apply_order_correction_v107(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.admin_preview_order_correction_v107(uuid,integer,jsonb,text) to authenticated;
grant execute on function public.admin_apply_order_correction_v107(uuid,integer,jsonb,text) to authenticated;

-- Creation audit enrichment is inserted atomically by the existing trigger.
-- Entry points set a scoped method; never trust a submitted actor or registrant.
do $patch$
declare definition text;
begin
  select pg_get_functiondef('public.audit_orders_trigger()'::regprocedure) into definition;
  if position('''program'', new.program_type' in definition)=0 then raise exception 'Unexpected audit function; review before applying'; end if;
  definition:=replace(definition,'''program'', new.program_type',
    '''input_method'', coalesce(nullif(current_setting(''spark.input_method'',true),''''),''manual''),
      ''order_id'',new.id,''order_number'',new.order_number,
      ''daily_shots'',new.daily_shots,''operation_days'',new.operation_days,
      ''price_per_shot'',new.price_per_shot,''supply_amount'',new.supply_amount,''vat_amount'',new.vat_amount,
      ''creator_username'',new.creator_username,''registrant_username'',new.creator_username,
      ''actor_username'',(select username from public.profiles where id=auth.uid()),
      ''actor_id'',auth.uid(),''store_name'',new.store_name,''mid'',new.mid,
      ''program'', new.program_type');
  execute definition;
  select pg_get_functiondef('public.create_orders_bulk_v10(jsonb)'::regprocedure) into definition;
  definition:=replace(definition,'  item_count integer;','  item_count integer; prior_method text := current_setting(''spark.input_method'',true);');
  definition:=replace(definition,'  item_count :=','  perform set_config(''spark.input_method'',''excel'',true);' || chr(10) || '  item_count :=');
  definition:=replace(definition,'end loop;','end loop; perform set_config(''spark.input_method'',coalesce(prior_method,''''),true);');
  execute definition;
  select pg_get_functiondef('spark_private.admin_assign_orders_v106(jsonb,uuid,text)'::regprocedure) into definition;
  definition:=replace(definition,'  v_mid text;','  v_mid text; prior_method text := current_setting(''spark.input_method'',true);');
  definition:=replace(definition,'  -- Fetch and lock','  perform set_config(''spark.input_method'',''admin_''||p_method,true);' || chr(10) || '  -- Fetch and lock');
  definition:=replace(definition,'  return jsonb_build_object(''items'', v_results);','  perform set_config(''spark.input_method'',coalesce(prior_method,''''),true); return jsonb_build_object(''items'', v_results);');
  execute definition;
end $patch$;
revoke all on function public.audit_orders_trigger() from public,anon,authenticated;
insert into public.app_schema_versions(version,description) values('v10.7.0','Safe admin order correction and intake audit provenance');
notify pgrst,'reload schema';
commit;
