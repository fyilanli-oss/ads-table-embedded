begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

-- Nonsecret history on the existing lifecycle event; no FK to retired envelopes.
alter table integrations.provider_connection_lifecycle_events
  add column identity_credential_before_id uuid,
  add column identity_credential_after_id uuid,
  add constraint google_identity_renewal_receipt_shape check (
    (identity_credential_before_id is null and identity_credential_after_id is null)
    or (identity_credential_before_id is not null and identity_credential_after_id is not null
      and identity_credential_before_id<>identity_credential_after_id
      and provider='google_ads' and event_type='credential_renewed' and to_status='connected')
  );

create function integrations.commit_google_identity_renewal(
 p_event uuid,p_workspace uuid,p_generation bigint,p_connection uuid,p_expected_version bigint,
 p_expected_credential uuid,p_credential uuid,p_scopes text[],p_verified timestamptz,
 p_ciphertext bytea,p_nonce bytea,p_tag bytea,p_key smallint,p_expires timestamptz
) returns table(renewal_id uuid,connection_id uuid,lifecycle_status text,connection_version bigint,credential_id uuid)
language plpgsql security definer set search_path='' as $function$
declare
 i shopify.installations%rowtype;
 c integrations.provider_connections%rowtype;
 r record;
begin
 if p_event is null or p_workspace is null or p_generation is null or p_generation<1
   or p_connection is null or p_expected_version is null or p_expected_version<1 or p_expected_version>=9007199254740991
   or p_expected_credential is null or p_credential is null or p_expected_credential=p_credential
   or p_verified is null or p_verified<statement_timestamp()-interval '10 minutes'
   or p_verified>statement_timestamp()+interval '1 minute'
   or p_expires is null or p_expires<=statement_timestamp()+interval '1 minute'
   or p_expires>p_verified+interval '1 day'
   or p_scopes is null or cardinality(p_scopes) not between 1 and 100
   or exists(select 1 from unnest(p_scopes) s(v) where v is null or v<>btrim(v) or length(v) not between 1 and 200)
   or cardinality(p_scopes)<>(select count(distinct v) from unnest(p_scopes) s(v))
   then raise exception 'GOOGLE_IDENTITY_RENEWAL_INPUT_INVALID'; end if;
 if not array['https://www.googleapis.com/auth/adwords','https://www.googleapis.com/auth/content']::text[] <@ p_scopes
   then raise exception 'OAUTH_IDENTITY_SCOPE_NOT_GRANTED'; end if;
 select x.* into i from shopify.installations x where x.workspace_id=p_workspace
   and x.install_generation=p_generation and x.status='active' for update;
 if not found then raise exception 'ACTIVE_INSTALLATION_REQUIRED'; end if;
 select x.* into c from integrations.provider_connections x where x.id=p_connection
   and x.installation_id=i.id and x.workspace_id=p_workspace and x.install_generation=p_generation
   and x.provider='google_ads' for update;
 if not found or c.lifecycle_status<>'connected' or c.connection_version<>p_expected_version
   or c.credential_id is distinct from p_expected_credential
   then raise exception 'GOOGLE_IDENTITY_CONNECTION_CHANGED'; end if;
 if not c.granted_scopes <@ p_scopes then raise exception 'GOOGLE_IDENTITY_SCOPE_DOWNGRADE'; end if;
 -- Do not replay a prior mutation, even if its historical receipt still exists.
 if exists(select 1 from integrations.provider_connection_lifecycle_events e where e.event_id=p_event)
   then raise exception 'GOOGLE_IDENTITY_RENEWAL_ALREADY_RECORDED'; end if;
 perform integrations.store_provider_credential_envelope(p_credential,p_workspace,p_generation,'google_ads',
   'provider_token_set',p_ciphertext,p_nonce,p_tag,p_key,p_expires);
 select * into r from integrations.renew_provider_connection_credential(p_event,p_connection,p_workspace,
   p_generation,'google_ads',p_expected_version,p_expected_credential,p_credential,p_scopes,p_verified);
 update integrations.provider_connection_lifecycle_events e
   set identity_credential_before_id=p_expected_credential,identity_credential_after_id=p_credential
   where e.event_id=p_event and e.connection_id=p_connection and e.provider='google_ads'
     and e.event_type='credential_renewed' and e.version_before=p_expected_version
     and e.version_after=p_expected_version+1;
 if not found then raise exception 'GOOGLE_IDENTITY_RENEWAL_RECEIPT_MISSING'; end if;
 return query select p_event,r.connection_id,r.lifecycle_status,r.connection_version,r.credential_id;
end
$function$;

-- Historical commit proof only. Missing receipt is not proof of rollback or retry permission.
create function integrations.read_google_identity_renewal(p_event uuid,p_workspace uuid,p_generation bigint)
returns table(renewal_id uuid,connection_id uuid,version_before bigint,version_after bigint,
 credential_before_id uuid,credential_after_id uuid)
language sql stable security definer set search_path='' as $function$
 select e.event_id,e.connection_id,e.version_before,e.version_after,
   e.identity_credential_before_id,e.identity_credential_after_id
 from integrations.provider_connection_lifecycle_events e
 join integrations.provider_connections c on c.id=e.connection_id and c.workspace_id=e.workspace_id
   and c.install_generation=e.install_generation and c.provider=e.provider
 join shopify.installations i on i.id=c.installation_id
 where e.event_id=p_event and e.workspace_id=p_workspace and e.install_generation=p_generation
   and e.provider='google_ads' and e.event_type='credential_renewed' and e.to_status='connected'
   and e.identity_credential_before_id is not null and e.identity_credential_after_id is not null
   and i.workspace_id=p_workspace and i.install_generation=p_generation and i.status='active'
$function$;
revoke all on function integrations.commit_google_identity_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz),
 integrations.read_google_identity_renewal(uuid,uuid,bigint)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
grant execute on function integrations.commit_google_identity_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz),
 integrations.read_google_identity_renewal(uuid,uuid,bigint) to adstable_runtime;
commit;
