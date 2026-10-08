function requiredQuery(database) {
  if (!database || typeof database.query !== "function") {
    throw new TypeError("database.query is required");
  }
  return database.query.bind(database);
}

function booleanResult(result, field, operation) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(`${operation}_RESULT_INVALID`);
  }
  if (result.rows[0][field] !== true) {
    throw new Error(`${operation}_RESULT_INVALID`);
  }
  return true;
}

function mapEnvelope(row) {
  return Object.freeze({
    sessionId: row.session_id,
    shopDomain: row.shop_domain,
    payloadCiphertext: row.payload_ciphertext,
    nonce: row.nonce,
    authTag: row.auth_tag,
    keyVersion: Number(row.key_version),
    expiresAt: row.expires_at ?? null,
  });
}

export function createShopifySessionRepository(database) {
  const query = requiredQuery(database);

  return Object.freeze({
    async store(envelope) {
      return booleanResult(
        await query(
          `select shopify.store_runtime_session(
            $1::text, $2::text, $3::bytea, $4::bytea, $5::bytea,
            $6::smallint, $7::timestamptz
          ) as stored`,
          [
            envelope.sessionId,
            envelope.shopDomain,
            envelope.payloadCiphertext,
            envelope.nonce,
            envelope.authTag,
            envelope.keyVersion,
            envelope.expiresAt,
          ],
        ),
        "stored",
        "RUNTIME_SESSION_STORE",
      );
    },

    async load(sessionId) {
      const result = await query(
        "select * from shopify.load_runtime_session($1::text)",
        [sessionId],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
        throw new Error("RUNTIME_SESSION_LOAD_RESULT_INVALID");
      }
      return result.rows.length === 0 ? undefined : mapEnvelope(result.rows[0]);
    },

    async delete(sessionId) {
      return booleanResult(
        await query(
          "select shopify.delete_runtime_session($1::text) as deleted",
          [sessionId],
        ),
        "deleted",
        "RUNTIME_SESSION_DELETE",
      );
    },

    async deleteMany(sessionIds) {
      return booleanResult(
        await query(
          "select shopify.delete_runtime_sessions($1::text[]) as deleted",
          [sessionIds],
        ),
        "deleted",
        "RUNTIME_SESSION_DELETE_MANY",
      );
    },

    async findByShop(shopDomain) {
      const result = await query(
        "select * from shopify.find_runtime_sessions_by_shop($1::text)",
        [shopDomain],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length > 25) {
        throw new Error("RUNTIME_SESSION_FIND_RESULT_INVALID");
      }
      return result.rows.map(mapEnvelope);
    },
  });
}
