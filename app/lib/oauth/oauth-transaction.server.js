import {createHash, randomBytes} from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const PKCE_PROVIDERS = new Set(["google_ads", "klaviyo"]);

export const OAUTH_CALLBACK_URIS = Object.freeze({
  meta: "https://embedded.adstable.app/auth/meta/callback",
  google_ads: "https://embedded.adstable.app/auth/google-ads/callback",
  klaviyo: "https://embedded.adstable.app/auth/klaviyo/callback",
});

function isoNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
}

function providerName(value) {
  if (!PROVIDERS.has(value)) throw new Error("OAUTH_PROVIDER_UNSUPPORTED");
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
    throw new Error("VERIFIED_ACTIVE_INSTALLATION_REQUIRED");
  }
  return Object.freeze({
    workspaceId: value.workspaceId,
    installGeneration: value.installGeneration,
  });
}

function requiredMethod(value, method, label) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(label + "." + method + " is required");
  }
}

function bytes32(value, label) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new Error(label + "_MUST_RETURN_32_BYTES");
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function base64url(value) {
  return value.toString("base64url");
}

function publicResult(transaction, state, pkceChallenge) {
  return Object.freeze({
    transactionId: transaction.transactionId,
    provider: transaction.provider,
    state,
    callbackUri: transaction.callbackUri,
    expiresAt: transaction.expiresAt,
    pkceChallenge,
    pkceMethod: pkceChallenge ? "S256" : null,
  });
}

export function oauthInstallationAuthority(installation) {
  if (
    !installation
    || installation.status !== "active"
    || !UUID_PATTERN.test(installation.workspaceId || "")
    || !Number.isSafeInteger(installation.installGeneration)
    || installation.installGeneration < 1
  ) {
    throw new Error("ACTIVE_INSTALLATION_REQUIRED");
  }
  return Object.freeze({
    authority: "shopify_installation_verified",
    workspaceId: installation.workspaceId,
    installGeneration: installation.installGeneration,
    status: "active",
  });
}

export function createOAuthTransactionBoundary({
  repository,
  verifierVault,
  now = () => new Date(),
  randomBytesFn = randomBytes,
}) {
  for (const method of ["create", "markRedirected", "claim", "complete", "invalidate"]) {
    requiredMethod(repository, method, "repository");
  }
  for (const method of ["assertReady", "store", "take", "remove"]) {
    requiredMethod(verifierVault, method, "verifierVault");
  }
  if (typeof randomBytesFn !== "function") {
    throw new TypeError("randomBytesFn is required");
  }

  return Object.freeze({
    async begin({installationAuthority, provider}) {
      const owner = authority(installationAuthority);
      const selectedProvider = providerName(provider);
      await verifierVault.assertReady(selectedProvider);

      const stateBytes = bytes32(randomBytesFn(32), "STATE_GENERATOR");
      const nonceBytes = bytes32(randomBytesFn(32), "NONCE_GENERATOR");
      const state = base64url(stateBytes);
      const pkceRequired = PKCE_PROVIDERS.has(selectedProvider);
      const verifier = pkceRequired
        ? base64url(bytes32(randomBytesFn(32), "PKCE_GENERATOR"))
        : null;
      const challenge = verifier
        ? base64url(sha256(Buffer.from(verifier, "ascii")))
        : null;
      const createdAt = isoNow(now);

      const transaction = await repository.create({
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: selectedProvider,
        stateDigest: sha256(Buffer.from(state, "ascii")),
        transactionNonce: nonceBytes,
        pkceChallenge: challenge,
        createdAt,
      });
      const expectedCallback = OAUTH_CALLBACK_URIS[selectedProvider];
      if (
        transaction.status !== "created"
        || transaction.callbackUri !== expectedCallback
        || transaction.pkceRequired !== pkceRequired
      ) {
        await repository.invalidate({
          transactionId: transaction.transactionId,
          failureCode: "PERSISTED_TRANSACTION_MISMATCH",
          completedAt: isoNow(now),
        });
        throw new Error("OAUTH_TRANSACTION_PERSISTENCE_MISMATCH");
      }

      try {
        if (verifier) {
          await verifierVault.store(transaction.transactionId, verifier);
        }
        const redirected = await repository.markRedirected(
          transaction.transactionId,
          isoNow(now),
        );
        if (redirected.status !== "redirected") {
          throw new Error("OAUTH_REDIRECT_TRANSITION_REJECTED");
        }
      } catch (error) {
        await verifierVault.remove(transaction.transactionId);
        try {
          await repository.invalidate({
            transactionId: transaction.transactionId,
            failureCode: "AUTHORIZATION_START_FAILED",
            completedAt: isoNow(now),
          });
        } catch {
          // The database state machine remains authoritative.
        }
        throw error;
      }

      return publicResult(
        {...transaction, provider: selectedProvider},
        state,
        challenge,
      );
    },

    async claimCallback({provider, state, code, providerError}) {
      const selectedProvider = providerName(provider);
      if (typeof state !== "string" || state.length < 43 || state.length > 128) {
        throw new Error("OAUTH_STATE_INVALID");
      }
      const claimedAt = isoNow(now);
      const claimed = await repository.claim({
        provider: selectedProvider,
        stateDigest: sha256(Buffer.from(state, "ascii")),
        claimedAt,
      });
      if (claimed.status !== "claimed") {
        throw new Error("OAUTH_TRANSACTION_" + String(claimed.status).toUpperCase());
      }
      if (
        claimed.provider !== selectedProvider
        || claimed.callbackUri !== OAUTH_CALLBACK_URIS[selectedProvider]
      ) {
        await repository.complete({
          transactionId: claimed.transactionId,
          outcome: "invalidated",
          failureCode: "CLAIM_AUTHORITY_MISMATCH",
          completedAt: isoNow(now),
        });
        throw new Error("OAUTH_CLAIM_AUTHORITY_MISMATCH");
      }

      if (providerError) {
        await verifierVault.remove(claimed.transactionId);
        await repository.complete({
          transactionId: claimed.transactionId,
          outcome: "denied",
          failureCode: "PROVIDER_CONSENT_DENIED",
          completedAt: isoNow(now),
        });
        return Object.freeze({
          transactionId: claimed.transactionId,
          status: "denied",
        });
      }

      if (typeof code !== "string" || code.length < 1 || code.length > 4096) {
        await verifierVault.remove(claimed.transactionId);
        await repository.complete({
          transactionId: claimed.transactionId,
          outcome: "failed",
          failureCode: "AUTHORIZATION_CODE_MISSING",
          completedAt: isoNow(now),
        });
        throw new Error("OAUTH_AUTHORIZATION_CODE_REQUIRED");
      }

      const verifier = claimed.pkceRequired
        ? await verifierVault.take(claimed.transactionId)
        : null;
      if (claimed.pkceRequired && !verifier) {
        await repository.complete({
          transactionId: claimed.transactionId,
          outcome: "failed",
          failureCode: "PKCE_VERIFIER_UNAVAILABLE",
          completedAt: isoNow(now),
        });
        throw new Error("OAUTH_PKCE_VERIFIER_UNAVAILABLE");
      }

      return Object.freeze({
        transactionId: claimed.transactionId,
        workspaceId: claimed.workspaceId,
        installGeneration: claimed.installGeneration,
        provider: selectedProvider,
        callbackUri: claimed.callbackUri,
        authorizationCode: code,
        pkceVerifier: verifier,
        status: "claimed",
      });
    },

    async finalizeExchange({transactionId, success}) {
      if (!UUID_PATTERN.test(transactionId || "")) {
        throw new Error("OAUTH_TRANSACTION_ID_INVALID");
      }
      const result = await repository.complete({
        transactionId,
        outcome: success ? "exchanged" : "failed",
        failureCode: success ? null : "PROVIDER_EXCHANGE_FAILED",
        completedAt: isoNow(now),
      });
      await verifierVault.remove(transactionId);
      return result;
    },
  });
}
