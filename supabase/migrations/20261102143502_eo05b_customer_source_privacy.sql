begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Exact verified webhook scope only. No customer profile/contact or new table.
alter table privacy.webhook_claims add column source_request_scope jsonb;
alter table privacy.deletion_runs add column source_customer_receipt jsonb;
create function privacy.valid_source_request_scope(p jsonb) returns boolean
language sql immutable set search_path='' as $fn$
 select coalesce(jsonb_typeof(p)='object' and (select count(*) from jsonb_object_keys(p))=2
 and p->'version'='1'::jsonb and jsonb_typeof(p->'orders')='array' and jsonb_array_length(p->'orders')<=1000
 and not exists(select 1 from jsonb_array_elements(p->'orders') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^gid://shopify/Order/[1-9][0-9]{0,29}$')
 and (select count(*)=count(distinct x) from jsonb_array_elements(p->'orders') x),false)
$fn$;
alter table privacy.webhook_claims add constraint webhook_source_request_scope_valid check(source_request_scope is null or privacy.valid_source_request_scope(source_request_scope));

create function privacy.claim_shopify_customer_webhook(p_webhook_id text,p_event_id text,p_topic text,p_shop_id text,p_shop_domain text,p_shop_identity_sha256 bytea,p_payload_sha256 text,p_api_version text,p_triggered_at timestamptz,p_received_at timestamptz,p_scope jsonb)
returns table(claim_id uuid,deletion_run_id uuid,workspace_id uuid,install_generation bigint,outcome text,duplicate boolean)
language plpgsql security definer set search_path='' as $fn$
declare r record; c privacy.webhook_claims%rowtype;
begin
 if p_topic not in ('customers/data_request','customers/redact') or not privacy.valid_source_request_scope(p_scope) then raise exception 'SOURCE_PRIVACY_SCOPE_INVALID';end if;
 select * into strict r from privacy.claim_shopify_webhook(p_webhook_id,p_event_id,p_topic,p_shop_id,p_shop_domain,p_shop_identity_sha256,p_payload_sha256,p_api_version,p_triggered_at,p_received_at);
 select * into strict c from privacy.webhook_claims where id=r.claim_id for update;
 if c.topic is distinct from p_topic or c.payload_sha256 is distinct from p_payload_sha256 or c.shop_identity_sha256 is distinct from p_shop_identity_sha256
 or (c.source_request_scope is not null and c.source_request_scope is distinct from p_scope) then raise exception 'SOURCE_PRIVACY_WEBHOOK_CONFLICT';end if;
 -- A historical missing scope is not backfilled from a later duplicate.
 if not r.duplicate then update privacy.webhook_claims set source_request_scope=p_scope where id=r.claim_id;end if;
 return query select r.claim_id,r.deletion_run_id,r.workspace_id,r.install_generation,r.outcome,r.duplicate;
end $fn$;

create function privacy.customer_source_snapshot(p_run uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r privacy.deletion_runs%rowtype; i shopify.installations%rowtype; scope jsonb; b jsonb; pages jsonb; refs jsonb; links jsonb; orders jsonb; lines jsonb; journeys jsonb; claims jsonb; result jsonb;
begin
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict r from privacy.deletion_runs where id=p_run;
 if r.kind not in ('customer_data_request','customer_redact') then raise exception 'SOURCE_PRIVACY_RUN_INVALID';end if;
 select * into strict i from shopify.installations where workspace_id=r.workspace_id and install_generation=r.install_generation for update;
 if i.shop_identity_sha256 is distinct from r.shop_identity_sha256 then raise exception 'SOURCE_PRIVACY_OWNER_CHANGED';end if;
 select source_request_scope into scope from privacy.webhook_claims where id=r.claim_id;
 if not privacy.valid_source_request_scope(scope) then raise exception 'SOURCE_PRIVACY_SCOPE_REQUIRED';end if;
 if (select count(*) from source.shopify_order_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>5000
 or (select count(*) from source.shopify_line_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>5000
 or (select count(*) from source.shopify_journey_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>5000
 or (select count(*) from source.provider_claim_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>5000
 or (select count(*) from evidence.source_pages where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>1000
 or (select coalesce(sum(plain_byte_count),0) from evidence.source_pages where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>16777216
 or (select count(*) from evidence.source_references where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>5000
 or (select count(*) from evidence.source_reference_links where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id)>10000
 then raise exception 'SOURCE_PRIVACY_SNAPSHOT_BOUNDS';end if;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'installation_id',x.installation_id::text,'installation_generation',x.installation_generation::text) order by x.id),'[]') into b from evidence.source_batches x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'batchId',x.batch_id::text,'family',x.family,'ordinal',x.page_ordinal,'origin',x.origin,'payloadHash',x.payload_hash,
 'captureLayer',x.capture_layer,'numericFidelity',x.numeric_fidelity,'fieldCoverage',x.field_coverage,'schemaVersion',x.payload_schema_version,'sanitizerVersion',x.sanitizer_version,
 'keyVersion',x.key_version,'plainBytes',x.plain_byte_count,'ciphertext',encode(x.ciphertext,'hex'),'nonce',encode(x.nonce,'hex'),'authTag',encode(x.auth_tag,'hex'),'available',x.purged_at is null) order by x.id),'[]') into pages from evidence.source_pages x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'page_id',x.page_id::text,'installation_id',x.installation_id::text,'installation_generation',x.installation_generation::text) order by x.id),'[]') into refs from evidence.source_references x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'source_reference_id',x.source_reference_id::text,'source_rule_version_id',x.source_rule_version_id::text,'mapping_id',x.mapping_id::text,'order_version_id',x.order_version_id::text,'line_version_id',x.line_version_id::text,'journey_version_id',x.journey_version_id::text,'claim_version_id',x.claim_version_id::text) order by x.id),'[]') into links from evidence.source_reference_links x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'source_batch_id',x.source_batch_id::text,'source_reference_id',x.source_reference_id::text) order by x.id),'[]') into orders from source.shopify_order_versions x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'order_version_id',x.order_version_id::text,'source_reference_id',x.source_reference_id::text) order by x.id),'[]') into lines from source.shopify_line_versions x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'order_version_id',x.order_version_id::text,'source_batch_id',x.source_batch_id::text) order by x.id),'[]') into journeys from source.shopify_journey_versions x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text,'source_reference_id',x.source_reference_id::text,'shopify_order_version_id',x.shopify_order_version_id::text,'supersedes_id',x.supersedes_id::text) order by x.id),'[]') into claims from source.provider_claim_versions x where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i.id;
 result:=jsonb_build_object('runId',r.id,'kind',r.kind,'scope',scope,'installationId',i.id::text,'workspaceId',r.workspace_id,'generation',r.install_generation::text,'shopId',i.shop_id,
 'batches',b,'pages',pages,'references',refs,'links',links,'orders',orders,'lines',lines,'journeys',journeys,'claims',claims);
 if octet_length(result::text)>40000000 then raise exception 'SOURCE_PRIVACY_SNAPSHOT_BOUNDS';end if;
 return result||jsonb_build_object('digest',evidence.source_hash(result));
end $fn$;

create function privacy.complete_customer_source_run(p_run uuid,p_digest text,p_changes jsonb,p_disclosure text default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r privacy.deletion_runs%rowtype; snap jsonb; i bigint; requested jsonb; order_ids bigint[]; claim_ids bigint[]; ref_ids bigint[]; page_ids bigint[]; line_ids bigint[]; journey_ids bigint[]; item jsonb; c jsonb; mid uuid;
begin
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict r from privacy.deletion_runs where id=p_run for update;
 perform 1 from shopify.installations where workspace_id=r.workspace_id and install_generation=r.install_generation for update;
 if r.status='completed' then raise exception 'SOURCE_PRIVACY_ALREADY_COMPLETED';end if;
 snap:=privacy.customer_source_snapshot(p_run);
 if snap->>'digest' is distinct from p_digest then raise exception 'SOURCE_PRIVACY_SNAPSHOT_CHANGED';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or not p_changes ?& array['pages','removedReferences'] or (select count(*) from jsonb_object_keys(p_changes))<>2 then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
 i:=(snap->>'installationId')::bigint;requested:=snap->'scope'->'orders';
 select coalesce(array_agg(id),'{}') into order_ids from source.shopify_order_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and requested ? order_id;
 select coalesce(array_agg(id),'{}') into line_ids from source.shopify_line_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and order_version_id=any(order_ids);
 select coalesce(array_agg(id),'{}') into journey_ids from source.shopify_journey_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and order_version_id=any(order_ids);
 select coalesce(array_agg(id),'{}') into claim_ids from source.provider_claim_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and
 ((order_link_state='verified' and shopify_order_version_id=any(order_ids)) or requested ? native_order_reference);
 select coalesce(array_agg(value::bigint),'{}') into ref_ids from jsonb_array_elements_text(p_changes->'removedReferences');
 select coalesce(array_agg((value->>'id')::bigint),'{}') into page_ids from jsonb_array_elements(p_changes->'pages');
 if cardinality(ref_ids)>5000 or cardinality(page_ids)>1000
 or exists(select 1 from unnest(ref_ids) x where not exists(select 1 from evidence.source_references t where t.id=x and t.installation_id=i and t.page_id=any(page_ids)))
 or exists(select 1 from evidence.source_reference_links l where l.workspace_id=r.workspace_id and l.installation_generation=r.install_generation and l.installation_id=i and l.source_reference_id=any(ref_ids) and
 (l.source_rule_version_id is not null or (l.order_version_id is not null and not l.order_version_id=any(order_ids)) or (l.line_version_id is not null and not l.line_version_id=any(line_ids))
 or (l.journey_version_id is not null and not l.journey_version_id=any(journey_ids)) or (l.claim_version_id is not null and not l.claim_version_id=any(claim_ids))))
 then raise exception 'SOURCE_PRIVACY_CROSS_SUBJECT_DEPENDENCY';end if;
 if r.kind='customer_data_request' then
  if p_disclosure is null or p_disclosure !~ '^[a-f0-9]{64}$' then raise exception 'SOURCE_PRIVACY_DISCLOSURE_RECEIPT_REQUIRED';end if;
  c:=jsonb_build_object('orderVersions',cardinality(order_ids),'lineVersions',cardinality(line_ids),'journeyVersions',cardinality(journey_ids),'claimVersions',cardinality(claim_ids),'sourceRecords',cardinality(ref_ids));
 else
  if p_disclosure is not null then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
  -- The trusted bounded decrypt/projector supplies only re-sealed affected pages.
  for item in select value from jsonb_array_elements(p_changes->'pages') loop
   update evidence.source_pages set payload_hash=item->>'payloadHash',ciphertext=decode(item->>'ciphertext','hex'),nonce=decode(item->>'nonce','hex'),auth_tag=decode(item->>'authTag','hex'),key_version=(item->>'keyVersion')::smallint,
    plain_byte_count=(item->>'plainBytes')::integer,field_coverage=item->'fieldCoverage',sanitizer_version=item->>'sanitizerVersion'
   where id=(item->>'id')::bigint and installation_id=i and payload_hash=item->>'previousHash' and purged_at is null;
   if not found then raise exception 'SOURCE_PRIVACY_PAGE_CHANGED';end if;
  end loop;
  update identity.product_identity_mappings set mapping_state='unresolved',verified_at=null,applicability=jsonb_build_object('state','privacy_proof_removed')
   where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id in(select mapping_id from evidence.source_reference_links where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and source_reference_id=any(ref_ids));
  delete from evidence.source_reference_links where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and (source_reference_id=any(ref_ids) or order_version_id=any(order_ids) or line_version_id=any(line_ids) or journey_version_id=any(journey_ids) or claim_version_id=any(claim_ids));
  delete from source.provider_claim_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(claim_ids);
  delete from source.shopify_journey_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(journey_ids);
  delete from source.shopify_line_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(line_ids);
  delete from source.shopify_order_versions where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(order_ids);
  delete from evidence.source_references where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id=any(ref_ids);
  update evidence.source_batches set storage_state='invalidated',commit_id=null,committed_at=null,
   manifest=manifest||jsonb_build_object('privacyRedacted',true) where workspace_id=r.workspace_id and installation_generation=r.install_generation and installation_id=i and id in(select batch_id from evidence.source_pages where id=any(page_ids));
  c:=jsonb_build_object('orderVersions',cardinality(order_ids),'lineVersions',cardinality(line_ids),'journeyVersions',cardinality(journey_ids),'claimVersions',cardinality(claim_ids),'sourceRecords',cardinality(ref_ids),'pagesRewritten',cardinality(page_ids));
 end if;
 insert into privacy.deletion_manifests(deletion_run_id,workspace_id,install_generation,shop_identity_sha256,kind,deleted_families,retained_families,row_counts,result,completed_at)
 values(r.id,r.workspace_id,r.install_generation,r.shop_identity_sha256,r.kind,
 case when r.kind='customer_redact' then array['customer_scoped_source_records'] else '{}'::text[] end,
 array['unrelated_source_records'],c,case when r.kind='customer_redact' then 'deleted' else 'disclosed' end,clock_timestamp()) returning id into mid;
 update privacy.deletion_runs set status='completed',completed_at=clock_timestamp(),last_error_code=null,source_customer_receipt=jsonb_build_object('manifestId',mid,'digest',p_digest,'disclosureReceipt',p_disclosure,'counts',c) where id=p_run;
 return jsonb_build_object('status','completed','manifestId',mid,'counts',c);
end $fn$;
alter table privacy.deletion_manifests drop constraint deletion_manifests_result_check;
alter table privacy.deletion_manifests add constraint deletion_manifests_result_check check(result in ('no_customer_data','deleted','disclosed'));

-- Tombstone scopes survive Disconnect/reconnect. Source writes cannot resurrect
-- an exact redacted order. Installation generation remains part of every match.
create function privacy.block_redacted_source_order() returns trigger language plpgsql security definer set search_path='' as $fn$
declare native_id text;
begin
 native_id:=case when tg_table_name='shopify_order_versions' then to_jsonb(new)->>'order_id' else to_jsonb(new)->>'native_order_reference' end;
 if tg_table_name='provider_claim_versions' and (native_id is null or native_id !~ '^gid://shopify/Order/[1-9][0-9]{0,29}$')
 and exists(select 1 from privacy.deletion_runs r join privacy.webhook_claims c on c.id=r.claim_id where r.workspace_id=new.workspace_id and r.install_generation=new.installation_generation and r.kind='customer_redact' and r.status='completed' and jsonb_array_length(c.source_request_scope->'orders')>0)
 then raise exception 'SOURCE_PRIVACY_SUBJECT_UNRESOLVED';end if;
 if exists(select 1 from privacy.deletion_runs r join privacy.webhook_claims c on c.id=r.claim_id where r.workspace_id=new.workspace_id and r.install_generation=new.installation_generation and r.kind='customer_redact' and r.status='completed'
 and c.source_request_scope->'orders' ? native_id) then raise exception 'SOURCE_PRIVACY_REDACTED_ORDER';end if;
 return new;
end $fn$;
create trigger source_order_privacy_tombstone before insert or update on source.shopify_order_versions for each row execute function privacy.block_redacted_source_order();
create trigger source_claim_privacy_tombstone before insert or update on source.provider_claim_versions for each row execute function privacy.block_redacted_source_order();
create function privacy.clear_deleted_source_scopes() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.status='completed' and new.kind in ('shop_redact','merchant_delete_my_data') then
  update privacy.webhook_claims set source_request_scope=null where workspace_id=new.workspace_id and install_generation=new.install_generation;
 end if;return new;
end $fn$;
create trigger clear_deleted_source_scopes after update of status on privacy.deletion_runs for each row execute function privacy.clear_deleted_source_scopes();
revoke all on function privacy.clear_deleted_source_scopes(),privacy.valid_source_request_scope(jsonb),privacy.claim_shopify_customer_webhook(text,text,text,text,text,bytea,text,text,timestamptz,timestamptz,jsonb),privacy.customer_source_snapshot(uuid),privacy.complete_customer_source_run(uuid,text,jsonb,text),privacy.block_redacted_source_order() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
