begin;

set local role adstable_owner;

create or replace function shopify.resolve_active_installation_callback_return(
  p_workspace_id uuid,
  p_install_generation bigint
)
returns table (
  shop_domain text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_installation shopify.installations%rowtype;
begin
  if p_workspace_id is null
     or p_install_generation is null
     or p_install_generation < 1 then
    raise exception 'INVALID_CALLBACK_RETURN_AUTHORITY';
  end if;

  select installation.*
    into current_installation
    from shopify.installations as installation
   where installation.workspace_id = p_workspace_id
     and installation.install_generation = p_install_generation
     and installation.status = 'active'
   for share;

  if not found
     or current_installation.shop_domain !~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$' then
    raise exception 'ACTIVE_INSTALLATION_CALLBACK_RETURN_UNAVAILABLE';
  end if;

  return query select current_installation.shop_domain;
end
$function$;

create or replace function integrations.cancel_provider_authorization_handoff(
  p_oauth_transaction_id uuid,
  p_workspace_id uuid,
  p_install_generation bigint,
  p_provider text,
  p_cancelled_at timestamptz
)
returns table (
  cancelled boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_handoff integrations.provider_authorization_handoffs%rowtype;
  current_credential_id uuid;
begin
  if p_oauth_transaction_id is null
     or p_workspace_id is null
     or p_install_generation is null
     or p_install_generation < 1
     or p_provider not in ('meta', 'google_ads', 'klaviyo')
     or p_cancelled_at is null then
    raise exception 'INVALID_PROVIDER_AUTHORIZATION_HANDOFF_CANCELLATION';
  end if;

  select handoff.*
    into current_handoff
    from integrations.provider_authorization_handoffs as handoff
    join shopify.installations as installation
      on installation.id = handoff.installation_id
   where handoff.oauth_transaction_id = p_oauth_transaction_id
     and handoff.workspace_id = p_workspace_id
     and handoff.install_generation = p_install_generation
     and handoff.provider = p_provider
     and installation.workspace_id = handoff.workspace_id
     and installation.install_generation = handoff.install_generation
     and installation.status = 'active'
   for update of handoff;

  if not found
     or current_handoff.status <> 'awaiting_selection'
     or current_handoff.credential_id is null
     or p_cancelled_at < current_handoff.created_at then
    raise exception 'PROVIDER_AUTHORIZATION_HANDOFF_UNAVAILABLE';
  end if;

  current_credential_id := current_handoff.credential_id;

  update integrations.provider_authorization_handoffs as handoff
     set status = 'failed',
         credential_id = null,
         failure_code = 'USER_CANCELLED_SELECTION',
         updated_at = statement_timestamp()
   where handoff.oauth_transaction_id = current_handoff.oauth_transaction_id
     and handoff.status = 'awaiting_selection'
     and handoff.credential_id = current_credential_id;

  if not found then
    raise exception 'PROVIDER_AUTHORIZATION_HANDOFF_CANCEL_RACE';
  end if;

  delete from integrations.provider_credential_envelopes as credential
   where credential.id = current_credential_id
     and credential.workspace_id = p_workspace_id
     and credential.install_generation = p_install_generation
     and credential.provider = p_provider
     and not exists (
       select 1
         from integrations.provider_connections as connection
        where connection.credential_id = credential.id
     );

  if not found then
    raise exception 'PROVIDER_AUTHORIZATION_HANDOFF_ORPHAN_CREDENTIAL_MISSING';
  end if;

  return query select true;
end
$function$;

revoke all on function shopify.resolve_active_installation_callback_return(
  uuid, bigint
) from public, anon, authenticated, service_role, adstable_runtime;
revoke all on function integrations.cancel_provider_authorization_handoff(
  uuid, uuid, bigint, text, timestamptz
) from public, anon, authenticated, service_role, adstable_runtime;

grant execute on function shopify.resolve_active_installation_callback_return(
  uuid, bigint
) to adstable_runtime;
grant execute on function integrations.cancel_provider_authorization_handoff(
  uuid, uuid, bigint, text, timestamptz
) to adstable_runtime;

comment on function shopify.resolve_active_installation_callback_return(uuid, bigint) is
  'Returns the active canonical Shopify installation domain for an already-claimed OAuth transaction authority.';
comment on function integrations.cancel_provider_authorization_handoff(uuid, uuid, bigint, text, timestamptz) is
  'Cancels a matching pending provider handoff and removes its unreferenced encrypted credential.';

reset role;

commit;
