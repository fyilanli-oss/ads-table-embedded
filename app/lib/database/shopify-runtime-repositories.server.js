function requiredQuery(database) {
  if (!database || typeof database.query !== "function") {
    throw new TypeError("database.query is required");
  }
  return database.query.bind(database);
}

function exactlyOneRow(result, operation) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(`${operation}_RESULT_INVALID`);
  }
  return result.rows[0];
}

function positiveInteger(value, operation) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${operation}_RESULT_INVALID`);
  }
  return parsed;
}

export function createShopifyRuntimeRepositories(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    installation: Object.freeze({
      async bootstrap({shopId, shopDomain, verifiedAt}) {
        const row = exactlyOneRow(
          await query(
            `select * from shopify.bootstrap_installation($1::text, $2::text, $3::timestamptz)`,
            [shopId, shopDomain, verifiedAt],
          ),
          "INSTALLATION_BOOTSTRAP",
        );

        return {
          shopId,
          shopDomain,
          workspaceId: row.workspace_id,
          installGeneration: positiveInteger(row.install_generation, "INSTALLATION_BOOTSTRAP"),
          status: row.installation_status,
          disposition: row.disposition,
        };
      },
    }),
    entitlement: Object.freeze({
      async applySnapshot(snapshot) {
        const row = exactlyOneRow(
          await query(
            `select * from billing.apply_shopify_app_pricing_snapshot(
              $1::text, $2::text, $3::bigint, $4::boolean, $5::text,
              $6::text, $7::boolean, $8::timestamptz, $9::timestamptz,
              $10::timestamptz, $11::text[], $12::text[], $13::timestamptz,
              $14::text
            )`,
            [
              snapshot.shopId,
              snapshot.shopDomain,
              snapshot.installGeneration,
              snapshot.active,
              snapshot.entitlementStatus,
              snapshot.billingPeriod,
              snapshot.cancelAtEndOfCycle,
              snapshot.trialEndsAt,
              snapshot.currentCycleStart,
              snapshot.currentCycleEnd,
              snapshot.itemHandles,
              snapshot.pendingItemHandles,
              snapshot.observedAt,
              snapshot.sourceHash,
            ],
          ),
          "ENTITLEMENT_SNAPSHOT",
        );

        return {
          workspaceId: row.workspace_id,
          shopId: row.shop_id,
          shopDomain: row.shop_domain,
          installGeneration: positiveInteger(row.install_generation, "ENTITLEMENT_SNAPSHOT"),
          entitlementStatus: row.entitlement_status,
          reportingStoreLimit: positiveInteger(row.reporting_store_limit, "ENTITLEMENT_SNAPSHOT"),
          candidateDetectionBilled: row.candidate_detection_billed,
          reportingStoreSwitchBilled: row.reporting_store_switch_billed,
          sourceObservedAt:
            row.source_observed_at instanceof Date
              ? row.source_observed_at.toISOString()
              : row.source_observed_at,
        };
      },
    }),
  });
}
