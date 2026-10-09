import {randomUUID} from "node:crypto";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["meta", "google_ads", "klaviyo"]);
const MAX_EVIDENCE_AGE_MS = 10 * 60 * 1000;
const MAX_EVIDENCE_ACCOUNTS = 1000;

function providerName(value) {
  if (!PROVIDERS.has(value)) {
    throw new Error("PROVIDER_ACCOUNT_AUTHORITY_UNSUPPORTED");
  }
  return value;
}

function installationAuthority(value) {
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
  return value;
}

function trimmed(value, code, maximum = 255) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
  ) {
    throw new Error(code);
  }
  return value;
}

function optionalTrimmed(value, code, maximum = 255) {
  if (value === null || value === undefined) return null;
  return trimmed(value, code, maximum);
}

function evidenceDate(value, code) {
  if (typeof value !== "string") throw new Error(code);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new Error(code);
  }
  return date;
}

function scopes(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new Error("PROVIDER_SCOPES_INVALID");
  }
  const normalized = values.map((value) =>
    trimmed(value, "PROVIDER_SCOPE_INVALID", 200)
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("PROVIDER_SCOPE_DUPLICATE");
  }
  return Object.freeze([...normalized].sort());
}

function account(value, provider) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PROVIDER_ACCOUNT_EVIDENCE_INVALID");
  }
  for (const forbidden of [
    "access_token", "refresh_token", "token", "credential_id",
    "workspace_id", "install_generation",
  ]) {
    if (forbidden in value) {
      throw new Error("PROVIDER_ACCOUNT_EVIDENCE_CONTAINS_SECRET_OR_AUTHORITY");
    }
  }
  const kind = trimmed(value.kind, "PROVIDER_ACCOUNT_KIND_INVALID", 20);
  if (!["advertiser", "manager", "account"].includes(kind)) {
    throw new Error("PROVIDER_ACCOUNT_KIND_INVALID");
  }
  if (typeof value.reportingEligible !== "boolean") {
    throw new Error("PROVIDER_ACCOUNT_ELIGIBILITY_INVALID");
  }
  if (
    provider === "klaviyo"
    && (kind !== "account" || value.reportingEligible !== true)
  ) {
    throw new Error("KLAVIYO_ACCOUNT_EVIDENCE_INVALID");
  }
  if (
    value.currency !== null
    && value.currency !== undefined
    && !/^[A-Z]{3}$/.test(value.currency)
  ) {
    throw new Error("PROVIDER_ACCOUNT_CURRENCY_INVALID");
  }

  return Object.freeze({
    id: trimmed(value.id, "PROVIDER_ACCOUNT_ID_INVALID"),
    name: trimmed(value.name, "PROVIDER_ACCOUNT_NAME_INVALID"),
    kind,
    reporting_eligible: value.reportingEligible,
    status: optionalTrimmed(value.status, "PROVIDER_ACCOUNT_STATUS_INVALID", 100),
    currency: value.currency ?? null,
    timezone: optionalTrimmed(
      value.timezone,
      "PROVIDER_ACCOUNT_TIMEZONE_INVALID",
      100,
    ),
    login_account_id: optionalTrimmed(
      value.loginAccountId,
      "PROVIDER_LOGIN_ACCOUNT_ID_INVALID",
    ),
  });
}

function verifiedEvidence(value, expectedProvider, now) {
  if (
    !value
    || value.authority !== "provider_account_access_verified"
    || value.provider !== expectedProvider
  ) {
    throw new Error("VERIFIED_PROVIDER_ACCOUNT_EVIDENCE_REQUIRED");
  }
  const verifiedAt = evidenceDate(
    value.verifiedAt,
    "PROVIDER_EVIDENCE_VERIFIED_AT_INVALID",
  );
  const expiresAt = evidenceDate(
    value.expiresAt,
    "PROVIDER_EVIDENCE_EXPIRES_AT_INVALID",
  );
  const current = now();
  if (!(current instanceof Date) || Number.isNaN(current.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  if (
    verifiedAt > current
    || expiresAt <= current
    || current - verifiedAt > MAX_EVIDENCE_AGE_MS
    || expiresAt - verifiedAt > MAX_EVIDENCE_AGE_MS
  ) {
    throw new Error("PROVIDER_ACCOUNT_EVIDENCE_STALE");
  }
  if (
    !Array.isArray(value.accounts)
    || value.accounts.length < 1
    || value.accounts.length > MAX_EVIDENCE_ACCOUNTS
  ) {
    throw new Error("PROVIDER_ACCOUNT_EVIDENCE_INVALID");
  }
  const normalizedAccounts = value.accounts.map((entry) =>
    account(entry, expectedProvider)
  );
  if (
    new Set(normalizedAccounts.map((entry) => entry.id)).size
    !== normalizedAccounts.length
  ) {
    throw new Error("PROVIDER_ACCOUNT_EVIDENCE_DUPLICATE");
  }
  if (expectedProvider === "klaviyo" && normalizedAccounts.length !== 1) {
    throw new Error("KLAVIYO_SINGLE_CONNECTED_ACCOUNT_REQUIRED");
  }
  return Object.freeze({
    verifiedAt: verifiedAt.toISOString(),
    scopes: scopes(value.scopes),
    accounts: Object.freeze(normalizedAccounts),
  });
}

function selectedAccounts(evidence, provider, selectedIds, reportingAccountId) {
  if (provider === "klaviyo") {
    if (
      reportingAccountId !== null && reportingAccountId !== undefined
      || selectedIds !== null && selectedIds !== undefined
    ) {
      throw new Error("KLAVIYO_REPORTING_ACCOUNT_CONTROL_FORBIDDEN");
    }
    return Object.freeze({
      accounts: evidence.accounts,
      reportingAccountId: null,
    });
  }

  if (
    !Array.isArray(selectedIds)
    || selectedIds.length < 1
    || selectedIds.length > 3
  ) {
    throw new Error("CONNECTED_ACCOUNT_CARDINALITY_INVALID");
  }
  const ids = selectedIds.map((id) =>
    trimmed(id, "CONNECTED_ACCOUNT_ID_INVALID")
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error("CONNECTED_ACCOUNT_DUPLICATE");
  }
  const available = new Map(
    evidence.accounts.map((entry) => [entry.id, entry]),
  );
  const accounts = ids.map((id) => {
    const entry = available.get(id);
    if (!entry) throw new Error("CONNECTED_ACCOUNT_NOT_PROVIDER_VERIFIED");
    return entry;
  });
  const selectedReportingAccount = trimmed(
    reportingAccountId,
    "REPORTING_ACCOUNT_REQUIRED",
  );
  const reporting = accounts.find(
    (entry) => entry.id === selectedReportingAccount,
  );
  if (
    !reporting
    || !reporting.reporting_eligible
    || reporting.kind !== "advertiser"
  ) {
    throw new Error("REPORTING_ACCOUNT_NOT_VERIFIED_OR_INELIGIBLE");
  }
  return Object.freeze({
    accounts: Object.freeze(accounts),
    reportingAccountId: selectedReportingAccount,
  });
}

export function createProviderAccountAuthority({
  database,
  repository,
  now = () => new Date(),
  randomUUIDFn = randomUUID,
} = {}) {
  const records = repository
    ?? createProviderAccountAuthorityRepository(database);

  return Object.freeze({
    async establish({
      installationAuthority: authority,
      provider,
      credentialId,
      providerEvidence,
      selectedAccountIds = null,
      reportingAccountId = null,
    }) {
      const owner = installationAuthority(authority);
      const selectedProvider = providerName(provider);
      if (!UUID_PATTERN.test(credentialId || "")) {
        throw new Error("PROVIDER_CREDENTIAL_ID_INVALID");
      }
      const evidence = verifiedEvidence(
        providerEvidence,
        selectedProvider,
        now,
      );
      const selected = selectedAccounts(
        evidence,
        selectedProvider,
        selectedAccountIds,
        reportingAccountId,
      );
      const connectionId = randomUUIDFn();
      if (!UUID_PATTERN.test(connectionId || "")) {
        throw new Error("PROVIDER_CONNECTION_ID_INVALID");
      }
      const persisted = await records.establish({
        connectionId,
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: selectedProvider,
        credentialId,
        grantedScopes: evidence.scopes,
        accounts: selected.accounts,
        reportingAccountId: selected.reportingAccountId,
        verifiedAt: evidence.verifiedAt,
      });
      if (
        persisted.connectionId !== connectionId
        || persisted.connectedAccountCount !== selected.accounts.length
        || persisted.reportingAccountId !== selected.reportingAccountId
      ) {
        throw new Error("PROVIDER_ACCOUNT_AUTHORITY_PERSISTENCE_MISMATCH");
      }
      return persisted;
    },

    async selectReportingAccount({
      installationAuthority: authority,
      connectionId,
      provider,
      providerAccountId,
      providerEvidence,
    }) {
      const owner = installationAuthority(authority);
      const selectedProvider = providerName(provider);
      if (selectedProvider === "klaviyo") {
        throw new Error("KLAVIYO_REPORTING_ACCOUNT_CONTROL_FORBIDDEN");
      }
      if (!UUID_PATTERN.test(connectionId || "")) {
        throw new Error("PROVIDER_CONNECTION_ID_INVALID");
      }
      const targetId = trimmed(
        providerAccountId,
        "REPORTING_ACCOUNT_ID_INVALID",
      );
      const evidence = verifiedEvidence(
        providerEvidence,
        selectedProvider,
        now,
      );
      const target = evidence.accounts.find((entry) => entry.id === targetId);
      if (
        !target
        || !target.reporting_eligible
        || target.kind !== "advertiser"
      ) {
        throw new Error("REPORTING_ACCOUNT_NOT_PROVIDER_REVERIFIED");
      }
      return records.selectReportingAccount({
        connectionId,
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: selectedProvider,
        providerAccountId: targetId,
        verifiedAt: evidence.verifiedAt,
      });
    },

    async load({installationAuthority: authority, provider}) {
      const owner = installationAuthority(authority);
      return records.load({
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: providerName(provider),
      });
    },
  });
}
