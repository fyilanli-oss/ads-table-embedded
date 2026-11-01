import {useEffect, useRef} from "react";

type Props = {owner: string | null; ready: boolean; busy: boolean;
  onConfirm(): void; onUnknown(): void};

// Consent is consumed once after native afterhide, never by rendering/opening.
export function OrderAccessRemoval({owner, ready, busy, onConfirm, onUnknown}: Props) {
  const modal = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const intent = useRef<{owner: string} | null>(null);
  const callbacks = useRef({owner, ready, busy, onConfirm, onUnknown});
  callbacks.current = {owner, ready, busy, onConfirm, onUnknown};
  useEffect(() => {
    const element = modal.current;
    if (!element) return;
    const afterHide = (event: Event) => {
      if (event.target !== element) return;
      const confirmed = intent.current;
      intent.current = null;
      const current = callbacks.current;
      if (confirmed && confirmed.owner === current.owner && current.ready && !current.busy) current.onConfirm();
    };
    element.addEventListener("afterhide", afterHide);
    return () => {element.removeEventListener("afterhide", afterHide); intent.current = null;};
  }, []);
  return <>
    {ready ? <s-button tone="critical" commandFor="shopify-orders-revoke-modal" command="--show"
      disabled={busy || !owner ? true : undefined}>Disconnect</s-button> : null}
    <s-modal ref={modal} id="shopify-orders-revoke-modal" heading="Remove order access?" size="base" padding="base">
      <s-paragraph>AdsTable's permission to read Shopify orders and purchased products will be removed. Order-based features will need access again. Product access and existing records will be kept.</s-paragraph>
      <s-button slot="primary-action" variant="primary" tone="critical" disabled={busy || !ready || !owner ? true : undefined}
        onClick={() => {
          if (intent.current || !owner || !ready || busy) return;
          intent.current = {owner};
          try {if (!modal.current) throw new Error("MODAL_UNAVAILABLE"); modal.current.hideOverlay();}
          catch {intent.current = null; onUnknown();}
        }}>Remove access</s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="shopify-orders-revoke-modal" command="--hide"
        onClick={() => {intent.current = null;}}>Cancel</s-button>
    </s-modal>
  </>;
}
