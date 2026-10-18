begin;

set local role adstable_owner;

create table integrations.provider_authorization_handoffs (
  oauth_transaction_id uuid primary key
    references integrations.oauth_transactions(id) on update restrict on delete cascade,
  installation_id bigint not null
    references shopify.installations(id) on update restrict on delete cascade,
  workspace_id uuid not null
    references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  credential_id uuid unique
    references integrations.provider_credential_envelopes(id) on update restrict on delete restrict,
  status text not null default 'awaiting_selection'
    check (status in ('awaiting_selection', 'consumed', 'expired', 'failed')),
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint provider_authorization_handoff_expiry_order
    check (expires_at = created_at + interval '10 minutes'),
  constraint provider_authorization_handoff_status_shape check (
    (status = 'awaiting_selection' and credential_id is not null
      and consumed_at is null and failure_code is null)
    or (status = 'consumed' and credential_id is not null
      and consumed_at is not null and failure_code is null)
    or (status in ('expired', 'failed') and credential_id is null
      and consumed_at is null and failure_code is not null)
  )
);

create index provider_authorization_handoffs_authority_idx
  on integrations.provider_authorization_handoffs (
    workspace_id, install_generation, provider, status
  );
create index provider_authorization_handoffs_expiry_idx
  on integrations.provider_authorization_handoffs (expires_at)
  where status = 'awaiting_selection';

alter table integrations.provider_authorization_handoffs enable row level security;
alter table integrations.provider_authorization_handoffs force row level security;

create policy provider_authorization_handoffs_owner_all
  on integrations.provider_authorization_handoffs
  for all to adstable_owner using (true) with check (true);

revoke all on table integrations.provider_authorization_handoffs
  from public, anon, authenticated, service_role, adstable_runtime;

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
    p_created_at, p_created_at + interval '10 minutes'
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
    and p_observed_at < handoff.expires_at
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
  established record;
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
     or p_consumed_at < current_handoff.created_at
     or p_consumed_at >= current_handoff.expires_at then
    raise exception 'PROVIDER_AUTHORIZATION_HANDOFF_UNAVAILABLE';
  end if;

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
       and handoff.expires_at <= p_observed_at
     order by handoff.expires_at, handoff.oauth_transaction_id
     for update skip locked
     limit p_limit
  ),
  expired as (
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
       select 1
         from integrations.provider_connections as connection
        where connection.credential_id = credential.id
     );

  return query select affected_count;
end
$function$;

revoke all on function integrations.create_provider_authorization_handoff(
  uuid, uuid, bigint, text, uuid, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.load_provider_authorization_handoff(
  uuid, uuid, bigint, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.consume_provider_authorization_handoff(
  uuid, uuid, uuid, bigint, text, text[], jsonb, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.expire_provider_authorization_handoffs(
  timestamptz, integer
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.create_provider_authorization_handoff(
  uuid, uuid, bigint, text, uuid, timestamptz
) to adstable_runtime;
grant execute on function integrations.load_provider_authorization_handoff(
  uuid, uuid, bigint, text, timestamptz
) to adstable_runtime;
grant execute on function integrations.consume_provider_authorization_handoff(
  uuid, uuid, uuid, bigint, text, text[], jsonb, text, timestamptz, timestamptz
) to adstable_runtime;
grant execute on function integrations.expire_provider_authorization_handoffs(
  timestamptz, integer
) to adstable_runtime;

comment on table integrations.provider_authorization_handoffs is
  'Short-lived server-only OAuth-to-account-selection authority. No token or provider account payload is stored.';

reset role;

commit;
