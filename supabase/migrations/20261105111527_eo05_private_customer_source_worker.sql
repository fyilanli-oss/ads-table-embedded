begin;
set local role adstable_owner;

-- Prepared only. No role login, key, schedule or live activation.
create table privacy.source_worker_operations (
 operation_id uuid primary key,
 run_id uuid unique references privacy.deletion_runs(id) on delete cascade,
 workspace_id uuid references app.workspaces(id) on delete cascade,
 install_generation bigint,
 status text not null check(status in ('reserved','idle','held','completed')),
 deadline_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 retain_until timestamptz not null default (clock_timestamp()+interval '8760 hours'),
 receipt jsonb not null default '{}'::jsonb check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=2048),
 check((status='idle' and run_id is null and workspace_id is null and install_generation is null)
    or (status<>'idle' and run_id is not null and workspace_id is not null and install_generation>0))
);
create unique index source_worker_reserved_workspace on privacy.source_worker_operations(workspace_id,install_generation) where status='reserved';
alter table privacy.source_worker_operations enable row level security;
alter table privacy.source_worker_operations force row level security;
create policy source_worker_owner_all on privacy.source_worker_operations for all to adstable_owner using(true) with check(true);
revoke all on privacy.source_worker_operations from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function privacy.inspect_customer_source_work(p_operation uuid) returns jsonb
language sql stable security definer set search_path='' as $f$
 select coalesce((select jsonb_build_object('operationId',operation_id,'status',
 case when status='reserved' and deadline_at<=statement_timestamp() then 'unknown' else status end,
 'receipt',receipt) from privacy.source_worker_operations where operation_id=p_operation),
 jsonb_build_object('operationId',p_operation,'status','not_observed','rollbackProven',false))
$f$;

create function privacy.reserve_customer_source_work(p_operation uuid,p_deadline timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare o privacy.source_worker_operations%rowtype;r privacy.deletion_runs%rowtype;
begin
 -- Same queue lock as the legacy consumer; no concurrent claim of an old snapshot.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-deletion-queue-worker',0));
 perform 1 from operations.refresh_control where singleton for update;
 select * into o from privacy.source_worker_operations where operation_id=p_operation for update;
 if found then
  if o.deadline_at is distinct from p_deadline then raise exception 'PRIVACY_OPERATION_CONFLICT';end if;
  return jsonb_build_object('status','recorded','observation',privacy.inspect_customer_source_work(p_operation));
 end if;
 if p_operation is null or p_deadline is null or p_deadline<=clock_timestamp() or p_deadline>clock_timestamp()+interval '60 seconds' then raise exception 'PRIVACY_OPERATION_INVALID';end if;
 select run.* into r from privacy.deletion_runs run join privacy.webhook_claims c on c.id=run.claim_id
 where run.kind in ('customer_redact','customer_data_request') and run.status in ('pending','failed')
 and c.workspace_id=run.workspace_id and c.install_generation=run.install_generation and c.shop_identity_sha256=run.shop_identity_sha256
 and c.topic=case run.kind when 'customer_redact' then 'customers/redact' else 'customers/data_request' end
 and privacy.valid_source_request_scope(c.source_request_scope)
 and not exists(select 1 from privacy.source_worker_operations x where x.run_id=run.id or
   (x.workspace_id=run.workspace_id and x.install_generation=run.install_generation and x.status='reserved'))
 and not exists(select 1 from privacy.deletion_runs x where x.workspace_id=run.workspace_id and x.install_generation=run.install_generation
   and x.kind in ('shop_redact','merchant_delete_my_data') and x.status in ('pending','running','failed'))
 order by case run.kind when 'customer_redact' then 0 else 1 end,run.deadline_at,run.requested_at,run.id
 for update of run skip locked limit 1;
 if not found then
  insert into privacy.source_worker_operations(operation_id,status,deadline_at) values(p_operation,'idle',p_deadline);
  return jsonb_build_object('status','idle');
 end if;
 insert into privacy.source_worker_operations(operation_id,run_id,workspace_id,install_generation,status,deadline_at)
 values(p_operation,r.id,r.workspace_id,r.install_generation,'reserved',p_deadline);
 return jsonb_build_object('status','reserved','runId',r.id,'kind',r.kind);
end $f$;

create function privacy.lock_customer_source_work(p_operation uuid) returns uuid
language plpgsql security definer set search_path='' as $f$
declare o privacy.source_worker_operations%rowtype;r privacy.deletion_runs%rowtype;
begin
 perform 1 from operations.refresh_control where singleton for update;
 select * into o from privacy.source_worker_operations where operation_id=p_operation for update;
 if not found or o.status<>'reserved' or o.deadline_at<=clock_timestamp() then raise exception 'PRIVACY_LEASE_UNAVAILABLE';end if;
 select * into r from privacy.deletion_runs where id=o.run_id for update;
 if not found or r.status not in ('pending','failed') or r.kind not in ('customer_redact','customer_data_request')
 or r.workspace_id<>o.workspace_id or r.install_generation<>o.install_generation
 or exists(select 1 from privacy.deletion_runs x where x.workspace_id=o.workspace_id and x.install_generation=o.install_generation
 and x.kind in ('shop_redact','merchant_delete_my_data') and x.status in ('pending','running','failed','completed'))
 then raise exception 'PRIVACY_LEASE_UNAVAILABLE';end if;
 return r.id;
end $f$;

create function privacy.worker_customer_source_snapshot(p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare r uuid;v jsonb;
begin
 r:=privacy.lock_customer_source_work(p_operation);
 v:=privacy.customer_source_snapshot(r);
 if octet_length(v::text)>40000000 then raise exception 'PRIVACY_SNAPSHOT_LIMIT';end if;
 return v;
end $f$;

create function privacy.complete_customer_source_work(p_operation uuid,p_digest text,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare r uuid;v jsonb;
begin
 r:=privacy.lock_customer_source_work(p_operation);
 -- No disclosure receipt parameter exists on this authority.
 v:=privacy.complete_customer_source_run(r,p_digest,p_changes,null);
 if (select deadline_at from privacy.source_worker_operations where operation_id=p_operation)<=clock_timestamp() then raise exception 'PRIVACY_LEASE_EXPIRED';end if;
 update privacy.source_worker_operations set status='completed',
 receipt=jsonb_build_object('status',v->>'status','manifestId',v->>'manifestId','result',v->>'result')
 where operation_id=p_operation;
 return v;
end $f$;

create function privacy.hold_customer_source_work(p_operation uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $f$
begin
 if p_reason is null or p_reason not in ('disclosure_required','review_required') then raise exception 'PRIVACY_HOLD_INVALID';end if;
 perform privacy.lock_customer_source_work(p_operation);
 update privacy.source_worker_operations set status='held',receipt=jsonb_build_object('reason',p_reason) where operation_id=p_operation;
 return privacy.inspect_customer_source_work(p_operation);
end $f$;

create function privacy.clear_customer_source_work() returns trigger
language plpgsql security definer set search_path='' as $f$
begin
 if new.status='completed' and new.kind in ('shop_redact','merchant_delete_my_data') then
  delete from privacy.source_worker_operations where workspace_id=new.workspace_id and install_generation=new.install_generation;
  update privacy.deletion_runs set status='superseded',updated_at=clock_timestamp()
   where workspace_id=new.workspace_id and install_generation=new.install_generation
   and kind in ('customer_data_request','customer_redact') and status in ('pending','failed');
 end if;
 return new;
end $f$;
create trigger clear_customer_source_work after update of status on privacy.deletion_runs
 for each row execute function privacy.clear_customer_source_work();

revoke all on function privacy.inspect_customer_source_work(uuid),privacy.reserve_customer_source_work(uuid,timestamptz),
 privacy.lock_customer_source_work(uuid),privacy.worker_customer_source_snapshot(uuid),
 privacy.complete_customer_source_work(uuid,text,jsonb),privacy.hold_customer_source_work(uuid,text),
 privacy.clear_customer_source_work()
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create or replace function privacy.process_deletion_queue(
  p_batch_size integer default 25
)
returns table (
  lock_acquired boolean,
  selected_count integer,
  completed_count integer,
  superseded_count integer,
  failed_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate record;
  execution_status text;
  v_selected integer := 0;
  v_completed integer := 0;
  v_superseded integer := 0;
  v_failed integer := 0;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'INVALID_DELETION_QUEUE_BATCH_SIZE';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('privacy-deletion-queue-worker', 0)
  ) then
    return query select false, 0, 0, 0, 0;
    return;
  end if;

  for candidate in
    select run.id
      from privacy.deletion_runs as run
     where (run.status = 'pending'
        or (
          run.status = 'failed'
          and run.attempt_count < 20
          and run.updated_at <= statement_timestamp() - pg_catalog.make_interval(
            secs => (
              300 * pg_catalog.power(
                2::numeric,
                least(greatest(run.attempt_count - 1, 0), 6)
              )
            )::double precision
          )
        )
        ) and not exists (select 1 from privacy.source_worker_operations op where op.run_id=run.id and op.status in ('reserved','held'))
     order by run.deadline_at asc, run.requested_at asc, run.id asc
     for update skip locked
     limit p_batch_size
  loop
    if exists(select 1 from privacy.source_worker_operations op where op.run_id=candidate.id and op.status in ('reserved','held')) then continue;end if;
    v_selected := v_selected + 1;
    begin
      select result.deletion_status
        into execution_status
        from privacy.execute_deletion_run(candidate.id) as result;

      if execution_status = 'completed' then
        v_completed := v_completed + 1;
      elsif execution_status = 'superseded' then
        v_superseded := v_superseded + 1;
      else
        raise exception 'UNEXPECTED_DELETION_EXECUTION_STATUS';
      end if;
    exception when others then
      update privacy.deletion_runs as run
         set status = 'failed',
             started_at = coalesce(run.started_at, statement_timestamp()),
             attempt_count = run.attempt_count + 1,
             last_error_code = 'DELETION_EXECUTION_SQLSTATE_' || sqlstate,
             updated_at = statement_timestamp()
       where run.id = candidate.id
         and run.status in ('pending', 'failed');
      v_failed := v_failed + 1;
    end;
  end loop;

  return query
    select true, v_selected, v_completed, v_superseded, v_failed;
end
$function$;

revoke all on function privacy.process_deletion_queue(integer)
  from public, anon, authenticated, service_role, adstable_runtime;
grant execute on function privacy.process_deletion_queue(integer)
  to postgres;


reset role;
commit;
