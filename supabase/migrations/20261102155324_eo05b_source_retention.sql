begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;

-- Bounded, finite, operational receipts; no new physical source/audit table.
alter table shopify.installations add column source_retention_receipts jsonb not null default '[]'::jsonb
 check(jsonb_typeof(source_retention_receipts)='array' and jsonb_array_length(source_retention_receipts)<=1000 and octet_length(source_retention_receipts::text)<=1048576);

create function evidence.retention_relation(p_kind text) returns table(schema_name text,table_name text,link_column text)
language sql immutable set search_path='' as $fn$
 select s,t,l from (values
 ('claim','source','provider_claim_versions','claim_version_id'),
 ('journey','source','shopify_journey_versions','journey_version_id'),
 ('line','source','shopify_line_versions','line_version_id'),
 ('order','source','shopify_order_versions','order_version_id'),
 ('mapping','identity','product_identity_mappings','mapping_id'),
 ('rule','identity','source_rule_versions','source_rule_version_id'),
 ('reference','evidence','source_references',null),
 ('page','evidence','source_pages',null),
 ('batch','evidence','source_batches',null)) v(kind,s,t,l) where kind=p_kind
$fn$;

create function evidence.retention_batches(p_workspace uuid,p_installation bigint,p_generation bigint,p_kind text,p_row jsonb) returns bigint[]
language plpgsql stable security definer set search_path='' as $fn$
declare relation record; result bigint[]:='{}'; extra bigint[]; bid bigint;
begin
 select * into strict relation from evidence.retention_relation(p_kind);
 if p_kind='batch' then result:=array[(p_row->>'id')::bigint];
 elsif p_kind='page' then result:=array[(p_row->>'batch_id')::bigint];
 elsif p_kind='reference' then
  select batch_id into bid from evidence.source_pages where workspace_id=p_workspace and installation_id=p_installation and installation_generation=p_generation and id=(p_row->>'page_id')::bigint;
  result:=array[bid];
 else
  if p_row->>'accepted_batch_id' is not null then result:=result||(p_row->>'accepted_batch_id')::bigint;end if;
  if p_row->>'source_batch_id' is not null then result:=result||(p_row->>'source_batch_id')::bigint;end if;
  if p_row->>'source_reference_id' is not null then
   select pg.batch_id into bid from evidence.source_references r join evidence.source_pages pg on pg.workspace_id=r.workspace_id and pg.installation_id=r.installation_id and pg.installation_generation=r.installation_generation and pg.id=r.page_id
    where r.workspace_id=p_workspace and r.installation_id=p_installation and r.installation_generation=p_generation and r.id=(p_row->>'source_reference_id')::bigint;
   result:=result||bid;
  end if;
  execute format('select coalesce(array_agg(batch_id),''{}'') from (select distinct pg.batch_id from evidence.source_reference_links l join evidence.source_references r on r.workspace_id=l.workspace_id and r.installation_id=l.installation_id and r.installation_generation=l.installation_generation and r.id=l.source_reference_id join evidence.source_pages pg on pg.workspace_id=r.workspace_id and pg.installation_id=r.installation_id and pg.installation_generation=r.installation_generation and pg.id=r.page_id where l.workspace_id=$1 and l.installation_id=$2 and l.installation_generation=$3 and l.%I=$4 limit 1001) q',relation.link_column)
   into extra using p_workspace,p_installation,p_generation,(p_row->>'id')::bigint;
  result:=result||extra;
 end if;
 return array(select distinct x from unnest(result) x where x is not null order by x);
end $fn$;

create function evidence.retention_ready(p_workspace uuid,p_installation bigint,p_generation bigint,p_kind text,p_id bigint,p_depth integer default 0) returns boolean
language plpgsql stable security definer set search_path='' as $fn$
declare relation record; row_data jsonb; batches bigint[]; held boolean; parent bigint;
begin
 if p_depth>=32 then return false;end if;
 select * into strict relation from evidence.retention_relation(p_kind);
 execute format('select to_jsonb(t) from %I.%I t where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id=$4',relation.schema_name,relation.table_name)
  into row_data using p_workspace,p_installation,p_generation,p_id;
 if row_data is null or (row_data->>'retain_until')::timestamptz>statement_timestamp() then return false;end if;
 batches:=evidence.retention_batches(p_workspace,p_installation,p_generation,p_kind,row_data);
 if cardinality(batches)=0 or cardinality(batches)>1000 or exists(select 1 from unnest(batches) x where not exists(select 1 from evidence.source_batches b
  where b.workspace_id=p_workspace and b.installation_id=p_installation and b.installation_generation=p_generation and b.id=x and b.source_state='complete' and b.handoff_state='consumed'
  and (b.storage_state='committed' or (b.storage_state='invalidated' and b.manifest->'retentionPruned'='true'::jsonb and coalesce(b.manifest->'privacyRedacted','false'::jsonb)='false'::jsonb)))) then return false;end if;
 if relation.link_column is not null then
  execute format('select exists(select 1 from evidence.source_reference_links where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and %I=$4 and retain_until>statement_timestamp())',relation.link_column)
   into held using p_workspace,p_installation,p_generation,p_id;
  if held then return false;end if;
 end if;
 if row_data->>'supersedes_id' is not null and not evidence.retention_ready(p_workspace,p_installation,p_generation,p_kind,(row_data->>'supersedes_id')::bigint,p_depth+1) then return false;end if;
 if p_kind='mapping' and row_data->>'source_rule_version_id' is not null and not evidence.retention_ready(p_workspace,p_installation,p_generation,'rule',(row_data->>'source_rule_version_id')::bigint,p_depth+1) then return false;end if;
 parent:=coalesce((row_data->>'order_version_id')::bigint,(row_data->>'shopify_order_version_id')::bigint);
 if parent is not null and not evidence.retention_ready(p_workspace,p_installation,p_generation,'order',parent,p_depth+1) then return false;end if;
 return true;
end $fn$;

-- Inspect actual incoming FK metadata, including later consumers. Predicate types
-- preserve the existing composite FK indexes; no textual/native-JSON table scans.
create function evidence.retention_has_dependents(p_kind text,p_row jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $fn$
declare relation record; fk record; predicate text; found_row boolean; target oid;
begin
 select * into strict relation from evidence.retention_relation(p_kind);
 target:=to_regclass(format('%I.%I',relation.schema_name,relation.table_name));
 for fk in select c.* from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=target order by c.oid loop
  if relation.link_column is not null and fk.conrelid='evidence.source_reference_links'::regclass then continue;end if;
  select string_agg(format('child.%I = ($1->>%L)::%s',a.attname,b.attname,pg_catalog.format_type(a.atttypid,a.atttypmod)),' and ' order by k.ord) into predicate
   from unnest(fk.conkey,fk.confkey) with ordinality k(child_att,parent_att,ord)
   join pg_catalog.pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.child_att
   join pg_catalog.pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.parent_att;
  execute format('select exists(select 1 from %s child where %s)',fk.conrelid::regclass,predicate) into found_row using p_row;
  if found_row then return true;end if;
 end loop;
 return false;
end $fn$;

create function evidence.cleanup_source_retention(p_workspace uuid,p_installation bigint,p_generation bigint,p_operation uuid,p_kind text,p_after bigint,p_limit integer,p_deadline timestamptz,p_audit jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare installation shopify.installations%rowtype; relation record; row_data jsonb; request_hash text; receipts jsonb; existing jsonb; receipt jsonb; batch_ids bigint[]; touched bigint[]:='{}';
 scanned integer:=0; held integer:=0; removed integer:=0; removed_links integer:=0; link_count integer; link_removed integer; bytes bigint:=0; last_id bigint:=p_after; prior_count integer; audit_until timestamptz;
begin
 if p_workspace is null or p_installation is null or p_generation is null or p_operation is null or p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 1000
 or p_deadline is null or not isfinite(p_deadline) or p_deadline<=clock_timestamp() or p_deadline>clock_timestamp()+interval '10 minutes'
 or jsonb_typeof(p_audit) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_audit))<>3 or not p_audit ?& array['version','until','maxReceipts']
 or jsonb_typeof(p_audit->'version') is distinct from 'string' or jsonb_typeof(p_audit->'until') is distinct from 'string'
 or length(p_audit->>'version') not between 1 and 128 or (p_audit->>'version') is null
 or jsonb_typeof(p_audit->'maxReceipts') is distinct from 'number'
 or coalesce((p_audit->>'maxReceipts')::integer not between 1 and 1000,true) then raise exception 'SOURCE_RETENTION_INPUT_INVALID';end if;
 audit_until:=(p_audit->>'until')::timestamptz;
 if audit_until is null or not isfinite(audit_until) or audit_until<p_deadline then raise exception 'SOURCE_RETENTION_AUDIT_INVALID';end if;
 select * into strict relation from evidence.retention_relation(p_kind);
 perform 1 from operations.refresh_control where singleton for update;
 select * into strict installation from shopify.installations where workspace_id=p_workspace and id=p_installation and install_generation=p_generation for update;
 -- A requested privacy action takes precedence; maintenance cannot consume its evidence.
 if exists(select 1 from privacy.deletion_runs where workspace_id=p_workspace and install_generation=p_generation and status in ('pending','running','failed')) then raise exception 'SOURCE_RETENTION_PRIVACY_PENDING';end if;
 request_hash:=evidence.source_hash(jsonb_build_object('workspaceId',p_workspace,'installationId',p_installation::text,'generation',p_generation::text,'operationId',p_operation,'kind',p_kind,'after',p_after::text,'limit',p_limit,'deadlineAt',p_deadline,'audit',p_audit));
 select value into existing from jsonb_array_elements(installation.source_retention_receipts) where value->>'operationId'=p_operation::text;
 if found then
  if existing->>'digest' is distinct from request_hash then raise exception 'SOURCE_RETENTION_OPERATION_CONFLICT';end if;
  return existing;
 end if;
 select coalesce(jsonb_agg(value order by ord),'[]') into receipts from jsonb_array_elements(installation.source_retention_receipts) with ordinality q(value,ord) where (value->>'expiresAt')::timestamptz>statement_timestamp();
 if jsonb_array_length(receipts)>=(p_audit->>'maxReceipts')::integer then raise exception 'SOURCE_RETENTION_AUDIT_CAPACITY';end if;
 -- New consumers of link IDs must be reviewed before a target+link delete path is used.
 if exists(select 1 from pg_catalog.pg_constraint where contype='f' and confrelid='evidence.source_reference_links'::regclass) then raise exception 'SOURCE_RETENTION_LINK_CONSUMER_REVIEW_REQUIRED';end if;
 for row_data in execute format('select to_jsonb(t) from %I.%I t where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id>$4 and retain_until<=statement_timestamp() order by id limit $5 for update skip locked',relation.schema_name,relation.table_name)
  using p_workspace,p_installation,p_generation,p_after,p_limit loop
  scanned:=scanned+1;last_id:=(row_data->>'id')::bigint;
  if not evidence.retention_ready(p_workspace,p_installation,p_generation,p_kind,last_id) or evidence.retention_has_dependents(p_kind,row_data) then held:=held+1;continue;end if;
  batch_ids:=evidence.retention_batches(p_workspace,p_installation,p_generation,p_kind,row_data);
  if (select count(distinct x) from unnest(touched||batch_ids) x)>1000 then held:=held+1;continue;end if;
  link_count:=0;
  if relation.link_column is not null then
   execute format('select count(*)::integer from (select 1 from evidence.source_reference_links where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and %I=$4 limit 1001) q',relation.link_column)
    into link_count using p_workspace,p_installation,p_generation,last_id;
   if removed_links+link_count>1000 then held:=held+1;continue;end if;
   execute format('delete from evidence.source_reference_links where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and %I=$4',relation.link_column)
    using p_workspace,p_installation,p_generation,last_id;
   get diagnostics link_removed=row_count;removed_links:=removed_links+link_removed;
  end if;
  execute format('delete from %I.%I where workspace_id=$1 and installation_id=$2 and installation_generation=$3 and id=$4',relation.schema_name,relation.table_name)
   using p_workspace,p_installation,p_generation,last_id;
  get diagnostics prior_count=row_count;
  if prior_count<>1 then raise exception 'SOURCE_RETENTION_DELETE_CHANGED';end if;
  removed:=removed+1;
  if p_kind='page' and row_data->>'ciphertext' is not null then bytes:=bytes+((length(row_data->>'ciphertext')-2)/2);end if;
  touched:=array(select distinct x from unnest(touched||batch_ids) x order by x);
 end loop;
 -- Historical commit receipts must not pretend the pruned rows are still present.
 update evidence.source_batches set storage_state='invalidated',commit_id=null,committed_at=null,manifest=manifest||jsonb_build_object('retentionPruned',true)
  where workspace_id=p_workspace and installation_id=p_installation and installation_generation=p_generation and id=any(touched);
 if exists(select 1 from evidence.source_batches where workspace_id=p_workspace and installation_id=p_installation and installation_generation=p_generation and id=any(touched)
  and (storage_state<>'invalidated' or manifest->'retentionPruned' is distinct from 'true'::jsonb)) then raise exception 'SOURCE_RETENTION_RECEIPT_NOT_INVALIDATED';end if;
 if clock_timestamp()>=p_deadline then raise exception 'SOURCE_RETENTION_DEADLINE_EXCEEDED';end if;
 receipt:=jsonb_build_object('status','completed','scope','bounded_scan_only','operationId',p_operation,'digest',request_hash,'kind',p_kind,'after',p_after::text,'lastScannedId',last_id::text,
  'scanned',scanned,'held',held,'deleted',removed,'linksDeleted',removed_links,'cipherBytesDeleted',bytes::text,
  'completedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',p_audit->>'until','policyVersion',p_audit->>'version');
 update shopify.installations set source_retention_receipts=receipts||jsonb_build_array(receipt) where id=p_installation and workspace_id=p_workspace and install_generation=p_generation;
 get diagnostics prior_count=row_count;
 if prior_count<>1 then raise exception 'SOURCE_RETENTION_AUDIT_NOT_RECORDED';end if;
 return receipt;
end $fn$;

create function evidence.inspect_source_retention(p_workspace uuid,p_installation bigint,p_generation bigint,p_operation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare receipt jsonb;
begin
 select x.value into receipt from shopify.installations i cross join lateral jsonb_array_elements(i.source_retention_receipts) x(value)
  where i.workspace_id=p_workspace and i.id=p_installation and i.install_generation=p_generation and x.value->>'operationId'=p_operation::text;
 if found then return jsonb_build_object('status','recorded','receipt',receipt,'expired',(receipt->>'expiresAt')::timestamptz<=statement_timestamp());end if;
 return jsonb_build_object('status','not_observed','rollbackProven',false);
end $fn$;
revoke all on function evidence.retention_relation(text),evidence.retention_batches(uuid,bigint,bigint,text,jsonb),evidence.retention_ready(uuid,bigint,bigint,text,bigint,integer),evidence.retention_has_dependents(text,jsonb),evidence.cleanup_source_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb),evidence.inspect_source_retention(uuid,bigint,bigint,uuid)
 from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Retained evidence remains readable as history. The source receipt itself stays
-- invalidated; available ciphertext is not a claim of current/unexpired proof.
create or replace function evidence.read_source_pages(o jsonb,p_attempt uuid,p_ordinal integer,p_after bigint,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
begin
 if p_limit is null or p_limit not between 1 and 100 or p_after is null or p_after<0 then raise exception 'SOURCE_READ_BOUNDS';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id::text,'family',p.family,'ordinal',p.page_ordinal,'origin',p.origin,'payloadHash',p.payload_hash,
 'captureLayer',p.capture_layer,'numericFidelity',p.numeric_fidelity,'fieldCoverage',p.field_coverage,'schemaVersion',p.payload_schema_version,'sanitizerVersion',p.sanitizer_version,
 'keyVersion',p.key_version,'plainBytes',p.plain_byte_count,'ciphertext',encode(p.ciphertext,'hex'),'nonce',encode(p.nonce,'hex'),'authTag',encode(p.auth_tag,'hex'),'available',p.purged_at is null,
 'expired',p.retain_until<=statement_timestamp(),'retainUntil',p.retain_until,'retentionPruned',p.retention_pruned))
 from (select x.*,coalesce(b.manifest->'retentionPruned'='true'::jsonb,false) retention_pruned from evidence.source_pages x join evidence.source_batches b on b.id=x.batch_id and b.workspace_id=x.workspace_id and b.installation_id=x.installation_id and b.installation_generation=x.installation_generation
 where b.workspace_id=(o->>'workspaceId')::uuid and b.installation_id=(o->>'installationId')::bigint and b.installation_generation=(o->>'generation')::bigint and b.authority=o and b.attempt_id=p_attempt and b.batch_ordinal=p_ordinal
 and (b.storage_state='committed' or (b.storage_state='invalidated' and b.manifest->'retentionPruned'='true'::jsonb and coalesce(b.manifest->'privacyRedacted','false'::jsonb)='false'::jsonb))
 and x.id>p_after order by x.id limit p_limit) p),'[]'::jsonb);
end $fn$;
revoke all on function evidence.read_source_pages(jsonb,uuid,integer,bigint,integer) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;
reset role;
commit;
