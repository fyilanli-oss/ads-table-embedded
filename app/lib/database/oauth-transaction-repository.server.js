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

function positiveInteger(value, operation) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(operation + "_RESULT_INVALID");
  }
  return parsed;
}

export function createOAuthTransactionRepository(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    async create(transaction) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.create_oauth_transaction(
            $1::uuid, $2::bigint, $3::text, $4::bytea, $5::bytea,
            $6::text, $7::timestamptz
          )`,
          [
            transaction.workspaceId,
            transaction.installGeneration,
            transaction.provider,
            transaction.stateDigest,
            transaction.transactionNonce,
            transaction.pkceChallenge,
            transaction.createdAt,
          ],
        ),
        "OAUTH_TRANSACTION_CREATE",
      );
      return Object.freeze({
        transactionId: row.transaction_id,
        callbackUri: row.callback_uri,
        pkceRequired: row.pkce_required,
        expiresAt:
          row.expires_at instanceof Date
            ? row.expires_at.toISOString()
            : row.expires_at,
        status: row.transaction_status,
      });
    },

    async markRedirected(transactionId, redirectedAt) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.mark_oauth_transaction_redirected($1::uuid, $2::timestamptz)",
          [transactionId, redirectedAt],
        ),
        "OAUTH_TRANSACTION_REDIRECT",
      );
      return Object.freeze({
        transactionId: row.transaction_id,
        status: row.transaction_status,
      });
    },

    async claim({provider, stateDigest, claimedAt}) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.claim_oauth_transaction($1::text, $2::bytea, $3::timestamptz)",
          [provider, stateDigest, claimedAt],
        ),
        "OAUTH_TRANSACTION_CLAIM",
      );
      return Object.freeze({
        transactionId: row.transaction_id,
        workspaceId: row.workspace_id,
        installGeneration: positiveInteger(
          row.install_generation,
          "OAUTH_TRANSACTION_CLAIM",
        ),
        provider: row.provider,
        callbackUri: row.callback_uri,
        pkceRequired: row.pkce_required,
        status: row.transaction_status,
      });
    },

    async complete({transactionId, outcome, failureCode, completedAt}) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.complete_oauth_transaction($1::uuid, $2::text, $3::text, $4::timestamptz)",
          [transactionId, outcome, failureCode, completedAt],
        ),
        "OAUTH_TRANSACTION_COMPLETE",
      );
      return Object.freeze({
        transactionId: row.transaction_id,
        status: row.transaction_status,
      });
    },

    async invalidate({transactionId, failureCode, completedAt}) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.invalidate_oauth_transaction($1::uuid, $2::text, $3::timestamptz)",
          [transactionId, failureCode, completedAt],
        ),
        "OAUTH_TRANSACTION_INVALIDATE",
      );
      return Object.freeze({
        transactionId: row.transaction_id,
        status: row.transaction_status,
      });
    },
  });
}
