function requiredQuery(database) {
  if (!database || typeof database.query !== "function") {
    throw new TypeError("database.query is required");
  }
  return database.query.bind(database);
}

function one(result, operation) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(operation + "_RESULT_INVALID");
  }
  return result.rows[0];
}

function lifecycle(row) {
  return Object.freeze({
    connectionId: row.connection_id,
    status: row.lifecycle_status,
    version: Number(row.connection_version),
    credentialId: row.credential_id ?? null,
    lifecycleChangedAt: row.lifecycle_changed_at instanceof Date
      ? row.lifecycle_changed_at.toISOString()
      : row.lifecycle_changed_at,
    disconnectedAt: row.disconnected_at instanceof Date
      ? row.disconnected_at.toISOString()
      : row.disconnected_at ?? null,
    disconnectReason: row.disconnect_reason ?? null,
  });
}

export function createProviderConnectionLifecycleRepository(database) {
  const query = requiredQuery(database);
  return Object.freeze({
    async load(value) {
      const result = await query(
        `select * from integrations.load_provider_connection_lifecycle(
          $1::uuid, $2::uuid, $3::bigint, $4::text
        )`,
        [
          value.connectionId, value.workspaceId,
          value.installGeneration, value.provider,
        ],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
        throw new Error("PROVIDER_CONNECTION_LIFECYCLE_LOAD_RESULT_INVALID");
      }
      return result.rows[0] ? lifecycle(result.rows[0]) : null;
    },

    async transition(value) {
      return lifecycle(one(await query(
        `select * from integrations.transition_provider_connection_lifecycle(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text,
          $6::bigint, $7::text, $8::text, $9::text, $10::timestamptz
        )`,
        [
          value.eventId, value.connectionId, value.workspaceId,
          value.installGeneration, value.provider, value.expectedVersion,
          value.eventType, value.reason, value.outcome, value.occurredAt,
        ],
      ), "PROVIDER_CONNECTION_LIFECYCLE_TRANSITION"));
    },

    async renew(value) {
      return lifecycle(one(await query(
        `select * from integrations.renew_provider_connection_credential(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text,
          $6::bigint, $7::uuid, $8::uuid, $9::text[], $10::timestamptz
        )`,
        [
          value.eventId, value.connectionId, value.workspaceId,
          value.installGeneration, value.provider, value.expectedVersion,
          value.expectedCredentialId, value.newCredentialId,
          value.grantedScopes, value.verifiedAt,
        ],
      ), "PROVIDER_CONNECTION_CREDENTIAL_RENEW"));
    },

    async finalizeDisconnect(value) {
      return lifecycle(one(await query(
        `select * from integrations.finalize_provider_disconnect(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text,
          $6::bigint, $7::text, $8::text, $9::timestamptz
        )`,
        [
          value.eventId, value.connectionId, value.workspaceId,
          value.installGeneration, value.provider, value.expectedVersion,
          value.outcome, value.reason, value.occurredAt,
        ],
      ), "PROVIDER_CONNECTION_DISCONNECT_FINALIZE"));
    },

    async reconnect(value) {
      return lifecycle(one(await query(
        `select * from integrations.reconnect_provider_connection(
          $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text,
          $6::bigint, $7::uuid, $8::text[], $9::jsonb, $10::text,
          $11::timestamptz
        )`,
        [
          value.eventId, value.connectionId, value.workspaceId,
          value.installGeneration, value.provider, value.expectedVersion,
          value.credentialId, value.grantedScopes,
          JSON.stringify(value.accounts), value.reportingAccountId,
          value.verifiedAt,
        ],
      ), "PROVIDER_CONNECTION_RECONNECT"));
    },
  });
}
