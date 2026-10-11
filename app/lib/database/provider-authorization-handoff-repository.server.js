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

function optionalOneRow(result, operation) {
  if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
    throw new Error(operation + "_RESULT_INVALID");
  }
  return result.rows[0] ?? null;
}

function positiveInteger(value, operation) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(operation + "_RESULT_INVALID");
  }
  return parsed;
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function handoff(row) {
  if (!row) return null;
  return Object.freeze({
    transactionId: row.oauth_transaction_id,
    credentialId: row.credential_id,
    status: row.handoff_status,
    expiresAt: timestamp(row.expires_at),
  });
}

export function createProviderAuthorizationHandoffRepository(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    async create(value) {
      return handoff(exactlyOneRow(
        await query(
          "select * from integrations.create_provider_authorization_handoff($1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::timestamptz)",
          [
            value.transactionId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.credentialId,
            value.createdAt,
          ],
        ),
        "PROVIDER_AUTHORIZATION_HANDOFF_CREATE",
      ));
    },

    async load(value) {
      return handoff(optionalOneRow(
        await query(
          "select * from integrations.load_provider_authorization_handoff($1::uuid, $2::uuid, $3::bigint, $4::text, $5::timestamptz)",
          [
            value.transactionId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.observedAt,
          ],
        ),
        "PROVIDER_AUTHORIZATION_HANDOFF_LOAD",
      ));
    },

    async loadCurrent(value) {
      return handoff(optionalOneRow(
        await query(
          "select * from integrations.load_current_provider_authorization_handoff($1::uuid, $2::bigint, $3::text, $4::timestamptz)",
          [
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.observedAt,
          ],
        ),
        "PROVIDER_AUTHORIZATION_HANDOFF_LOAD_CURRENT",
      ));
    },

    async consume(value) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.consume_provider_authorization_handoff($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::text[], $7::jsonb, $8::text, $9::timestamptz, $10::timestamptz)",
          [
            value.transactionId,
            value.connectionId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.grantedScopes,
            JSON.stringify(value.accounts),
            value.reportingAccountId,
            value.verifiedAt,
            value.consumedAt,
          ],
        ),
        "PROVIDER_AUTHORIZATION_HANDOFF_CONSUME",
      );
      return Object.freeze({
        connectionId: row.connection_id,
        connectedAccountCount: positiveInteger(
          row.connected_account_count,
          "PROVIDER_AUTHORIZATION_HANDOFF_CONSUME",
        ),
        reportingAccountId: row.reporting_account_id ?? null,
      });
    },

    async resolveCallbackReturn({workspaceId, installGeneration}) {
      const row = exactlyOneRow(
        await query(
          "select * from shopify.resolve_active_installation_callback_return($1::uuid, $2::bigint)",
          [workspaceId, installGeneration],
        ),
        "ACTIVE_INSTALLATION_CALLBACK_RETURN",
      );
      if (
        typeof row.shop_domain !== "string"
        || !/^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$/.test(row.shop_domain)
      ) {
        throw new Error("ACTIVE_INSTALLATION_CALLBACK_RETURN_RESULT_INVALID");
      }
      return Object.freeze({shopDomain: row.shop_domain});
    },

    async cancel(value) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.cancel_provider_authorization_handoff($1::uuid, $2::uuid, $3::bigint, $4::text, $5::timestamptz)",
          [
            value.transactionId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.cancelledAt,
          ],
        ),
        "PROVIDER_AUTHORIZATION_HANDOFF_CANCEL",
      );
      if (row.cancelled !== true) {
        throw new Error("PROVIDER_AUTHORIZATION_HANDOFF_CANCEL_RESULT_INVALID");
      }
      return Object.freeze({cancelled: true});
    },

    async expire({observedAt, limit = 100}) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.expire_provider_authorization_handoffs($1::timestamptz, $2::integer)",
          [observedAt, limit],
        ),
        "PROVIDER_AUTHORIZATION_HANDOFF_EXPIRE",
      );
      const count = typeof row.expired_count === "number"
        ? row.expired_count
        : Number(row.expired_count);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("PROVIDER_AUTHORIZATION_HANDOFF_EXPIRE_RESULT_INVALID");
      }
      return count;
    },
  });
}
