import pg from "pg";

const {Pool} = pg;

const PROJECT_REF = "podpwkrpmjiksskxhwsu";
const REGION = "eu-central-1";
const RUNTIME_ROLE = "adstable_runtime";
const POOLER_HOST_PATTERN = new RegExp(
  `^aws-[0-9]+-${REGION.replaceAll("-", "\\-")}\\.pooler\\.supabase\\.com$`,
);

export const ADSTABLE_RUNTIME_DATABASE_ENV = "ADSTABLE_RUNTIME_DATABASE_URL";

function invalidConfiguration() {
  return new Error("ADSTABLE_RUNTIME_DATABASE_URL_INVALID");
}

export function readRuntimeDatabaseConfig(environment = process.env) {
  const raw = environment?.[ADSTABLE_RUNTIME_DATABASE_ENV];
  if (typeof raw !== "string" || raw.length === 0) throw invalidConfiguration();

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalidConfiguration();
  }

  let username;
  let password;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw invalidConfiguration();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    username !== `${RUNTIME_ROLE}.${PROJECT_REF}` ||
    password.length < 24 ||
    !POOLER_HOST_PATTERN.test(url.hostname) ||
    url.port !== "6543" ||
    url.pathname !== "/postgres" ||
    url.searchParams.get("sslmode") !== "require" ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    url.hash !== ""
  ) {
    throw invalidConfiguration();
  }

  return Object.freeze({
    connectionString: raw,
    projectRef: PROJECT_REF,
    role: RUNTIME_ROLE,
    connectionMode: "transaction_pooler",
  });
}

export function createRuntimePostgresClient({
  environment = process.env,
  poolFactory = (config) => new Pool(config),
} = {}) {
  const config = readRuntimeDatabaseConfig(environment);
  const pool = poolFactory({
    connectionString: config.connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    application_name: "adstable-runtime",
  });

  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("Postgres pool must provide query");
  }

  return Object.freeze({
    query(text, values) {
      return pool.query({text, values});
    },
    close: typeof pool.end === "function" ? () => pool.end() : async () => {},
  });
}
