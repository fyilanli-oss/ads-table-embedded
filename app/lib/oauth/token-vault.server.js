import {identityOAuthBinding, validateIdentityOAuthGrantedScopes} from "./oauth-permission-profile.server.js";
import {
  createTokenEnvelopeCipher,
  readProviderTokenKeyring,
  TOKEN_VAULT_CONTRACT_VERSION,
} from "./token-envelope.server.js";
import {
  createTokenVaultRepository,
} from "../database/token-vault-repository.server.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const SELF_TEST_RECORD_ID = "00000000-0000-4000-8000-000000000001";
const SELF_TEST_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

function providerName(value) {
  if (!PROVIDERS.has(value)) throw new Error("TOKEN_VAULT_PROVIDER_UNSUPPORTED");
  return value;
}

function authority(value) {
  if (
    !value
    || value.authority !== "shopify_installation_verified"
    || value.status !== "active"
    || !UUID_PATTERN.test(value.workspaceId || "")
    || !Number.isSafeInteger(value.installGeneration)
    || value.installGeneration < 1
  ) {
    throw new Error("TOKEN_VAULT_VERIFIED_INSTALLATION_REQUIRED");
  }
  return value;
}

function isoNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
}

function requiredDate(value, errorCode) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.valueOf())) {
    throw new Error(errorCode);
  }
  return date.toISOString();
}

function tokenSetJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PROVIDER_TOKEN_SET_INVALID");
  }
  const serialized = JSON.stringify(value);
  if (
    serialized.length < 2
    || serialized.length > 65536
    || !/(?:access_token|refresh_token|token)/i.test(serialized)
  ) {
    throw new Error("PROVIDER_TOKEN_SET_INVALID");
  }
  return serialized;
}

export function createTokenVault({
  database,
  environment = process.env,
  repository,
  keyring,
  cipher,
  now = () => new Date(),
} = {}) {
  const resolvedKeyring = keyring ?? readProviderTokenKeyring(environment);
  const envelopeCipher = cipher ?? createTokenEnvelopeCipher({keyring: resolvedKeyring});
  const envelopes = repository ?? createTokenVaultRepository(database);
  let guardPromise;

  async function runGuard() {
    const guard = await envelopes.assertContract(TOKEN_VAULT_CONTRACT_VERSION);
    if (guard.contractVersion !== TOKEN_VAULT_CONTRACT_VERSION) {
      throw new Error("TOKEN_VAULT_CONTRACT_VERSION_MISMATCH");
    }
    for (const version of guard.usedKeyVersions) {
      if (!resolvedKeyring.has(version)) {
        throw new Error("PROVIDER_TOKEN_KEY_VERSION_UNAVAILABLE");
      }
    }

    const testIdentity = {
      recordId: SELF_TEST_RECORD_ID,
      workspaceId: SELF_TEST_WORKSPACE_ID,
      installGeneration: 1,
      provider: "meta",
      purpose: "provider_token_set",
    };
    const sealed = envelopeCipher.seal({
      identity: testIdentity,
      secret: '{"token":"startup-guard-self-test"}',
    });
    if (envelopeCipher.open(sealed) !== '{"token":"startup-guard-self-test"}') {
      throw new Error("TOKEN_VAULT_CRYPTO_SELF_TEST_FAILED");
    }
    return Object.freeze({
      contractVersion: guard.contractVersion,
      activeKeyVersion: resolvedKeyring.activeVersion,
      readableKeyVersions: resolvedKeyring.versions,
    });
  }

  async function assertRuntimeReady() {
    guardPromise ??= runGuard().catch((error) => {
      guardPromise = undefined;
      throw error;
    });
    return guardPromise;
  }

  async function assertReady(provider) {
    providerName(provider);
    return assertRuntimeReady();
  }

  return Object.freeze({
    assertRuntimeReady,
    assertReady,

    async store(transactionId, verifier, context) {
      await assertReady(context?.provider);
      if (!UUID_PATTERN.test(transactionId || "")) {
        throw new Error("OAUTH_TRANSACTION_ID_INVALID");
      }
      const expiresAt = requiredDate(
        context?.expiresAt,
        "OAUTH_PKCE_EXPIRY_INVALID",
      );
      const sealed = envelopeCipher.seal({
        identity: {
          recordId: transactionId,
          workspaceId: context?.workspaceId,
          installGeneration: context?.installGeneration,
          provider: context?.provider,
          purpose: "pkce_verifier",
        },
        secret: verifier,
      });
      const stored = await envelopes.storePkce({...sealed, expiresAt});
      if (!stored) throw new Error("OAUTH_PKCE_ENVELOPE_STORE_FAILED");
    },

    async take(transactionId, context) {
      await assertReady(context?.provider);
      const envelope = await envelopes.takePkce({
        transactionId,
        workspaceId: context?.workspaceId,
        installGeneration: context?.installGeneration,
        provider: context?.provider,
        takenAt: isoNow(now),
      });
      return envelope ? envelopeCipher.open(envelope) : null;
    },

    async remove(transactionId, context) {
      if (!UUID_PATTERN.test(transactionId || "")) {
        throw new Error("OAUTH_TRANSACTION_ID_INVALID");
      }
      const selectedProvider = providerName(context?.provider);
      if (
        !UUID_PATTERN.test(context?.workspaceId || "")
        || !Number.isSafeInteger(context?.installGeneration)
        || context.installGeneration < 1
      ) {
        throw new Error("OAUTH_PKCE_AUTHORITY_INVALID");
      }
      await envelopes.deletePkce({
        transactionId,
        workspaceId: context.workspaceId,
        installGeneration: context.installGeneration,
        provider: selectedProvider,
      });
    },

    async commitIdentityOAuthCredential({installationAuthority, provider, transactionId,
      connectionId, binding, tokenSet, scopes, accounts, verifiedAt, expiresAt}) {
      const owner = authority(installationAuthority);
      const selectedProvider = providerName(provider);
      if (!UUID_PATTERN.test(transactionId || "") || !UUID_PATTERN.test(connectionId || "")) {
        throw new Error("IDENTITY_OAUTH_COMMIT_INPUT_INVALID");
      }
      const expected = identityOAuthBinding(binding);
      const granted = validateIdentityOAuthGrantedScopes(selectedProvider,
        selectedProvider === "google_ads" ? scopes?.join(" ") : scopes);
      if (tokenSet?.permission_profile !== "identity_v1") throw new Error("IDENTITY_OAUTH_TOKEN_PROFILE_REQUIRED");
      const nativeScopes = validateIdentityOAuthGrantedScopes(selectedProvider,
        selectedProvider === "google_ads" ? tokenSet.scope : tokenSet.scopes);
      if (nativeScopes.length !== granted.length || nativeScopes.some(s => !granted.includes(s))) {
        throw new Error("IDENTITY_OAUTH_TOKEN_SCOPE_MISMATCH");
      }
      const expires = requiredDate(expiresAt,"IDENTITY_OAUTH_EXPIRY_REQUIRED");
      const verified = requiredDate(verifiedAt,"IDENTITY_OAUTH_VERIFICATION_REQUIRED");
      if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > 1000
        || accounts.some(a => !a || typeof a.id !== "string" || !a.id || a.id !== a.id.trim()
          || a.kind !== "advertiser" || a.reportingEligible !== true)
        || new Set(accounts.map(a=>a.id)).size !== accounts.length) throw new Error("IDENTITY_OAUTH_ACCOUNTS_INVALID");
      // Snapshot all mutable inputs before the first await. No plaintext enters SQL.
      const accountIds = accounts.map(a => ({id:a.id,kind:a.kind,reportingEligible:a.reportingEligible}));
      const recordId = envelopeCipher.createRecordId();
      const sealed = envelopeCipher.seal({identity:{recordId,workspaceId:owner.workspaceId,
        installGeneration:owner.installGeneration,provider:selectedProvider,purpose:"provider_token_set"},
        secret:tokenSetJson(tokenSet)});
      await assertReady(selectedProvider);
      try {
        const row = await envelopes.commitIdentityCredential({...sealed,transactionId,connectionId,
          binding:expected,scopes:[...granted],accounts:accountIds,verifiedAt:verified,expiresAt:expires});
        if (row.credential_id !== recordId || !UUID_PATTERN.test(row.connection_id || "")
          || (expected.connectionId !== null && row.connection_id !== expected.connectionId)
          || !["connected","pending_account_selection"].includes(row.lifecycle_status)
          || Number(row.connection_version) !== (expected.version === null ? 1 : expected.version+1)) {
          throw new Error("IDENTITY_OAUTH_COMMIT_RESULT_INVALID");
        }
        return Object.freeze({connectionId:row.connection_id,credentialId:recordId,
          version:Number(row.connection_version),status:row.lifecycle_status});
      } catch {
        // SQL may have committed. Never delete, finalize failed, retry, refresh or activate.
        throw new Error("IDENTITY_OAUTH_WRITE_UNCONFIRMED");
      }
    },

    async readIdentityOAuthCommit({installationAuthority,provider,transactionId}) {
      const owner = authority(installationAuthority);
      if (!UUID_PATTERN.test(transactionId || "")) throw new Error("OAUTH_TRANSACTION_ID_INVALID");
      const row = await envelopes.readIdentityCommit({transactionId,workspaceId:owner.workspaceId,
        installGeneration:owner.installGeneration,provider:providerName(provider)});
      if (!row) return null; // No receipt is not proof of rollback or permission to replay.
      if (!UUID_PATTERN.test(row.connection_id || "") || !UUID_PATTERN.test(row.credential_id || "")
        || !Number.isSafeInteger(Number(row.connection_version)) || Number(row.connection_version)<1
        || !["connected","pending_account_selection"].includes(row.lifecycle_status)) {
        throw new Error("IDENTITY_OAUTH_RECEIPT_INVALID");
      }
      return Object.freeze({connectionId:row.connection_id,credentialId:row.credential_id,
        version:Number(row.connection_version),status:row.lifecycle_status,
        historicalCommit:true,authorizesActivation:false});
    },

    async storeProviderTokenSet({
      installationAuthority,
      provider,
      tokenSet,
      expiresAt = null,
    }) {
      const owner = authority(installationAuthority);
      const selectedProvider = providerName(provider);
      await assertReady(selectedProvider);
      const recordId = envelopeCipher.createRecordId();
      const sealed = envelopeCipher.seal({
        identity: {
          recordId,
          workspaceId: owner.workspaceId,
          installGeneration: owner.installGeneration,
          provider: selectedProvider,
          purpose: "provider_token_set",
        },
        secret: tokenSetJson(tokenSet),
      });
      const persistedId = await envelopes.storeCredential({
        ...sealed,
        expiresAt: expiresAt === null
          ? null
          : requiredDate(expiresAt, "PROVIDER_TOKEN_EXPIRY_INVALID"),
      });
      if (persistedId !== recordId) {
        throw new Error("PROVIDER_TOKEN_ENVELOPE_ID_MISMATCH");
      }
      return Object.freeze({credentialId: recordId});
    },

    async loadProviderTokenSet({
      credentialId,
      installationAuthority,
      provider,
    }) {
      const owner = authority(installationAuthority);
      const selectedProvider = providerName(provider);
      await assertReady(selectedProvider);
      const envelope = await envelopes.loadCredential({
        recordId: credentialId,
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: selectedProvider,
      });
      if (!envelope) return null;
      const parsed = JSON.parse(envelopeCipher.open(envelope));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("PROVIDER_TOKEN_SET_INVALID");
      }
      return parsed;
    },

    async deleteProviderTokenSet({
      credentialId,
      installationAuthority,
      provider,
    }) {
      const owner = authority(installationAuthority);
      const selectedProvider = providerName(provider);
      await assertReady(selectedProvider);
      return envelopes.deleteCredential({
        recordId: credentialId,
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: selectedProvider,
      });
    },
  });
}
