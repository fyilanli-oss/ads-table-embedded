begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;

create index deletion_runs_workspace_fk_idx
  on privacy.deletion_runs using btree (workspace_id);
create index deletion_manifests_workspace_fk_idx
  on privacy.deletion_manifests using btree (workspace_id);

commit;
