import {readFileSync} from "node:fs";
import {GOOGLE_SOURCE_ROLE, GOOGLE_SOURCE_RPC, GOOGLE_SOURCE_ROLE_CHECK_SQL} from "../app/lib/database/google-source-postgres.server.js";

export const roleContractPath="contracts/eo-05-step15-google-source-role-v1.json";
export const roleInstallationPath="tools/sql/eo05-google-source-role-install.sql";
const privateSchemas="'app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source'";
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

export function loadGoogleSourceRolePlan(){
 const p=JSON.parse(read(roleContractPath));
 const signatures=[...new Set(GOOGLE_SOURCE_RPC.map(x=>x[1]))];
 if(p.role!==GOOGLE_SOURCE_ROLE||p.functions.length!==16||JSON.stringify(p.functions.map(x=>x.signature))!==JSON.stringify(signatures)
  ||p.functions.some(x=>!/^[a-f0-9]{64}$/.test(x.definition_sha256)))throw Error("GOOGLE_SOURCE_ROLE_PLAN_INVALID");
 return p;
}

// Only fixed repository data enters SQL. No tenant, credential or URL is accepted.
export function googleSourceRolePrerequisiteSql(){
 const p=loadGoogleSourceRolePlan();
 return `with expected(signature,definition_sha256) as (values
 ${p.functions.map(x=>"("+literal(x.signature)+","+literal(x.definition_sha256)+")").join(",\n ")})
 select current_user='postgres'
 and current_setting('server_version_num')::integer between 170000 and 179999
 and exists(select 1 from pg_roles where rolname='adstable_owner' and not rolcanlogin and not rolsuper and not rolbypassrls)
 and (select count(*) from pg_namespace n join pg_roles r on r.oid=n.nspowner
      where n.nspname in ('integrations','operations','evidence','identity') and r.rolname='adstable_owner')=4
 and not exists(select 1 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
      left join pg_roles r on r.oid=p.proowner
      where p.oid is null or r.rolname<>'adstable_owner' or not p.prosecdef
       or not coalesce(p.proconfig @> array['search_path=""'],false)
       or encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>e.definition_sha256
       or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.privilege_type='EXECUTE' and (a.grantee=0 or a.grantee in
           (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))))
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='evidence' and c.relname='source_batches' and c.relkind='r')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in (${privateSchemas}) and c.relkind in ('r','p') and (not c.relrowsecurity or not c.relforcerowsecurity))
 as ready`;
}

const signaturesLiteral=()=>"array["+loadGoogleSourceRolePlan().functions.map(x=>literal(x.signature)).join(",")+"]::text[]";
// Same role/function/table profile enforced by the actual server transport.
export function googleSourceInstalledRoleSql(){
 return GOOGLE_SOURCE_ROLE_CHECK_SQL.replaceAll("current_user",literal(GOOGLE_SOURCE_ROLE)).replaceAll("$1::text[]",signaturesLiteral());
}

const inactiveRoleSql=`select not r.rolcanlogin and not r.rolsuper and not r.rolinherit and not r.rolbypassrls
 and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
 and not exists(select 1 from pg_auth_members m where m.member=r.oid)
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (${privateSchemas}) and c.relkind in ('r','p')
  and (has_table_privilege(r.oid,c.oid,'MAINTAIN') or has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (${privateSchemas}) and c.relkind='S' and has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE'))
 as inactive from pg_roles r where r.rolname='adstable_google_source_runner'`;

// Read-only catalogue inspection, no execution of installation SQL or repair path.
export async function inspectGoogleSourceRole(client){
 const prerequisite=(await client.query(googleSourceRolePrerequisiteSql())).rows;
 const exists=(await client.query("select exists(select 1 from pg_roles where rolname=$1) present",[GOOGLE_SOURCE_ROLE])).rows;
 if(prerequisite.length!==1||exists.length!==1||typeof prerequisite[0].ready!=="boolean"||typeof exists[0].present!=="boolean")throw Error("GOOGLE_SOURCE_ROLE_PREFLIGHT_INVALID");
 if(!prerequisite[0].ready)return Object.freeze({status:"blocked",reason:"prerequisites_changed",authorizesInstallation:false,authorizesActivation:false});
 if(!exists[0].present)return Object.freeze({status:"ready_to_install",authorizesInstallation:false,authorizesActivation:false});
 const profile=(await client.query(googleSourceInstalledRoleSql())).rows,inactive=(await client.query(inactiveRoleSql)).rows;
 return Object.freeze({status:profile.length===1&&profile[0].profile_ready===true&&inactive.length===1&&inactive[0].inactive===true?"installed_inactive":"blocked",
  reason:"existing_role_never_reinstalled_or_repaired",authorizesInstallation:false,authorizesActivation:false});
}

// Render a reviewable operational SQL artifact; this module never submits it.
// Kept outside supabase/migrations: the approved82 ledger/rehearsal stays immutable.
export function renderGoogleSourceRoleInstallation(){
 const p=loadGoogleSourceRolePlan();
 return `-- Prepared only. Separate explicit approval is required before live execution.
-- NOLOGIN, no password/key, no membership in existing roles, no activation.
-- Execute once as postgres with stop-on-error, never continue after an error.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
declare ready boolean;
begin
 if exists(select 1 from pg_roles where rolname='adstable_google_source_runner') then
  raise exception 'GOOGLE_SOURCE_ROLE_ALREADY_EXISTS';
 end if;
 ${googleSourceRolePrerequisiteSql().replace(/\n as ready$/, "\n into ready")};
 if ready is distinct from true then raise exception 'GOOGLE_SOURCE_ROLE_PREREQUISITES_CHANGED'; end if;
end
$preflight$;
create role adstable_google_source_runner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password null;
set local role adstable_owner;
grant usage on schema integrations,operations,evidence,identity to adstable_google_source_runner;
${p.functions.map(x=>"grant execute on function "+x.signature+" to adstable_google_source_runner;").join("\n")}
reset role;
do $postflight$
declare valid boolean; inactive boolean;
begin
 select q.profile_ready into valid from (${googleSourceInstalledRoleSql()}) q;
 select q.inactive into inactive from (${inactiveRoleSql}) q;
 if valid is distinct from true or inactive is distinct from true then
  raise exception 'GOOGLE_SOURCE_ROLE_POSTFLIGHT_FAILED';
 end if;
end
$postflight$;
commit;
`;
}

export function googleSourceRoleInstallationBodyForRehearsal(){
 const sql=read(roleInstallationPath);
 if(sql!==renderGoogleSourceRoleInstallation())throw Error("GOOGLE_SOURCE_ROLE_ARTIFACT_CHANGED");
 return sql.replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"");
}
