import {useEffect, useRef, useState} from "react";
import type {PermissionSelection} from "../lib/shopify/permission-settings.server.js";

export type SelectionModel = {
  key: string;
  feature: "google_ads" | "meta";
  stage: "select_account" | "select_reporting_account" | "change_reporting";
  selection: PermissionSelection;
};
export type SelectionInput = {accountIds: string[]};
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
  const multiple = model.stage === "select_account";
  const visible = model.selection.accounts;
  useEffect(() => {
    const element = modal.current;
    if (!element) return;
    const afterHide = (event: Event) => { if (event.target === element) onAfterHide(model.key); };
    element.addEventListener("afterhide", afterHide);
    if (shown.current !== model.key) { shown.current = model.key; element.showOverlay(); }
    return () => element.removeEventListener("afterhide", afterHide);
  }, [model.key, onAfterHide]);
  const confirm = () => {
    const accountIds = [...(choices.current?.values ?? [])];
    if (accountIds.length < 1 || accountIds.length > (multiple ? 3 : 1)
      || new Set(accountIds).size !== accountIds.length
      || accountIds.some(id => !visible.some(account => account.id === id))) {
      setInvalid(true); return;
    }
    setInvalid(false);
    onConfirm(model.key, {accountIds}, () => {
      if (!modal.current) throw new Error("PERMISSION_SELECTION_NOT_MOUNTED");
      modal.current.hideOverlay();
    });
  };
  const empty = visible.length === 0;
  const heading = multiple ? model.feature === "google_ads" ? "Select Google Ads accounts" : "Select Meta accounts" : "Select Reporting Account";
  return (
    <s-modal ref={modal} id="permission-setup-selection" heading={heading} size="base" padding="base">
      <s-stack direction="block" gap="base">
        <s-paragraph>{multiple ? "Choose one to three advertiser accounts." : "Choose the account to use for reporting."}</s-paragraph>
        {empty ? <s-banner tone="warning" heading="No selectable advertiser accounts were returned. Resume setup to check the current connection status." /> : null}
        <s-choice-list ref={choices} label={multiple ? "Advertiser accounts" : "Reporting Account"}
          multiple={multiple ? true : undefined}>
          {visible.map(account => <s-choice key={account.id} value={account.id}>{account.name} ({account.id})</s-choice>)}
        </s-choice-list>
        {invalid ? <s-banner tone="warning" heading="Check the selected accounts before continuing." /> : null}
      </s-stack>
      <s-button slot="primary-action" variant="primary" disabled={busy || empty ? true : undefined} loading={busy ? true : undefined} onClick={confirm}>
        Save selection
      </s-button>
      <s-button slot="secondary-actions" variant="secondary" commandFor="permission-setup-selection" command="--hide">Cancel</s-button>
    </s-modal>
  );
}
