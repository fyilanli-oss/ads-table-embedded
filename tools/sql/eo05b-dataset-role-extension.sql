-- Prepared only. Separate live role/grant approval required.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
grant usage on schema app,analytics to adstable_google_source_runner;
grant execute on function evidence.begin_dataset_storage_operation(jsonb,uuid,uuid,text,timestamptz),
 evidence.assert_source_owner(jsonb),
 evidence.read_source_receipt(jsonb,uuid,integer),
 evidence.read_source_pages(jsonb,uuid,integer,bigint,integer),
 evidence.read_dataset_source_context(jsonb,text,bigint,date,date),
 analytics.commit_dataset_storage(jsonb,jsonb),
 analytics.inspect_dataset_storage(jsonb,bigint,uuid),
 analytics.commit_dataset_empty_retention(jsonb,jsonb),
 analytics.inspect_dataset_empty_retention(jsonb,bigint,uuid),
 app.read_reporting_currency(jsonb),
 analytics.lookup_dataset_fx(text,text,date),
 analytics.record_dataset_fx(jsonb) to adstable_google_source_runner;
grant usage on schema app,analytics to adstable_meta_source_runner;
grant execute on function evidence.begin_dataset_storage_operation(jsonb,uuid,uuid,text,timestamptz),
 evidence.assert_source_owner(jsonb),
 evidence.read_source_receipt(jsonb,uuid,integer),
 evidence.read_source_pages(jsonb,uuid,integer,bigint,integer),
 evidence.read_dataset_source_context(jsonb,text,bigint,date,date),
 analytics.commit_dataset_storage(jsonb,jsonb),
 analytics.inspect_dataset_storage(jsonb,bigint,uuid),
 analytics.commit_dataset_empty_retention(jsonb,jsonb),
 analytics.inspect_dataset_empty_retention(jsonb,bigint,uuid),
 app.read_reporting_currency(jsonb),
 analytics.lookup_dataset_fx(text,text,date),
 analytics.record_dataset_fx(jsonb) to adstable_meta_source_runner;
grant usage on schema app,analytics to adstable_klaviyo_source_runner;
grant execute on function evidence.begin_dataset_storage_operation(jsonb,uuid,uuid,text,timestamptz),
 evidence.assert_source_owner(jsonb),
 evidence.read_source_receipt(jsonb,uuid,integer),
 evidence.read_source_pages(jsonb,uuid,integer,bigint,integer),
 evidence.read_dataset_source_context(jsonb,text,bigint,date,date),
 analytics.commit_dataset_storage(jsonb,jsonb),
 analytics.inspect_dataset_storage(jsonb,bigint,uuid),
 analytics.commit_dataset_empty_retention(jsonb,jsonb),
 analytics.inspect_dataset_empty_retention(jsonb,bigint,uuid),
 app.read_reporting_currency(jsonb),
 analytics.lookup_dataset_fx(text,text,date),
 analytics.record_dataset_fx(jsonb) to adstable_klaviyo_source_runner;
reset role;
commit;
