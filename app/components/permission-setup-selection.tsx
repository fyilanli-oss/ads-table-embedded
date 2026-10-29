import {useEffect, useRef, useState} from "react";
import type {PermissionSelection} from "../lib/shopify/permission-settings.server.js";

export type SelectionModel = {
  key: string;
  feature: "google_ads" | "meta";
  stage: "select_account" | "select_reporting_account" | "verify_assets";
  selection: PermissionSelection;
};
export type SelectionInput = {accountIds?: string[]; merchantId?: string; businessId?: string; catalogId?: string; loadCatalogs?: true};
type Props = {
  model: SelectionModel;
  busy: boolean;
  onConfirm(key: string, input: SelectionInput, hide: () => void): void;
  onAfterHide(key: string): void;
};

export function PermissionSetupSelection({model, busy, onConfirm, onAfterHide}: Props) {
  const modal = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const choices = useRef<HTMLElementTagNameMap["s-choice-list"] | null>(null);
  const shown = useRef<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const assets = model.stage === "verify_assets";
  const multiple = model.stage === "select_account";
  const options = model.selection.assetOptions;
  const visible = assets ? options?.candidates ?? [] : model.selection.accounts;
  useEffect(() => {
    const element = modal.current;
    if (!element) return;
    const afterHide = (event: Event) => { if (event.target === element) onAfterHide(model.key); };
    element.addEventListener("afterhide", afterHide);
    if (shown.current !== model.key) { shown.current = model.key; element.showOverlay(); }
    return () => element.removeEventListener("afterhide", afterHide);
  }, [model.key, onAfterHide]);
  const confirm = () => {
    let input: SelectionInput;
    const accountIds = [...(choices.current?.values ?? [])];
    if (accountIds.length < 1 || accountIds.length > (multiple ? 3 : 1)
      || new Set(accountIds).size !== accountIds.length
      || accountIds.some(id => !visible.some(account => account.id === id))
      || assets && (!options || !(Date.parse(options.expiresAt) > Date.now()))) {
      setInvalid(true); return;
    }
    if (!assets) input = {accountIds};
    else if (options?.candidateKind === "merchant_accounts") input = {merchantId: accountIds[0]};
    else if (options?.candidateKind === "businesses") input = {businessId: accountIds[0], loadCatalogs: true};
    else if (options?.candidateKind === "catalogs" && options.businessId) input = {businessId: options.businessId, catalogId: accountIds[0]};
    else { setInvalid(true); return; }
    setInvalid(false);
    onConfirm(model.key, input, () => {
      if (!modal.current) throw new Error("PERMISSION_SELECTION_NOT_MOUNTED");
      modal.current.hideOverlay();
    });
  };
  const empty = visible.length === 0;
  const expired = assets && !!options && !(Date.parse(options.expiresAt) > Date.now());
  const heading = assets ? model.feature === "google_ads" ? "Select Merchant Center account"
    : options?.candidateKind === "catalogs" ? "Select Meta catalog" : "Select Meta business"
    : multiple ? model.feature === "google_ads" ? "Select Google Ads accounts" : "Select Meta accounts" : "Select Reporting Account";
  return (
    <s-modal ref={modal} id="permission-setup-selection" heading={heading} size="base" padding="base">
      <s-stack direction="block" gap="base">
        <s-paragraph>{assets
          ? "Choose an item visible to this connection. Access will be verified before setup can continue."
          : multiple ? "Choose one to three advertiser accounts." : "Choose the account to use for reporting."}</s-paragraph>
        {empty ? <s-banner tone="warning" heading={assets
          ? "No available accounts or catalogs were returned. Check status before continuing."
          : "No selectable accounts were returned. Check status before continuing."} /> : null}
        <s-choice-list ref={choices} label={assets ? model.feature === "google_ads" ? "Merchant Center accounts"
          : options?.candidateKind === "catalogs" ? "Catalogs" : "Businesses" : multiple ? "Advertiser accounts" : "Reporting Account"}
          multiple={multiple ? true : undefined}>
          {visible.map(account => <s-choice key={account.id} value={account.id}>{account.name} ({account.id})</s-choice>)}
        </s-choice-list>
        {invalid ? <s-banner tone="warning" heading="Check the selected accounts or identifiers before continuing." /> : null}
        {expired ? <s-banner tone="warning" heading="We could not confirm the result. Check the connection status before starting again." /> : null}
      </s-stack>
      <s-button slot="primary-action" variant="primary" disabled={busy || empty || expired ? true : undefined} loading={busy ? true : undefined} onClick={confirm}>
        {assets ? options?.candidateKind === "businesses" ? "Continue" : "Verify access" : "Save selection"}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="permission-setup-selection" command="--hide">Cancel</s-button>
    </s-modal>
  );
}
