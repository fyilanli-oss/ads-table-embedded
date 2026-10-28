begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Extend only the existing private, disabled-by-default scope inventory.
-- No native configuration, policies, limits or enabled rows are installed.
alter table operations.refresh_quota_contexts
  drop constraint refresh_quota_contexts_provider_check,
  drop constraint refresh_quota_contexts_check;
alter table operations.refresh_quota_contexts
  add constraint refresh_quota_contexts_provider_check
    check(provider in ('shopify_partner','shopify_admin','meta','google_ads','klaviyo')),
  add constraint refresh_quota_contexts_check check(
    (provider='shopify_partner' and connection_id is null and connection_version is null and account_id is null
      and organization_id is not null and organization_id ~ '^[1-9][0-9]*$' and api_version ~ '^\d{4}-\d{2}$')
    or (provider='shopify_admin' and connection_id is null and connection_version is null and organization_id is null
      and account_id is not null and length(account_id)<=253 and account_id ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
      and api_version ~ '^\d{4}-(01|04|07|10)$')
    or (provider in ('meta','google_ads','klaviyo') and connection_id is not null and connection_version is not null
      and connection_version>0 and account_id is not null and organization_id is null
      and ((provider='meta' and account_id ~ '^act_[0-9]+$' and api_version ~ '^v[0-9]+\.[0-9]+$')
        or (provider='google_ads' and account_id ~ '^[0-9]+$' and api_version ~ '^v[0-9]+$')
        or (provider='klaviyo' and length(account_id) between 1 and 256 and api_version ~ '^\d{4}-\d{2}-\d{2}$')))
  );

create or replace function operations.load_refresh_quota_context(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,
  p_from date,p_to date,p_target text,p_observed timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare authority jsonb; installation jsonb; cfg operations.refresh_quota_contexts%rowtype;
begin
  if p_target is null or (p_target not in ('shopify_partner','shopify_admin') and p_target<>p_provider) then return null; end if;
  if p_target='shopify_admin' and (p_provider is null or p_provider not in ('meta','google_ads','klaviyo')) then return null; end if;
  -- Original provider job/account/window/fence and current connection/selection remain mandatory.
  authority:=operations.load_refresh_bound_authority(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to);
  installation:=operations.load_refresh_entitlement_installation(p_workspace,p_generation,p_provider,p_account,p_job,p_fence);
  if authority is null or installation is null then return null; end if;
  select q.* into cfg from operations.refresh_quota_contexts q join shopify.installations i on i.id=q.installation_id
    and i.workspace_id=q.workspace_id and i.install_generation=q.install_generation and i.status='active'
    where q.workspace_id=p_workspace and q.install_generation=p_generation and q.provider=p_target and q.enabled;
  if not found then return null; end if;
  if p_target<>'shopify_partner' and not operations.refresh_entitlement_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_observed) then return null; end if;
  if p_target='shopify_admin' then
    -- Admin is installation-owned, not an ad connection or fourth reporting provider.
    if cfg.account_id is distinct from installation->>'shopDomain' then return null; end if;
  elsif p_target<>'shopify_partner' then
    if cfg.connection_id::text is distinct from authority->>'connectionId'
      or cfg.connection_version is distinct from (authority->>'connectionVersion')::bigint
      or cfg.account_id is distinct from authority->>'accountId' then return null; end if;
  end if;
  return jsonb_build_object('provider',cfg.provider,'clientScopeKey',cfg.client_scope_key,'connectionScopeKey',cfg.connection_scope_key,
    'connectionEpoch',cfg.connection_epoch,'accountId',cfg.account_id,'organizationId',cfg.organization_id,'apiVersion',cfg.api_version);
end
$fn$;
revoke all on function operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz) to adstable_refresh_coordinator;
reset role;
commit;
