begin;

set local role adstable_owner;

alter table integrations.provider_authorization_handoffs
  drop constraint if exists provider_authorization_handoff_expiry_order;

alter table integrations.provider_authorization_handoffs
  alter column expires_at drop not null;

update integrations.provider_authorization_handoffs
   set expires_at = null,
       updated_at = statement_timestamp()
 where status = 'awaiting_selection';

drop index if exists integrations.provider_authorization_handoffs_expiry_idx;

create or replace function integrations.create_provider_authorization_handoff(
  p_oauth_transaction_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_credential_id uuid,
  p_created_at timestamptz
)
returns table (
  oauth_transaction_id uuid,
  handoff_status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_transaction integrations.oauth_transactions%rowtype;
  current_installation shopify.installations%rowtype;
  created_handoff integrations.provider_authorization_handoffs%rowtype;
begin
  if p_oauth_transaction_id is null
     or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_credential_id is null
     or p_created_at is null
     or p_created_at < statement_timestamp() - interval '1 minute'
     or p_created_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_PROVIDER_AUTHORIZATION_HANDOFF';
  end if;

  select transaction.* into source_transaction
    from integrations.oauth_transactions as transaction
   where transaction.id = p_oauth_transaction_id
   for update;

  if not found
     or source_transaction.status <> 'exchanged'
     or source_transaction.workspace_id <> p_workspace_id
     or source_transaction.install_generation <> p_install_generation
     or source_transaction.provider <> p_provider then
    raise exception 'OAUTH_TRANSACTION_HANDOFF_AUTHORITY_MISMATCH';
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.id = source_transaction.installation_id
     and installation.workspace_id = p_workspace_id
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for share;

  if not found then
    raise exception 'ACTIVE_INSTALLATION_AUTHORITY_REQUIRED';
  end if;

  if not exists (
    select 1
      from integrations.provider_credential_envelopes as credential
     where credential.id = p_credential_id
       and credential.installation_id = current_installation.id
       and credential.workspace_id = p_workspace_id
       and credential.install_generation = p_install_generation
       and credential.provider = p_provider
       and credential.purpose = 'provider_token_set'
  ) then
    raise exception 'PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH';
  end if;

  insert into integrations.provider_authorization_handoffs (
    oauth_transaction_id, installation_id, workspace_id, install_generation,
    provider, credential_id, created_at, expires_at
  ) values (
    source_transaction.id, current_installation.id, current_installation.workspace_id,
    current_installation.install_generation, p_provider, p_credential_id,
    p_created_at, null
  ) returning * into created_handoff;

  return query select
    created_handoff.oauth_transaction_id,
    created_handoff.status,
    created_handoff.expires_at;
end
$function$;

create or replace function integrations.load_provider_authorization_handoff(
  p_oauth_transaction_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_observed_at timestamptz
)
returns table (
  oauth_transaction_id uuid,
  credential_id uuid,
  handoff_status text,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    handoff.oauth_transaction_id,
    handoff.credential_id,
    handoff.status,
    handoff.expires_at
  from integrations.provider_authorization_handoffs as handoff
  join integrations.oauth_transactions as transaction
    on transaction.id = handoff.oauth_transaction_id
  join shopify.installations as installation
    on installation.id = handoff.installation_id
  where handoff.oauth_transaction_id = p_oauth_transaction_id
    and handoff.workspace_id = p_workspace_id
    and handoff.install_generation = p_install_generation
    and handoff.provider = p_provider
    and handoff.status = 'awaiting_selection'
    and handoff.credential_id is not null
    and p_observed_at is not null
    and p_observed_at >= handoff.created_at
    and transaction.status = 'exchanged'
    and transaction.workspace_id = handoff.workspace_id
    and transaction.install_generation = handoff.install_generation
    and transaction.provider = handoff.provider
    and installation.workspace_id = handoff.workspace_id
    and installation.install_generation = handoff.install_generation
    and installation.status = 'active';
$function$;

create or replace function integrations.consume_provider_authorization_handoff(
  p_oauth_transaction_id uuid,
  p_connection_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_granted_scopes text[],
  p_accounts jsonb,
  p_reporting_account_id text,
  p_verified_at timestamptz,
  p_consumed_at timestamptz
)
returns table (
  connection_id uuid,
  connected_account_count smallint,
  reporting_account_id text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_handoff integrations.provider_authorization_handoffs%rowtype;
  current_connection integrations.provider_connections%rowtype;
  established record;
  reconnected record;
begin
  if p_consumed_at is null then
    raise exception 'INVALID_PROVIDER_AUTHORIZATION_HANDOFF_CONSUMPTION';
  end if;

  select handoff.* into current_handoff
    from integrations.provider_authorization_handoffs as handoff
   where handoff.oauth_transaction_id = p_oauth_transaction_id
     and handoff.workspace_id = p_workspace_id
     and handoff.install_generation = p_install_generation
     and handoff.provider = p_provider
   for update;

  if not found
     or current_handoff.status <> 'awaiting_selection'
     or current_handoff.credential_id is null
     or p_consumed_at < current_handoff.created_at then
    raise exception 'PROVIDER_AUTHORIZATION_HANDOFF_UNAVAILABLE';
  end if;

  select connection.* into current_connection
    from integrations.provider_connections as connection
   where connection.workspace_id = p_workspace_id
     and connection.install_generation = p_install_generation
     and connection.provider = p_provider
   for update;

  if found then
    if current_connection.lifecycle_status <> 'disconnected'
       or current_connection.credential_id is not null then
      raise exception 'PROVIDER_CONNECTION_ALREADY_EXISTS_USE_LIFECYCLE';
    end if;

    select * into reconnected
      from integrations.reconnect_provider_connection(
        p_connection_id,
        current_connection.id,
        p_workspace_id,
        p_install_generation,
        p_provider,
        current_connection.connection_version,
        current_handoff.credential_id,
        p_granted_scopes,
        p_accounts,
        p_reporting_account_id,
        p_verified_at
      );

    established.connection_id := reconnected.connection_id;
    established.reporting_account_id := p_reporting_account_id;
    established.connected_account_count := jsonb_array_length(p_accounts)::smallint;
  else
    select * into established
      from integrations.establish_provider_account_authority(
        p_connection_id,
        p_workspace_id,
        p_install_generation,
        p_provider,
        current_handoff.credential_id,
        p_granted_scopes,
        p_accounts,
        p_reporting_account_id,
        p_verified_at
      );
  end if;

  update integrations.provider_authorization_handoffs as handoff
     set status = 'consumed',
         consumed_at = p_consumed_at,
         updated_at = statement_timestamp()
   where handoff.oauth_transaction_id = current_handoff.oauth_transaction_id
     and handoff.status = 'awaiting_selection';

  if not found then
    raise exception 'PROVIDER_AUTHORIZATION_HANDOFF_CONSUME_RACE';
  end if;

  return query select
    established.connection_id,
    established.connected_account_count,
    established.reporting_account_id;
end
$function$;

create or replace function integrations.expire_provider_authorization_handoffs(
  p_observed_at timestamptz,
  p_limit integer
)
returns table (
  expired_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expired_credential_ids uuid[];
  affected_count integer;
begin
  if p_observed_at is null or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_PROVIDER_AUTHORIZATION_HANDOFF_EXPIRY_REQUEST';
  end if;

  with candidates as (
    select handoff.oauth_transaction_id, handoff.credential_id
      from integrations.provider_authorization_handoffs as handoff
     where handoff.status = 'awaiting_selection'
       and handoff.expires_at is not null
       and handoff.expires_at <= p_observed_at
     order by handoff.expires_at, handoff.oauth_transaction_id
     for update skip locked
     limit p_limit
  ), expired as (
    update integrations.provider_authorization_handoffs as handoff
       set status = 'expired',
           credential_id = null,
           failure_code = 'SELECTION_HANDOFF_EXPIRED',
           updated_at = statement_timestamp()
      from candidates
     where handoff.oauth_transaction_id = candidates.oauth_transaction_id
    returning candidates.credential_id
  )
  select coalesce(array_agg(credential_id), '{}'::uuid[])
    into expired_credential_ids
    from expired;

  affected_count := cardinality(expired_credential_ids);

  delete from integrations.provider_credential_envelopes as credential
   where credential.id = any(expired_credential_ids)
     and not exists (
       select 1 from integrations.provider_connections as connection
        where connection.credential_id = credential.id
     );

  return query select affected_count;
end
$function$;

comment on table integrations.provider_authorization_handoffs is
  'Server-only durable OAuth-to-account-selection authority. OAuth state remains separately time-bounded; pending selection ends only by consumption, explicit cancellation, revocation or installation cleanup.';

reset role;

commit;
