-- Separately approved operational role extension, never an automatic installer.
-- Existing NOLOGIN/LOGIN/password, memberships and table rights are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if current_user<>'postgres' or not exists(select 1 from pg_roles where rolname='adstable_google_source_runner'
  and not rolsuper and not rolinherit and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolreplication)
 or exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='adstable_google_source_runner'))
 or exists(select 1 from unnest(array['evidence.commit_google_dataset_source(jsonb,uuid,integer,jsonb,jsonb)',
 'evidence.read_source_pages(jsonb,uuid,integer,bigint,integer)']) s(signature)
 left join pg_proc p on p.oid=to_regprocedure(s.signature) left join pg_roles r on r.oid=p.proowner
 where p.oid is null or r.rolname<>'adstable_owner' or not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false))
 then raise exception 'GOOGLE_DATASET_ROLE_PREREQUISITE_FAILED';end if;
end $guard$;
grant execute on function evidence.commit_google_dataset_source(jsonb,uuid,integer,jsonb,jsonb),
 evidence.read_source_pages(jsonb,uuid,integer,bigint,integer) to adstable_google_source_runner;
commit;
