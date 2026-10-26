export const KLAVIYO_ATTRIBUTED_EVENT_LIMIT: 100;
export function buildKlaviyoAttributedEventRequest(input: {accessToken: string; id: string}): any;
export function readKlaviyoAttributedEvents(input: {
  sales: any[];
  fetchEvent: (id: string) => Promise<{payload: any; requestId: string | null}>;
}): Promise<any>;
