function queryOf(database) {
  if (!database || typeof database.query !== "function") {
    throw new TypeError("database.query is required");
  }
  return database.query.bind(database);
}

function one(result, code) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
    throw new Error(code + "_RESULT_INVALID");
  }
  return result.rows[0];
}

function optional(result, code) {
  if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
    throw new Error(code + "_RESULT_INVALID");
  }
  return result.rows[0] ?? null;
}

function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function period(row) {
  return Object.freeze({
    id: row.spend_period_id ?? row.id,
    amount: String(row.amount ?? row.estimated_30_day_email_spend),
    currency: row.currency ?? row.source_currency,
    effectiveFrom: String(row.effective_from),
    correctionVersion: Number(row.correction_version),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function configuration(row) {
  if (!row) return null;
  const raw = typeof row.spend_periods === "string"
    ? JSON.parse(row.spend_periods)
    : row.spend_periods;
  if (!Array.isArray(raw) || raw.length < 1) {
    throw new Error("KLAVIYO_SPEND_CONFIGURATION_RESULT_INVALID");
  }
  const periods = Object.freeze(raw.map(period));
  return Object.freeze({
    connectionId: row.connection_id,
    connectionVersion: Number(row.connection_version),
    credentialId: row.credential_id,
    account: Object.freeze({
      id: row.provider_account_id,
      name: row.account_name,
      currency: row.source_currency,
      timezone: row.timezone_name,
    }),
    current: periods[0],
    periods,
  });
}

function accountEvidence(account) {
  return {
    id: account.id,
    name: account.name,
    kind: "account",
    reporting_eligible: true,
    status: account.status,
    currency: account.currency,
    timezone: account.timezone,
  };
}

export function createKlaviyoSpendRepository(database) {
  const query = queryOf(database);
  return Object.freeze({
    async complete(value) {
      const row = one(await query(
        `select * from integrations.complete_klaviyo_setup_with_spend(
          $1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::jsonb,
          $6::numeric, $7::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.expectedVersion, JSON.stringify(accountEvidence(value.account)),
          value.amount, value.verifiedAt,
        ],
      ), "KLAVIYO_SETUP_COMPLETE");
      return Object.freeze({
        connectionId: row.connection_id,
        status: row.lifecycle_status,
        version: Number(row.connection_version),
        spendPeriod: period({...row, amount: value.amount, currency: value.account.currency}),
      });
    },

    async append(value) {
      const row = one(await query(
        `select * from integrations.append_klaviyo_spend_period(
          $1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::jsonb,
          $6::numeric, $7::timestamptz
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.expectedVersion, JSON.stringify(accountEvidence(value.account)),
          value.amount, value.verifiedAt,
        ],
      ), "KLAVIYO_SPEND_APPEND");
      return period({...row, amount: value.amount, currency: value.account.currency});
    },

    async correct(value) {
      return period(one(await query(
        `select * from integrations.correct_klaviyo_spend_period(
          $1::uuid, $2::uuid, $3::bigint, $4::date, $5::bigint, $6::numeric
        )`,
        [
          value.connectionId, value.workspaceId, value.installGeneration,
          value.effectiveFrom, value.expectedCorrectionVersion, value.amount,
        ],
      ), "KLAVIYO_SPEND_CORRECT"));
    },

    async load(value) {
      return configuration(optional(await query(
        `select * from integrations.load_klaviyo_spend_configuration(
          $1::uuid, $2::bigint
        )`,
        [value.workspaceId, value.installGeneration],
      ), "KLAVIYO_SPEND_CONFIGURATION_LOAD"));
    },
  });
}
