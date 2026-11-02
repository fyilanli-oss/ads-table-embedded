begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
-- Explicit trusted-server review only; no runtime grant or live rule registration.
create function identity.source_rule_review_state(o jsonb,p_mapping bigint,p_proposal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare m identity.product_identity_mappings%rowtype; r identity.source_rule_versions%rowtype;
 b evidence.source_batches%rowtype; origin evidence.source_batches%rowtype;
 refs jsonb; pages jsonb:='[]'; page record; result jsonb; ctx jsonb; rd jsonb; total_bytes bigint:=0;
 w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
begin
 if coalesce(o->>'provider','') not in ('google_ads','meta','klaviyo') or p_mapping is null
 then raise exception 'MAPPING_INPUT_INVALID';end if;
 if jsonb_typeof(p_proposal) is distinct from 'object' or octet_length(p_proposal::text)>8192
 or (select count(*) from jsonb_object_keys(p_proposal))<>6 or not p_proposal ?& array['ruleKey','previousRuleId','basis','from','until','maxObservationAgeMs']
 or coalesce(p_proposal->>'ruleKey','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'
 or not coalesce(isfinite((p_proposal->>'from')::timestamptz) and isfinite((p_proposal->>'until')::timestamptz)
 and (p_proposal->>'from')::timestamptz<=clock_timestamp() and (p_proposal->>'until')::timestamptz>clock_timestamp()
 and (p_proposal->>'maxObservationAgeMs')::bigint between 1 and 86400000,false)
 or p_proposal->'basis'->>'version' is distinct from 'product-source-rule-v1' or p_proposal->'basis'->>'provider' is distinct from o->>'provider'
 then raise exception 'SOURCE_RULE_PROPOSAL_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 if not exists(select 1 from integrations.provider_connections c where c.id=(o->>'connectionId')::uuid and c.granted_scopes @>
  case o->>'provider' when 'google_ads' then array['https://www.googleapis.com/auth/adwords','https://www.googleapis.com/auth/content']
  when 'meta' then array['ads_read','catalog_management','business_management','pages_read_engagement','pages_show_list']
  else array['accounts:read','campaigns:read','flows:read','events:read','metrics:read'] end)
 then raise exception 'MAPPING_SCOPES_NOT_CURRENT';end if;
 select * into m from identity.product_identity_mappings where workspace_id=w and installation_id=iid and installation_generation=g and id=p_mapping for share;
 if not found or m.mapping_state<>'unresolved' or m.retain_until<=clock_timestamp()
 or exists(select 1 from identity.product_identity_mappings n where n.workspace_id=w and n.installation_id=iid and n.installation_generation=g and n.identity_hash=m.identity_hash and n.revision>m.revision)
 then raise exception 'MAPPING_NOT_CURRENT';end if;
 select * into r from identity.source_rule_versions where workspace_id=w and installation_id=iid and installation_generation=g
 and rule_key=p_proposal->>'ruleKey' order by version desc limit 1 for share;
 if r.id::text is distinct from p_proposal->>'previousRuleId'
 or (r.id is not null and (r.native_context is distinct from m.native_context or r.applicability->'owner' is distinct from o
 or r.applicability->'identity' is distinct from m.identity_key_canonical::jsonb))
 then raise exception 'SOURCE_RULE_PREDECESSOR_CHANGED';end if;
 select * into b from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and id=m.accepted_batch_id for share;
 origin:=b;
 if origin.authority is distinct from o or origin.storage_state<>'committed' or origin.source_state<>'complete' or origin.retain_until<=clock_timestamp()
 then raise exception 'MAPPING_ORIGIN_NOT_CURRENT';end if;
 rd:=origin.manifest->case o->>'provider' when 'google_ads' then 'googleRead' when 'meta' then 'metaRead' else 'klaviyoRead' end;
 if rd is null or not coalesce(isfinite((rd->>'completedAt')::timestamptz) and (rd->>'completedAt')::timestamptz<=clock_timestamp()
 and (rd->>'completedAt')::timestamptz>clock_timestamp()-((p_proposal->>'maxObservationAgeMs')::bigint*interval '1 millisecond')
 and (rd->>'completedAt')::timestamptz>=(p_proposal->>'from')::timestamptz,false)
 then raise exception 'MAPPING_OBSERVATION_STALE';end if;
 if (o->>'provider'='google_ads' and rd->>'merchantId' is distinct from m.native_context->>'merchant_id')
 or (o->>'provider'='meta' and rd->'target'->>'catalogId' is distinct from m.native_context->>'catalog_id')
 or (o->>'provider'='klaviyo' and rd->'sourceContext'->>'metricId' is distinct from m.native_context->>'metric_id')
 then raise exception 'MAPPING_NATIVE_CONTEXT_INVALID';end if;
  ctx:=operations.load_refresh_quota_context(w,g,o->>'provider',o->>'accountId',rd->>'jobId',(rd->>'fence')::bigint,
   (rd->'window'->>'from')::date,(rd->'window'->>'to')::date,o->>'provider',(rd->>'observedAt')::timestamptz);
  if ctx is null or ctx is distinct from rd->'quotaContext' or coalesce((rd->>'deadlineAt')::timestamptz,'-infinity')<=clock_timestamp()
  or (o->>'provider'='google_ads' and ctx->'merchant'->>'targetAccountId' is distinct from rd->>'merchantId')
  or (o->>'provider'<>'google_ads' and coalesce((rd->>'permissionExpiresAt')::timestamptz,'-infinity')<=clock_timestamp())
  then raise exception 'MAPPING_JOB_NOT_CURRENT';end if;
 select coalesce(jsonb_agg(x order by x->>'id',x->>'target',x->>'role'),'[]') into refs from (
  select jsonb_build_object('id',q.id::text,'pageId',q.page_id::text,'locator',q.record_locator,'nativeType',q.native_record_type,'nativeId',q.native_record_id,
   'recordHash',q.record_hash,'role',l.role,'target','mapping','retainUntil',least(q.retain_until,l.retain_until)) x
  from evidence.source_reference_links l join evidence.source_references q on q.workspace_id=l.workspace_id and q.installation_id=l.installation_id and q.installation_generation=l.installation_generation and q.id=l.source_reference_id
  where l.workspace_id=w and l.installation_id=iid and l.installation_generation=g and l.mapping_id=m.id
  and q.observation_state='present' order by l.id limit 101) bounded;
 if exists(select 1 from evidence.source_reference_links l join evidence.source_references q on q.id=l.source_reference_id
  where l.workspace_id=w and l.installation_id=iid and l.installation_generation=g and l.mapping_id=m.id and q.observation_state<>'present')
 or jsonb_array_length(refs) not between 2 and 32
 or not exists(select 1 from jsonb_array_elements(refs) x where x->>'target'='mapping' and x->>'role'='candidate_check')
 or exists(select 1 from jsonb_array_elements(refs) x where (x->>'retainUntil')::timestamptz<=clock_timestamp())
 then raise exception 'MAPPING_EVIDENCE_REQUIRED';end if;
 for page in select distinct p.id,p.batch_id,p.plain_byte_count,p.retain_until from evidence.source_pages p
 where p.workspace_id=w and p.installation_id=iid and p.installation_generation=g and p.id in(select (x->>'pageId')::bigint from jsonb_array_elements(refs) x) order by p.id loop
  total_bytes:=total_bytes+page.plain_byte_count;
  if total_bytes>16711680 or page.retain_until<=clock_timestamp() then raise exception 'MAPPING_EVIDENCE_BOUNDS';end if;
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
  'proposal',p_proposal,'proposalHash',evidence.source_hash(p_proposal),'previousRuleId',r.id::text,
  'rule',jsonb_build_object('id','1','ruleKey',p_proposal->>'ruleKey','version',(coalesce(r.version,0)+1)::text,'kind','product_identity','context',m.native_context,'parserVersion','product-mapping-v1',
   'basis',p_proposal->'basis','applicability',jsonb_build_object('owner',o,'identity',m.identity_key_canonical::jsonb,'from',p_proposal->>'from','until',p_proposal->>'until','maxObservationAgeMs',(p_proposal->>'maxObservationAgeMs')::bigint),
   'retainUntil',least(m.retain_until,origin.retain_until,(p_proposal->>'until')::timestamptz)),
  'sourceBatchId',origin.id::text,'sourceCommitId',origin.commit_id,'sourceDigest',origin.request_digest,'completedAt',rd->>'completedAt',
  'references',refs,'pages',pages);
 return result||jsonb_build_object('snapshotHash',evidence.source_hash(result));
end $fn$;
create function identity.commit_reviewed_source_rule(o jsonb,p_operation uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare s jsonb; prior evidence.source_batches%rowtype; projection jsonb; bundle jsonb; receipt jsonb;
 policy jsonb; decision jsonb; until_time timestamptz; rid bigint; bid bigint; n integer; copied integer;
 digest text:=evidence.source_hash(p); w uuid:=(o->>'workspaceId')::uuid; iid bigint:=(o->>'installationId')::bigint; g bigint:=(o->>'generation')::bigint;
begin
 if p_operation is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536
 or (select count(*) from jsonb_object_keys(p))<>8 or not p ?& array['mappingId','proposal','snapshotHash','decision','policy','deadlineAt','page','projectionHash']
 or not coalesce(isfinite((p->>'deadlineAt')::timestamptz) and (p->>'deadlineAt')::timestamptz>clock_timestamp()
 and (p->>'deadlineAt')::timestamptz<=clock_timestamp()+interval '10 minutes',false)
 then raise exception 'SOURCE_RULE_WRITE_INPUT_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 perform evidence.assert_source_owner(o);
 perform pg_advisory_xact_lock(hashtextextended(w::text||iid::text||g::text||p_operation::text,0));
 select * into prior from evidence.source_batches where workspace_id=w and installation_id=iid and installation_generation=g and attempt_id=p_operation and batch_ordinal=0;
 if found then
  if prior.authority is distinct from o or prior.request_digest<>digest or prior.manifest->>'kind' is distinct from 'source_rule_review_v1'
  then raise exception 'SOURCE_RULE_OPERATION_CONFLICT';end if;
  return evidence.read_source_receipt(o,p_operation,0);
 end if;
 s:=identity.source_rule_review_state(o,(p->>'mappingId')::bigint,p->'proposal');
 if s->>'snapshotHash' is distinct from p->>'snapshotHash' then raise exception 'SOURCE_RULE_SNAPSHOT_CHANGED';end if;
 decision:=p->'decision';until_time:=(p->'policy'->>'until')::timestamptz;
 if jsonb_typeof(decision) is distinct from 'object' or (select count(*) from jsonb_object_keys(decision))<>5
 or not decision ?& array['status','decisionId','snapshotHash','proposalHash','validUntil'] or decision->>'status' is distinct from 'approved'
 or decision->>'decisionId' is null or (decision->>'decisionId')::uuid is null
 or decision->>'snapshotHash' is distinct from s->>'snapshotHash' or decision->>'proposalHash' is distinct from s->>'proposalHash'
 or not coalesce(isfinite((decision->>'validUntil')::timestamptz) and (decision->>'validUntil')::timestamptz>clock_timestamp(),false)
 or jsonb_typeof(p->'policy') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'policy'))<>2
 or coalesce(length(p->'policy'->>'version'),0) not between 1 and 128
 or not coalesce(isfinite(until_time) and until_time>clock_timestamp(),false)
 or until_time>(s->'rule'->>'retainUntil')::timestamptz or until_time>(decision->>'validUntil')::timestamptz
 or until_time>(s->>'completedAt')::timestamptz+((p->'proposal'->>'maxObservationAgeMs')::bigint*interval '1 millisecond')
 or exists(select 1 from jsonb_array_elements(s->'references') x where until_time>(x->>'retainUntil')::timestamptz)
 or exists(select 1 from jsonb_array_elements(s->'pages') x where until_time>(x->>'retainUntil')::timestamptz)
 then raise exception 'SOURCE_RULE_REVIEW_OR_POLICY_INVALID';end if;
 if p->'page'->>'key' is distinct from 'review' or p->'page'->>'family' is distinct from 'source_rule_review'
 or p->'page'->>'schemaVersion' is distinct from 'source-rule-review-v1' or p->'page'->>'origin' is distinct from o->>'provider'
 or p->'page'->>'captureLayer' is distinct from 'collector_projection' or p->'page'->>'ordinal' is distinct from '0'
 or (p->'page'->>'plainBytes')::bigint not between 1 and 65536
 or coalesce(p->>'projectionHash','') !~ '^[a-f0-9]{64}$'
 then raise exception 'SOURCE_RULE_PAGE_INVALID';end if;
 projection:=(s->'rule'-'id'-'retainUntil')||jsonb_build_object('applicability',(s->'rule'->'applicability')||jsonb_build_object('review',decision||jsonb_build_object('sourceMappingId',p->>'mappingId')));
 policy:=jsonb_build_object('metadata',p->'policy','raw',p->'policy','identity',p->'policy','order',p->'policy','claim',p->'policy');
 bundle:=jsonb_build_object('sourceState','complete','policy',policy,'pages',jsonb_build_array(p->'page'),
 'references',jsonb_build_array(jsonb_build_object('key','review-ref','page','review','locatorKind','row','locator','/records/0','nativeType','ReviewedSourceRule','nativeId',null,'state','present','hash',p->>'projectionHash')),
 'rules',jsonb_build_array(projection||jsonb_build_object('key','reviewed','state','reviewed')),
 'mappings','[]'::jsonb,'orders','[]'::jsonb,'lines','[]'::jsonb,'journeys','[]'::jsonb,'claims','[]'::jsonb,
 'links',jsonb_build_array(jsonb_build_object('reference','review-ref','targetType','rule','target','reviewed','role','review_basis')));
 receipt:=evidence.commit_source_batch(o,p_operation,0,bundle);rid:=(receipt->'manifest'->'ids'->>'rule:reviewed')::bigint;bid:=(receipt->>'batchId')::bigint;
 if receipt->>'status' is distinct from 'committed' or rid is null or bid is null then raise exception 'SOURCE_RULE_INNER_WRITE_FAILED';end if;
 update identity.source_rule_versions set supersedes_id=(s->>'previousRuleId')::bigint where workspace_id=w and installation_id=iid and installation_generation=g and id=rid;
 get diagnostics n=row_count;if n<>1 then raise exception 'SOURCE_RULE_VERSION_FINALIZE_FAILED';end if;
 insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,source_rule_version_id)
 select w,iid,g,o->>'shopId','identity',until_time,(x->>'id')::bigint,'source_basis',rid from jsonb_array_elements(s->'references') x group by x->>'id';
 get diagnostics copied=row_count;
 if copied<>(select count(distinct x->>'id') from jsonb_array_elements(s->'references') x)
 then raise exception 'SOURCE_RULE_LINK_FINALIZE_FAILED';end if;
 update evidence.source_batches set request_digest=digest,manifest=manifest||jsonb_build_object('kind','source_rule_review_v1',
  'sourceBatchId',s->>'sourceBatchId','sourceMappingId',p->>'mappingId','ruleKey',s->'rule'->>'ruleKey','ruleVersion',s->'rule'->>'version',
  'decisionId',decision->>'decisionId','snapshotHash',s->>'snapshotHash','counts',(manifest->'counts')||jsonb_build_object('links',copied+1))
 where workspace_id=w and installation_id=iid and installation_generation=g and id=bid;
 get diagnostics n=row_count;
 if n<>1 or (p->>'deadlineAt')::timestamptz<=clock_timestamp() then raise exception 'SOURCE_RULE_FINALIZE_FAILED';end if;
 return evidence.read_source_receipt(o,p_operation,0);
end $fn$;
revoke all on function identity.source_rule_review_state(jsonb,bigint,jsonb),identity.commit_reviewed_source_rule(jsonb,uuid,jsonb)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
