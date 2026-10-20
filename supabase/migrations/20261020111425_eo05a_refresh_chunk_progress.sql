begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

create table operations.refresh_work_progress (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null check (install_generation>0),
  provider text not null check (provider in ('meta','google_ads','klaviyo')),
  account_id text not null check (length(account_id) between 1 and 256),
  job_id text not null check (length(job_id) between 1 and 256),
  fence bigint primary key check (fence between 1 and 9007199254740991),
  stage text not null check (stage in ('checking_authority','request_intent','response_received','ready_for_dataset')),
  from_date date not null,
  to_date date not null check (to_date>=from_date),
  rows_observed bigint not null default 0 check (rows_observed between 0 and 9007199254740991),
  bytes_observed bigint not null default 0 check (bytes_observed between 0 and 9007199254740991),
  observed_at timestamptz not null default statement_timestamp()
);
create index refresh_work_progress_account_idx on operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id);
alter table operations.refresh_work_progress enable row level security;
alter table operations.refresh_work_progress force row level security;
create policy refresh_work_progress_owner on operations.refresh_work_progress to adstable_owner using (true) with check (true);
revoke all on operations.refresh_work_progress from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function operations.advance_refresh_work_stage(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_expected text,p_stage text,p_rows bigint,p_bytes bigint,p_from date,p_to date)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare previous text;
begin
  perform 1 from operations.refresh_control where singleton for update;
  if not operations.refresh_claim_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence) then return false; end if;
  if p_stage is null or p_from is null or p_to is null or p_from>p_to or p_rows is null or p_bytes is null or p_rows<0 or p_bytes<0
    or p_rows>9007199254740991 or p_bytes>9007199254740991
    or ((p_expected is null and p_stage='checking_authority')
      or (p_expected='checking_authority' and p_stage='request_intent')
      or (p_expected='request_intent' and p_stage='response_received')
      or (p_expected='response_received' and p_stage='ready_for_dataset')) is not true then raise exception 'REFRESH_STAGE_INVALID'; end if;
  select stage into previous from operations.refresh_work_progress where fence=p_fence;
  if previous is distinct from p_expected then return false; end if;
  if exists (select 1 from operations.refresh_work_progress where fence=p_fence and (from_date<>p_from or to_date<>p_to)) then return false; end if;
  if p_stage<>'ready_for_dataset' and (p_rows<>0 or p_bytes<>0) then raise exception 'REFRESH_STAGE_COUNTS_INVALID'; end if;
  if not exists (select 1 from operations.refresh_runs where fence=p_fence
    and (cost->>'rows')::numeric>=p_rows and (cost->>'bytes')::numeric>=p_bytes) then raise exception 'REFRESH_STAGE_BUDGET_EXCEEDED'; end if;
  insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date,rows_observed,bytes_observed)
    values (p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_stage,p_from,p_to,p_rows,p_bytes)
    on conflict (fence) do update set stage=excluded.stage,rows_observed=excluded.rows_observed,bytes_observed=excluded.bytes_observed,observed_at=statement_timestamp();
  return true;
end
$fn$;

create function operations.read_refresh_work_stage(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint)
returns jsonb language sql stable security definer set search_path='' as $fn$
  select to_jsonb(p) from operations.refresh_work_progress as p where workspace_id=p_workspace and install_generation=p_generation
    and provider=p_provider and account_id=p_account and job_id=p_job and fence=p_fence
$fn$;

-- Preserve prior classifications without editing accepted migration files.
alter function operations.refresh_stop_classification(text) rename to refresh_stop_classification_before_progress;
revoke all on function operations.refresh_stop_classification_before_progress(text) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.refresh_stop_classification(p_reason text) returns jsonb language sql immutable set search_path='' as $fn$
  select case when p_reason in ('validation_failed_after_request','authority_check_failed_after_request') then
    jsonb_build_object('state','paused','call_state','settled','source','unknown','action',
      case when p_reason='authority_check_failed_after_request' then 'check_authority' else 'investigate' end)
    else operations.refresh_stop_classification_before_progress(p_reason) end
$fn$;

-- A chunk's provider response is not a Dataset commit. Existing metadata-only probes stay distinct.
create or replace function operations.finish_refresh_work(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,p_outcome text)
returns boolean language plpgsql security definer set search_path='' as $fn$
begin
  perform 1 from operations.refresh_control where singleton for update;
  if operations.refresh_account_is_held(p_workspace,p_generation,p_provider,p_account) then return false; end if;
  if exists (select 1 from operations.refresh_work_progress where fence=p_fence
    and (p_outcome='completed' or stage='request_intent')) then return false; end if;
  return operations.finish_refresh_work_before_stops(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_outcome);
end
$fn$;

revoke all on function operations.refresh_stop_classification(text),
  operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date),
  operations.read_refresh_work_stage(uuid,bigint,text,text,text,bigint)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date),
  operations.read_refresh_work_stage(uuid,bigint,text,text,text,bigint) to adstable_refresh_coordinator;
reset role;
commit;
