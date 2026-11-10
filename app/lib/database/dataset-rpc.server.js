// Fixed private storage surface. These are not browser, cleanup, credential,
// currency-selection or refresh-completion permissions.
export const DATASET_SOURCE_CONTEXT_SQL = "select * from evidence.read_dataset_source_context($1::jsonb,$2::text,$3::bigint,$4::date,$5::date)";
export const DATASET_STORAGE_RPC = Object.freeze([
  ["select evidence.begin_dataset_storage_operation($1::jsonb,$2::uuid,$3::uuid,$4::text,$5::timestamptz) as result", "evidence.begin_dataset_storage_operation(jsonb,uuid,uuid,text,timestamptz)"],
  ["select evidence.assert_source_owner($1::jsonb)", "evidence.assert_source_owner(jsonb)"],
  ["select evidence.read_source_receipt($1::jsonb,$2::uuid,$3::integer) as result", "evidence.read_source_receipt(jsonb,uuid,integer)"],
  ["select evidence.read_source_pages($1::jsonb,$2::uuid,$3::integer,$4::bigint,$5::integer) as result", "evidence.read_source_pages(jsonb,uuid,integer,bigint,integer)"],
  [DATASET_SOURCE_CONTEXT_SQL, "evidence.read_dataset_source_context(jsonb,text,bigint,date,date)"],
  ["select analytics.commit_dataset_storage($1::jsonb,$2::jsonb) as result", "analytics.commit_dataset_storage(jsonb,jsonb)"],
  ["select analytics.inspect_dataset_storage($1::jsonb,$2::bigint,$3::uuid) as result", "analytics.inspect_dataset_storage(jsonb,bigint,uuid)"],
  ["select analytics.commit_dataset_empty_retention($1::jsonb,$2::jsonb) as result", "analytics.commit_dataset_empty_retention(jsonb,jsonb)"],
  ["select analytics.inspect_dataset_empty_retention($1::jsonb,$2::bigint,$3::uuid) as result", "analytics.inspect_dataset_empty_retention(jsonb,bigint,uuid)"],
  ["select app.read_reporting_currency($1::jsonb) as result", "app.read_reporting_currency(jsonb)"],
  ["select analytics.lookup_dataset_fx($1::text,$2::text,$3::date) as result", "analytics.lookup_dataset_fx(text,text,date)"],
  ["select analytics.record_dataset_fx($1::jsonb) as result", "analytics.record_dataset_fx(jsonb)"],
].map(Object.freeze));
// Explicit version2 private reconciliation surface; prepared grants remain separate.
export const DATASET_RECONCILIATION_RPC = Object.freeze([
  ["select analytics.commit_dataset_reconciliation($1::jsonb,$2::jsonb,$3::jsonb,$4::timestamptz) as result", "analytics.commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)"],
  ["select analytics.inspect_dataset_reconciliation($1::jsonb,$2::uuid) as result", "analytics.inspect_dataset_reconciliation(jsonb,uuid)"],
].map(Object.freeze));
// Existing source clients still issue only their own fixed RPCs. Recognizing
// this exact future extension avoids breaking capture when its separate grant
// is installed; it does not grant or enable any storage call.
// Resolve only built-in argument types. Looking up a new function via
// to_regprocedure would require schema USAGE even for the unchanged old role.
export const DATASET_OPTIONAL_PRIVILEGES_SQL = "and not (" + [...new Set([...DATASET_STORAGE_RPC, ...DATASET_RECONCILIATION_RPC].map(x => x[1]))].map(signature => {
  const [, schema, name, types] = signature.match(/^([a-z_]+)\.([a-z_]+)\((.*)\)$/);
  const oids = types.split(",").map(type => "pg_catalog.to_regtype('" + type + "')::oid::text").join("||' '||");
  return "(n.nspname='" + schema + "' and p.proname='" + name + "' and p.proargtypes::text=(" + oids + "))";
}).join(" or ") + ")";
