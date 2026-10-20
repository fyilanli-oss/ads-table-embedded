begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Owner-reviewed NONSECRET scope inventory only. No rows or native limits are installed.
create table operations.refresh_quota_contexts (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  install_generation bigint not null check(install_generation>0),
  provider text not null check(provider in ('shopify_partner','meta','google_ads','klaviyo')),
  installation_id bigint not null references shopify.installations(id) on delete cascade,
  connection_id uuid references integrations.provider_connections(id) on delete cascade,
  connection_version bigint,
  account_id text,
  client_scope_key text not null check(client_scope_key ~ '^[a-f0-9]{64}$'),
  connection_scope_key text not null check(connection_scope_key ~ '^[a-f0-9]{64}$'),
  connection_epoch bigint not null check(connection_epoch between 1 and 9007199254740991),
  organization_id text,
  api_version text not null,
  enabled boolean not null default false,
  primary key(workspace_id,install_generation,provider),
  check((provider='shopify_partner' and connection_id is null and connection_version is null and account_id is null
    and organization_id is not null and organization_id ~ '^[1-9][0-9]*$' and api_version ~ '^\d{4}-\d{2}$')
    or (provider<>'shopify_partner' and connection_id is not null and connection_version is not null and connection_version>0 and account_id is not null and organization_id is null
      and ((provider='meta' and account_id ~ '^act_[0-9]+$' and api_version ~ '^v[0-9]+\.[0-9]+$')
        or (provider='google_ads' and account_id ~ '^[0-9]+$' and api_version ~ '^v[0-9]+$')
        or (provider='klaviyo' and length(account_id) between 1 and 256 and api_version ~ '^\d{4}-\d{2}-\d{2}$'))))
);
create index refresh_quota_contexts_installation_idx on operations.refresh_quota_contexts(installation_id);
create index refresh_quota_contexts_connection_idx on operations.refresh_quota_contexts(connection_id);
alter table operations.refresh_quota_contexts enable row level security;
alter table operations.refresh_quota_contexts force row level security;
create policy refresh_quota_contexts_owner on operations.refresh_quota_contexts to adstable_owner using(true) with check(true);
revoke all on operations.refresh_quota_contexts from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

create function operations.load_refresh_quota_context(p_workspace uuid,p_generation bigint,p_provider text,p_account text,p_job text,p_fence bigint,
  p_from date,p_to date,p_target text,p_observed timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare authority jsonb; installation jsonb; cfg operations.refresh_quota_contexts%rowtype;
begin
  if p_target is null or (p_target<>'shopify_partner' and p_target<>p_provider) then return null; end if;
  authority:=operations.load_refresh_bound_authority(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to);
  installation:=operations.load_refresh_entitlement_installation(p_workspace,p_generation,p_provider,p_account,p_job,p_fence);
  if authority is null or installation is null then return null; end if;
  select q.* into cfg from operations.refresh_quota_contexts q join shopify.installations i on i.id=q.installation_id
    and i.workspace_id=q.workspace_id and i.install_generation=q.install_generation and i.status='active'
    where q.workspace_id=p_workspace and q.install_generation=p_generation and q.provider=p_target and q.enabled;
  if not found then return null; end if;
  if p_target<>'shopify_partner' then
    if cfg.connection_id::text is distinct from authority->>'connectionId'
      or cfg.connection_version is distinct from (authority->>'connectionVersion')::bigint
      or cfg.account_id is distinct from authority->>'accountId'
      or not operations.refresh_entitlement_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_observed) then return null; end if;
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
