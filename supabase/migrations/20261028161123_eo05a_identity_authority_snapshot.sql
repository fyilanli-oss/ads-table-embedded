begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- One statement snapshot of nonsecret identity authority; no new tables or native grants.
create function integrations.load_provider_identity_authority(p_workspace uuid,p_generation bigint,p_provider text,p_shop text,p_domain text)
returns table(installation_id text,workspace_id uuid,install_generation bigint,installation_status text,shop_id text,shop_domain text,
  connection_id uuid,credential_id uuid,connection_version bigint,lifecycle_status text,granted_scopes text[],accounts jsonb,
  reporting_account_id text,reporting_selection_epoch text)
language sql stable security definer set search_path='' as $fn$
  select i.id::text,i.workspace_id,i.install_generation,i.status,i.shop_id,i.shop_domain,
    c.id,c.credential_id,c.connection_version,c.lifecycle_status,c.granted_scopes,
    coalesce((select jsonb_agg(jsonb_build_object('id',a.provider_account_id,'kind',a.account_kind,
      'reporting_eligible',a.reporting_eligible,'status',a.provider_status,'login_account_id',a.login_account_id) order by a.provider_account_id)
      from integrations.provider_accounts a where a.connection_id=c.id and a.workspace_id=c.workspace_id
        and a.install_generation=c.install_generation and a.provider=c.provider),'[]'::jsonb),
    selected.provider_account_id,b.id::text
  from shopify.installations i join integrations.provider_connections c on c.installation_id=i.id
    and c.workspace_id=i.workspace_id and c.install_generation=i.install_generation
  left join integrations.reporting_account_bindings b on b.connection_id=c.id and b.workspace_id=c.workspace_id
    and b.install_generation=c.install_generation and b.provider=c.provider and b.effective_to is null
  left join integrations.provider_accounts selected on selected.id=b.account_id and selected.connection_id=c.id
    and selected.workspace_id=c.workspace_id and selected.install_generation=c.install_generation and selected.provider=c.provider
  where i.workspace_id=p_workspace and i.install_generation=p_generation and i.shop_id=p_shop and i.shop_domain=p_domain and i.status='active'
    and c.provider=p_provider and c.lifecycle_status='connected' and c.credential_id is not null and c.connection_version>0
    and p_provider in ('meta','google_ads','klaviyo') and (p_provider='klaviyo' or b.id is not null)
$fn$;
revoke all on function integrations.load_provider_identity_authority(uuid,bigint,text,text,text)
  from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function integrations.load_provider_identity_authority(uuid,bigint,text,text,text) to adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
