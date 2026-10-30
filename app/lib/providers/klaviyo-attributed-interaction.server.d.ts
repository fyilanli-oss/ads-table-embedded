export const KLAVIYO_INTERACTION_FIELDS: Readonly<{event: string; metric: string}>;
export function buildKlaviyoAttributedEventRequest(input: {eventId: string; accessToken: string}): {
  url: string; method: "GET"; headers: Record<string, string>;
};
export interface KlaviyoAttributedInteraction {
  event_id: string;
  metric_id: string;
  metric_name: string;
  metric_integration: string | null;
  occurred_at: string;
  timestamp: number | null;
  kind: "click" | "open" | "other";
}
export function readKlaviyoAttributedInteractions(input: {
  events: readonly Readonly<Record<string, any>>[];
  attributions: readonly Readonly<Record<string, any>>[];
  fetchEvent: (eventId: string) => Promise<unknown>;
  check: () => void;
  maxInteractions?: number;
  maxBytes?: number;
}): Promise<Readonly<{
  links: readonly Readonly<{sale_event_id: string; attribution_id: string | null; interaction_event_id: string | null;
    status: "no_attribution" | "missing_reference" | "reference_conflict" | "time_conflict" | "linked";
    interaction_kind?: "click" | "open" | "other"}>[];
  events: readonly KlaviyoAttributedInteraction[];
  requests: number;
  observed_response_bytes: number;
  clicked_product_verified: false;
  sales_roles_changed: false;
  persistable: false;
  publishable: false;
}>>;
