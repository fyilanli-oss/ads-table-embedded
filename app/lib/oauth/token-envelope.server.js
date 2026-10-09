import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_PREFIX = "ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V";
const ACTIVE_VERSION_ENV = "ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION";
const SESSION_KEY_ENV = "ADSTABLE_SESSION_ENCRYPTION_KEY_V1";
const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const PURPOSES = new Set(["pkce_verifier", "provider_token_set"]);
const ALGORITHM = "aes-256-gcm";
const CONTRACT_VERSION = 1;

function requiredIdentity(identity) {
  if (
    !identity
    || !UUID_PATTERN.test(identity.recordId || "")
    || !UUID_PATTERN.test(identity.workspaceId || "")
    || !Number.isSafeInteger(identity.installGeneration)
    || identity.installGeneration < 1
    || !PROVIDERS.has(identity.provider)
    || !PURPOSES.has(identity.purpose)
  ) {
    throw new Error("TOKEN_ENVELOPE_IDENTITY_INVALID");
  }
  return identity;
}

function requiredBuffer(value, length, errorCode) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (length === null ? buffer.length === 0 : buffer.length !== length) {
    throw new Error(errorCode);
  }
  return buffer;
}

function decodeKey(encoded) {
  if (typeof encoded !== "string" || !KEY_PATTERN.test(encoded)) {
    throw new Error("PROVIDER_TOKEN_ENCRYPTION_KEY_INVALID");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new Error("PROVIDER_TOKEN_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

function aad(identity, keyVersion) {
  return Buffer.from(
    [
      "adstable-provider-vault",
      `contract=${CONTRACT_VERSION}`,
      `key=${keyVersion}`,
      `record=${identity.recordId}`,
      `workspace=${identity.workspaceId}`,
      `generation=${identity.installGeneration}`,
      `provider=${identity.provider}`,
      `purpose=${identity.purpose}`,
    ].join(":"),
    "utf8",
  );
}

export function readProviderTokenKeyring(environment = process.env) {
  const activeVersion = Number(environment?.[ACTIVE_VERSION_ENV]);
  if (!Number.isSafeInteger(activeVersion) || activeVersion < 1 || activeVersion > 32767) {
    throw new Error("PROVIDER_TOKEN_ACTIVE_KEY_VERSION_INVALID");
  }

  const keys = new Map();
  for (const [name, value] of Object.entries(environment ?? {})) {
    if (!name.startsWith(KEY_PREFIX)) continue;
    const versionText = name.slice(KEY_PREFIX.length);
    if (!/^[1-9][0-9]{0,4}$/.test(versionText)) {
      throw new Error("PROVIDER_TOKEN_KEY_VERSION_INVALID");
    }
    const version = Number(versionText);
    if (version > 32767 || keys.has(version)) {
      throw new Error("PROVIDER_TOKEN_KEY_VERSION_INVALID");
    }
    keys.set(version, decodeKey(value));
  }
  if (!keys.has(activeVersion)) {
    throw new Error("PROVIDER_TOKEN_ACTIVE_KEY_UNAVAILABLE");
  }

  const fingerprints = new Set();
  for (const key of keys.values()) {
    const fingerprint = key.toString("base64url");
    if (fingerprints.has(fingerprint)) {
      throw new Error("PROVIDER_TOKEN_KEY_REUSED_ACROSS_VERSIONS");
    }
    fingerprints.add(fingerprint);
  }

  const encodedSessionKey = environment?.[SESSION_KEY_ENV];
  if (typeof encodedSessionKey === "string" && KEY_PATTERN.test(encodedSessionKey)) {
    const sessionKey = Buffer.from(encodedSessionKey, "base64url");
    for (const key of keys.values()) {
      if (sessionKey.length === key.length && timingSafeEqual(sessionKey, key)) {
        throw new Error("PROVIDER_TOKEN_KEY_MUST_DIFFER_FROM_SESSION_KEY");
      }
    }
  }

  return Object.freeze({
    activeVersion,
    versions: Object.freeze([...keys.keys()].sort((a, b) => a - b)),
    has(version) {
      return keys.has(version);
    },
    get(version) {
      const key = keys.get(version);
      if (!key) throw new Error("PROVIDER_TOKEN_KEY_VERSION_UNAVAILABLE");
      return key;
    },
  });
}

export function createTokenEnvelopeCipher({
  keyring,
  randomBytesFn = randomBytes,
  randomUUIDFn = randomUUID,
} = {}) {
  if (!keyring || typeof keyring.get !== "function" || typeof keyring.has !== "function") {
    throw new TypeError("keyring is required");
  }
  if (typeof randomBytesFn !== "function") throw new TypeError("randomBytesFn is required");
  if (typeof randomUUIDFn !== "function") throw new TypeError("randomUUIDFn is required");

  return Object.freeze({
    seal({identity, secret}) {
      const bound = requiredIdentity(identity);
      if (typeof secret !== "string" || secret.length < 1 || secret.length > 65536) {
        throw new Error("TOKEN_ENVELOPE_SECRET_INVALID");
      }
      const keyVersion = keyring.activeVersion;
      const nonce = requiredBuffer(
        randomBytesFn(12),
        12,
        "TOKEN_ENVELOPE_NONCE_INVALID",
      );
      const plaintext = Buffer.from(secret, "utf8");
      try {
        const cipher = createCipheriv(ALGORITHM, keyring.get(keyVersion), nonce);
        cipher.setAAD(aad(bound, keyVersion));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return Object.freeze({
          ...bound,
          ciphertext,
          nonce,
          authTag: cipher.getAuthTag(),
          keyVersion,
        });
      } finally {
        plaintext.fill(0);
      }
    },

    open(envelope) {
      const bound = requiredIdentity(envelope);
      const keyVersion = envelope?.keyVersion;
      if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || keyVersion > 32767) {
        throw new Error("TOKEN_ENVELOPE_KEY_VERSION_INVALID");
      }
      const ciphertext = requiredBuffer(
        envelope.ciphertext,
        null,
        "TOKEN_ENVELOPE_CIPHERTEXT_INVALID",
      );
      const nonce = requiredBuffer(envelope.nonce, 12, "TOKEN_ENVELOPE_NONCE_INVALID");
      const authTag = requiredBuffer(
        envelope.authTag,
        16,
        "TOKEN_ENVELOPE_AUTH_TAG_INVALID",
      );

      try {
        const decipher = createDecipheriv(ALGORITHM, keyring.get(keyVersion), nonce);
        decipher.setAAD(aad(bound, keyVersion));
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        try {
          return plaintext.toString("utf8");
        } finally {
          plaintext.fill(0);
        }
      } catch (error) {
        if (error?.message === "PROVIDER_TOKEN_KEY_VERSION_UNAVAILABLE") throw error;
        throw new Error("TOKEN_ENVELOPE_AUTHENTICATION_FAILED");
      }
    },

    createRecordId() {
      return randomUUIDFn();
    },
  });
}

export const PROVIDER_TOKEN_ACTIVE_VERSION_ENVIRONMENT = ACTIVE_VERSION_ENV;
export const PROVIDER_TOKEN_KEY_ENVIRONMENT_PREFIX = KEY_PREFIX;
export const TOKEN_VAULT_CONTRACT_VERSION = CONTRACT_VERSION;
