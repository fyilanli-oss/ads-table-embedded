-- Prepared only; existing EO05B role extension is a prerequisite.
-- Separate live installation/grant approval is required.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role adstable_owner;
grant execute on function analytics.commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz),
 analytics.inspect_dataset_reconciliation(jsonb,uuid)
 to adstable_google_source_runner,adstable_meta_source_runner,adstable_klaviyo_source_runner;
reset role;
commit;
