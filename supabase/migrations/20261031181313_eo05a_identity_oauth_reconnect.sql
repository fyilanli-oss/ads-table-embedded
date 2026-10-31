begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Refuse a partial rollout: this replaces the already installed atomic writer.
do $precondition$
begin
  if to_regprocedure('integrations.commit_identity_oauth_credential(uuid,uuid,bigint,text,uuid,uuid,bigint,uuid,text[],jsonb,timestamptz,bytea,bytea,bytea,smallint,timestamptz)') is null
    or (select count(*) from pg_catalog.pg_attribute where attrelid='integrations.oauth_transactions'::regclass
      and attname in ('identity_credential_id','identity_connection_id','identity_connection_version','identity_result_status')
      and not attisdropped) <> 4 then
    raise exception 'IDENTITY_OAUTH_RECONNECT_PREREQUISITES_REQUIRED';
  end if;
end
$precondition$;

-- Explicit fresh OAuth reconnect; same signature, ownership and grants preserved.
create or replace function integrations.commit_identity_oauth_credential(
  p_transaction uuid,p_workspace uuid,p_generation bigint,p_provider text,
  p_connection uuid,p_expected_connection uuid,p_expected_version bigint,
  p_credential uuid,p_scopes text[],p_accounts jsonb,p_verified_at timestamptz,
  p_ciphertext bytea,p_nonce bytea,p_tag bytea,p_key smallint,p_expires timestamptz
) returns table(connection_id uuid,lifecycle_status text,connection_version bigint,credential_id uuid)
language plpgsql security definer set search_path = '' as $function$
declare
  i shopify.installations%rowtype;
  t integrations.oauth_transactions%rowtype;
  c integrations.provider_connections%rowtype;
  r record;
begin
  if p_provider is null or p_provider not in ('meta','google_ads')
    or p_transaction is null or p_workspace is null or p_generation is null or p_generation < 1
    or p_connection is null or p_credential is null
    or ((p_expected_connection is null) <> (p_expected_version is null))
    or p_expected_version < 1 or p_expected_version >= 9007199254740991
    or p_verified_at is null or p_verified_at < statement_timestamp()-interval '10 minutes'
    or p_verified_at > statement_timestamp()+interval '1 minute'
    or p_expires is null or p_expires <= statement_timestamp()
    or p_scopes is null or cardinality(p_scopes) not between 1 and 100
    or exists(select 1 from unnest(p_scopes) s(v) where v is null or v<>btrim(v) or length(v) not between 1 and 200)
    or cardinality(p_scopes)<>(select count(distinct v) from unnest(p_scopes) s(v))
    or p_accounts is null or jsonb_typeof(p_accounts)<>'array'
    then raise exception 'IDENTITY_OAUTH_COMMIT_INPUT_INVALID'; end if;
  if (p_provider='google_ads' and not array['https://www.googleapis.com/auth/adwords','https://www.googleapis.com/auth/content']::text[] <@ p_scopes)
    or (p_provider='meta' and not array['ads_read','catalog_management','business_management','pages_read_engagement','pages_show_list']::text[] <@ p_scopes)
    then raise exception 'OAUTH_IDENTITY_SCOPE_NOT_GRANTED'; end if;
  if jsonb_array_length(p_accounts) not between 1 and 1000
    or exists(select 1 from jsonb_array_elements(p_accounts) a where jsonb_typeof(a)<>'object'
      or coalesce(a->>'id','')='' or a->>'kind' is distinct from 'advertiser'
      or a->'reportingEligible' is distinct from 'true'::jsonb)
    or jsonb_array_length(p_accounts)<>(select count(distinct a->>'id') from jsonb_array_elements(p_accounts) a)
    then raise exception 'IDENTITY_OAUTH_ACCOUNTS_INVALID'; end if;

  -- All writers for this path serialize on the actual installation before CAS.
  select x.* into i from shopify.installations x
    where x.workspace_id=p_workspace and x.install_generation=p_generation and x.status='active' for update;
  if not found then raise exception 'ACTIVE_INSTALLATION_REQUIRED'; end if;
  select x.* into t from integrations.oauth_transactions x where x.id=p_transaction
    and x.installation_id=i.id and x.workspace_id=p_workspace and x.install_generation=p_generation
    and x.provider=p_provider for update;
  if not found or t.status<>'claimed' or t.expires_at<=statement_timestamp()
    then raise exception 'IDENTITY_OAUTH_CLAIM_REQUIRED'; end if;
  select x.* into c from integrations.provider_connections x where x.installation_id=i.id
    and x.workspace_id=p_workspace and x.install_generation=p_generation and x.provider=p_provider for update;
  if (p_expected_connection is null and c.id is not null)
    or (p_expected_connection is not null and (c.id is null or c.id<>p_expected_connection
      or c.connection_version<>p_expected_version))
    then raise exception 'IDENTITY_OAUTH_CONNECTION_CHANGED'; end if;
  if c.id is not null and c.lifecycle_status not in ('connected','pending_account_selection','reauthorization_required','disconnected')
    then raise exception 'IDENTITY_OAUTH_CONNECTION_STATE_NOT_ELIGIBLE'; end if;
  -- Reconnect needs fresh consent, not permission from an abandoned credential.
  -- The exact connection/version CAS above still prevents a later disconnect revival.
  if c.lifecycle_status='disconnected' and (c.credential_id is not null or c.disconnected_at is null
    or exists(select 1 from integrations.reporting_account_bindings b where b.connection_id=c.id and b.effective_to is null))
    then raise exception 'IDENTITY_OAUTH_DISCONNECT_INCOMPLETE'; end if;
  if c.id is not null and c.lifecycle_status<>'disconnected' and not c.granted_scopes <@ p_scopes
    then raise exception 'IDENTITY_OAUTH_SCOPE_DOWNGRADE'; end if;
  if c.lifecycle_status='connected' then
    if c.credential_id is null or not exists(select 1 from integrations.provider_accounts a where a.connection_id=c.id and a.account_kind='advertiser' and a.reporting_eligible)
      or exists(select 1 from integrations.provider_accounts a where a.connection_id=c.id and a.account_kind='advertiser' and a.reporting_eligible
        and not exists(select 1 from jsonb_array_elements(p_accounts) e where e->>'id'=a.provider_account_id))
      or not exists(select 1 from integrations.reporting_account_bindings b where b.connection_id=c.id and b.effective_to is null)
      then raise exception 'IDENTITY_OAUTH_SELECTED_ASSET_NOT_VERIFIED'; end if;
  end if;

  -- Envelope, connection CAS, receipt and OAuth completion share one transaction.
  perform integrations.store_provider_credential_envelope(p_credential,p_workspace,p_generation,p_provider,
    'provider_token_set',p_ciphertext,p_nonce,p_tag,p_key,p_expires);
  if c.lifecycle_status='connected' then
    select * into r from integrations.renew_provider_connection_credential(p_transaction,c.id,p_workspace,
      p_generation,p_provider,p_expected_version,c.credential_id,p_credential,p_scopes,p_verified_at);
  else
    select * into r from integrations.stage_provider_account_selection(coalesce(c.id,p_connection),p_workspace,
      p_generation,p_provider,p_credential,p_scopes,p_verified_at);
  end if;
  update integrations.oauth_transactions x set status='exchanged',completed_at=p_verified_at,updated_at=p_verified_at,
    identity_credential_id=p_credential,identity_connection_id=r.connection_id,
    identity_connection_version=r.connection_version,identity_result_status=r.lifecycle_status
    where x.id=p_transaction;
  return query select r.connection_id,r.lifecycle_status,r.connection_version,r.credential_id;
end
$function$;


commit;
