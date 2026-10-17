export const KLAVIYO_REPORTING_API_REVISION: "2026-10-15";
export const KLAVIYO_REPORTING_STATISTICS: readonly string[];
export class KlaviyoReportingError extends Error {
  code: string;
  details: unknown;
}
export function klaviyoBusinessDayTimeframe(input: any): any;
export function buildKlaviyoShopifyMetricsRequest(input: any): any;
export function buildKlaviyoCampaignValuesRequest(input: any): any;
export function buildKlaviyoFlowValuesRequest(input: any): any;
export function buildKlaviyoOrderedProductEventsRequest(input: any): any;
export function selectKlaviyoShopifyMetrics(items: any[]): any;
export function normalizeKlaviyoMedium(value: string): any;
export function normalizeKlaviyoReportRow(kind: "campaign" | "flow", row: any): any;
export function classifyKlaviyoCampaignSalesRole(input: any): string;
export function resolveKlaviyoMessageChannel(input: any): any;
export function normalizeKlaviyoOrderedProductEvent(event: any): any;
export function runKlaviyoReportingFamilies(input: any): Promise<any>;
