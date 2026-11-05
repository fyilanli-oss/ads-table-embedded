begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
create or replace function privacy.complete_customer_source_run(p_run uuid,p_digest text,p_changes jsonb,p_disclosure text default null) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r privacy.deletion_runs%rowtype; snap jsonb; i bigint; requested jsonb; order_ids bigint[]; claim_ids bigint[]; ref_ids bigint[]; page_ids bigint[]; line_ids bigint[]; journey_ids bigint[]; item jsonb; c jsonb; mid uuid; matched integer; no_data boolean; outcome text;
begin
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict r from privacy.deletion_runs where id=p_run for update;
 perform 1 from shopify.installations where workspace_id=r.workspace_id and install_generation=r.install_generation for update;
 if r.status='completed' then raise exception 'SOURCE_PRIVACY_ALREADY_COMPLETED';end if;
 snap:=privacy.customer_source_snapshot(p_run);
 if snap->>'digest' is distinct from p_digest then raise exception 'SOURCE_PRIVACY_SNAPSHOT_CHANGED';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or not p_changes ?& array['pages','removedReferences','matchedSourceRecords'] or (select count(*) from jsonb_object_keys(p_changes))<>3
 or jsonb_typeof(p_changes->'matchedSourceRecords') is distinct from 'number' or (p_changes->>'matchedSourceRecords') !~ '^(0|[1-9][0-9]{0,5})$' then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
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
 matched:=(p_changes->>'matchedSourceRecords')::integer;
 no_data:=cardinality(order_ids)=0 and cardinality(line_ids)=0 and cardinality(journey_ids)=0 and cardinality(claim_ids)=0 and cardinality(ref_ids)=0 and cardinality(page_ids)=0 and matched=0;
 if no_data and p_disclosure is not null then raise exception 'SOURCE_PRIVACY_PLAN_INVALID';end if;
 if r.kind='customer_data_request' then
  if not no_data and (p_disclosure is null or p_disclosure !~ '^[a-f0-9]{64}$') then raise exception 'SOURCE_PRIVACY_DISCLOSURE_RECEIPT_REQUIRED';end if;
  c:=jsonb_build_object('orderVersions',cardinality(order_ids),'lineVersions',cardinality(line_ids),'journeyVersions',cardinality(journey_ids),'claimVersions',cardinality(claim_ids),'sourceRecords',cardinality(ref_ids),'rawSourceRecords',matched);
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
  c:=jsonb_build_object('orderVersions',cardinality(order_ids),'lineVersions',cardinality(line_ids),'journeyVersions',cardinality(journey_ids),'claimVersions',cardinality(claim_ids),'sourceRecords',cardinality(ref_ids),'rawSourceRecords',matched,'pagesRewritten',cardinality(page_ids));
 end if;
 outcome:=case when no_data then 'no_customer_data' when r.kind='customer_redact' then 'deleted' else 'disclosed' end;
 insert into privacy.deletion_manifests(deletion_run_id,workspace_id,install_generation,shop_identity_sha256,kind,deleted_families,retained_families,row_counts,result,completed_at)
 values(r.id,r.workspace_id,r.install_generation,r.shop_identity_sha256,r.kind,
 case when r.kind='customer_redact' then array['customer_scoped_source_records'] else '{}'::text[] end,
 array['unrelated_source_records'],c,outcome,clock_timestamp()) returning id into mid;
 update privacy.deletion_runs set status='completed',completed_at=clock_timestamp(),last_error_code=null,
  source_customer_receipt=jsonb_build_object('manifestId',mid,'result',outcome,'digest',p_digest,'disclosureReceipt',p_disclosure,'counts',c,
   'redactedOrderHashes',case when r.kind='customer_redact' then
    (select coalesce(jsonb_agg(evidence.source_hash(value) order by value),'[]') from jsonb_array_elements(requested)) else '[]'::jsonb end)
  where id=p_run;
 update privacy.webhook_claims set source_request_scope=null where id=r.claim_id;
 return jsonb_build_object('status','completed','result',outcome,'manifestId',mid,'counts',c);
end $fn$;
create function privacy.customer_source_run_kind(p_run uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare kind text;
begin
 select case when r.status='completed' then null else r.kind end into strict kind from privacy.deletion_runs r where r.id=p_run;
 return case when kind in ('customer_data_request','customer_redact') then kind else null end;
end $fn$;
revoke all on function privacy.customer_source_run_kind(uuid) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
-- Preserve owner-only snapshot/completion. Ingress receives only the existing verified-scope claim RPC.
grant execute on function privacy.claim_shopify_customer_webhook(text,text,text,text,text,bytea,text,text,timestamptz,timestamptz,jsonb) to adstable_runtime;

-- The existing SQL queue can prove absence only in a completely empty source store.
-- Keep exact order tombstones even then, and never retain the plaintext order scope.
create function privacy.complete_empty_source_scope() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare scope jsonb; mid uuid;
begin
 if new.status='completed' and new.kind in ('customer_data_request','customer_redact') and new.source_customer_receipt is null then
  select source_request_scope into scope from privacy.webhook_claims where id=new.claim_id for update;
  if not privacy.valid_source_request_scope(scope) or exists(select 1 from evidence.source_batches where workspace_id=new.workspace_id and installation_generation=new.install_generation) then raise exception 'SOURCE_PRIVACY_SCOPE_OR_PROOF_REQUIRED';end if;
  select id into strict mid from privacy.deletion_manifests where deletion_run_id=new.id and result='no_customer_data';
  update privacy.deletion_runs set source_customer_receipt=jsonb_build_object('manifestId',mid,'result','no_customer_data','disclosureReceipt',null,
   'redactedOrderHashes',case when new.kind='customer_redact' then (select coalesce(jsonb_agg(evidence.source_hash(value) order by value),'[]') from jsonb_array_elements(scope->'orders')) else '[]'::jsonb end) where id=new.id;
  update privacy.webhook_claims set source_request_scope=null where id=new.claim_id;
 end if;return new;
end $fn$;
create trigger complete_empty_source_scope after update of status on privacy.deletion_runs for each row execute function privacy.complete_empty_source_scope();
revoke all on function privacy.complete_empty_source_scope() from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
commit;
