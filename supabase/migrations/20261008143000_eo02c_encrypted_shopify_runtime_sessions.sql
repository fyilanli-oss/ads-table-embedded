begin;

set local role adstable_owner;

create table shopify.runtime_sessions (
  session_id text primary key
    check (char_length(session_id) between 1 and 255),
  shop_domain text not null
    check (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  payload_ciphertext bytea not null
    check (octet_length(payload_ciphertext) > 0),
  nonce bytea not null
    check (octet_length(nonce) = 12),
  auth_tag bytea not null
    check (octet_length(auth_tag) = 16),
  key_version smallint not null
    check (key_version > 0),
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint runtime_sessions_timestamp_order check (updated_at >= created_at)
);

create index runtime_sessions_shop_lookup_idx
  on shopify.runtime_sessions (shop_domain, expires_at desc nulls last);

alter table shopify.runtime_sessions enable row level security;
alter table shopify.runtime_sessions force row level security;

create policy runtime_sessions_owner_all
  on shopify.runtime_sessions
  for all
  to adstable_owner
  using (true)
  with check (true);

revoke all on table shopify.runtime_sessions
  from public, anon, authenticated, service_role, adstable_runtime;

create or replace function shopify.store_runtime_session(
  p_session_id text,
  p_shop_domain text,
  p_payload_ciphertext bytea,
  p_nonce bytea,
  p_auth_tag bytea,
  p_key_version smallint,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_session_id is null
     or char_length(p_session_id) not between 1 and 255
     or p_shop_domain is null
     or p_shop_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'
     or p_payload_ciphertext is null
     or octet_length(p_payload_ciphertext) = 0
     or p_nonce is null
     or octet_length(p_nonce) <> 12
     or p_auth_tag is null
     or octet_length(p_auth_tag) <> 16
     or p_key_version is null
     or p_key_version < 1 then
    raise exception 'INVALID_RUNTIME_SESSION_ENVELOPE';
  end if;

  insert into shopify.runtime_sessions (
    session_id,
    shop_domain,
    payload_ciphertext,
    nonce,
    auth_tag,
    key_version,
    expires_at
  ) values (
    p_session_id,
    p_shop_domain,
    p_payload_ciphertext,
    p_nonce,
    p_auth_tag,
    p_key_version,
    p_expires_at
  )
  on conflict (session_id) do update
    set shop_domain = excluded.shop_domain,
        payload_ciphertext = excluded.payload_ciphertext,
        nonce = excluded.nonce,
        auth_tag = excluded.auth_tag,
        key_version = excluded.key_version,
        expires_at = excluded.expires_at,
        updated_at = statement_timestamp();

  return true;
end
$function$;

create or replace function shopify.load_runtime_session(p_session_id text)
returns table (
  session_id text,
  shop_domain text,
  payload_ciphertext bytea,
  nonce bytea,
  auth_tag bytea,
  key_version smallint,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select runtime_session.session_id,
         runtime_session.shop_domain,
         runtime_session.payload_ciphertext,
         runtime_session.nonce,
         runtime_session.auth_tag,
         runtime_session.key_version,
         runtime_session.expires_at
    from shopify.runtime_sessions as runtime_session
   where runtime_session.session_id = p_session_id
$function$;

create or replace function shopify.delete_runtime_session(p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from shopify.runtime_sessions
   where session_id = p_session_id;
  return true;
end
$function$;

create or replace function shopify.delete_runtime_sessions(p_session_ids text[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_session_ids is null or cardinality(p_session_ids) > 100 then
    raise exception 'INVALID_RUNTIME_SESSION_IDS';
  end if;

  delete from shopify.runtime_sessions
   where session_id = any (p_session_ids);
  return true;
end
$function$;

create or replace function shopify.find_runtime_sessions_by_shop(p_shop_domain text)
returns table (
  session_id text,
  shop_domain text,
  payload_ciphertext bytea,
  nonce bytea,
  auth_tag bytea,
  key_version smallint,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select runtime_session.session_id,
         runtime_session.shop_domain,
         runtime_session.payload_ciphertext,
         runtime_session.nonce,
         runtime_session.auth_tag,
         runtime_session.key_version,
         runtime_session.expires_at
    from shopify.runtime_sessions as runtime_session
   where runtime_session.shop_domain = p_shop_domain
   order by runtime_session.expires_at desc nulls last,
            runtime_session.updated_at desc
   limit 25
$function$;

revoke all on function shopify.store_runtime_session(text, text, bytea, bytea, bytea, smallint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function shopify.load_runtime_session(text)
  from public, anon, authenticated, service_role;
revoke all on function shopify.delete_runtime_session(text)
  from public, anon, authenticated, service_role;
revoke all on function shopify.delete_runtime_sessions(text[])
  from public, anon, authenticated, service_role;
revoke all on function shopify.find_runtime_sessions_by_shop(text)
  from public, anon, authenticated, service_role;

grant execute on function shopify.store_runtime_session(text, text, bytea, bytea, bytea, smallint, timestamptz)
  to adstable_runtime;
grant execute on function shopify.load_runtime_session(text)
  to adstable_runtime;
grant execute on function shopify.delete_runtime_session(text)
  to adstable_runtime;
grant execute on function shopify.delete_runtime_sessions(text[])
  to adstable_runtime;
grant execute on function shopify.find_runtime_sessions_by_shop(text)
  to adstable_runtime;

comment on table shopify.runtime_sessions is
  'Ciphertext-only Shopify framework sessions. Token JSON and credentials are never stored in plaintext.';
comment on function shopify.store_runtime_session(text, text, bytea, bytea, bytea, smallint, timestamptz) is
  'Function-only upsert for an application-encrypted Shopify session envelope.';

reset role;

commit;
