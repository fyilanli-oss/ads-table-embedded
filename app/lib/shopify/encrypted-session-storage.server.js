import {
  createSessionEnvelopeCipher,
  readSessionEncryptionKey,
} from "./session-envelope.server.js";
import {
  createShopifySessionRepository,
} from "../database/shopify-session-repository.server.js";

export function createEncryptedShopifySessionStorage({
  database,
  environment = process.env,
  cipher,
  repository,
} = {}) {
  const envelopeCipher = cipher ?? createSessionEnvelopeCipher({
    key: readSessionEncryptionKey(environment),
  });
  const sessions = repository ?? createShopifySessionRepository(database);

  return Object.freeze({
    async storeSession(session) {
      await sessions.store(envelopeCipher.encrypt(session));
      return true;
    },

    async loadSession(sessionId) {
      const envelope = await sessions.load(sessionId);
      return envelope ? envelopeCipher.decrypt(envelope) : undefined;
    },

    async deleteSession(sessionId) {
      await sessions.delete(sessionId);
      return true;
    },

    async deleteSessions(sessionIds) {
      if (!Array.isArray(sessionIds)) throw new TypeError("sessionIds must be an array");
      await sessions.deleteMany(sessionIds);
      return true;
    },

    async findSessionsByShop(shopDomain) {
      const envelopes = await sessions.findByShop(shopDomain);
      return envelopes.map((envelope) => envelopeCipher.decrypt(envelope));
    },
  });
}
