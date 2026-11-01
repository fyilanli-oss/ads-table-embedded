import {useEffect, useRef} from "react";

export function PermissionProviderDisconnect({feature, onConfirm, onAfterHide}: {
  feature: "meta" | "google_ads";
  onConfirm(hide: () => void): void;
  onAfterHide(): void;
}) {
  const modal = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const shown = useRef(false);
  useEffect(() => {
    const element = modal.current;
    if (!element) return;
    const afterHide = (event: Event) => {if (event.target === element) onAfterHide();};
    element.addEventListener("afterhide", afterHide);
    if (!shown.current) {shown.current = true; element.showOverlay();}
    return () => element.removeEventListener("afterhide", afterHide);
  }, [onAfterHide]);
  const name = feature === "meta" ? "Meta" : "Google Ads";
  return <s-modal ref={modal} id="permission-provider-disconnect" heading={`Disconnect ${name}?`}>
    <s-paragraph>AdsTable will remove {name} authorization, selected accounts and the encrypted credential. Historical data remains.</s-paragraph>
    <s-button slot="primary-action" variant="primary" tone="critical" onClick={() => onConfirm(() => {
      if (!modal.current) throw new Error("PERMISSION_SELECTION_NOT_MOUNTED");
      modal.current.hideOverlay();
    })}>Disconnect {name}</s-button>
    <s-button slot="secondary-actions" commandFor="permission-provider-disconnect" command="--hide">Keep connected</s-button>
  </s-modal>;
}
