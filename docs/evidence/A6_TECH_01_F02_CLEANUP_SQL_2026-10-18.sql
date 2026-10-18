begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;
lock table integrations.provider_connections, integrations.provider_authorization_handoffs,
  integrations.oauth_transactions, integrations.provider_credential_envelopes
  in share row exclusive mode;
do $f02$
declare
  before_state jsonb;
  after_state jsonb;
  affected integer;
begin
  select jsonb_build_object(
'candidate_count',(select count(*) from integrations.provider_credential_envelopes where encode(sha256(convert_to(id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981' and provider='google_ads' and created_at='2026-10-11T15:50:07.837069Z'::timestamptz and updated_at=created_at),
'candidate_connection_references',(select count(*) from integrations.provider_connections c join integrations.provider_credential_envelopes e on e.id=c.credential_id where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981'),
'candidate_handoff_references',(select count(*) from integrations.provider_authorization_handoffs h join integrations.provider_credential_envelopes e on e.id=h.credential_id where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981'),
'candidate_inflight_oauth',(select count(*) from integrations.oauth_transactions o join integrations.provider_credential_envelopes e on e.workspace_id=o.workspace_id and e.install_generation=o.install_generation and e.provider=o.provider where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981' and o.expires_at>statement_timestamp() and o.status not in ('exchanged','failed','expired','denied','cancelled')),
'credentials',(select count(*) from integrations.provider_credential_envelopes),
'bound_credentials',(select count(*) from integrations.provider_credential_envelopes e where exists(select 1 from integrations.provider_connections c where c.credential_id=e.id)),
'other_credentials_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'[]'),'UTF8')),'hex') from integrations.provider_credential_envelopes e where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')<>'dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981'),
'connections',(select count(*) from integrations.provider_connections),
'connections_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text,'[]'),'UTF8')),'hex') from integrations.provider_connections c),
'history_rows',(select count(*) from integrations.provider_authorization_handoffs),
'history_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(h) order by h.oauth_transaction_id)::text,'[]'),'UTF8')),'hex') from integrations.provider_authorization_handoffs h),
'orphan_google_credentials',(select count(*) from integrations.provider_credential_envelopes e where e.provider='google_ads' and not exists(select 1 from integrations.provider_connections c where c.credential_id=e.id) and not exists(select 1 from integrations.provider_authorization_handoffs h where h.credential_id=e.id))
) into before_state;
  if before_state <> '{"connections":3,"credentials":4,"history_rows":8,"history_sha256":"f0ec37f341d0b5fecbd8a7b5dc021f91ba7289c900781969670a498d42b6984b","candidate_count":1,"bound_credentials":3,"connections_sha256":"2a760704c4cc5025cefb4eea30d727bae79cc020772604f734959b89f41aada2","candidate_inflight_oauth":0,"other_credentials_sha256":"a4b7a086f5ccfa9731b177485bdc60af58e6cfc0c5f81f71468d127959968dc8","orphan_google_credentials":1,"candidate_handoff_references":0,"candidate_connection_references":0}'::jsonb then
    raise exception 'F02_PRECONDITION_DRIFT';
  end if;
  delete from integrations.provider_credential_envelopes
   where provider='google_ads'
     and created_at='2026-10-11T15:50:07.837069Z'::timestamptz
     and updated_at=created_at
     and encode(sha256(convert_to(id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'F02_EXACT_DELETE_COUNT_INVALID'; end if;
  select jsonb_build_object(
'candidate_count',(select count(*) from integrations.provider_credential_envelopes where encode(sha256(convert_to(id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981' and provider='google_ads' and created_at='2026-10-11T15:50:07.837069Z'::timestamptz and updated_at=created_at),
'candidate_connection_references',(select count(*) from integrations.provider_connections c join integrations.provider_credential_envelopes e on e.id=c.credential_id where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981'),
'candidate_handoff_references',(select count(*) from integrations.provider_authorization_handoffs h join integrations.provider_credential_envelopes e on e.id=h.credential_id where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981'),
'candidate_inflight_oauth',(select count(*) from integrations.oauth_transactions o join integrations.provider_credential_envelopes e on e.workspace_id=o.workspace_id and e.install_generation=o.install_generation and e.provider=o.provider where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')='dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981' and o.expires_at>statement_timestamp() and o.status not in ('exchanged','failed','expired','denied','cancelled')),
'credentials',(select count(*) from integrations.provider_credential_envelopes),
'bound_credentials',(select count(*) from integrations.provider_credential_envelopes e where exists(select 1 from integrations.provider_connections c where c.credential_id=e.id)),
'other_credentials_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'[]'),'UTF8')),'hex') from integrations.provider_credential_envelopes e where encode(sha256(convert_to(e.id::text,'UTF8')),'hex')<>'dc4db4375091b8039851d0c49a2b28c6396eb49954caa75e84430157dd94b981'),
'connections',(select count(*) from integrations.provider_connections),
'connections_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) order by c.id)::text,'[]'),'UTF8')),'hex') from integrations.provider_connections c),
'history_rows',(select count(*) from integrations.provider_authorization_handoffs),
'history_sha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(h) order by h.oauth_transaction_id)::text,'[]'),'UTF8')),'hex') from integrations.provider_authorization_handoffs h),
'orphan_google_credentials',(select count(*) from integrations.provider_credential_envelopes e where e.provider='google_ads' and not exists(select 1 from integrations.provider_connections c where c.credential_id=e.id) and not exists(select 1 from integrations.provider_authorization_handoffs h where h.credential_id=e.id))
) into after_state;
  if after_state <> '{"connections":3,"credentials":3,"history_rows":8,"history_sha256":"f0ec37f341d0b5fecbd8a7b5dc021f91ba7289c900781969670a498d42b6984b","candidate_count":0,"bound_credentials":3,"connections_sha256":"2a760704c4cc5025cefb4eea30d727bae79cc020772604f734959b89f41aada2","candidate_inflight_oauth":0,"other_credentials_sha256":"a4b7a086f5ccfa9731b177485bdc60af58e6cfc0c5f81f71468d127959968dc8","orphan_google_credentials":0,"candidate_handoff_references":0,"candidate_connection_references":0}'::jsonb then
    raise exception 'F02_POSTCONDITION_FAILED';
  end if;
end
$f02$;
reset role;
commit;
select true as f02_cleanup_committed;
