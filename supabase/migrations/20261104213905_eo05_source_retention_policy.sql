begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
-- Prepared only. No UPDATE of existing data, grant to application roles, or scheduler.
alter table shopify.installations add column source_retention_policy_receipts jsonb not null default '[]'::jsonb
 check(jsonb_typeof(source_retention_policy_receipts)='array' and jsonb_array_length(source_retention_policy_receipts)<=100 and octet_length(source_retention_policy_receipts::text)<=1048576);

-- Explicit expected row IDs/deadlines prevent a broad or silent lifetime extension.
-- Original request_digest, manifest, ciphertext, identity validity and handoff remain intact.
create function evidence.apply_source_retention_policy(p_workspace uuid,p_installation bigint,p_generation bigint,p_operation uuid,p_expected jsonb,p_deadline timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare installation shopify.installations%rowtype; item jsonb; row_data jsonb; relation record;
 batches bigint[]; old_until timestamptz; new_until timestamptz; recorded timestamptz;
 request_hash text; prior jsonb; receipts jsonb; receipt jsonb; changes jsonb:='[]'; n integer; changed integer:=0;
begin
 if p_workspace is null or p_installation is null or p_installation<1 or p_generation is null or p_generation<1 or p_operation is null
 or p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp() or p_deadline>clock_timestamp()+interval '10 minutes'
 or jsonb_typeof(p_expected) is distinct from 'array' then raise exception 'SOURCE_RETENTION_POLICY_INPUT_INVALID';end if;
 if jsonb_array_length(p_expected) not between 1 and 1000 or octet_length(p_expected::text)>262144
 or (select count(distinct (x->>'kind',x->>'id')) from jsonb_array_elements(p_expected) x)<>jsonb_array_length(p_expected) then raise exception 'SOURCE_RETENTION_POLICY_INPUT_INVALID';end if;
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict installation from shopify.installations where workspace_id=p_workspace and id=p_installation and install_generation=p_generation for update;
 if installation.status<>'active' or not exists(select 1 from app.workspaces where id=p_workspace and status='active') then raise exception 'SOURCE_RETENTION_POLICY_SCOPE_INACTIVE';end if;
 if exists(select 1 from privacy.deletion_runs where workspace_id=p_workspace and install_generation=p_generation and status in ('pending','running','failed')) then raise exception 'SOURCE_RETENTION_POLICY_PRIVACY_PENDING';end if;
 request_hash:=evidence.source_hash(jsonb_build_object('workspaceId',p_workspace,'installationId',p_installation::text,'generation',p_generation::text,'operationId',p_operation,'expected',p_expected,'deadlineAt',p_deadline,'policyVersion','source-retention-90-365-v1'));
 select value into prior from jsonb_array_elements(installation.source_retention_policy_receipts) where value->>'operationId'=p_operation::text;
 if found then
  if prior->>'digest' is distinct from request_hash then raise exception 'SOURCE_RETENTION_POLICY_OPERATION_CONFLICT';end if;
  return prior;
 end if;
 select coalesce(jsonb_agg(value order by ord),'[]') into receipts from jsonb_array_elements(installation.source_retention_policy_receipts) with ordinality q(value,ord) where (value->>'expiresAt')::timestamptz>statement_timestamp();
 if jsonb_array_length(receipts)>=100 then raise exception 'SOURCE_RETENTION_POLICY_AUDIT_CAPACITY';end if;
 -- Deterministic lock order; input order is not a lock ordering authority.
 for item in select value from jsonb_array_elements(p_expected) order by value->>'kind',(value->>'id')::bigint loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>3 or not item ?& array['kind','id','until']
  or jsonb_typeof(item->'kind') is distinct from 'string' or jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'until') is distinct from 'string'
  or coalesce(item->>'id','')!~'^[1-9][0-9]{0,18}$' then raise exception 'SOURCE_RETENTION_POLICY_ROW_INVALID';end if;
  select * into strict relation from (values
   ('batch','evidence','source_batches'),('page','evidence','source_pages'),('reference','evidence','source_references'),
   ('rule','identity','source_rule_versions'),('mapping','identity','product_identity_mappings'),('order','source','shopify_order_versions'),
   ('line','source','shopify_line_versions'),('journey','source','shopify_journey_versions'),('claim','source','provider_claim_versions'),
   ('link','evidence','source_reference_links')) v(kind,schema_name,table_name) where kind=item->>'kind';
  execute format('select to_jsonb(t) from %I.%I t where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id=$4 for update',relation.schema_name,relation.table_name)
   into row_data using p_workspace,p_installation,p_generation,(item->>'id')::bigint;
  if row_data is null or (row_data->>'retain_until')::timestamptz is distinct from (item->>'until')::timestamptz
   or not isfinite((item->>'until')::timestamptz) or (row_data->>'retain_until')::timestamptz<=clock_timestamp()
   or row_data->>'purged_at' is not null then raise exception 'SOURCE_RETENTION_POLICY_EXPECTATION_CHANGED';end if;
  if item->>'kind'='link' then
   select array[b.id] into batches from evidence.source_references r join evidence.source_pages pg on pg.id=r.page_id and pg.workspace_id=r.workspace_id and pg.installation_id=r.installation_id and pg.installation_generation=r.installation_generation join evidence.source_batches b on b.id=pg.batch_id
    where r.id=(row_data->>'source_reference_id')::bigint and r.workspace_id=p_workspace and r.installation_id=p_installation and r.installation_generation=p_generation;
  else batches:=evidence.retention_batches(p_workspace,p_installation,p_generation,item->>'kind',row_data);end if;
  if cardinality(batches) is null or cardinality(batches)=0 or exists(select 1 from unnest(batches) x where not exists(select 1 from evidence.source_batches b
   where b.id=x and b.workspace_id=p_workspace and b.installation_id=p_installation and b.installation_generation=p_generation and b.storage_state='committed')) then raise exception 'SOURCE_RETENTION_POLICY_PROOF_UNAVAILABLE';end if;
  recorded:=(row_data->>'recorded_at')::timestamptz;old_until:=(row_data->>'retain_until')::timestamptz;
  -- Elapsed UTC hours: DST and SQL session timezone cannot alter the lifetime.
  new_until:=greatest(old_until,recorded+case when row_data->>'retention_class'='metadata' then interval '8760 hours' else interval '2160 hours' end);
  execute format('update %I.%I set retain_until=$1 where workspace_id=$2 and installation_id=$3 and installation_generation=$4 and id=$5 and retain_until=$6',relation.schema_name,relation.table_name)
   using new_until,p_workspace,p_installation,p_generation,(item->>'id')::bigint,old_until;
  get diagnostics n=row_count;if n<>1 then raise exception 'SOURCE_RETENTION_POLICY_WRITE_UNCONFIRMED';end if;
  if new_until<>old_until then changed:=changed+1;end if;
  changes:=changes||jsonb_build_array(jsonb_build_object('kind',item->>'kind','id',item->>'id','recordedAt',recorded,'from',old_until,'until',new_until));
  if clock_timestamp()>=p_deadline then raise exception 'SOURCE_RETENTION_POLICY_DEADLINE';end if;
 end loop;
 receipt:=jsonb_build_object('status','completed','operationId',p_operation,'digest',request_hash,'policyVersion','source-retention-90-365-v1',
  'changed',changed,'checked',jsonb_array_length(changes),'changesDigest',evidence.source_hash(jsonb_build_object('operationId',p_operation,'changes',changes)),'completedAt',statement_timestamp(),'expiresAt',statement_timestamp()+interval '8760 hours',
  'deletionPerformed',false,'originalSourceReceiptChanged',false);
 update shopify.installations set source_retention_policy_receipts=receipts||jsonb_build_array(receipt) where id=p_installation and workspace_id=p_workspace and install_generation=p_generation;
 get diagnostics n=row_count;if n<>1 then raise exception 'SOURCE_RETENTION_POLICY_AUDIT_UNCONFIRMED';end if;
 return receipt;
end $fn$;
create function evidence.inspect_source_retention_policy(p_workspace uuid,p_installation bigint,p_generation bigint,p_operation uuid) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select coalesce((select jsonb_build_object('status','recorded','receipt',x.value,'expired',(x.value->>'expiresAt')::timestamptz<=statement_timestamp())
  from shopify.installations i cross join lateral jsonb_array_elements(i.source_retention_policy_receipts) x(value)
  where i.workspace_id=p_workspace and i.id=p_installation and i.install_generation=p_generation and x.value->>'operationId'=p_operation::text),
  jsonb_build_object('status','not_observed','rollbackProven',false));
$fn$;
revoke all on function evidence.apply_source_retention_policy(uuid,bigint,bigint,uuid,jsonb,timestamptz),evidence.inspect_source_retention_policy(uuid,bigint,bigint,uuid)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
-- Source-runner roles are not granted either function. Only the owning maintenance identity can call them.
commit;
