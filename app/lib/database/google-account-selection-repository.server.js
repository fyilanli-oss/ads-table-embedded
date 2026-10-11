function queryOf(database) {
  if (!database || typeof database.query !== "function") {
    throw new TypeError("database.query is required");
  }
  return database.query.bind(database);
}

function one(result, code) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(code + "_RESULT_INVALID");
  }
  return result.rows[0];
}

function optional(result, code) {
  if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
    throw new Error(code + "_RESULT_INVALID");
  }
  return result.rows[0] ?? null;
}

function integer(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

function accountsOf(value, code) {
  const accounts = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(accounts)) throw new Error(code);
  return Object.freeze(accounts.map((account) => Object.freeze({...account})));
}

function record(row) {
  if (!row) return null;
  return Object.freeze({
    connectionId: row.connection_id,
    status: row.lifecycle_status,
    version: integer(row.connection_version, "GOOGLE_CONNECTION_VERSION_INVALID"),
    credentialId: row.credential_id ?? null,
    scopes: Object.freeze([...(row.granted_scopes ?? [])]),
    connectedAccountCount: row.connected_account_count == null
      ? null
      : integer(row.connected_account_count, "GOOGLE_ACCOUNT_COUNT_INVALID"),
    reportingAccountId: row.reporting_account_id ?? null,
  });
}

function pendingReportingRecord(row) {
  if (!row) return null;
  return Object.freeze({
    ...record(row),
    accounts: accountsOf(
      row.accounts,
      "GOOGLE_PENDING_REPORTING_ACCOUNTS_INVALID",
    ),
  });
}

export function createGoogleAccountSelectionRepository(database) {
  const query = queryOf(database);
  return Object.freeze({
    async stage(value) {
      return record(one(await query(
        `select * from integrations.stage_provider_account_selection(
          $1::uuid, $2::uuid, $3::bigint, 'google_ads', $4::uuid,
          $5::text[], $6::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.credentialId, value.scopes, value.verifiedAt,
        ],
      ), "GOOGLE_ACCOUNT_SELECTION_STAGE"));
    },

    async loadPending(value) {
      return record(optional(await query(
        `select * from integrations.load_pending_provider_account_selection(
          $1::uuid, $2::bigint, 'google_ads'
        )`,
        [value.workspaceId, value.installGeneration],
      ), "GOOGLE_ACCOUNT_SELECTION_LOAD"));
    },

    async loadPendingReporting(value) {
      return pendingReportingRecord(optional(await query(
        `select * from integrations.load_pending_reporting_account_selection(
          $1::uuid, $2::bigint, 'google_ads'
        )`,
        [value.workspaceId, value.installGeneration],
      ), "GOOGLE_REPORTING_ACCOUNT_SELECTION_LOAD"));
    },

    async complete(value) {
      return record(one(await query(
        `select * from integrations.complete_pending_provider_account_selection(
          $1::uuid, $2::uuid, $3::bigint, 'google_ads', $4::bigint,
          $5::jsonb, $6::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.expectedVersion, JSON.stringify(value.accounts),
          value.verifiedAt,
        ],
      ), "GOOGLE_ACCOUNT_SELECTION_COMPLETE"));
    },

    async completeReporting(value) {
      return record(one(await query(
        `select * from integrations.complete_pending_reporting_account_selection(
          $1::uuid, $2::uuid, $3::bigint, 'google_ads', $4::bigint,
          $5::text, $6::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.expectedVersion, value.providerAccountId, value.verifiedAt,
        ],
      ), "GOOGLE_REPORTING_ACCOUNT_SELECTION_COMPLETE"));
    },

    async cancel(value) {
      return record(one(await query(
        `select * from integrations.cancel_pending_provider_account_selection(
          $1::uuid, $2::uuid, $3::bigint, 'google_ads', $4::bigint,
          $5::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.expectedVersion, value.cancelledAt,
        ],
      ), "GOOGLE_ACCOUNT_SELECTION_CANCEL"));
    },

    async callbackReturn(value) {
      const row = one(await query(
        `select * from shopify.resolve_active_installation_callback_return(
          $1::uuid, $2::bigint
        )`,
        [value.workspaceId, value.installGeneration],
      ), "GOOGLE_CALLBACK_RETURN");
      if (
        typeof row.shop_domain !== "string"
        || !/^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$/.test(row.shop_domain)
      ) throw new Error("GOOGLE_CALLBACK_RETURN_INVALID");
      return Object.freeze({shopDomain: row.shop_domain});
    },
  });
}
