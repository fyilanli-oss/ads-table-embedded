begin;

set local role adstable_owner;

create index oauth_pkce_envelopes_workspace_fk_idx
  on integrations.oauth_pkce_envelopes (workspace_id);

reset role;

commit;
