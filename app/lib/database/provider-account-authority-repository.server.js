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

function connectionAuthority(row) {
  if (!row) return null;
  const accounts = typeof row.accounts === "string"
    ? JSON.parse(row.accounts)
    : row.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error("PROVIDER_ACCOUNT_AUTHORITY_RESULT_INVALID");
  }
  return Object.freeze({
    connectionId: row.connection_id,
    credentialId: row.credential_id,
    grantedScopes: Object.freeze([...(row.granted_scopes ?? [])]),
    connectedAt: timestamp(row.connected_at),
    lastVerifiedAt: timestamp(row.last_verified_at),
    accounts: Object.freeze(accounts.map((account) => Object.freeze({...account}))),
    reportingAccountId: row.reporting_account_id ?? null,
  });
}

export function createProviderAccountAuthorityRepository(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    async establish(value) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.establish_provider_account_authority(
            $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid,
            $6::text[], $7::jsonb, $8::text, $9::timestamptz
          )`,
          [
            value.connectionId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.credentialId,
            value.grantedScopes,
            JSON.stringify(value.accounts),
            value.reportingAccountId,
            value.verifiedAt,
          ],
        ),
        "PROVIDER_ACCOUNT_AUTHORITY_ESTABLISH",
      );
      return Object.freeze({
        connectionId: row.connection_id,
        connectedAccountCount: positiveInteger(
          row.connected_account_count,
          "PROVIDER_ACCOUNT_AUTHORITY_ESTABLISH",
        ),
        reportingAccountId: row.reporting_account_id ?? null,
      });
    },

    async selectReportingAccount(value) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.select_reporting_account(
            $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::timestamptz
          )`,
          [
            value.connectionId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.providerAccountId,
            value.verifiedAt,
          ],
        ),
        "REPORTING_ACCOUNT_SELECT",
      );
      return Object.freeze({
        connectionId: row.connection_id,
        reportingAccountId: row.reporting_account_id,
        changed: row.changed === true,
      });
    },

    async load({workspaceId, installGeneration, provider}) {
      const row = optionalOneRow(
        await query(
          `select * from integrations.load_provider_account_authority(
            $1::uuid, $2::bigint, $3::text
          )`,
          [workspaceId, installGeneration, provider],
        ),
        "PROVIDER_ACCOUNT_AUTHORITY_LOAD",
      );
      return connectionAuthority(row);
    },
  });
}
