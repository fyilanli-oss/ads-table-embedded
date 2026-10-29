import {useEffect, useRef, useState} from "react";
import type {PermissionSelection} from "../lib/shopify/permission-settings.server.js";

export type SelectionModel = {
  key: string;
  feature: "google_ads" | "meta";
  stage: "select_account" | "select_reporting_account" | "verify_assets";
  selection: PermissionSelection;
};
export type SelectionInput = {accountIds?: string[]; merchantId?: string; businessId?: string; catalogId?: string};
type Props = {
  model: SelectionModel;
  busy: boolean;
  onConfirm(key: string, input: SelectionInput, hide: () => void): void;
  onAfterHide(key: string): void;
};

export function PermissionSetupSelection({model, busy, onConfirm, onAfterHide}: Props) {
  const modal = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const choices = useRef<HTMLElementTagNameMap["s-choice-list"] | null>(null);
  const merchant = useRef<HTMLElementTagNameMap["s-text-field"] | null>(null);
  const business = useRef<HTMLElementTagNameMap["s-text-field"] | null>(null);
  const catalog = useRef<HTMLElementTagNameMap["s-text-field"] | null>(null);
  const shown = useRef<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const assets = model.stage === "verify_assets";
  const multiple = model.stage === "select_account";
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
    if (!assets) {
      const accountIds = [...(choices.current?.values ?? [])];
      if (accountIds.length < 1 || accountIds.length > (multiple ? 3 : 1)
        || new Set(accountIds).size !== accountIds.length
        || accountIds.some(id => !model.selection.accounts.some(account => account.id === id))) {
        setInvalid(true); return;
      }
      input = {accountIds};
    } else {
      const merchantId = merchant.current?.value ?? "";
      const businessId = business.current?.value ?? "";
      const catalogId = catalog.current?.value ?? "";
      const numeric = (id: string) => /^[1-9][0-9]{0,29}$/.test(id);
      if (model.feature === "google_ads" ? !numeric(merchantId) || BigInt(merchantId) > 9223372036854775807n
        : !numeric(businessId) || !numeric(catalogId)) { setInvalid(true); return; }
      input = model.feature === "google_ads" ? {merchantId} : {businessId, catalogId};
    }
    setInvalid(false);
    onConfirm(model.key, input, () => {
      if (!modal.current) throw new Error("PERMISSION_SELECTION_NOT_MOUNTED");
      modal.current.hideOverlay();
    });
  };
  const empty = !assets && model.selection.accounts.length === 0;
  const heading = assets ? model.feature === "google_ads" ? "Verify Merchant Center account" : "Verify Meta catalog access"
    : multiple ? model.feature === "google_ads" ? "Select Google Ads accounts" : "Select Meta accounts" : "Select Reporting Account";
  return (
    <s-modal ref={modal} id="permission-setup-selection" heading={heading} size="base" padding="base">
      <s-stack direction="block" gap="base">
        <s-paragraph>{assets
          ? "Enter the account or catalog identifiers to verify access. These are candidates, not verified connections."
          : multiple ? "Choose one to three advertiser accounts." : "Choose the account to use for reporting."}</s-paragraph>
        {empty ? <s-banner tone="warning" heading="No selectable accounts were returned. Check status before continuing." /> : null}
        {!assets ? (
          <s-choice-list ref={choices} label={multiple ? "Advertiser accounts" : "Reporting Account"} multiple={multiple ? true : undefined}>
            {model.selection.accounts.map(account => <s-choice key={account.id} value={account.id}>{account.name} ({account.id})</s-choice>)}
          </s-choice-list>
        ) : model.feature === "google_ads" ? (
          <s-text-field ref={merchant} label="Merchant Center account ID" required maxLength={30} />
        ) : <>
          <s-text-field ref={business} label="Business ID" required maxLength={30} />
          <s-text-field ref={catalog} label="Catalog ID" required maxLength={30} />
        </>}
        {invalid ? <s-banner tone="warning" heading="Check the selected accounts or identifiers before continuing." /> : null}
      </s-stack>
      <s-button slot="primary-action" variant="primary" disabled={busy || empty ? true : undefined} loading={busy ? true : undefined} onClick={confirm}>
        {assets ? "Verify access" : "Save selection"}
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="permission-setup-selection" command="--hide">Cancel</s-button>
    </s-modal>
  );
}
