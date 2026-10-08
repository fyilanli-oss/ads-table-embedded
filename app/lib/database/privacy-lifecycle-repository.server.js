function requiredQuery(database) {
  if (!database || typeof database.query !== "function") {
    throw new TypeError("database.query is required");
  }
  return database.query.bind(database);
}

function exactlyOneRow(result, operation) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(operation + "_RESULT_INVALID");
  }
  return result.rows[0];
}

export function createPrivacyLifecycleRepository(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    async claimWebhook(claim) {
      const row = exactlyOneRow(
        await query(
          `select * from privacy.claim_shopify_webhook(
            $1::text, $2::text, $3::text, $4::text, $5::text,
            $6::bytea, $7::text, $8::text, $9::timestamptz, $10::timestamptz
          )`,
          [
            claim.webhookId,
            claim.eventId,
            claim.topic,
            claim.shopId,
            claim.shopDomain,
            claim.shopIdentitySha256,
            claim.payloadSha256,
            claim.apiVersion,
            claim.triggeredAt,
            claim.receivedAt,
          ],
        ),
        "PRIVACY_WEBHOOK_CLAIM",
      );
      return Object.freeze({
        claimId: row.claim_id,
        deletionRunId: row.deletion_run_id ?? null,
        workspaceId: row.workspace_id ?? null,
        installGeneration:
          row.install_generation === null ? null : Number(row.install_generation),
        outcome: row.outcome,
        duplicate: row.duplicate,
      });
    },

    async requestWorkspaceDeletion(request) {
      const row = exactlyOneRow(
        await query(
          `select privacy.request_workspace_deletion(
            $1::text, $2::text, $3::text, $4::bigint, $5::bytea, $6::timestamptz
          ) as deletion_run_id`,
          [
            request.requestKey,
            request.shopId,
            request.shopDomain,
            request.installGeneration,
            request.shopIdentitySha256,
            request.requestedAt,
          ],
        ),
        "PRIVACY_WORKSPACE_DELETION_REQUEST",
      );
      return row.deletion_run_id;
    },

    async executeDeletionRun(deletionRunId) {
      const row = exactlyOneRow(
        await query(
          "select * from privacy.execute_deletion_run($1::uuid)",
          [deletionRunId],
        ),
        "PRIVACY_DELETION_EXECUTION",
      );
      return Object.freeze({
        deletionRunId: row.deletion_run_id,
        status: row.deletion_status,
        manifestId: row.manifest_id ?? null,
        result: row.manifest_result ?? null,
      });
    },
  });
}
