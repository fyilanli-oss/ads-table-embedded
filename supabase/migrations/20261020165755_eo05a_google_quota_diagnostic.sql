begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Fixed enums only on existing private RLS operations; NOT shared-stop rules.
alter table operations.api_quota_operations add column google_quota_scope text check(google_quota_scope in ('ACCOUNT','DEVELOPER'));
alter table operations.api_quota_operations add column google_quota_code text check(google_quota_code in (
  'RESOURCE_EXHAUSTED','RESOURCE_TEMPORARILY_EXHAUSTED','EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION','EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION'));
alter table operations.api_quota_operations add constraint api_quota_google_diagnostic_shape check(
  (google_quota_scope is null and google_quota_code is null) or (provider='google_ads' and google_quota_scope is not null and google_quota_code is not null));

create function operations.stop_shared_api_quota_google_observed(p_operation text,p_attempt uuid,p_scope text,p_code text) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare op operations.api_quota_operations%rowtype; accepted boolean;
begin
  if p_operation is null or p_operation !~ '^[a-f0-9]{64}$' or p_attempt is null
    or p_scope is null or p_scope not in ('ACCOUNT','DEVELOPER') or p_code is null
    or p_code not in ('RESOURCE_EXHAUSTED','RESOURCE_TEMPORARILY_EXHAUSTED','EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION','EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION') then raise exception 'API_QUOTA_INPUT_INVALID'; end if;
  -- Same operation -> domain -> charged UUID policies order, delegated to existing implementation.
  select * into op from operations.api_quota_operations where operation_key=p_operation for update;
  if not found or op.provider<>'google_ads' then return false; end if;
  accepted:=operations.stop_shared_api_quota_scoped(p_operation,p_attempt,true,false,null);
  if accepted and not op.stopped then
    update operations.api_quota_operations set google_quota_scope=p_scope,google_quota_code=p_code where operation_key=p_operation;
  end if;
  -- ACCOUNT/DEVELOPER is descriptive, not an exact rate bucket identity. No policy stop expansion.
  return accepted;
end
$fn$;
revoke all on function operations.stop_shared_api_quota_google_observed(text,uuid,text,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.stop_shared_api_quota_google_observed(text,uuid,text,text) to adstable_refresh_coordinator;
reset role;
commit;
