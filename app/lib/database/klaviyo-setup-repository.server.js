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

function record(row) {
  if (!row) return null;
  return Object.freeze({
    connectionId: row.connection_id,
    status: row.lifecycle_status,
    version: integer(row.connection_version, "KLAVIYO_CONNECTION_VERSION_INVALID"),
    credentialId: row.credential_id ?? null,
    scopes: Object.freeze([...(row.granted_scopes ?? [])]),
  });
}

export function createKlaviyoSetupRepository(database) {
  const query = queryOf(database);
  return Object.freeze({
    async stage(value) {
      return record(one(await query(
        `select * from integrations.stage_provider_account_selection(
          $1::uuid, $2::uuid, $3::bigint, 'klaviyo', $4::uuid,
          $5::text[], $6::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.credentialId, value.scopes, value.verifiedAt,
        ],
      ), "KLAVIYO_SETUP_STAGE"));
    },

    async loadPending(value) {
      return record(optional(await query(
        `select * from integrations.load_pending_klaviyo_account_selection(
          $1::uuid, $2::bigint
        )`,
        [value.workspaceId, value.installGeneration],
      ), "KLAVIYO_SETUP_LOAD"));
    },

    async callbackReturn(value) {
      const row = one(await query(
        `select * from shopify.resolve_active_installation_callback_return(
          $1::uuid, $2::bigint
        )`,
        [value.workspaceId, value.installGeneration],
      ), "KLAVIYO_CALLBACK_RETURN");
      if (
        typeof row.shop_domain !== "string"
        || !/^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$/.test(row.shop_domain)
      ) throw new Error("KLAVIYO_CALLBACK_RETURN_INVALID");
      return Object.freeze({shopDomain: row.shop_domain});
    },
  });
}
