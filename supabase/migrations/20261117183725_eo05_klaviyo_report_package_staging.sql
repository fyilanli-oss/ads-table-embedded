begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Staging lives for one PostgreSQL transaction. An interrupted transaction
-- leaves neither staged rows nor a visible change to the previous report.
create function analytics.stage_klaviyo_daily_report_package(
  o jsonb, p jsonb, c jsonb, d timestamptz, ordinal integer, package_count integer
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  workspace uuid := (o->>'workspaceId')::uuid;
  generation bigint := (o->>'generation')::bigint;
  account text := o->>'accountId';
  job text := c->'sourceContext'->>'job_id';
  claim_fence bigint := (c->'sourceContext'->>'fence')::bigint;
  day date := (c->>'businessDate')::date;
  operation uuid := (p->>'operationId')::uuid;
  staged_count integer;
  row_count integer;
  binding text;
  package_digest text;
  staging_relation oid;
begin
  perform evidence.assert_source_owner(o);
  if o->>'provider' is distinct from 'klaviyo' or operation is null
    or package_count is null or package_count not between 2 and 20
    or ordinal is null or ordinal<0 or ordinal>=package_count
    or jsonb_typeof(p) is distinct from 'object' or p->>'version' is distinct from 'eo05b-storage-v1'
    or jsonb_typeof(p->'rows') is distinct from 'array' then
    raise exception 'KLAVIYO_REPORT_PACKAGE_INVALID';
  end if;
  row_count:=jsonb_array_length(p->'rows');
  if row_count not between 1 and 200
    or octet_length(analytics.dataset_json(jsonb_build_object('write',p,'context',c)))>1048576 then
    raise exception 'KLAVIYO_REPORT_PACKAGE_LIMIT';
  end if;
  if d is null or d<=clock_timestamp()
    or operations.refresh_claim_is_current(workspace,generation,'klaviyo',account,job,claim_fence) is not true
    or not exists (
      select 1 from operations.refresh_work_bindings b
      join operations.refresh_work_progress s on s.fence=b.fence and s.workspace_id=b.workspace_id
        and s.install_generation=b.install_generation and s.provider=b.provider and s.account_id=b.account_id and s.job_id=b.job_id
      where b.workspace_id=workspace and b.install_generation=generation and b.provider='klaviyo'
        and b.account_id=account and b.job_id=job and b.fence=claim_fence
        and b.from_date=day and b.to_date=day and s.from_date=day and s.to_date=day
        and s.stage='ready_for_dataset' and b.source=c->'sourceContext'->'snapshot'
        and extract(epoch from d)*1000<=b.deadline_at_ms
    ) then raise exception 'SCHEDULED_DATASET_CLAIM_REQUIRED'; end if;

  staging_relation:=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage');
  if staging_relation is null and ordinal=0 then
    create temporary table pg_temp.adstable_klaviyo_daily_report_stage (
      package_ordinal integer primary key,
      day_binding text not null,
      body jsonb not null,
      digest text not null
    ) on commit drop;
    staging_relation:=pg_catalog.to_regclass('pg_temp.adstable_klaviyo_daily_report_stage');
  end if;
  if not exists (select 1 from pg_catalog.pg_class
    where oid=staging_relation and relnamespace=pg_catalog.pg_my_temp_schema()
      and relowner=current_user::regrole and relpersistence='t' and relkind='r') then
    raise exception 'KLAVIYO_REPORT_STAGE_REQUIRED';
  end if;
  binding:=analytics.dataset_digest(jsonb_build_object(
    'owner',o,'context',c,'deadline',d,'operationId',operation,'policy',p->'policy','packageCount',package_count));
  select count(*) into staged_count from pg_temp.adstable_klaviyo_daily_report_stage;
  if staged_count<>ordinal or exists (select 1 from pg_temp.adstable_klaviyo_daily_report_stage where day_binding<>binding) then
    raise exception 'KLAVIYO_REPORT_PACKAGE_SEQUENCE';
  end if;
  package_digest:=analytics.dataset_digest(jsonb_build_object('write',p,'context',c));
  insert into pg_temp.adstable_klaviyo_daily_report_stage (package_ordinal,day_binding,body,digest)
  values (ordinal,binding,p,package_digest);
  return jsonb_build_object('status','staged','operationId',operation,'ordinal',ordinal,
    'packageCount',package_count,'rowCount',row_count,'digest',package_digest);
end $fn$;

revoke all on function analytics.stage_klaviyo_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
