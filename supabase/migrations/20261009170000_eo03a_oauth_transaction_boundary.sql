begin;

set local role adstable_owner;

create schema if not exists integrations authorization adstable_owner;

create table integrations.oauth_transactions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  installation_id uuid not null
    references shopify.installations(id) on update restrict on delete cascade,
  workspace_id uuid not null
    references app.workspaces(id) on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  state_digest bytea not null unique check (octet_length(state_digest) = 32),
  transaction_nonce bytea not null unique check (octet_length(transaction_nonce) = 32),
  callback_uri text not null,
  pkce_required boolean not null,
  pkce_challenge text,
  status text not null default 'created'
    check (status in (
      'created', 'redirected', 'claimed', 'exchanged',
      'denied', 'expired', 'invalidated', 'failed'
    )),
  failure_code text check (
    failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{2,127}$'
  ),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  redirected_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint oauth_transaction_expiry_order
    check (expires_at = created_at + interval '10 minutes'),
  constraint oauth_transaction_callback_exact check (
    (provider = 'meta'
      and callback_uri = 'https://embedded.adstable.app/auth/meta/callback')
    or (provider = 'google_ads'
      and callback_uri = 'https://embedded.adstable.app/auth/google-ads/callback')
    or (provider = 'klaviyo'
      and callback_uri = 'https://embedded.adstable.app/auth/klaviyo/callback')
  ),
  constraint oauth_transaction_pkce_shape check (
    (pkce_required and pkce_challenge ~ '^[A-Za-z0-9_-]{43}$')
    or (not pkce_required and pkce_challenge is null)
  ),
  constraint oauth_transaction_provider_pkce check (
    (provider in ('google_ads', 'klaviyo') and pkce_required)
    or (provider = 'meta' and not pkce_required)
  ),
  constraint oauth_transaction_completion_shape check (
    (status in ('created', 'redirected', 'claimed') and completed_at is null)
    or (status in ('exchanged', 'denied', 'expired', 'invalidated', 'failed')
      and completed_at is not null)
  )
);

create index oauth_transactions_installation_idx
  on integrations.oauth_transactions (
    workspace_id, install_generation, provider, created_at desc
  );
create index oauth_transactions_open_expiry_idx
  on integrations.oauth_transactions (expires_at)
  where status in ('created', 'redirected', 'claimed');

alter table integrations.oauth_transactions enable row level security;
alter table integrations.oauth_transactions force row level security;

create policy oauth_transactions_owner_all
  on integrations.oauth_transactions
  for all to adstable_owner using (true) with check (true);

revoke all on schema integrations
  from public, anon, authenticated, service_role, adstable_runtime;
grant usage on schema integrations to adstable_runtime;
revoke all on table integrations.oauth_transactions
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function integrations.create_oauth_transaction(
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_state_digest bytea,
  p_transaction_nonce bytea,
  p_pkce_challenge text,
  p_created_at timestamptz
)
returns table (
  transaction_id uuid,
  callback_uri text,
  pkce_required boolean,
  expires_at timestamptz,
  transaction_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
  expected_callback text;
  requires_pkce boolean;
  created_transaction integrations.oauth_transactions%rowtype;
begin
  if p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_state_digest is null or octet_length(p_state_digest) <> 32
     or p_transaction_nonce is null or octet_length(p_transaction_nonce) <> 32
     or p_created_at is null
     or p_created_at > statement_timestamp() + interval '1 minute' then
    raise exception 'INVALID_OAUTH_TRANSACTION_REQUEST';
  end if;

  expected_callback := case p_provider
    when 'meta' then 'https://embedded.adstable.app/auth/meta/callback'
    when 'google_ads' then 'https://embedded.adstable.app/auth/google-ads/callback'
    when 'klaviyo' then 'https://embedded.adstable.app/auth/klaviyo/callback'
  end;
  requires_pkce := p_provider in ('google_ads', 'klaviyo');

  if (requires_pkce and (p_pkce_challenge is null
      or p_pkce_challenge !~ '^[A-Za-z0-9_-]{43}$'))
     or (not requires_pkce and p_pkce_challenge is not null) then
    raise exception 'INVALID_OAUTH_PKCE_SHAPE';
  end if;

  select installation.* into current_installation
    from shopify.installations as installation
   where installation.workspace_id = p_workspace_id
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for share;

  if not found then
    raise exception 'ACTIVE_INSTALLATION_AUTHORITY_REQUIRED';
  end if;

  insert into integrations.oauth_transactions (
    installation_id, workspace_id, install_generation, provider,
    state_digest, transaction_nonce, callback_uri, pkce_required,
    pkce_challenge, created_at, expires_at
  ) values (
    current_installation.id, current_installation.workspace_id,
    current_installation.install_generation, p_provider,
    p_state_digest, p_transaction_nonce, expected_callback, requires_pkce,
    p_pkce_challenge, p_created_at, p_created_at + interval '10 minutes'
  ) returning * into created_transaction;

  return query select
    created_transaction.id,
    created_transaction.callback_uri,
    created_transaction.pkce_required,
    created_transaction.expires_at,
    created_transaction.status;
end
$function$;

create or replace function integrations.mark_oauth_transaction_redirected(
  p_transaction_id uuid,
  p_redirected_at timestamptz
)
returns table (
  transaction_id uuid,
  transaction_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integrations.oauth_transactions%rowtype;
begin
  update integrations.oauth_transactions as transaction
     set status = 'redirected',
         redirected_at = p_redirected_at,
         updated_at = statement_timestamp()
   where transaction.id = p_transaction_id
     and transaction.status = 'created'
     and p_redirected_at is not null
     and p_redirected_at >= transaction.created_at
     and p_redirected_at < transaction.expires_at
  returning * into changed;

  if not found then raise exception 'OAUTH_REDIRECT_TRANSITION_REJECTED'; end if;
  return query select changed.id, changed.status;
end
$function$;

create or replace function integrations.claim_oauth_transaction(
  p_provider text,
  p_state_digest bytea,
  p_claimed_at timestamptz
)
returns table (
  transaction_id uuid,
  workspace_id uuid,
  install_generation bigint,
  provider text,
  callback_uri text,
  pkce_required boolean,
  transaction_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_transaction integrations.oauth_transactions%rowtype;
  installation_active boolean;
begin
  if p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_state_digest is null or octet_length(p_state_digest) <> 32
     or p_claimed_at is null then
    raise exception 'INVALID_OAUTH_CLAIM_REQUEST';
  end if;

  select transaction.* into current_transaction
    from integrations.oauth_transactions as transaction
   where transaction.state_digest = p_state_digest
   for update;

  if not found then raise exception 'OAUTH_STATE_UNKNOWN'; end if;
  if current_transaction.provider <> p_provider then
    raise exception 'OAUTH_PROVIDER_MISMATCH';
  end if;
  if current_transaction.status <> 'redirected' then
    raise exception 'OAUTH_STATE_ALREADY_USED';
  end if;

  if p_claimed_at >= current_transaction.expires_at then
    update integrations.oauth_transactions
       set status = 'expired', completed_at = p_claimed_at,
           failure_code = 'STATE_EXPIRED', updated_at = statement_timestamp()
     where id = current_transaction.id;
    current_transaction.status := 'expired';
  else
    select exists (
      select 1 from shopify.installations as installation
       where installation.id = current_transaction.installation_id
         and installation.workspace_id = current_transaction.workspace_id
         and installation.install_generation = current_transaction.install_generation
         and installation.status = 'active'
    ) into installation_active;

    if not installation_active then
      update integrations.oauth_transactions
         set status = 'invalidated', completed_at = p_claimed_at,
             failure_code = 'INSTALLATION_AUTHORITY_CHANGED',
             updated_at = statement_timestamp()
       where id = current_transaction.id;
      current_transaction.status := 'invalidated';
    else
      update integrations.oauth_transactions
         set status = 'claimed', claimed_at = p_claimed_at,
             updated_at = statement_timestamp()
       where id = current_transaction.id;
      current_transaction.status := 'claimed';
    end if;
  end if;

  return query select
    current_transaction.id, current_transaction.workspace_id,
    current_transaction.install_generation, current_transaction.provider,
    current_transaction.callback_uri, current_transaction.pkce_required,
    current_transaction.status;
end
$function$;

create or replace function integrations.complete_oauth_transaction(
  p_transaction_id uuid,
  p_outcome text,
  p_failure_code text,
  p_completed_at timestamptz
)
returns table (
  transaction_id uuid,
  transaction_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integrations.oauth_transactions%rowtype;
begin
  if p_outcome not in ('exchanged', 'denied', 'failed', 'invalidated')
     or p_completed_at is null
     or (p_outcome = 'exchanged' and p_failure_code is not null)
     or (p_outcome <> 'exchanged' and (
       p_failure_code is null
       or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
     )) then
    raise exception 'INVALID_OAUTH_COMPLETION_REQUEST';
  end if;

  update integrations.oauth_transactions as transaction
     set status = p_outcome, failure_code = p_failure_code,
         completed_at = p_completed_at, updated_at = statement_timestamp()
   where transaction.id = p_transaction_id
     and transaction.status = 'claimed'
     and p_completed_at >= transaction.claimed_at
  returning * into changed;

  if not found then raise exception 'OAUTH_COMPLETION_TRANSITION_REJECTED'; end if;
  return query select changed.id, changed.status;
end
$function$;

create or replace function integrations.invalidate_oauth_transaction(
  p_transaction_id uuid,
  p_failure_code text,
  p_completed_at timestamptz
)
returns table (
  transaction_id uuid,
  transaction_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed integrations.oauth_transactions%rowtype;
begin
  if p_failure_code is null
     or p_failure_code !~ '^[A-Z][A-Z0-9_]{2,127}$'
     or p_completed_at is null then
    raise exception 'INVALID_OAUTH_INVALIDATION_REQUEST';
  end if;

  update integrations.oauth_transactions as transaction
     set status = 'invalidated', failure_code = p_failure_code,
         completed_at = p_completed_at, updated_at = statement_timestamp()
   where transaction.id = p_transaction_id
     and transaction.status in ('created', 'redirected')
  returning * into changed;

  if not found then raise exception 'OAUTH_INVALIDATION_TRANSITION_REJECTED'; end if;
  return query select changed.id, changed.status;
end
$function$;

revoke all on function integrations.create_oauth_transaction(
  uuid, bigint, text, bytea, bytea, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function integrations.mark_oauth_transaction_redirected(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function integrations.claim_oauth_transaction(text, bytea, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function integrations.complete_oauth_transaction(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function integrations.invalidate_oauth_transaction(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function integrations.create_oauth_transaction(
  uuid, bigint, text, bytea, bytea, text, timestamptz
) to adstable_runtime;
grant execute on function integrations.mark_oauth_transaction_redirected(uuid, timestamptz)
  to adstable_runtime;
grant execute on function integrations.claim_oauth_transaction(text, bytea, timestamptz)
  to adstable_runtime;
grant execute on function integrations.complete_oauth_transaction(uuid, text, text, timestamptz)
  to adstable_runtime;
grant execute on function integrations.invalidate_oauth_transaction(uuid, text, timestamptz)
  to adstable_runtime;

comment on table integrations.oauth_transactions is
  'Server-owned, generation-bound OAuth state machine. No authorization code, token, secret or plaintext PKCE verifier.';
comment on constraint oauth_transactions_installation_id_fkey
  on integrations.oauth_transactions is
  'Privacy registry link: deleting the exact Shopify installation generation cascades its OAuth security metadata.';

reset role;

commit;
