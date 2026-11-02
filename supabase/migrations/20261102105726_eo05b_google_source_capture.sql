begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Private, bounded source preparation only. No runtime/coordinator EXECUTE grant.
create function evidence.commit_google_identity_source(o jsonb,p_attempt uuid,p_ordinal integer,p jsonb,p_read jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
 ctx jsonb; input_hash text; prior evidence.source_batches%rowtype; item jsonb; normalized jsonb:='[]'; m identity.product_identity_mappings%rowtype;
 revision bigint; h text; receipt jsonb; k text;
begin
 if o->>'provider' is distinct from 'google_ads' or p_ordinal is distinct from 0
 or jsonb_typeof(p_read) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_read))<>8
 or not p_read ?& array['jobId','fence','window','observedAt','merchantId','quotaContext','completedAt','deadlineAt']
 or p->>'sourceState' is distinct from 'complete' then raise exception 'GOOGLE_SOURCE_BINDING_INVALID';end if;
 foreach k in array array['orders','lines','journeys','claims','rules'] loop
  if jsonb_array_length(p->k) is distinct from 0 then raise exception 'GOOGLE_SOURCE_FAMILY_INVALID';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'pages') x where x->>'origin'<>'google_ads'
 or x->>'family' not in ('merchant_products','google_merchant_link','google_candidate_checks')
 or x->>'captureLayer'<>'collector_projection') then raise exception 'GOOGLE_SOURCE_FAMILY_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform 1 from operations.refresh_quota_contexts where workspace_id=w and install_generation=g and provider='google_ads' for share;
 perform 1 from billing.workspace_subscriptions where workspace_id=w and installation_id=iid and install_generation=g for share;
 perform 1 from billing.workspace_entitlements where workspace_id=w and install_generation=g for share;
 ctx:=operations.load_refresh_quota_context(w,g,'google_ads',o->>'accountId',p_read->>'jobId',(p_read->>'fence')::bigint,
  (p_read->'window'->>'from')::date,(p_read->'window'->>'to')::date,'google_ads',(p_read->>'observedAt')::timestamptz);
 if ctx is null or ctx is distinct from p_read->'quotaContext'
 or ctx->'merchant'->>'targetAccountId' is distinct from p_read->>'merchantId'
 or (p_read->>'completedAt')::timestamptz<(p_read->>'observedAt')::timestamptz
 or (p_read->>'completedAt')::timestamptz>clock_timestamp()
 or (p_read->>'deadlineAt')::timestamptz<=clock_timestamp()
 or (p_read->>'deadlineAt')::timestamptz>clock_timestamp()+interval '10 minutes'
 then raise exception 'GOOGLE_SOURCE_READ_NOT_CURRENT';end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_attempt::text||p_ordinal::text,0));
 input_hash:=evidence.source_hash(p);
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_attempt and batch_ordinal=0;
 if found then
  if prior.authority is distinct from o or prior.manifest->>'googleInputDigest' is distinct from input_hash
   or prior.manifest->'googleRead' is distinct from p_read then raise exception 'GOOGLE_SOURCE_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_attempt,0);
 end if;
 -- Lock canonical identities in a stable order. A version is assigned by durable
 -- state; caller revision1 cannot overwrite a previous connection/observation.
 for item in select value from jsonb_array_elements(p->'mappings') order by evidence.source_hash(value->'identity') loop
  if item->>'state' not in ('unresolved','conflicting') or item->>'productId' is not null or item->>'variantId' is not null
   or item->>'verifiedAt' is not null or item->>'rule' is not null
   or item->'context'->>'merchant_id' is distinct from p_read->>'merchantId' then raise exception 'GOOGLE_SOURCE_VERIFICATION_FORBIDDEN';end if;
  h:=evidence.source_hash(item->'identity');perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||h,0));
 end loop;
 for item in select value from jsonb_array_elements(p->'mappings') loop
  h:=evidence.source_hash(item->'identity');
  select * into m from identity.product_identity_mappings where workspace_id=w and installation_id=iid and installation_generation=g
   and identity_hash=h order by revision desc limit 1;
  if found then
   if m.identity_key_canonical<>(item->'identity')::text or m.identity_key_version<>'1' then raise exception 'SOURCE_IDENTITY_HASH_CONFLICT';end if;
   if m.mapping_state=item->>'state' and m.applicability=item->'applicability'
    and (select authority from evidence.source_batches where id=m.accepted_batch_id)=o then revision:=m.revision;
   else revision:=m.revision+1;end if;
  else revision:=1;end if;
  normalized:=normalized||jsonb_build_array(item||jsonb_build_object('revision',revision::text));
 end loop;
 receipt:=evidence.commit_source_batch(o,p_attempt,0,p||jsonb_build_object('mappings',normalized));
 update identity.product_identity_mappings current_mapping set supersedes_id=(select old.id from identity.product_identity_mappings old where old.workspace_id=w and old.installation_id=iid
  and old.installation_generation=g and old.identity_hash=current_mapping.identity_hash and old.revision<current_mapping.revision order by old.revision desc limit 1)
 where current_mapping.accepted_batch_id=(receipt->>'batchId')::bigint and current_mapping.revision>1;
 update evidence.source_batches set manifest=manifest||jsonb_build_object('googleRead',p_read,'googleInputDigest',input_hash)
 where id=(receipt->>'batchId')::bigint and workspace_id=w and installation_id=iid and installation_generation=g;
 if (p_read->>'deadlineAt')::timestamptz<=clock_timestamp() then raise exception 'GOOGLE_SOURCE_READ_EXPIRED';end if;
 return evidence.read_source_receipt(o,p_attempt,0);
end $fn$;
revoke all on function evidence.commit_google_identity_source(jsonb,uuid,integer,jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
