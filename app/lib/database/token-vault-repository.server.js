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

    async deletePkce({transactionId, workspaceId, installGeneration, provider}) {
      const row = exactlyOneRow(
        await query(
          `select * from integrations.delete_oauth_pkce_envelope(
            $1::uuid, $2::uuid, $3::bigint, $4::text
          )`,
          [transactionId, workspaceId, installGeneration, provider],
        ),
        "OAUTH_PKCE_ENVELOPE_DELETE",
      );
      return row.deleted === true;
    },

    async commitGoogleIdentityRenewal(value) {
      return exactlyOneRow(await query(
        `select * from integrations.commit_google_identity_renewal(
          $1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::bigint,$6::uuid,$7::uuid,
          $8::text[],$9::timestamptz,$10::bytea,$11::bytea,$12::bytea,$13::smallint,$14::timestamptz)`,
        [value.renewalId,value.workspaceId,value.installGeneration,value.connectionId,
          value.expectedVersion,value.expectedCredentialId,value.recordId,value.scopes,
          value.verifiedAt,value.ciphertext,value.nonce,value.authTag,value.keyVersion,value.expiresAt]),
      "GOOGLE_IDENTITY_RENEWAL_COMMIT");
    },

    async readGoogleIdentityRenewal(value) {
      return optionalOneRow(await query(
        `select * from integrations.read_google_identity_renewal($1::uuid,$2::uuid,$3::bigint)`,
        [value.renewalId,value.workspaceId,value.installGeneration]), "GOOGLE_IDENTITY_RENEWAL_RECEIPT");
    },

    async commitIdentityCredential(value) {
      return exactlyOneRow(await query(
        `select * from integrations.commit_identity_oauth_credential(
          $1::uuid,$2::uuid,$3::bigint,$4::text,$5::uuid,$6::uuid,$7::bigint,
          $8::uuid,$9::text[],$10::jsonb,$11::timestamptz,$12::bytea,$13::bytea,
          $14::bytea,$15::smallint,$16::timestamptz)`,
        [value.transactionId,value.workspaceId,value.installGeneration,value.provider,
          value.connectionId,value.binding.connectionId,value.binding.version,value.recordId,
          value.scopes,JSON.stringify(value.accounts),value.verifiedAt,value.ciphertext,
          value.nonce,value.authTag,value.keyVersion,value.expiresAt]), "IDENTITY_OAUTH_COMMIT");
    },

    async readIdentityCommit(value) {
      return optionalOneRow(await query(
        `select * from integrations.read_identity_oauth_commit($1::uuid,$2::uuid,$3::bigint,$4::text)`,
        [value.transactionId,value.workspaceId,value.installGeneration,value.provider]), "IDENTITY_OAUTH_RECEIPT");
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
