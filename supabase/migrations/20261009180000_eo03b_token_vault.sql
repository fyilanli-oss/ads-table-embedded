begin;

set local role adstable_owner;

create table integrations.oauth_pkce_envelopes (
  transaction_id uuid primary key
    references integrations.oauth_transactions(id)
    on update restrict on delete cascade,
  installation_id bigint not null
    references shopify.installations(id)
    on update restrict on delete cascade,
  workspace_id uuid not null
    references app.workspaces(id)
    on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  payload_ciphertext bytea not null check (octet_length(payload_ciphertext) > 0),
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null check (key_version > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp()
);

create index oauth_pkce_envelopes_installation_fk_idx
  on integrations.oauth_pkce_envelopes (installation_id);
create index oauth_pkce_envelopes_expiry_idx
  on integrations.oauth_pkce_envelopes (expires_at);

create table integrations.provider_credential_envelopes (
  id uuid primary key,
  installation_id bigint not null
    references shopify.installations(id)
    on update restrict on delete cascade,
  workspace_id uuid not null
    references app.workspaces(id)
    on update restrict on delete restrict,
  install_generation bigint not null check (install_generation > 0),
  provider text not null check (provider in ('meta', 'google_ads', 'klaviyo')),
  purpose text not null check (purpose = 'provider_token_set'),
  payload_ciphertext bytea not null check (octet_length(payload_ciphertext) > 0),
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null check (key_version > 0),
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index provider_credential_envelopes_installation_fk_idx
  on integrations.provider_credential_envelopes (installation_id);
create index provider_credential_envelopes_authority_idx
  on integrations.provider_credential_envelopes (
    workspace_id, install_generation, provider, updated_at desc
  );

alter table integrations.oauth_pkce_envelopes enable row level security;
alter table integrations.oauth_pkce_envelopes force row level security;
alter table integrations.provider_credential_envelopes enable row level security;
alter table integrations.provider_credential_envelopes force row level security;

create policy oauth_pkce_envelopes_owner_all
  on integrations.oauth_pkce_envelopes
  for all to adstable_owner using (true) with check (true);
create policy provider_credential_envelopes_owner_all
  on integrations.provider_credential_envelopes
  for all to adstable_owner using (true) with check (true);

revoke all on table integrations.oauth_pkce_envelopes
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on table integrations.provider_credential_envelopes
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function integrations.token_vault_runtime_guard(
  p_expected_contract_version smallint
)
returns table (
  contract_version smallint,
  used_key_versions smallint[]
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_expected_contract_version is distinct from 1 then
    raise exception 'TOKEN_VAULT_CONTRACT_VERSION_MISMATCH';
  end if;

  return query
  select
    1::smallint,
    coalesce(
      array(
        select distinct version
        from (
          select key_version as version
          from integrations.oauth_pkce_envelopes
          union
          select key_version as version
          from integrations.provider_credential_envelopes
        ) as used
        order by version
      ),
      array[]::smallint[]
    );
end
$function$;

create or replace function integrations.store_oauth_pkce_envelope(
  p_transaction_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_payload_ciphertext bytea,
  p_nonce bytea,
  p_auth_tag bytea,
  p_key_version smallint,
  p_expires_at timestamptz
)
returns table (stored boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_transaction integrations.oauth_transactions%rowtype;
begin
  if p_transaction_id is null
     or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_payload_ciphertext is null or octet_length(p_payload_ciphertext) < 1
     or p_nonce is null or octet_length(p_nonce) <> 12
     or p_auth_tag is null or octet_length(p_auth_tag) <> 16
     or p_key_version is null or p_key_version < 1
     or p_expires_at is null then
    raise exception 'INVALID_OAUTH_PKCE_ENVELOPE';
  end if;

  select transaction.* into current_transaction
    from integrations.oauth_transactions as transaction
   where transaction.id = p_transaction_id
   for update;

  if not found
     or current_transaction.status <> 'created'
     or not current_transaction.pkce_required
     or current_transaction.workspace_id <> p_workspace_id
     or current_transaction.install_generation <> p_install_generation
     or current_transaction.provider <> p_provider
     or current_transaction.expires_at <> p_expires_at then
    raise exception 'OAUTH_PKCE_TRANSACTION_AUTHORITY_MISMATCH';
  end if;

  insert into integrations.oauth_pkce_envelopes (
    transaction_id, installation_id, workspace_id, install_generation,
    provider, payload_ciphertext, nonce, auth_tag, key_version, expires_at
  ) values (
    current_transaction.id, current_transaction.installation_id,
    current_transaction.workspace_id, current_transaction.install_generation,
    current_transaction.provider, p_payload_ciphertext, p_nonce, p_auth_tag,
    p_key_version, current_transaction.expires_at
  );

  return query select true;
end
$function$;

create or replace function integrations.take_oauth_pkce_envelope(
  p_transaction_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_taken_at timestamptz
)
returns table (
  record_id uuid,
  workspace_id uuid,
  install_generation bigint,
  provider text,
  payload_ciphertext bytea,
  nonce bytea,
  auth_tag bytea,
  key_version smallint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_transaction_id is null
     or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_taken_at is null then
    raise exception 'INVALID_OAUTH_PKCE_TAKE_REQUEST';
  end if;

  return query
  with authorized as (
    select envelope.transaction_id
      from integrations.oauth_pkce_envelopes as envelope
      join integrations.oauth_transactions as transaction
        on transaction.id = envelope.transaction_id
      join shopify.installations as installation
        on installation.id = envelope.installation_id
     where envelope.transaction_id = p_transaction_id
       and envelope.workspace_id = p_workspace_id
       and envelope.install_generation = p_install_generation
       and envelope.provider = p_provider
       and transaction.status = 'claimed'
       and transaction.workspace_id = envelope.workspace_id
       and transaction.install_generation = envelope.install_generation
       and transaction.provider = envelope.provider
       and installation.workspace_id = envelope.workspace_id
       and installation.install_generation = envelope.install_generation
       and installation.status = 'active'
       and p_taken_at < envelope.expires_at
     for update of envelope
  ),
  taken as (
    delete from integrations.oauth_pkce_envelopes as envelope
     using authorized
     where envelope.transaction_id = authorized.transaction_id
    returning envelope.*
  )
  select
    taken.transaction_id,
    taken.workspace_id,
    taken.install_generation,
    taken.provider,
    taken.payload_ciphertext,
    taken.nonce,
    taken.auth_tag,
    taken.key_version,
    taken.expires_at
  from taken;
end
$function$;

create or replace function integrations.delete_oauth_pkce_envelope(
  p_transaction_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (deleted boolean)
language sql
security definer
set search_path = ''
as $function$
  with removed as (
    delete from integrations.oauth_pkce_envelopes
     where transaction_id = p_transaction_id
       and workspace_id = p_workspace_id
       and install_generation = p_install_generation
       and provider = p_provider
    returning 1
  )
  select exists(select 1 from removed);
$function$;

create or replace function integrations.store_provider_credential_envelope(
  p_credential_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_purpose text,
  p_payload_ciphertext bytea,
  p_nonce bytea,
  p_auth_tag bytea,
  p_key_version smallint,
  p_expires_at timestamptz
)
returns table (credential_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
begin
  if p_credential_id is null
     or p_workspace_id is null
     or p_install_generation is null or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_purpose <> 'provider_token_set'
     or p_payload_ciphertext is null or octet_length(p_payload_ciphertext) < 1
     or p_nonce is null or octet_length(p_nonce) <> 12
     or p_auth_tag is null or octet_length(p_auth_tag) <> 16
     or p_key_version is null or p_key_version < 1 then
    raise exception 'INVALID_PROVIDER_CREDENTIAL_ENVELOPE';
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

  insert into integrations.provider_credential_envelopes (
    id, installation_id, workspace_id, install_generation, provider, purpose,
    payload_ciphertext, nonce, auth_tag, key_version, expires_at
  ) values (
    p_credential_id, current_installation.id, current_installation.workspace_id,
    current_installation.install_generation, p_provider, p_purpose,
    p_payload_ciphertext, p_nonce, p_auth_tag, p_key_version, p_expires_at
  );

  return query select p_credential_id;
end
$function$;

create or replace function integrations.load_provider_credential_envelope(
  p_credential_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (
  record_id uuid,
  workspace_id uuid,
  install_generation bigint,
  provider text,
  payload_ciphertext bytea,
  nonce bytea,
  auth_tag bytea,
  key_version smallint,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $function$
  select
    envelope.id,
    envelope.workspace_id,
    envelope.install_generation,
    envelope.provider,
    envelope.payload_ciphertext,
    envelope.nonce,
    envelope.auth_tag,
    envelope.key_version,
    envelope.expires_at
  from integrations.provider_credential_envelopes as envelope
  join shopify.installations as installation
    on installation.id = envelope.installation_id
  where envelope.id = p_credential_id
    and envelope.workspace_id = p_workspace_id
    and envelope.install_generation = p_install_generation
    and envelope.provider = p_provider
    and envelope.purpose = 'provider_token_set'
    and installation.workspace_id = envelope.workspace_id
    and installation.install_generation = envelope.install_generation
    and installation.status = 'active';
$function$;

create or replace function integrations.delete_provider_credential_envelope(
  p_credential_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text
)
returns table (deleted boolean)
language sql
security definer
set search_path = ''
as $function$
  with authorized as (
    select envelope.id
    from integrations.provider_credential_envelopes as envelope
    join shopify.installations as installation
      on installation.id = envelope.installation_id
    where envelope.id = p_credential_id
      and envelope.workspace_id = p_workspace_id
      and envelope.install_generation = p_install_generation
      and envelope.provider = p_provider
      and installation.workspace_id = envelope.workspace_id
      and installation.install_generation = envelope.install_generation
  ),
  removed as (
    delete from integrations.provider_credential_envelopes as envelope
    using authorized
    where envelope.id = authorized.id
    returning 1
  )
  select exists(select 1 from removed);
$function$;

revoke all on function integrations.token_vault_runtime_guard(smallint)
  from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.store_oauth_pkce_envelope(
  uuid, uuid, bigint, text, bytea, bytea, bytea, smallint, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.take_oauth_pkce_envelope(
  uuid, uuid, bigint, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.delete_oauth_pkce_envelope(
  uuid, uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.store_provider_credential_envelope(
  uuid, uuid, bigint, text, text, bytea, bytea, bytea, smallint, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.load_provider_credential_envelope(
  uuid, uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.delete_provider_credential_envelope(
  uuid, uuid, bigint, text
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function integrations.token_vault_runtime_guard(smallint)
  to adstable_runtime;
grant execute on function integrations.store_oauth_pkce_envelope(
  uuid, uuid, bigint, text, bytea, bytea, bytea, smallint, timestamptz
) to adstable_runtime;
grant execute on function integrations.take_oauth_pkce_envelope(
  uuid, uuid, bigint, text, timestamptz
) to adstable_runtime;
grant execute on function integrations.delete_oauth_pkce_envelope(
  uuid, uuid, bigint, text
) to adstable_runtime;
grant execute on function integrations.store_provider_credential_envelope(
  uuid, uuid, bigint, text, text, bytea, bytea, bytea, smallint, timestamptz
) to adstable_runtime;
grant execute on function integrations.load_provider_credential_envelope(
  uuid, uuid, bigint, text
) to adstable_runtime;
grant execute on function integrations.delete_provider_credential_envelope(
  uuid, uuid, bigint, text
) to adstable_runtime;

comment on table integrations.oauth_pkce_envelopes is
  'EO-03-B AES-256-GCM ciphertext-only, single-use PKCE verifier envelopes. No plaintext verifier.';
comment on table integrations.provider_credential_envelopes is
  'EO-03-B AES-256-GCM ciphertext-only provider token-set envelopes. No plaintext token.';
comment on function integrations.token_vault_runtime_guard(smallint) is
  'Fail-closed schema contract and stored key-version inventory for runtime startup.';

reset role;

commit;
