import {oauthInstallationAuthority} from "../oauth/oauth-transaction.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {
  createProviderConnectionLifecycle,
} from "../oauth/provider-connection-lifecycle.server.js";
import {META_GRAPH_VERSION, MetaGraphError} from "./meta-graph.server.js";
import {buildMetaSourceLinks} from "./meta-source-links.server.js";
import {projectMetaProductSales} from "./meta-sales-role.server.js";
import {
  fetchMetaAdChannelInsightsPage,
  fetchMetaProductBreakdownInsightsPage,
} from "./meta-reporting.server.js";

const PROVIDER = "meta";
const MAX_PAGES_PER_FACT_FAMILY = 20;
const MAX_ROWS_PER_FACT_FAMILY = 20_000;

function connectedReportingAccount(connection) {
  if (!connection) throw new Error("CONNECTED_META_CONNECTION_REQUIRED");
  if (
    typeof connection.reportingAccountId !== "string"
    || !/^act_[0-9]+$/.test(connection.reportingAccountId)
  ) throw new Error("META_REPORTING_ACCOUNT_REQUIRED");
  const selected = connection.accounts.find(
    (account) => account.id === connection.reportingAccountId,
  );
  if (
    !selected
    || selected.kind !== "advertiser"
    || selected.reporting_eligible !== true
  ) throw new Error("META_REPORTING_ACCOUNT_AUTHORITY_INVALID");
  return connection.reportingAccountId;
}

function owner(value) {
  return oauthInstallationAuthority({
    workspaceId: value?.workspaceId,
    installGeneration: value?.installGeneration,
    status: value?.status,
  });
}

export function createMetaReportingAuthorityRuntime({
  database,
  tokenVault,
  appSecret = process.env.META_APP_SECRET,
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
  now = () => new Date(),
  loadProductSalesEvidence = null,
} = {}) {
  if (loadProductSalesEvidence !== null && typeof loadProductSalesEvidence !== "function") {
    throw new TypeError("loadProductSalesEvidence must be a server-side loader");
  }
  if (!tokenVault || typeof tokenVault.loadProviderTokenSet !== "function") {
    throw new TypeError("tokenVault.loadProviderTokenSet is required");
  }
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const accountAuthority = createProviderAccountAuthorityRepository(database);
  const lifecycle = createProviderConnectionLifecycle({database});

  async function markReauthorizationRequired({installation, connection, reason}) {
    const current = await lifecycle.load({
      installationAuthority: installation,
      connectionId: connection.connectionId,
      provider: PROVIDER,
    });
    if (!current || current.status !== "connected") return;
    await lifecycle.markReauthorizationRequired({
      installationAuthority: installation,
      connectionId: connection.connectionId,
      provider: PROVIDER,
      expectedVersion: current.version,
      reason,
    });
  }

  async function loadAuthority(installationAuthority) {
    const installation = owner(installationAuthority);
    const connection = await accountAuthority.load({
      workspaceId: installation.workspaceId,
      installGeneration: installation.installGeneration,
      provider: PROVIDER,
    });
    const reportingAccountId = connectedReportingAccount(connection);
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId: connection.credentialId,
      installationAuthority: installation,
      provider: PROVIDER,
    });
    if (
      typeof stored?.access_token !== "string"
      || stored.access_token.length < 1
      || stored.access_token !== stored.access_token.trim()
    ) throw new Error("META_ACCESS_TOKEN_UNAVAILABLE");
    if (
      typeof stored.expires_at === "string"
      && !Number.isNaN(Date.parse(stored.expires_at))
      && Date.parse(stored.expires_at) <= now().valueOf()
    ) {
      await markReauthorizationRequired({
        installation,
        connection,
        reason: "meta_token_expired_before_reporting",
      });
      throw new MetaGraphError(
        "META_REAUTHORIZATION_REQUIRED",
        "Meta authorization is expired",
      );
    }
    return {installation, connection, reportingAccountId, stored};
  }

  async function protectedRead(context, operation) {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof MetaGraphError
        && (
          error.code === "META_REAUTHORIZATION_REQUIRED"
          || error.details?.status === 401
          || error.details?.provider_error_code === 190
        )
      ) {
        await markReauthorizationRequired({
          installation: context.installation,
          connection: context.connection,
          reason: "meta_reporting_authorization_rejected",
        });
      }
      throw error;
    }
  }

  async function readPagePair({context, dateWindow, channelAfter, productAfter}) {
    return protectedRead(context, async () => {
      const channel = await fetchMetaAdChannelInsightsPage({
        accessToken: context.stored.access_token,
        appSecret,
        adAccountId: context.reportingAccountId,
        dateWindow,
        after: channelAfter,
        graphVersion,
        fetchFn,
      });
      const product = await fetchMetaProductBreakdownInsightsPage({
        accessToken: context.stored.access_token,
        appSecret,
        adAccountId: context.reportingAccountId,
        dateWindow,
        after: productAfter,
        graphVersion,
        fetchFn,
      });
      return {channel, product};
    });
  }

  async function collectPages({context, dateWindow, fetchPage}) {
    const rows = [];
    const pdMetricRows = [];
    const requestIds = [];
    const rateLimits = [];
    const seen = new Set();
    let after = null;
    let first = null;
    for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_FACT_FAMILY; pageNumber += 1) {
      const page = await protectedRead(context, () => fetchPage(after));
      if (!first) first = page;
      const rowOffset = rows.length;
      if (page.pd_metric_rows) {
        pdMetricRows.push(...page.pd_metric_rows.map(projection => Object.freeze({
          ...projection, source_row_index: rowOffset + projection.source_row_index,
        })));
      }
      rows.push(...page.rows);
      if (page.provider_request_id) requestIds.push(page.provider_request_id);
      if (page.evidence?.rate_limit) rateLimits.push(page.evidence.rate_limit);
      if (rows.length > MAX_ROWS_PER_FACT_FAMILY) {
        throw new MetaGraphError("META_REPORTING_ROW_LIMIT_EXCEEDED", "Meta reporting row limit exceeded");
      }
      if (page.next_cursor === null) {
        return Object.freeze({
          ...first,
          rows: Object.freeze(rows),
          ...(first.pd_metric_rows ? {pd_metric_rows: Object.freeze(pdMetricRows)} : {}),
          next_cursor: null,
          provider_request_id: requestIds.at(-1) ?? null,
          evidence: Object.freeze({
            ...first.evidence,
            page_count: pageNumber + 1,
            provider_request_ids: Object.freeze(requestIds),
            rate_limits: Object.freeze(rateLimits),
          }),
        });
      }
      if (seen.has(page.next_cursor)) {
        throw new MetaGraphError("META_REPORTING_CURSOR_LOOP", "Meta reporting cursor loop detected");
      }
      seen.add(page.next_cursor);
      after = page.next_cursor;
    }
    throw new MetaGraphError("META_REPORTING_PAGE_LIMIT_EXCEEDED", "Meta reporting page limit exceeded");
  }

  return Object.freeze({
    async readDailyEvidencePages({
      installationAuthority,
      dateWindow,
      channelAfter = null,
      productAfter = null,
    }) {
      const context = await loadAuthority(installationAuthority);
      const {channel, product} = await readPagePair({
        context,
        dateWindow,
        channelAfter,
        productAfter,
      });

      return Object.freeze({
        provider: PROVIDER,
        authority: Object.freeze({
          connection_id: context.connection.connectionId,
          reporting_account_id: context.reportingAccountId,
        }),
        channel,
        product,
      });
    },

    async readDailyEvidenceSnapshot({installationAuthority, dateWindow, includePromotedProductMetrics = false}) {
      if (typeof includePromotedProductMetrics !== "boolean") {
        throw new TypeError("includePromotedProductMetrics must be boolean");
      }
      const context = await loadAuthority(installationAuthority);
      const channel = await collectPages({
        context,
        dateWindow,
        fetchPage: (after) => fetchMetaAdChannelInsightsPage({
          accessToken: context.stored.access_token,
          appSecret,
          adAccountId: context.reportingAccountId,
          dateWindow,
          after,
          graphVersion,
          fetchFn,
        }),
      });
      const product = await collectPages({
        context,
        dateWindow,
        fetchPage: (after) => fetchMetaProductBreakdownInsightsPage({
          includePromotedProductMetrics,
          accessToken: context.stored.access_token,
          appSecret,
          adAccountId: context.reportingAccountId,
          dateWindow,
          after,
          graphVersion,
          fetchFn,
        }),
      });
      const sourceLinks = buildMetaSourceLinks({
        scope: {
          workspace_id: context.installation.workspaceId,
          install_generation: context.installation.installGeneration,
          connection_id: context.connection.connectionId,
          reporting_account_id: context.reportingAccountId,
        },
        dateWindow,
        channelRows: channel.rows,
        productRows: product.rows,
      });
      let salesEvidence = null;
      if (loadProductSalesEvidence !== null) {
        try {
          const batch = await loadProductSalesEvidence({installationAuthority: context.installation,
            connectionId: context.connection.connectionId, reportingAccountId: context.reportingAccountId,
            dateWindow: Object.freeze({...dateWindow}), productRows: structuredClone(product.rows)});
          if (batch?.scope?.workspace_id !== context.installation.workspaceId
            || batch?.scope?.install_generation !== context.installation.installGeneration
            || batch?.scope?.connection_id !== context.connection.connectionId
            || batch?.scope?.reporting_account_id !== context.reportingAccountId) {
            throw new Error("scope mismatch");
          }
          salesEvidence = batch.rows;
        } catch {
          throw new MetaGraphError("META_SALES_ROLE_EVIDENCE_FAILED", "Meta sale evidence loading failed");
        }
        if (!Array.isArray(salesEvidence)) {
          throw new MetaGraphError("META_PRODUCT_SALE_EVIDENCE_INVALID", "Meta sale evidence must be an array");
        }
        for (let index = 0; index < product.rows.length; index++) {
          if (salesEvidence[index]?.state !== "verified") continue;
          const row = product.rows[index];
          if (row.account_id !== context.reportingAccountId.slice(4) || row.date_start < dateWindow.start
            || row.date_start > dateWindow.end) {
            throw new MetaGraphError("META_SALES_ROLE_SCOPE_MISMATCH", "Meta sale evidence is outside the requested scope");
          }
        }
      }
      const productSales = projectMetaProductSales({rows: product.rows, evidenceRows: salesEvidence});
      return Object.freeze({
        provider: PROVIDER,
        authority: Object.freeze({
          connection_id: context.connection.connectionId,
          reporting_account_id: context.reportingAccountId,
        }),
        channel,
        product,
        source_links: sourceLinks,
        product_sales: productSales,
      });
    },
  });
}
