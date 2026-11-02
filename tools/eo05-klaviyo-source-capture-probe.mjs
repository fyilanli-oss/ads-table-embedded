import assert from "node:assert/strict";
import {randomUUID, createHash} from "node:crypto";
import {createRefreshKlaviyoIdentityReader} from "../app/lib/refresh/quota-authority-binding.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {KLAVIYO_OAUTH_SCOPES} from "../app/lib/providers/klaviyo-api.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {dispatchRefreshPreflight} from "../app/lib/refresh/preflight-bridge.server.js";

// Independent transaction and actual Klaviyo admission. Never spend another test's
// short dispatch deadline on this matrix or widen its production/test limits.
export async function klaviyoSourceCaptureRehearsal(client, {workspace, shopId, shopDomain}) {
  await client.query("begin");
  try {
    const initial = new Date(Date.now() - 3 * 86400000).toISOString();
    await client.query("update integrations.provider_connections set connected_at=$1 where workspace_id=$2", [initial, workspace]);
    await client.query("update integrations.reporting_account_bindings set effective_from=$1 where workspace_id=$2 and effective_to is null", [initial, workspace]);
    const store = createRefreshWorkRepository(client), quotaStore = createSharedQuotaRepository(client);
    await store.checkQueueFromAuthority({expectedRevision: (await store.readQueueCheck()).revision});
    const vector = {requests: 20, dbWrites: 20, connections: 10, rows: 100, bytes: 10000};
    const accounts = [{provider: "meta", accountId: "act_101"}, {provider: "google_ads", accountId: "111"}, {provider: "klaviyo", accountId: "klaviyo-a"}];
    const budget = {global: vector, interactiveReserve: {requests: 0, dbWrites: 0, connections: 0, rows: 0, bytes: 0},
      providers: accounts.map(a => ({provider: a.provider, limit: vector})), workspaces: [{workspaceId: workspace, limit: vector}], accounts: accounts.map(a => ({...a, limit: vector}))};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton", [JSON.stringify(budget), JSON.stringify({maxCandidates: 8, maxClaims: 8, maxAdmissions: 8, maxWorkspaces: 8})]);
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10), window = {from: day, to: day};
    const limits = {deadlineAt: Date.now() + 120000, requestTimeoutMs: 1000, finishReserveMs: 10};
    const entitlementVerifier = createRefreshEntitlementVerifier({store, appId: "gid://shopify/App/456", now: Date.now, limits,
      authorizeRead: async () => true, partnerApi: {appId: "gid://shopify/App/456", activeSubscription: async () => ({data: {activeSubscription: {
        shop: {id: shopId, myshopifyDomain: shopDomain}, billingPeriod: "EVERY_30_DAYS", cancelAtEndOfCycle: false, trialEndsAt: null,
        currentBillingCycle: {startTime: initial, endTime: new Date(Date.now() + 10 * 86400000).toISOString()},
        items: [{handle: "monthly", price: {active: true}}], pendingUpdate: null}}})}});
    let execution;
    const result = await dispatchRefreshPreflight({store, now: Date.now, entitlementVerifier,
      buildWorkPlan: async source => source.provider === "klaviyo" ? {partitionId: "klaviyo-source-matrix", workClass: "hourly_hot_window", window,
        cost: {requests: 2, dbWrites: 5, connections: 1, rows: 5, bytes: 1000}, limits: {...limits, maxRows: 5, maxBytes: 1000}} : null,
      readPage: async value => {execution = structuredClone({claim: value.claim, window: value.window, entitlementReceipt: value.entitlementReceipt}); return {kind: "complete", payload: {}};},
      validatePage: () => ({complete: true, rows: []})});
    assert.equal(result.status, "awaiting_dataset"); assert.equal(execution.claim.provider, "klaviyo");
    await client.query("update operations.refresh_work_progress set stage='request_intent',rows_observed=0,bytes_observed=0 where fence=$1", [execution.claim.fence]);
    await klaviyoSourceCaptureProbe(client, {store, quotaStore, execution});
  } finally {await client.query("rollback");}
}

// Rollback-only F01 fixture: real current-owner/job/billing/quota SQL and native
// HTTP boundary. Tokens and every physical HTTP reply are synthetic.
export async function klaviyoSourceCaptureProbe(client, {store, quotaStore, execution: original}) {
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.ok(process.env.RUNNER_TEMP);
  await client.query("savepoint klaviyo_source_fixture");
  try {
    const {workspaceId, installGeneration, fence} = original.claim;
    const connection = (await client.query("select id,credential_id,connection_version from integrations.provider_connections where workspace_id=$1 and provider='klaviyo'", [workspaceId])).rows[0];
    const installation = (await client.query("select id::text,shop_id,shop_domain from shopify.installations where workspace_id=$1 and install_generation=$2 and status='active'", [workspaceId, installGeneration])).rows[0];
    const source = (await client.query("select operations.refresh_preflight_source($1,$2,'klaviyo','klaviyo-a') source", [workspaceId, installGeneration])).rows[0].source;
    assert.ok(source); const accountId = "klaviyo-a", scopes = [...KLAVIYO_OAUTH_SCOPES];
    await client.query("update integrations.provider_connections set granted_scopes=$1 where id=$2", [scopes, connection.id]);
    // Actual admitted Klaviyo job; only fixture scopes changed above. Refresh its
    // bound source inside the savepoint without extending any deadline.
    assert.equal(original.claim.provider, "klaviyo"); assert.equal(original.claim.accountId, accountId);
    await client.query("update operations.refresh_work_bindings set source=operations.refresh_preflight_source(workspace_id,install_generation,provider,account_id) where fence=$1", [fence]);
    const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled) values($1,$2,'klaviyo',$3,$4,$5,$6,$7,$8,1,'2026-10-15',true)",
      [workspaceId, installGeneration, installation.id, connection.id, connection.connection_version, accountId, hash(), hash()]);
    const execution = {...original, claim: {...original.claim, provider: "klaviyo", accountId}};
    const verified = {installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId, installGeneration: Number(installGeneration)},
      identity: {session: {authority: "shopify_id_token_verified", shopDomain: installation.shop_domain},
        shop: {authority: "shopify_admin_verified", shopId: installation.shop_id, myshopifyDomain: installation.shop_domain}},
      context: {admin: {graphql() {throw Error("Admin not used by native-only source fixture");}}}};
    async function routes() {
      const ctx = await store.loadQuotaContext({...execution, provider: "klaviyo"}); assert.ok(ctx);
      for (const family of ["account_discovery", "metrics", "events"]) {
        const r = quotaRouteIdentity(ctx, {provider: "klaviyo", family, accountId: null, organizationId: null, version: ctx.apiVersion, includes: family === "events" ? ["attributions", "metric"] : []}), policy = randomUUID();
        await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'klaviyo') on conflict do nothing", [ctx.connectionScopeKey]);
        await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'klaviyo',true,true) on conflict do nothing", [r.routeKey]);
        await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'klaviyo',60000,1000000,0,5000,1000)", [policy]);
        await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,1)", [r.routeKey, policy]);
        await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2) on conflict do nothing", [r.routeKey, ctx.connectionScopeKey]);
        await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true on conflict(operation_key) do update set quota_fingerprint=excluded.quota_fingerprint,enabled=true", [r.routeKey, ctx.connectionScopeKey]);
        await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true) on conflict(route_key) do update set enabled=true", [r.routeKey]);
      }
    }
    async function scenario(mode) {
      await client.query("savepoint klaviyo_source_case");
      try {
        const {input} = sourceStoreFixture(); let nativeCalls = 0, writeCalls = 0, lastArgs, sqlCode;
        if (mode === "late_failure") {
          await client.query("create function pg_temp.reject_klaviyo_mapping() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_META_MAPPING_FAILURE';end$$");
          await client.query("create trigger reject_klaviyo_mapping before insert on source.provider_claim_versions for each row execute function pg_temp.reject_klaviyo_mapping()");
        }
        const db = {async query(sql, args) {
          if (!sql.includes("evidence.commit_klaviyo_identity_source")) return client.query(sql, args);
          writeCalls++; lastArgs = args;
          if (mode === "fence") await client.query("update operations.refresh_runs set fence=fence+1000 where fence=$1", [fence]);
          if (mode === "disconnect") await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1", [connection.id]);
          if (mode === "context") await client.query("update operations.refresh_quota_contexts set connection_epoch=connection_epoch+1 where workspace_id=$1 and provider='klaviyo'", [workspaceId]);
          if (mode === "account") await client.query("update integrations.provider_accounts set active=false where connection_id=$1", [connection.id]);
          if (mode === "scopes") await client.query("update integrations.provider_connections set granted_scopes=array_remove(granted_scopes,'events:read') where id=$1", [connection.id]);
          if (mode === "verified_claim") {const body=JSON.parse(args[3]);body.claims[0].linkState="verified";args=[...args.slice(0,3),JSON.stringify(body),args[4]];}
          if (["expired", "permission_expired"].includes(mode)) {const read = JSON.parse(args[4]); read[mode === "expired" ? "deadlineAt" : "permissionExpiresAt"] = new Date(Date.now() - 1000).toISOString(); args = [...args.slice(0, 4), JSON.stringify(read)];}
          if (mode === "permission_missing") {const read = JSON.parse(args[4]); read.permissionExpiresAt = null; args = [...args.slice(0, 4), JSON.stringify(read)];}
          await client.query("savepoint klaviyo_source_rpc"); let result;
          try {result = await client.query(sql, args); await client.query("release savepoint klaviyo_source_rpc");}
          catch (error) {sqlCode = error.code; await client.query("rollback to savepoint klaviyo_source_rpc"); await client.query("release savepoint klaviyo_source_rpc"); throw error;}
          if (mode === "lost") throw Error("synthetic lost acknowledgement"); return result;
        }};
        let readNumber=0;
        async function read() {
          readNumber++;await routes(); const issued = Date.now();
          const token = {access_token: "SYNTHETIC-ONLY", permission_profile: "identity_v1", scopes, scope_verified_at: new Date(issued).toISOString(), expires_at: new Date(issued + 3600000).toISOString()};
          const reader = createRefreshKlaviyoIdentityReader({verified, database: db, tokenVault: {loadProviderTokenSet: async () => token},
            mode: "native",
            ...execution, workStore: store, quotaStore, now: Date.now, readNow: () => new Date(),
            sourceStorage: {cipher: input.cipher, policy: input.policy, limits: {maxRows: 1000, maxBytes: 1000000}},
            fetchFn: async endpoint => {
              nativeCalls++;const key=new URL(endpoint).pathname.split('/').filter(Boolean).at(-1);
              if(key==='events'&&mode==='native_failure')return Response.json({errors:[{detail:'SYNTHETIC-PRIVATE'}]},{status:500});
              if(key==='accounts')return Response.json({data:[{type:'account',id:accountId,attributes:{preferred_currency:'USD',timezone:'UTC',contact_information:{organization_name:'PRIVATE-NAME'}}}]});
              const metric={type:'metric',id:'metric1',attributes:{name:'Ordered Product',integration:{name:'Shopify',id:'integration1'}}};
              if(key==='metrics')return Response.json({data:[metric],links:{next:null}});
              assert.equal(key,'events');
              const event={type:'event',id:'event1',attributes:{datetime:execution.window.from+'T12:00:00.000Z',uuid:'uuid1',event_properties:{ProductID:'EXACT-ID','Variant ID':'456',Quantity:2,$value:'EXACT-AMOUNT',OrderId:'gid://shopify/Order/101',email:'PRIVATE-EMAIL'}},relationships:{metric:{data:{type:'metric',id:'metric1'}},attributions:{data:[{type:'attribution',id:'a1'}]}}};
              const attribution={type:'attribution',id:'a1',relationships:{'campaign-message':{data:{type:'campaign-message',id:'m1'}}}};
              const body={data:mode==='empty'?[]:[event],included:[metric,attribution],links:{next:null}};
              const amount=mode==='changed_event'&&readNumber>1?'12.5100':'12.5000';
              return new Response(JSON.stringify(body).replace('"EXACT-ID"','9007199254740993').replace('"EXACT-AMOUNT"',amount),{headers:{'content-type':'application/json'}});
            }});
          let outcome, error; try {outcome = await reader.readEvidence();} catch (e) {error = e;}
          await assert.rejects(reader.readEvidence(), /EXECUTION_USED/); return {outcome, error};
        }
        const first = await read(), success = ["success", "empty", "reuse", "new_version", "changed_event"].includes(mode);
        if (success) {
          assert.ok(first.outcome, JSON.stringify({mode, sqlCode, error: first.error?.message}));
          const result = first.outcome, receipt = result.sourceReceipt;
          assert.equal(result.sourceStored, true); assert.equal(result.persistable, false); assert.equal(result.authorizes_activation, false);
          assert.equal(receipt.manifest.counts.mappings, mode === "empty" ? 0 : 1); assert.equal(receipt.manifest.counts.claims, mode === "empty" ? 0 : 1);
          const same = (await client.query("select evidence.commit_klaviyo_identity_source($1::jsonb,$2::uuid,$3::integer,$4::jsonb,$5::jsonb) as result", lastArgs)).rows[0].result;
          assert.equal(same.commitId, receipt.commitId);
          const sourceOwner = JSON.parse(lastArgs[0]), repo = createSourceEvidenceRepository(client);
          const pages = await repo.readPages({owner: sourceOwner, attemptId: lastArgs[1], ordinal: 0, limit: 100}); assert.equal(pages.length, 4);
          for (const page of pages) {
            const payload=input.cipher.open({owner:sourceOwner,attemptId:lastArgs[1],ordinal:0,page});assert.ok(Array.isArray(payload.records));
            assert.doesNotMatch(JSON.stringify(payload),/PRIVATE-EMAIL|PRIVATE-NAME|SYNTHETIC-ONLY/);
            if(mode!=='empty'&&page.family==='klaviyo_ordered_product_events')assert.deepEqual(payload.records[0].attributes.event_properties.$value,{jsonNumber:'12.5000'});
          }
          if(mode!=='empty'){
            const claim=(await client.query('select * from source.provider_claim_versions where id=$1',[receipt.manifest.ids['claim:c0']])).rows[0];
            assert.equal(claim.order_link_state,'unlinked');assert.equal(claim.shopify_order_version_id,null);assert.equal(claim.native_order_reference,'gid://shopify/Order/101');
          }
          if (mode !== "empty") {
            const m = (await client.query("select * from identity.product_identity_mappings where id=$1", [receipt.manifest.ids["mapping:m0"]])).rows[0];
            assert.equal(m.mapping_state, "unresolved"); assert.equal(m.shopify_product_id, null); assert.equal(m.source_rule_version_id, null);
          }
          if (["reuse", "new_version", "changed_event"].includes(mode)) {
            if (mode === "new_version") {
              await client.query("update integrations.provider_connections set connection_version=connection_version+1 where id=$1", [connection.id]);
              await client.query("update operations.refresh_quota_contexts set connection_version=connection_version+1,connection_epoch=connection_epoch+1 where workspace_id=$1 and provider='klaviyo'", [workspaceId]);
              await client.query("update operations.refresh_work_bindings set source=operations.refresh_preflight_source(workspace_id,install_generation,provider,account_id) where fence=$1", [fence]);
            }
            const next = await read(); assert.ok(next.outcome, JSON.stringify({mode, sqlCode, error: next.error?.message}));
            const id = next.outcome.sourceReceipt.manifest.ids["mapping:m0"];
            if (mode !== "new_version") assert.equal(id, receipt.manifest.ids["mapping:m0"]);
            else {const m = (await client.query("select revision::text,supersedes_id::text from identity.product_identity_mappings where id=$1", [id])).rows[0]; assert.equal(m.revision, "2"); assert.equal(m.supersedes_id, receipt.manifest.ids["mapping:m0"]);}
            const claimId=next.outcome.sourceReceipt.manifest.ids['claim:c0'];
            if(mode==='changed_event'){
              const claim=(await client.query('select supersedes_id::text,native_data from source.provider_claim_versions where id=$1',[claimId])).rows[0];
              assert.equal(claim.supersedes_id,receipt.manifest.ids['claim:c0']);assert.deepEqual(claim.native_data.attributes.event_properties.$value,{jsonNumber:'12.5100'});
            }else assert.equal(claimId,receipt.manifest.ids['claim:c0']);
          }
        } else {
          assert.ok(first.error); assert.equal(writeCalls, mode === "native_failure" ? 0 : 1, JSON.stringify({mode, error: first.error.message}));
          const rows = (await client.query("select * from evidence.source_batches where workspace_id=$1 and installation_id=$2", [workspaceId, installation.id])).rows;
          if (mode === "lost") {
            assert.equal(rows.length, 1); assert.equal(first.error.message, "SOURCE_STORE_WRITE_UNCONFIRMED");
            assert.equal((await createSourceEvidenceRepository(client).inspect({owner: JSON.parse(lastArgs[0]), attemptId: lastArgs[1], ordinal: 0})).status, "committed");
          } else assert.equal(rows.length, 0, JSON.stringify({mode, sqlCode, error: first.error.message}));
        }
        assert.equal(nativeCalls, mode === "native_failure" ? 3 : ["reuse", "new_version", "changed_event"].includes(mode) ? 8 : 4);
        const run = (await client.query("select status from operations.refresh_runs where workspace_id=$1 and provider='klaviyo' and job_id=$2", [workspaceId, execution.claim.id])).rows[0]; assert.equal(run.status, "running");
      } finally {await client.query("rollback to savepoint klaviyo_source_case"); await client.query("release savepoint klaviyo_source_case");}
    }
    for (const mode of ["success", "empty", "reuse", "new_version", "changed_event", "lost", "fence", "disconnect", "context", "account", "scopes", "verified_claim", "expired", "permission_expired", "permission_missing", "late_failure", "native_failure"]) await scenario(mode);
    for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_function_privilege($1,'evidence.commit_klaviyo_identity_source(jsonb,uuid,integer,jsonb,jsonb)','EXECUTE') ok", [role])).rows[0].ok, false);
    console.log("EO05_KLAVIYO_SOURCE_CAPTURE_PASS real_SQL_quota_native_boundary_synthetic_HTTP=true encrypted_page_readback=true unresolved_not_verified=true durable_revision_supersedes=true stale_fence_context_account_scopes_disconnect_expiry_denied=true exact_native_numeric_lexemes=true unlinked_claim_content_versions=true late_failure_rollback=true lost_ack_explicit_readback=true no_runtime_grants=true no_checkpoint=true");
  } finally {await client.query("rollback to savepoint klaviyo_source_fixture"); await client.query("release savepoint klaviyo_source_fixture");}
}
