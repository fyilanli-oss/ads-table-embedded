import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {Session} from "@shopify/shopify-api";

const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SESSION_ID_PATTERN = /^.{1,255}$/s;
const KEY_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const KEY_ENVIRONMENT = "ADSTABLE_SESSION_ENCRYPTION_KEY_V1";

function invalidKey() {
  return new Error("ADSTABLE_SESSION_ENCRYPTION_KEY_V1_INVALID");
}

function requiredText(value, pattern, errorCode) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function requiredBuffer(value, length, errorCode) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (length === null ? buffer.length === 0 : buffer.length !== length) {
    throw new Error(errorCode);
  }
  return buffer;
}

function additionalAuthenticatedData(sessionId, shopDomain, keyVersion) {
  return Buffer.from(
    `adstable-shopify-session:v${keyVersion}:${sessionId}:${shopDomain}`,
    "utf8",
  );
}

export function readSessionEncryptionKey(environment = process.env) {
  const encoded = environment?.[KEY_ENVIRONMENT];
  if (typeof encoded !== "string" || !KEY_PATTERN.test(encoded)) throw invalidKey();

  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) throw invalidKey();
  return key;
}

export function createSessionEnvelopeCipher({
  key,
  keyVersion = KEY_VERSION,
  randomBytesFn = randomBytes,
} = {}) {
  const encryptionKey = requiredBuffer(key, 32, "SESSION_ENCRYPTION_KEY_INVALID");
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new Error("SESSION_ENCRYPTION_KEY_VERSION_INVALID");
  }

  return Object.freeze({
    encrypt(session) {
      const sessionId = requiredText(session?.id, SESSION_ID_PATTERN, "SESSION_ID_INVALID");
      const shopDomain = requiredText(
        session?.shop,
        SHOP_DOMAIN_PATTERN,
        "SESSION_SHOP_DOMAIN_INVALID",
      );
      if (typeof session?.toPropertyArray !== "function") {
        throw new Error("SHOPIFY_SESSION_REQUIRED");
      }

      const nonce = requiredBuffer(randomBytesFn(12), 12, "SESSION_NONCE_INVALID");
      const aad = additionalAuthenticatedData(sessionId, shopDomain, keyVersion);
      const plaintext = Buffer.from(
        JSON.stringify(session.toPropertyArray(true)),
        "utf8",
      );
      try {
        const cipher = createCipheriv(ALGORITHM, encryptionKey, nonce);
        cipher.setAAD(aad);
        const payloadCiphertext = Buffer.concat([
          cipher.update(plaintext),
          cipher.final(),
        ]);
        return Object.freeze({
          sessionId,
          shopDomain,
          payloadCiphertext,
          nonce,
          authTag: cipher.getAuthTag(),
          keyVersion,
          expiresAt: session.expires instanceof Date
            ? session.expires.toISOString()
            : null,
        });
      } finally {
        plaintext.fill(0);
      }
    },

    decrypt(envelope) {
      const sessionId = requiredText(
        envelope?.sessionId,
        SESSION_ID_PATTERN,
        "SESSION_ID_INVALID",
      );
      const shopDomain = requiredText(
        envelope?.shopDomain,
        SHOP_DOMAIN_PATTERN,
        "SESSION_SHOP_DOMAIN_INVALID",
      );
      if (envelope?.keyVersion !== keyVersion) {
        throw new Error("SESSION_ENCRYPTION_KEY_VERSION_UNAVAILABLE");
      }

      const payloadCiphertext = requiredBuffer(
        envelope.payloadCiphertext,
        null,
        "SESSION_CIPHERTEXT_INVALID",
      );
      const nonce = requiredBuffer(envelope.nonce, 12, "SESSION_NONCE_INVALID");
      const authTag = requiredBuffer(envelope.authTag, 16, "SESSION_AUTH_TAG_INVALID");
      const decipher = createDecipheriv(ALGORITHM, encryptionKey, nonce);
      decipher.setAAD(additionalAuthenticatedData(sessionId, shopDomain, keyVersion));
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([
        decipher.update(payloadCiphertext),
        decipher.final(),
      ]);
      try {
        const properties = JSON.parse(plaintext.toString("utf8"));
        const session = Session.fromPropertyArray(properties, true);
        if (session.id !== sessionId || session.shop !== shopDomain) {
          throw new Error("SESSION_ENVELOPE_IDENTITY_MISMATCH");
        }
        return session;
      } finally {
        plaintext.fill(0);
      }
    },
  });
}

export const SHOPIFY_SESSION_KEY_ENVIRONMENT = KEY_ENVIRONMENT;
