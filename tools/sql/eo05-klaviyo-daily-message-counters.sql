-- Prepared registry addition for the rollback-only Dataset replay.
create function analytics.dataset_message_extensions_valid(fact_table text, j jsonb)
returns boolean language plpgsql immutable set search_path='' as $fn$
declare counters jsonb := j->'metric_extensions'; entry jsonb; k text;
begin
  if j->>'extension_schema_version'='eo05b-extensions-v1' then
    return counters is not distinct from '{}'::jsonb;
  end if;
  if j->>'extension_schema_version' is distinct from 'eo05b-klaviyo-message-extensions-v1'
    or fact_table is distinct from 'pd_facts' or j->>'platform' is distinct from 'klaviyo'
    or coalesce(j->>'entity_type','') not in ('campaign_message','flow_message')
    or jsonb_typeof(counters) is distinct from 'object'
    then return false;
  end if;
  if not counters ?& array['recipients','opens']
    or (select count(*) from jsonb_object_keys(counters))<>2 then return false; end if;
  foreach k in array array['recipients','opens'] loop
    entry := counters->k;
    if jsonb_typeof(entry) is distinct from 'object' then return false; end if;
    if not entry ?& array['state','value']
      or (select count(*) from jsonb_object_keys(entry))<>2 then return false; end if;
    case entry->>'state'
      when 'present' then
        if jsonb_typeof(entry->'value') is distinct from 'string'
          or entry->>'value' !~ '^(0|[1-9][0-9]{0,126})$' then return false; end if;
      when 'missing', 'unknown' then
        if entry->'value' is distinct from 'null'::jsonb then return false; end if;
      else return false;
    end case;
  end loop;
  return true;
end $fn$;
revoke all on function analytics.dataset_message_extensions_valid(text,jsonb)
from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator;

-- Preserve all existing row validation and replace only the empty registry rule.
do $registry$
declare
  definition text := pg_catalog.pg_get_functiondef('analytics.validate_dataset_fact()'::regprocedure);
  prior text := $prior$if new.extension_schema_version<>'eo05b-extensions-v1' or new.metric_extensions<>'{}'::jsonb
 or (select count(*) from jsonb_object_keys(new.metric_extensions))>32 then raise exception 'DATASET_EXTENSION_UNREGISTERED';end if;$prior$;
  updated text;
begin
  updated := replace(definition,prior,
    'if not analytics.dataset_message_extensions_valid(tg_table_name,j) then raise exception ''DATASET_EXTENSION_UNREGISTERED'';end if;');
  if length(definition)-length(replace(definition,prior,''))<>length(prior)
    then raise exception 'DATASET_EXTENSION_BASELINE_MISMATCH'; end if;
  execute updated;
end $registry$;
