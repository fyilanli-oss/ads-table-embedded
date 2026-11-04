begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Nonsecret proof on the existing renewal receipt. No token, job or quota table is replaced.
alter table integrations.provider_connection_lifecycle_events
 add column refresh_job_id text,
 add column refresh_job_fence bigint,
 add constraint google_refresh_renewal_job_shape check(
  (refresh_job_id is null and refresh_job_fence is null) or
  (refresh_job_id is not null and refresh_job_fence is not null
   and provider='google_ads' and event_type='credential_renewed'
   and identity_credential_before_id is not null and identity_credential_after_id is not null
   and length(refresh_job_id) between 1 and 256 and refresh_job_fence>0));

create or replace function operations.guard_refresh_merchant_epoch() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if old.merchant_binding_epoch is not null then
  if new.merchant_binding_epoch is null or new.merchant_binding_epoch<old.merchant_binding_epoch then
   raise exception 'MERCHANT_QUOTA_EPOCH_INVALID';end if;
  if to_jsonb(new) is distinct from to_jsonb(old)
   and new.merchant_binding_epoch<=old.merchant_binding_epoch then
   -- Only a committed, exact fenced-job renewal may carry an unchanged Merchant
   -- authority/quota identity onto the next encrypted credential. Every other
   -- field (including all scope keys, quota epochs, targets and flags) is equal.
   if (to_jsonb(new)-array['connection_version','merchant_credential_id'])
       is not distinct from (to_jsonb(old)-array['connection_version','merchant_credential_id'])
    and old.provider='google_ads' and old.enabled and old.merchant_enabled
    and new.connection_version=old.connection_version+1
    and exists(select 1 from integrations.provider_connection_lifecycle_events e
      join integrations.provider_connections c on c.id=e.connection_id
      join operations.refresh_work_bindings b on b.workspace_id=e.workspace_id
       and b.install_generation=e.install_generation and b.provider='google_ads'
       and b.account_id=old.account_id and b.job_id=e.refresh_job_id and b.fence=e.refresh_job_fence
      where e.workspace_id=old.workspace_id and e.install_generation=old.install_generation
       and e.connection_id=old.connection_id and e.provider='google_ads' and e.event_type='credential_renewed'
       and e.version_before=old.connection_version and e.version_after=new.connection_version
       and e.identity_credential_before_id=old.merchant_credential_id
       and e.identity_credential_after_id=new.merchant_credential_id
       and c.installation_id=old.installation_id and c.workspace_id=old.workspace_id
       and c.install_generation=old.install_generation and c.lifecycle_status='connected'
       and c.connection_version=new.connection_version and c.credential_id=new.merchant_credential_id
       and operations.refresh_claim_is_current(b.workspace_id,b.install_generation,b.provider,b.account_id,b.job_id,b.fence)
       and b.source->>'connectionId'=c.id::text
       and (b.source->>'connectionVersion')::bigint=c.connection_version)
    then return new;end if;
   raise exception 'MERCHANT_QUOTA_EPOCH_INVALID';
  end if;
 end if;
 return new;
end
$fn$;

-- One transaction: existing encrypted renewal + exact current claim handoff.
-- Native HTTP is completed before entering this transaction. Any failed guard
-- rolls back the new envelope, old-envelope retirement, receipt and all handoffs.
create function integrations.commit_google_refresh_renewal(
 p_event uuid,p_workspace uuid,p_generation bigint,p_connection uuid,p_expected_version bigint,
 p_expected_credential uuid,p_credential uuid,p_scopes text[],p_verified timestamptz,
 p_ciphertext bytea,p_nonce bytea,p_tag bytea,p_key smallint,p_expires timestamptz,
 p_account text,p_job text,p_fence bigint,p_from date,p_to date,p_observed timestamptz
) returns table(renewal_id uuid,connection_id uuid,lifecycle_status text,connection_version bigint,credential_id uuid)
language plpgsql security definer set search_path='' as $fn$
declare
 c integrations.provider_connections%rowtype;
 b operations.refresh_work_bindings%rowtype;
 q operations.refresh_quota_contexts%rowtype;
 original_source jsonb; original_quota jsonb; r record;
begin
 if p_account is null or p_account!~'^[1-9][0-9]{0,18}$' or p_job is null
  or length(p_job) not between 1 and 256 or p_fence is null or p_fence<1
  or p_from is null or p_to is distinct from p_from or p_observed is null then
  raise exception 'GOOGLE_REFRESH_RENEWAL_INPUT_INVALID';end if;
 -- Same lock order as the canonical credential transaction, then job/coordinator.
 perform 1 from shopify.installations i where i.workspace_id=p_workspace
  and i.install_generation=p_generation and i.status='active' for update;
 if not found then raise exception 'ACTIVE_INSTALLATION_REQUIRED';end if;
 select x.* into c from integrations.provider_connections x where x.id=p_connection
  and x.workspace_id=p_workspace and x.install_generation=p_generation and x.provider='google_ads' for update;
 if not found or c.lifecycle_status<>'connected' or c.connection_version<>p_expected_version
  or c.credential_id is distinct from p_expected_credential
  or p_scopes is null or not(c.granted_scopes<@p_scopes and p_scopes<@c.granted_scopes) then
  raise exception 'GOOGLE_IDENTITY_CONNECTION_CHANGED';end if;
 perform 1 from operations.refresh_control where singleton for update;
 select x.* into b from operations.refresh_work_bindings x where x.workspace_id=p_workspace
  and x.install_generation=p_generation and x.provider='google_ads' and x.account_id=p_account
  and x.job_id=p_job and x.fence=p_fence and x.from_date=p_from and x.to_date=p_to for update;
 if not found or b.source->>'connectionId' is distinct from p_connection::text
  or (b.source->>'connectionVersion')::bigint is distinct from p_expected_version then
  raise exception 'GOOGLE_REFRESH_JOB_NOT_CURRENT';end if;
 original_source:=operations.refresh_preflight_source(p_workspace,p_generation,'google_ads',p_account);
 if original_source is null or b.source->>'selectionId' is distinct from original_source->>'selectionId'
  or (b.source-array['scheduledHour','queuedAt']) is distinct from original_source then
  raise exception 'GOOGLE_REFRESH_JOB_NOT_CURRENT';end if;
 original_quota:=operations.load_refresh_quota_context(p_workspace,p_generation,'google_ads',p_account,p_job,p_fence,p_from,p_to,'google_ads',p_observed);
 if original_quota is null then raise exception 'GOOGLE_REFRESH_JOB_NOT_CURRENT';end if;
 select x.* into q from operations.refresh_quota_contexts x where x.workspace_id=p_workspace
  and x.install_generation=p_generation and x.provider='google_ads' for update;
 if not found or not q.enabled or q.connection_id<>c.id or q.connection_version<>c.connection_version
  or q.installation_id<>c.installation_id or q.account_id<>p_account
  or (q.merchant_enabled and q.merchant_credential_id is distinct from p_expected_credential) then
  raise exception 'GOOGLE_REFRESH_QUOTA_NOT_CURRENT';end if;

 select * into r from integrations.commit_google_identity_renewal(p_event,p_workspace,p_generation,p_connection,p_expected_version,
  p_expected_credential,p_credential,p_scopes,p_verified,p_ciphertext,p_nonce,p_tag,p_key,p_expires);
 update integrations.provider_connection_lifecycle_events e set refresh_job_id=p_job,refresh_job_fence=p_fence
  where e.event_id=p_event and e.connection_id=p_connection and e.version_before=p_expected_version
   and e.version_after=p_expected_version+1 and e.identity_credential_before_id=p_expected_credential
   and e.identity_credential_after_id=p_credential;
 if not found then raise exception 'GOOGLE_REFRESH_RENEWAL_RECEIPT_REQUIRED';end if;
 update operations.refresh_work_bindings x
  set source=jsonb_set(x.source,'{connectionVersion}',to_jsonb(p_expected_version+1),false)
  where x.workspace_id=p_workspace and x.install_generation=p_generation and x.provider='google_ads'
   and x.account_id=p_account and x.job_id=p_job and x.fence=p_fence;
 update operations.refresh_quota_contexts x set connection_version=p_expected_version+1,
  merchant_credential_id=case when x.merchant_enabled then p_credential else x.merchant_credential_id end
  where x.workspace_id=p_workspace and x.install_generation=p_generation and x.provider='google_ads';
 -- Preserve due hour, queue position, reservations and limits. No job is admitted,
 -- reset, completed, or unlocked here; unrelated/old jobs retain their old fence.
 update operations.refresh_queue_accounts x set connection_version=p_expected_version+1
  where x.workspace_id=p_workspace and x.install_generation=p_generation and x.provider='google_ads'
   and x.account_id=p_account and x.connection_id=p_connection::text and x.connection_version=p_expected_version;
 if (operations.refresh_preflight_source(p_workspace,p_generation,'google_ads',p_account)-'connectionVersion')
    is distinct from (original_source-'connectionVersion')
  or operations.load_refresh_quota_context(p_workspace,p_generation,'google_ads',p_account,p_job,p_fence,p_from,p_to,'google_ads',p_observed)
    is distinct from original_quota then raise exception 'GOOGLE_REFRESH_HANDOFF_UNCONFIRMED';end if;
 return query select r.renewal_id,r.connection_id,r.lifecycle_status,r.connection_version,r.credential_id;
end
$fn$;
revoke all on function integrations.commit_google_refresh_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz,text,text,bigint,date,date,timestamptz)
 from public,anon,authenticated,service_role,adstable_refresh_coordinator,adstable_runtime;
grant execute on function integrations.commit_google_refresh_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz,text,text,bigint,date,date,timestamptz)
 to adstable_runtime;
reset role;
commit;
