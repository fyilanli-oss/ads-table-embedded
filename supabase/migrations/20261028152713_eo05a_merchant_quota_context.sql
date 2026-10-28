begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Existing owner-reviewed nonsecret inventory only. No native scopes, profiles or limits seeded.
alter table operations.refresh_quota_contexts
  add column merchant_enabled boolean not null default false,
  add column merchant_target_account_id text,
  add column merchant_quota_account_id text,
  add column merchant_api_version text,
  add column merchant_binding_epoch bigint,
  add column merchant_credential_id uuid,
  add constraint refresh_quota_contexts_merchant_check check(
    (not merchant_enabled and merchant_target_account_id is null and merchant_quota_account_id is null
      and merchant_api_version is null and merchant_binding_epoch is null and merchant_credential_id is null)
    or (provider='google_ads' and merchant_target_account_id is not null and merchant_quota_account_id is not null
      and merchant_api_version is not null and merchant_binding_epoch is not null and merchant_credential_id is not null
      and merchant_target_account_id ~ '^[1-9][0-9]{0,18}$' and merchant_target_account_id::numeric<=9223372036854775807
      and merchant_quota_account_id ~ '^[1-9][0-9]{0,18}$' and merchant_quota_account_id::numeric<=9223372036854775807
      and merchant_api_version='products/v1' and merchant_binding_epoch between 1 and 9007199254740991));

-- Prevent away/back configuration changes from reviving an old Merchant route/profile.
create function operations.guard_refresh_merchant_epoch() returns trigger
language plpgsql set search_path='' as $fn$
begin
  if old.merchant_binding_epoch is not null then
    if new.merchant_binding_epoch is null or new.merchant_binding_epoch<old.merchant_binding_epoch then
      raise exception 'MERCHANT_QUOTA_EPOCH_INVALID';end if;
    if row(new.merchant_enabled,new.merchant_target_account_id,new.merchant_quota_account_id,new.merchant_api_version,new.merchant_credential_id,
      new.connection_id,new.connection_version,new.installation_id,new.install_generation,new.account_id,new.enabled,
      new.client_scope_key,new.connection_scope_key,new.connection_epoch,new.workspace_id,new.provider,new.api_version,new.organization_id)
      is distinct from row(old.merchant_enabled,old.merchant_target_account_id,old.merchant_quota_account_id,old.merchant_api_version,old.merchant_credential_id,
        old.connection_id,old.connection_version,old.installation_id,old.install_generation,old.account_id,old.enabled,
        old.client_scope_key,old.connection_scope_key,old.connection_epoch,old.workspace_id,old.provider,old.api_version,old.organization_id)
      and new.merchant_binding_epoch<=old.merchant_binding_epoch then raise exception 'MERCHANT_QUOTA_EPOCH_INVALID';end if;
  end if;
  return new;
end
$fn$;
create trigger refresh_quota_contexts_merchant_epoch before update on operations.refresh_quota_contexts
  for each row execute function operations.guard_refresh_merchant_epoch();
revoke all on function operations.guard_refresh_merchant_epoch() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

alter function operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)
  rename to load_refresh_quota_context_before_merchant;
revoke all on function operations.load_refresh_quota_context_before_merchant(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
create function operations.load_refresh_quota_context(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,
  p_from date,p_to date,p_target text,p_observed timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare base jsonb; merchant jsonb;
begin
  base:=operations.load_refresh_quota_context_before_merchant(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to,p_target,p_observed);
  if base is null or p_target<>'google_ads' then return base;end if;
  select jsonb_build_object('targetAccountId',q.merchant_target_account_id,'quotaAccountId',q.merchant_quota_account_id,
    'apiVersion',q.merchant_api_version,'bindingEpoch',q.merchant_binding_epoch) into merchant
  from operations.refresh_quota_contexts q join integrations.provider_connections c on c.id=q.connection_id
    and c.workspace_id=q.workspace_id and c.install_generation=q.install_generation and c.installation_id=q.installation_id
    and c.provider='google_ads' and c.lifecycle_status='connected' and c.connection_version=q.connection_version
    and c.credential_id=q.merchant_credential_id
    and c.granted_scopes @> array['https://www.googleapis.com/auth/content']::text[]
  where q.workspace_id=p_workspace and q.install_generation=p_generation and q.provider='google_ads' and q.enabled and q.merchant_enabled
    and q.account_id=base->>'accountId';
  -- Missing/stale/disabled Merchant scope never gains a target or inferred quota pool.
  -- Ordinary Ads retains its existing seven-field context; Merchant transport requires the extra object.
  if merchant is null then return base;end if;
  return base||jsonb_build_object('merchant',merchant);
end
$fn$;
revoke all on function operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz) to adstable_refresh_coordinator;
reset role;
commit;
