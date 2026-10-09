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

function envelope(row, purpose) {
  if (!row) return null;
  return Object.freeze({
    recordId: row.record_id,
    workspaceId: row.workspace_id,
    installGeneration: positiveInteger(row.install_generation, "TOKEN_VAULT"),
    provider: row.provider,
    purpose,
    ciphertext: row.payload_ciphertext,
    nonce: row.nonce,
    authTag: row.auth_tag,
    keyVersion: positiveInteger(row.key_version, "TOKEN_VAULT"),
    expiresAt:
      row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
  });
}

export function createTokenVaultRepository(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    async assertContract(expectedVersion) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.token_vault_runtime_guard($1::smallint)",
          [expectedVersion],
        ),
        "TOKEN_VAULT_RUNTIME_GUARD",
      );
      return Object.freeze({
        contractVersion: positiveInteger(
          row.contract_version,
          "TOKEN_VAULT_RUNTIME_GUARD",
        ),
        usedKeyVersions: Object.freeze(
          (row.used_key_versions ?? []).map((value) =>
            positiveInteger(value, "TOKEN_VAULT_RUNTIME_GUARD"),
          ),
        ),
      });
    },

    async storePkce(value) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.store_oauth_pkce_envelope(
            $1::uuid, $2::uuid, $3::bigint, $4::text,
            $5::bytea, $6::bytea, $7::bytea, $8::smallint, $9::timestamptz
          )`,
          [
            value.recordId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.ciphertext,
            value.nonce,
            value.authTag,
            value.keyVersion,
            value.expiresAt,
          ],
        ),
        "OAUTH_PKCE_ENVELOPE_STORE",
      );
      return row.stored === true;
    },

    async takePkce({transactionId, workspaceId, installGeneration, provider, takenAt}) {
      const row = optionalOneRow(
        await query(
          `select * from integrations.take_oauth_pkce_envelope(
            $1::uuid, $2::uuid, $3::bigint, $4::text, $5::timestamptz
          )`,
          [transactionId, workspaceId, installGeneration, provider, takenAt],
        ),
        "OAUTH_PKCE_ENVELOPE_TAKE",
      );
      return envelope(row, "pkce_verifier");
    },

    async deletePkce(transactionId) {
      const row = exactlyOneRow(
        await query(
          "select * from integrations.delete_oauth_pkce_envelope($1::uuid)",
          [transactionId],
        ),
        "OAUTH_PKCE_ENVELOPE_DELETE",
      );
      return row.deleted === true;
    },

    async storeCredential(value) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.store_provider_credential_envelope(
            $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text,
            $6::bytea, $7::bytea, $8::bytea, $9::smallint, $10::timestamptz
          )`,
          [
            value.recordId,
            value.workspaceId,
            value.installGeneration,
            value.provider,
            value.purpose,
            value.ciphertext,
            value.nonce,
            value.authTag,
            value.keyVersion,
            value.expiresAt,
          ],
        ),
        "PROVIDER_CREDENTIAL_ENVELOPE_STORE",
      );
      return row.credential_id;
    },

    async loadCredential({recordId, workspaceId, installGeneration, provider}) {
      const row = optionalOneRow(
        await query(
          `select * from integrations.load_provider_credential_envelope(
            $1::uuid, $2::uuid, $3::bigint, $4::text
          )`,
          [recordId, workspaceId, installGeneration, provider],
        ),
        "PROVIDER_CREDENTIAL_ENVELOPE_LOAD",
      );
      return envelope(row, "provider_token_set");
    },

    async deleteCredential({recordId, workspaceId, installGeneration, provider}) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.delete_provider_credential_envelope(
            $1::uuid, $2::uuid, $3::bigint, $4::text
          )`,
          [recordId, workspaceId, installGeneration, provider],
        ),
        "PROVIDER_CREDENTIAL_ENVELOPE_DELETE",
      );
      return row.deleted === true;
    },
  });
}
