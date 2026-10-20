begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create table operations.refresh_inventory_status (
  workspace_id uuid not null references app.workspaces(id) on delete cascade,
  provider text not null check(provider in ('meta','google_ads','klaviyo')),
  install_generation bigint,
  connection_id uuid,
  reporting_account_id text,
  reason text not null check(reason in ('ready_for_entitlement_check','workspace_inactive','installation_missing','installation_inactive',
    'not_connected','reauthorization_required','disconnect_pending','disconnected','reporting_account_required','account_ambiguous',
    'account_invalid','credential_unavailable','scope_missing','metadata_missing','future_source')),
  cached_entitlement_status text check(cached_entitlement_status in ('trial','active','subscription_required')),
  observed_at_ms bigint not null,
  primary key(workspace_id,provider)
);
alter table operations.refresh_inventory_status enable row level security;
alter table operations.refresh_inventory_status force row level security;
create policy refresh_inventory_status_owner on operations.refresh_inventory_status to adstable_owner using(true) with check(true);
revoke all on operations.refresh_inventory_status from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- One SQL statement snapshot, bounded by stored limits. No ciphertext/credential ID/domain/name is returned.
create function operations.build_refresh_native_inventory() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  with cfg as materialized(select * from operations.refresh_queue_control where singleton),
  ws as materialized(select w.id,w.status from app.workspaces w order by w.id limit (select max_workspaces::bigint+1 from cfg)),
  source as materialized(
    select w.id as workspace_id,w.status as workspace_status,v.provider,i.id as installation_id,i.install_generation,i.status as installation_status,
      c.id as connection_id,c.lifecycle_status,c.connection_version,c.connected_at,c.granted_scopes,
      a.provider_account_id,a.account_kind,a.reporting_eligible,a.provider_status,a.currency_code,a.timezone_name,a.active,
      b.effective_from,b.effective_to,coalesce(k.n,0) as klaviyo_accounts,e.entitlement_status,
      exists(select 1 from integrations.provider_credential_envelopes ce where ce.id=c.credential_id and ce.installation_id=i.id
        and ce.workspace_id=w.id and ce.install_generation=i.install_generation and ce.provider=v.provider) as credential_present
    from ws w cross join (values('meta'),('google_ads'),('klaviyo')) v(provider)
    left join shopify.installations i on i.workspace_id=w.id
    left join integrations.provider_connections c on c.installation_id=i.id and c.workspace_id=w.id and c.install_generation=i.install_generation and c.provider=v.provider
    left join lateral(select rb.account_id,rb.effective_from,rb.effective_to from integrations.reporting_account_bindings rb
      where rb.connection_id=c.id and rb.workspace_id=w.id and rb.install_generation=i.install_generation and rb.provider=v.provider
      order by (rb.effective_to is null) desc,rb.effective_from desc,rb.id desc limit 1) b on v.provider in ('meta','google_ads')
    left join lateral(select count(*)::int n from (select 1 from integrations.provider_accounts ka where ka.connection_id=c.id and ka.active limit 2) x) k on v.provider='klaviyo'
    left join lateral(select pa.* from integrations.provider_accounts pa where pa.connection_id=c.id and pa.workspace_id=w.id
      and pa.install_generation=i.install_generation and pa.provider=v.provider
      and ((v.provider in ('meta','google_ads') and pa.id=b.account_id) or (v.provider='klaviyo' and k.n=1 and pa.active))
      order by pa.id limit 1) a on true
    left join billing.workspace_entitlements e on e.workspace_id=w.id and e.install_generation=i.install_generation
  ), assessed as materialized(
    select s.*,case
      when workspace_status<>'active' then 'workspace_inactive'
      when installation_id is null then 'installation_missing'
      when installation_status<>'active' then 'installation_inactive'
      when connection_id is null then 'not_connected'
      when lifecycle_status<>'connected' then lifecycle_status
      when not credential_present then 'credential_unavailable'
      when provider='klaviyo' and klaviyo_accounts>1 then 'account_ambiguous'
      when provider_account_id is null or (provider in ('meta','google_ads') and effective_to is not null) then 'reporting_account_required'
      when not active or (provider in ('meta','google_ads') and (account_kind<>'advertiser' or not reporting_eligible))
        or (provider='klaviyo' and (account_kind<>'account' or provider_status is distinct from 'active')) then 'account_invalid'
      when (provider='meta' and not granted_scopes @> array['ads_read'])
        or (provider='google_ads' and not granted_scopes @> array['https://www.googleapis.com/auth/adwords'])
        or (provider='klaviyo' and not granted_scopes @> array['campaigns:read','events:read','flows:read','metrics:read']) then 'scope_missing'
      when (provider='meta' and provider_account_id !~ '^act_[0-9]+$')
        or (provider='google_ads' and provider_account_id !~ '^[0-9]+$')
        or currency_code is null or timezone_name is null
        or not exists(select 1 from pg_timezone_names tz where tz.name=timezone_name) then 'metadata_missing'
      when connected_at>statement_timestamp() or effective_from>statement_timestamp() then 'future_source'
      else 'ready_for_entitlement_check' end as reason,
      floor(extract(epoch from greatest(connected_at,effective_from))*1000)::bigint as eligible_from,
      sha256(convert_to(format('[%s,%s,%s]',to_json(workspace_id::text)::text,to_json(provider)::text,to_json(provider_account_id)::text),'UTF8')) as hashed
    from source s
  ), accounts as materialized(
    select jsonb_build_object('workspaceId',workspace_id::text,'installGeneration',install_generation::text,'provider',provider,
      'accountId',provider_account_id,'connectionId',connection_id::text,'connectionVersion',connection_version,
      'eligibleFromMs',eligible_from,'connectionOpen',lifecycle_status='connected','eligible',reason='ready_for_entitlement_check',
      'offsetMs',(get_byte(hashed,0)::bigint*16777216+get_byte(hashed,1)::bigint*65536+get_byte(hashed,2)::bigint*256+get_byte(hashed,3))%3600000) as value
    from assessed where provider_account_id is not null order by workspace_id,provider
    limit(select max_accounts::bigint+1 from cfg)
  )
  select jsonb_build_object('observedAtMs',floor(extract(epoch from statement_timestamp())*1000)::bigint,
    'workspaces',coalesce((select jsonb_agg(id::text order by id) from ws),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(value) from accounts),'[]'::jsonb),
    'assessments',coalesce((select jsonb_agg(jsonb_build_object('workspaceId',workspace_id::text,'provider',provider,
      'installGeneration',install_generation,'connectionId',connection_id,'reportingAccountId',provider_account_id,
      'reason',reason,'cachedEntitlementStatus',entitlement_status) order by workspace_id,provider) from assessed),'[]'::jsonb))
$fn$;

create function operations.read_refresh_inventory_status() returns jsonb
language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('workspaceId',workspace_id::text,'provider',provider,'installGeneration',install_generation::text,
    'connectionId',connection_id::text,'reportingAccountId',reporting_account_id,'reason',reason,
    'cachedEntitlementStatus',cached_entitlement_status,'observedAtMs',observed_at_ms) order by workspace_id,provider),'[]'::jsonb)
  from operations.refresh_inventory_status
$fn$;

create function operations.check_refresh_queue_from_authority(p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare c operations.refresh_queue_control%rowtype; inventory jsonb; result jsonb; a jsonb;
begin
  perform 1 from operations.refresh_control where singleton for update;
  select * into strict c from operations.refresh_queue_control where singleton for update;
  if p_revision is null or c.revision<>p_revision then return jsonb_build_object('committed',false); end if;
  if c.max_workspaces is null or c.max_accounts is null or c.max_snapshot_bytes is null or c.max_snapshot_age_ms is null then
    raise exception 'REFRESH_QUEUE_NOT_CONFIGURED';
  end if;
  inventory := operations.build_refresh_native_inventory();
  if jsonb_array_length(inventory->'workspaces')>c.max_workspaces or jsonb_array_length(inventory->'accounts')>c.max_accounts
    or octet_length(inventory::text)>c.max_snapshot_bytes then raise exception 'REFRESH_NATIVE_INVENTORY_OVER_BOUND'; end if;
  -- Reporting-account selection has its OWN effective period and need not increment OAuth connection_version.
  -- Only the native source may retire this metadata epoch; claims, holds and budgets are never released here.
  delete from operations.refresh_queue_accounts q using jsonb_array_elements(inventory->'accounts') entry(value)
    where q.workspace_id=(entry.value->>'workspaceId')::uuid and q.install_generation=(entry.value->>'installGeneration')::bigint
      and q.provider=entry.value->>'provider' and q.account_id=entry.value->>'accountId'
      and (q.connection_id<>entry.value->>'connectionId' or q.connection_version<>(entry.value->>'connectionVersion')::bigint
        or q.eligible_from_ms<>(entry.value->>'eligibleFromMs')::bigint);
  result := operations.commit_refresh_queue_check(p_revision,inventory-'assessments');
  if result->>'committed' is distinct from 'true' then raise exception 'REFRESH_NATIVE_INVENTORY_CONFLICT'; end if;
  for a in select value from jsonb_array_elements(inventory->'assessments') loop
    insert into operations.refresh_inventory_status values((a->>'workspaceId')::uuid,a->>'provider',(a->>'installGeneration')::bigint,
      (a->>'connectionId')::uuid,a->>'reportingAccountId',a->>'reason',a->>'cachedEntitlementStatus',(inventory->>'observedAtMs')::bigint)
    on conflict(workspace_id,provider) do update set install_generation=excluded.install_generation,connection_id=excluded.connection_id,
      reporting_account_id=excluded.reporting_account_id,reason=excluded.reason,cached_entitlement_status=excluded.cached_entitlement_status,observed_at_ms=excluded.observed_at_ms;
  end loop;
  return result || jsonb_build_object('inventorySource','database_authority','assessedProviders',jsonb_array_length(inventory->'assessments'));
end
$fn$;
revoke all on function operations.build_refresh_native_inventory() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
revoke all on function operations.commit_refresh_queue_check(bigint,jsonb) from adstable_refresh_coordinator;
revoke all on function operations.read_refresh_inventory_status(),operations.check_refresh_queue_from_authority(bigint)
  from public,anon,authenticated,service_role,adstable_runtime;
grant execute on function operations.read_refresh_inventory_status(),operations.check_refresh_queue_from_authority(bigint) to adstable_refresh_coordinator;
reset role;
commit;
