import {randomUUID} from "node:crypto";
import {
  createProviderConnectionLifecycleRepository,
} from "../database/provider-connection-lifecycle-repository.server.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const DISCONNECT_OUTCOMES = new Set([
  "revoked", "already_invalid", "not_supported", "local_authority_removed",
]);
const MAX_EVIDENCE_AGE_MS = 10 * 60 * 1000;

function uuid(value, code) {
  if (!UUID.test(value || "")) throw new Error(code);
  return value;
}

function provider(value) {
  if (!PROVIDERS.has(value)) {
    throw new Error("PROVIDER_CONNECTION_LIFECYCLE_UNSUPPORTED");
  }
  return value;
}

function authority(value) {
  if (
    !value || value.authority !== "shopify_installation_verified"
    || value.status !== "active" || !UUID.test(value.workspaceId || "")
    || !Number.isSafeInteger(value.installGeneration)
    || value.installGeneration < 1
  ) {
    throw new Error("VERIFIED_ACTIVE_INSTALLATION_REQUIRED");
  }
  return value;
}

function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("PROVIDER_CONNECTION_VERSION_INVALID");
  }
  return value;
}

function text(value, code, maximum = 255) {
  if (
    typeof value !== "string" || value.length < 1
    || value.length > maximum || value !== value.trim()
  ) throw new Error(code);
  return value;
}

function iso(value, code) {
  const date = new Date(value);
  if (
    typeof value !== "string" || Number.isNaN(date.valueOf())
    || date.toISOString() !== value
  ) throw new Error(code);
  return date;
}

function freshEvidence(value, expectedAuthority, selectedProvider, now) {
  if (
    !value || value.authority !== expectedAuthority
    || value.provider !== selectedProvider
  ) throw new Error("VERIFIED_PROVIDER_LIFECYCLE_EVIDENCE_REQUIRED");
  const verifiedAt = iso(value.verifiedAt, "PROVIDER_EVIDENCE_TIME_INVALID");
  const expiresAt = iso(value.expiresAt, "PROVIDER_EVIDENCE_TIME_INVALID");
  const current = now();
  if (
    !(current instanceof Date) || Number.isNaN(current.valueOf())
    || verifiedAt > current || expiresAt <= current
    || current - verifiedAt > MAX_EVIDENCE_AGE_MS
    || expiresAt - verifiedAt > MAX_EVIDENCE_AGE_MS
  ) throw new Error("PROVIDER_LIFECYCLE_EVIDENCE_STALE");
  return verifiedAt.toISOString();
}

function scopes(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new Error("PROVIDER_SCOPES_INVALID");
  }
  const result = values.map((entry) =>
    text(entry, "PROVIDER_SCOPE_INVALID", 200)
  );
  if (new Set(result).size !== result.length) {
    throw new Error("PROVIDER_SCOPE_DUPLICATE");
  }
  return Object.freeze([...result].sort());
}

function safeAccount(value, selectedProvider) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PROVIDER_ACCOUNT_EVIDENCE_INVALID");
  }
  for (const key of [
    "access_token", "refresh_token", "token", "credential_id",
    "workspace_id", "install_generation",
  ]) {
    if (key in value) {
      throw new Error("PROVIDER_ACCOUNT_EVIDENCE_CONTAINS_SECRET_OR_AUTHORITY");
    }
  }
  const kind = text(value.kind, "PROVIDER_ACCOUNT_KIND_INVALID", 20);
  if (!["advertiser", "manager", "account"].includes(kind)) {
    throw new Error("PROVIDER_ACCOUNT_KIND_INVALID");
  }
  if (typeof value.reportingEligible !== "boolean") {
    throw new Error("PROVIDER_ACCOUNT_ELIGIBILITY_INVALID");
  }
  if (
    selectedProvider === "klaviyo"
    && (kind !== "account" || value.reportingEligible !== true)
  ) throw new Error("KLAVIYO_ACCOUNT_EVIDENCE_INVALID");
  return Object.freeze({
    id: text(value.id, "PROVIDER_ACCOUNT_ID_INVALID"),
    name: text(value.name, "PROVIDER_ACCOUNT_NAME_INVALID"),
    kind,
    reporting_eligible: value.reportingEligible,
    status: value.status ?? null,
    currency: value.currency ?? null,
    timezone: value.timezone ?? null,
    login_account_id: value.loginAccountId ?? null,
  });
}

function reconnectSelection(evidence, selectedProvider) {
  if (!Array.isArray(evidence.accounts)) {
    throw new Error("PROVIDER_ACCOUNT_EVIDENCE_INVALID");
  }
  const accounts = evidence.accounts.map((entry) =>
    safeAccount(entry, selectedProvider)
  );
  if (
    accounts.length < 1 || accounts.length > 3
    || new Set(accounts.map((entry) => entry.id)).size !== accounts.length
  ) throw new Error("CONNECTED_ACCOUNT_CARDINALITY_INVALID");

  if (selectedProvider === "klaviyo") {
    if (accounts.length !== 1 || evidence.reportingAccountId != null) {
      throw new Error("KLAVIYO_SINGLE_CONNECTED_ACCOUNT_REQUIRED");
    }
    return {accounts, reportingAccountId: null};
  }

  const reportingAccountId = text(
    evidence.reportingAccountId,
    "REPORTING_ACCOUNT_REQUIRED",
  );
  const reporting = accounts.find((entry) => entry.id === reportingAccountId);
  if (
    !reporting || reporting.kind !== "advertiser"
    || reporting.reporting_eligible !== true
  ) throw new Error("REPORTING_ACCOUNT_NOT_VERIFIED_OR_INELIGIBLE");
  return {accounts, reportingAccountId};
}

function context(input) {
  const owner = authority(input.installationAuthority);
  return {
    owner,
    provider: provider(input.provider),
    connectionId: uuid(
      input.connectionId,
      "PROVIDER_CONNECTION_ID_INVALID",
    ),
    eventId: uuid(input.eventId, "LIFECYCLE_EVENT_ID_INVALID"),
    expectedVersion: version(input.expectedVersion),
  };
}

export function createProviderConnectionLifecycle({
  database,
  repository,
  now = () => new Date(),
  randomUUIDFn = randomUUID,
} = {}) {
  const records = repository
    ?? createProviderConnectionLifecycleRepository(database);
  const eventId = (provided) =>
    uuid(provided ?? randomUUIDFn(), "LIFECYCLE_EVENT_ID_INVALID");

  return Object.freeze({
    async load({installationAuthority, connectionId, provider: providerValue}) {
      const owner = authority(installationAuthority);
      return records.load({
        connectionId: uuid(connectionId, "PROVIDER_CONNECTION_ID_INVALID"),
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: provider(providerValue),
      });
    },

    async markReauthorizationRequired(input) {
      const selected = context({...input, eventId: eventId(input.eventId)});
      return records.transition({
        eventId: selected.eventId,
        connectionId: selected.connectionId,
        workspaceId: selected.owner.workspaceId,
        installGeneration: selected.owner.installGeneration,
        provider: selected.provider,
        expectedVersion: selected.expectedVersion,
        eventType: "reauthorization_required",
        reason: text(input.reason, "REAUTHORIZATION_REASON_REQUIRED", 200),
        outcome: null,
        occurredAt: now().toISOString(),
      });
    },

    async requestDisconnect(input) {
      const selected = context({...input, eventId: eventId(input.eventId)});
      return records.transition({
        eventId: selected.eventId,
        connectionId: selected.connectionId,
        workspaceId: selected.owner.workspaceId,
        installGeneration: selected.owner.installGeneration,
        provider: selected.provider,
        expectedVersion: selected.expectedVersion,
        eventType: "disconnect_requested",
        reason: text(input.reason, "DISCONNECT_REASON_REQUIRED", 200),
        outcome: null,
        occurredAt: now().toISOString(),
      });
    },

    async renewCredential(input) {
      const selected = context({...input, eventId: eventId(input.eventId)});
      const verifiedAt = freshEvidence(
        input.providerEvidence,
        "provider_credential_renewal_verified",
        selected.provider,
        now,
      );
      return records.renew({
        eventId: selected.eventId,
        connectionId: selected.connectionId,
        workspaceId: selected.owner.workspaceId,
        installGeneration: selected.owner.installGeneration,
        provider: selected.provider,
        expectedVersion: selected.expectedVersion,
        expectedCredentialId: uuid(
          input.expectedCredentialId,
          "EXPECTED_PROVIDER_CREDENTIAL_ID_INVALID",
        ),
        newCredentialId: uuid(
          input.newCredentialId,
          "NEW_PROVIDER_CREDENTIAL_ID_INVALID",
        ),
        grantedScopes: scopes(input.providerEvidence.scopes),
        verifiedAt,
      });
    },

    async finalizeDisconnect(input) {
      const selected = context({...input, eventId: eventId(input.eventId)});
      freshEvidence(
        input.providerEvidence,
        "provider_disconnect_verified",
        selected.provider,
        now,
      );
      if (!DISCONNECT_OUTCOMES.has(input.providerEvidence.outcome)) {
        throw new Error("VERIFIED_DISCONNECT_OUTCOME_REQUIRED");
      }
      return records.finalizeDisconnect({
        eventId: selected.eventId,
        connectionId: selected.connectionId,
        workspaceId: selected.owner.workspaceId,
        installGeneration: selected.owner.installGeneration,
        provider: selected.provider,
        expectedVersion: selected.expectedVersion,
        outcome: input.providerEvidence.outcome,
        reason: text(input.reason, "DISCONNECT_REASON_REQUIRED", 200),
        occurredAt: input.providerEvidence.verifiedAt,
      });
    },

    async reconnect(input) {
      const selected = context({...input, eventId: eventId(input.eventId)});
      const verifiedAt = freshEvidence(
        input.providerEvidence,
        "provider_account_access_verified",
        selected.provider,
        now,
      );
      const selection = reconnectSelection(
        input.providerEvidence,
        selected.provider,
      );
      return records.reconnect({
        eventId: selected.eventId,
        connectionId: selected.connectionId,
        workspaceId: selected.owner.workspaceId,
        installGeneration: selected.owner.installGeneration,
        provider: selected.provider,
        expectedVersion: selected.expectedVersion,
        credentialId: uuid(
          input.credentialId,
          "PROVIDER_CREDENTIAL_ID_INVALID",
        ),
        grantedScopes: scopes(input.providerEvidence.scopes),
        accounts: selection.accounts,
        reportingAccountId: selection.reportingAccountId,
        verifiedAt,
      });
    },
  });
}
