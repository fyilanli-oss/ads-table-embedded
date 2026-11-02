begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
-- Private trusted-server boundary. AES payload semantics are checked by the
-- purpose-keyed application reader; SQL rechecks durable evidence/CAS/authority.
-- No real reviewed rule is registered and no application role is granted access.
create function identity.mapping_review_state(o jsonb,p_mapping bigint,p_rule bigint,p_write boolean) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare m identity.product_identity_mappings%rowtype; r identity.source_rule_versions%rowtype;
 b evidence.source_batches%rowtype; rb evidence.source_batches%rowtype; origin evidence.source_batches%rowtype;
 refs jsonb; pages jsonb:='[]'; page record; result jsonb; ctx jsonb; rd jsonb; total_bytes bigint:=0; oldest timestamptz;
 w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
begin
 if coalesce(o->>'provider','') not in ('google_ads','meta','klaviyo') or p_mapping is null or p_rule is null or p_write is null
 then raise exception 'MAPPING_INPUT_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if not exists(select 1 from integrations.provider_connections c where c.id=(o->>'connectionId')::uuid and c.granted_scopes @>
  case o->>'provider' when 'google_ads' then array['https://www.googleapis.com/auth/adwords','https://www.googleapis.com/auth/content']
  when 'meta' then array['ads_read','catalog_management','business_management','pages_read_engagement','pages_show_list']
  else array['accounts:read','campaigns:read','flows:read','events:read','metrics:read'] end)
 then raise exception 'MAPPING_SCOPES_NOT_CURRENT';end if;
 select * into m from identity.product_identity_mappings where workspace_id=w and installation_id=iid and installation_generation=g and id=p_mapping for share;
 if not found or m.mapping_state not in ('unresolved','verified') or m.retain_until<=clock_timestamp()
 or exists(select 1 from identity.product_identity_mappings n where n.workspace_id=w and n.installation_id=iid and n.installation_generation=g and n.identity_hash=m.identity_hash and n.revision>m.revision)
 then raise exception 'MAPPING_NOT_CURRENT';end if;
 select * into r from identity.source_rule_versions where workspace_id=w and installation_id=iid and installation_generation=g and id=p_rule for share;
 if not found or r.review_status<>'reviewed' or r.retain_until<=clock_timestamp() or r.native_context is distinct from m.native_context
 or r.parser_version<>'product-mapping-v1' or r.rule_kind<>'product_identity'
 or exists(select 1 from identity.source_rule_versions n where n.workspace_id=w and n.installation_id=iid and n.installation_generation=g and n.rule_key=r.rule_key and n.version>r.version)
 or r.applicability->'owner' is distinct from o
 or not coalesce(isfinite((r.applicability->>'from')::timestamptz) and isfinite((r.applicability->>'until')::timestamptz)
 and (r.applicability->>'from')::timestamptz<=clock_timestamp() and (r.applicability->>'until')::timestamptz>clock_timestamp()
 and (r.applicability->>'maxObservationAgeMs')::bigint between 1 and 86400000,false)
 then raise exception 'MAPPING_RULE_NOT_CURRENT';end if;
 select * into b from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and id=m.accepted_batch_id for share;
 select * into rb from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and id=r.accepted_batch_id for share;
 if b.authority is distinct from o or rb.authority is distinct from o or b.storage_state<>'committed' or rb.storage_state<>'committed'
 or b.source_state<>'complete' or rb.source_state<>'complete' or least(b.retain_until,rb.retain_until)<=clock_timestamp()
 then raise exception 'MAPPING_BATCH_NOT_CURRENT';end if;
 if m.mapping_state='verified' then
  if m.source_rule_version_id is distinct from r.id or b.manifest->>'kind' is distinct from 'mapping_verification_v1'
  then raise exception 'MAPPING_RECEIPT_REQUIRED';end if;
  select * into origin from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and id=(b.manifest->>'sourceBatchId')::bigint for share;
 else origin:=b;end if;
 if origin.authority is distinct from o or origin.storage_state<>'committed' or origin.source_state<>'complete' or origin.retain_until<=clock_timestamp()
 then raise exception 'MAPPING_ORIGIN_NOT_CURRENT';end if;
 rd:=origin.manifest->case o->>'provider' when 'google_ads' then 'googleRead' when 'meta' then 'metaRead' else 'klaviyoRead' end;
 if rd is null or not coalesce(isfinite((rd->>'completedAt')::timestamptz) and (rd->>'completedAt')::timestamptz<=clock_timestamp()
 and (rd->>'completedAt')::timestamptz>clock_timestamp()-((r.applicability->>'maxObservationAgeMs')::bigint*interval '1 millisecond')
 and (rd->>'completedAt')::timestamptz>=(r.applicability->>'from')::timestamptz,false)
 then raise exception 'MAPPING_OBSERVATION_STALE';end if;
 if (o->>'provider'='google_ads' and rd->>'merchantId' is distinct from m.native_context->>'merchant_id')
 or (o->>'provider'='meta' and rd->'target'->>'catalogId' is distinct from m.native_context->>'catalog_id')
 or (o->>'provider'='klaviyo' and rd->'sourceContext'->>'metricId' is distinct from m.native_context->>'metric_id')
 then raise exception 'MAPPING_NATIVE_CONTEXT_INVALID';end if;
 if p_write then
  ctx:=operations.load_refresh_quota_context(w,g,o->>'provider',o->>'accountId',rd->>'jobId',(rd->>'fence')::bigint,
   (rd->'window'->>'from')::date,(rd->'window'->>'to')::date,o->>'provider',(rd->>'observedAt')::timestamptz);
  if ctx is null or ctx is distinct from rd->'quotaContext' or coalesce((rd->>'deadlineAt')::timestamptz,'-infinity')<=clock_timestamp()
  or (o->>'provider'='google_ads' and ctx->'merchant'->>'targetAccountId' is distinct from rd->>'merchantId')
  or (o->>'provider'<>'google_ads' and coalesce((rd->>'permissionExpiresAt')::timestamptz,'-infinity')<=clock_timestamp())
  then raise exception 'MAPPING_JOB_NOT_CURRENT';end if;
 end if;
 select coalesce(jsonb_agg(x order by x->>'id',x->>'target',x->>'role'),'[]') into refs from (
  select jsonb_build_object('id',q.id::text,'pageId',q.page_id::text,'locator',q.record_locator,'nativeType',q.native_record_type,'nativeId',q.native_record_id,
   'recordHash',q.record_hash,'role',l.role,'target',case when l.mapping_id=m.id then 'mapping' else 'rule' end,'retainUntil',least(q.retain_until,l.retain_until)) x
  from evidence.source_reference_links l join evidence.source_references q on q.workspace_id=l.workspace_id and q.installation_id=l.installation_id and q.installation_generation=l.installation_generation and q.id=l.source_reference_id
  where l.workspace_id=w and l.installation_id=iid and l.installation_generation=g and (l.mapping_id=m.id or l.source_rule_version_id=r.id)
  and q.observation_state='present' order by l.id limit 101) bounded;
 if exists(select 1 from evidence.source_reference_links l join evidence.source_references q on q.id=l.source_reference_id
  where l.workspace_id=w and l.installation_id=iid and l.installation_generation=g and (l.mapping_id=m.id or l.source_rule_version_id=r.id) and q.observation_state<>'present')
 or jsonb_array_length(refs) not between 2 and 100 or not exists(select 1 from jsonb_array_elements(refs) x where x->>'target'='rule')
 or not exists(select 1 from jsonb_array_elements(refs) x where x->>'target'='mapping' and x->>'role'='candidate_check')
 or exists(select 1 from jsonb_array_elements(refs) x where (x->>'retainUntil')::timestamptz<=clock_timestamp())
 then raise exception 'MAPPING_EVIDENCE_REQUIRED';end if;
 for page in select distinct p.id,p.batch_id,p.plain_byte_count,p.retain_until from evidence.source_pages p
 where p.workspace_id=w and p.installation_id=iid and p.installation_generation=g and p.id in(select (x->>'pageId')::bigint from jsonb_array_elements(refs) x) order by p.id loop
  total_bytes:=total_bytes+page.plain_byte_count;
  if total_bytes>16777216 or page.retain_until<=clock_timestamp() then raise exception 'MAPPING_EVIDENCE_BOUNDS';end if;
  select * into b from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and id=page.batch_id for share;
  if b.authority is distinct from o or b.storage_state<>'committed' or b.source_state<>'complete' or b.retain_until<=clock_timestamp()
  then raise exception 'MAPPING_EVIDENCE_BATCH_INVALID';end if;
  pages:=pages||(select jsonb_build_array(jsonb_build_object('id',p.id::text,'batchId',b.id::text,'attemptId',b.attempt_id,'batchOrdinal',b.batch_ordinal,
    'family',p.family,'ordinal',p.page_ordinal,'origin',p.origin,'payloadHash',p.payload_hash,'captureLayer',p.capture_layer,'numericFidelity',p.numeric_fidelity,
    'fieldCoverage',p.field_coverage,'schemaVersion',p.payload_schema_version,'sanitizerVersion',p.sanitizer_version,'keyVersion',p.key_version,'plainBytes',p.plain_byte_count,
    'ciphertext',encode(p.ciphertext,'hex'),'nonce',encode(p.nonce,'hex'),'authTag',encode(p.auth_tag,'hex'),'retainUntil',p.retain_until))
   from evidence.source_pages p where p.workspace_id=w and p.installation_id=iid and p.installation_generation=g and p.id=page.id and p.purged_at is null);
  if pages is null then raise exception 'MAPPING_EVIDENCE_PURGED';end if;
 end loop;
 result:=jsonb_build_object('owner',o,'mapping',jsonb_build_object('id',m.id::text,'revision',m.revision::text,'identityKey',m.identity_key_canonical,'identityVersion',m.identity_key_version,
  'nativeId',m.native_product_id,'context',m.native_context,'state',m.mapping_state,'productId',m.shopify_product_id,'variantId',m.shopify_variant_id,'retainUntil',m.retain_until),
  'rule',jsonb_build_object('id',r.id::text,'ruleKey',r.rule_key,'version',r.version::text,'kind',r.rule_kind,'context',r.native_context,'parserVersion',r.parser_version,
   'basis',r.documented_basis,'applicability',r.applicability,'retainUntil',r.retain_until),
  'sourceBatchId',origin.id::text,'sourceCommitId',origin.commit_id,'sourceDigest',origin.request_digest,'completedAt',rd->>'completedAt',
  'references',refs,'pages',pages);
 return result||jsonb_build_object('snapshotHash',evidence.source_hash(result));
end $fn$;
create function identity.commit_verified_mapping(o jsonb,p_operation uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare s jsonb; prior evidence.source_batches%rowtype; old identity.product_identity_mappings%rowtype;
 bid bigint; mid bigint; digest text:=evidence.source_hash(p); until_time timestamptz; n integer; result jsonb;
 w uuid:=(o->>'workspaceId')::uuid;iid bigint:=(o->>'installationId')::bigint;g bigint:=(o->>'generation')::bigint;
begin
 if p_operation is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384
 or (select count(*) from jsonb_object_keys(p))<>7 or not p ?& array['mappingId','ruleId','snapshotHash','productId','variantId','policy','deadlineAt']
 or coalesce(p->>'productId','') !~ '^gid://shopify/Product/[1-9][0-9]*$'
 or (p->>'variantId' is not null and p->>'variantId' !~ '^gid://shopify/ProductVariant/[1-9][0-9]*$')
 or not coalesce(isfinite((p->>'deadlineAt')::timestamptz) and (p->>'deadlineAt')::timestamptz>clock_timestamp()
 and (p->>'deadlineAt')::timestamptz<=clock_timestamp()+interval '10 minutes',false)
 then raise exception 'MAPPING_WRITE_INPUT_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_operation::text,0));
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_operation and batch_ordinal=0;
 if found then
  if prior.authority is distinct from o or prior.request_digest<>digest or prior.manifest->>'kind' is distinct from 'mapping_verification_v1'
  then raise exception 'MAPPING_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_operation,0);
 end if;
 s:=identity.mapping_review_state(o,(p->>'mappingId')::bigint,(p->>'ruleId')::bigint,true);
 if s->>'snapshotHash' is distinct from p->>'snapshotHash' or s->'mapping'->>'state'<>'unresolved'
 then raise exception 'MAPPING_SNAPSHOT_CHANGED';end if;
 until_time:=(p->'policy'->>'until')::timestamptz;
 if coalesce(length(p->'policy'->>'version'),0) not between 1 and 128 or not coalesce(isfinite(until_time) and until_time>clock_timestamp(),false)
 or until_time>(s->'mapping'->>'retainUntil')::timestamptz or until_time>(s->'rule'->>'retainUntil')::timestamptz
 or until_time>(s->'rule'->'applicability'->>'until')::timestamptz
 or exists(select 1 from jsonb_array_elements(s->'references') x where until_time>(x->>'retainUntil')::timestamptz)
 or exists(select 1 from jsonb_array_elements(s->'pages') x where until_time>(x->>'retainUntil')::timestamptz)
 then raise exception 'MAPPING_POLICY_INVALID';end if;
 select * into old from identity.product_identity_mappings where workspace_id=w and installation_id=iid and installation_generation=g and id=(p->>'mappingId')::bigint for update;
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||old.identity_hash,0));
 insert into evidence.source_batches(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,attempt_id,batch_ordinal,primary_source,authority,source_state,storage_state,request_digest,manifest)
 values(w,iid,g,o->>'shopId','metadata',until_time,p_operation,0,o->>'provider',o,'complete','staged',digest,'{}') returning id into bid;
 insert into identity.product_identity_mappings(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,accepted_batch_id,source_rule_version_id,supersedes_id,
 identity_key_version,identity_key_canonical,identity_hash,revision,native_product_id,native_context,shopify_product_id,shopify_variant_id,mapping_state,verified_at,applicability)
 values(w,iid,g,o->>'shopId','identity',until_time,bid,(p->>'ruleId')::bigint,old.id,old.identity_key_version,old.identity_key_canonical,old.identity_hash,old.revision+1,
 old.native_product_id,old.native_context,p->>'productId',p->>'variantId','verified',clock_timestamp(),jsonb_build_object('verificationVersion','product-mapping-v1','operationId',p_operation,'sourceBatchId',s->>'sourceBatchId','snapshotHash',s->>'snapshotHash','policy',p->'policy')) returning id into mid;
 insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,mapping_id)
 select w,iid,g,o->>'shopId','identity',until_time,(x->>'id')::bigint,case when x->>'target'='rule' then 'reviewed_rule' else x->>'role' end,mid
 from jsonb_array_elements(s->'references') x group by x->>'id',case when x->>'target'='rule' then 'reviewed_rule' else x->>'role' end;
 get diagnostics n=row_count;
 update evidence.source_batches set storage_state='committed',commit_id=gen_random_uuid(),committed_at=clock_timestamp(),
 manifest=jsonb_build_object('kind','mapping_verification_v1','sourceBatchId',s->>'sourceBatchId','sourceMappingId',old.id::text,'ruleId',p->>'ruleId','policy',p->'policy',
 'counts',jsonb_build_object('pages',0,'references',0,'rules',0,'mappings',1,'orders',0,'lines',0,'journeys',0,'claims',0,'links',n),'ids',jsonb_build_object('mapping:accepted',mid::text))
 where id=bid and workspace_id=w and installation_id=iid and installation_generation=g;
 get diagnostics n=row_count;
 if n<>1 or (p->>'deadlineAt')::timestamptz<=clock_timestamp() then raise exception 'MAPPING_FINALIZE_FAILED';end if;
 return evidence.read_source_receipt(o,p_operation,0);
end $fn$;
create function identity.lookup_verified_mapping(o jsonb,p_identity jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare m identity.product_identity_mappings%rowtype; h text;
begin
 if jsonb_typeof(p_identity) is distinct from 'object' or octet_length(p_identity::text)>8192
 or (select count(*) from jsonb_object_keys(p_identity))<>4 or not p_identity ?& array['provider','accountId','nativeId','context']
 or p_identity->>'provider' is distinct from o->>'provider' or p_identity->>'accountId' is distinct from o->>'accountId'
 or jsonb_typeof(p_identity->'nativeId') is distinct from 'string' or coalesce(length(p_identity->>'nativeId'),0) not between 1 and 1024
 or jsonb_typeof(p_identity->'context') is distinct from 'object' then raise exception 'MAPPING_IDENTITY_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 h:=evidence.source_hash(p_identity);
 if exists(select 1 from identity.product_identity_mappings x where x.workspace_id=(o->>'workspaceId')::uuid and x.installation_id=(o->>'installationId')::bigint
  and x.installation_generation=(o->>'generation')::bigint and x.identity_hash=h and (x.identity_key_version<>'1' or x.identity_key_canonical<>p_identity::text))
 then raise exception 'MAPPING_IDENTITY_COLLISION';end if;
 select * into m from identity.product_identity_mappings x where x.workspace_id=(o->>'workspaceId')::uuid and x.installation_id=(o->>'installationId')::bigint
  and x.installation_generation=(o->>'generation')::bigint and x.identity_hash=h order by x.revision desc limit 1;
 if not found or m.mapping_state<>'verified' or m.source_rule_version_id is null then raise exception 'MAPPING_NOT_VERIFIED';end if;
 return identity.mapping_review_state(o,m.id,m.source_rule_version_id,false);
end $fn$;
revoke all on function identity.mapping_review_state(jsonb,bigint,bigint,boolean),identity.commit_verified_mapping(jsonb,uuid,jsonb),identity.lookup_verified_mapping(jsonb,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
