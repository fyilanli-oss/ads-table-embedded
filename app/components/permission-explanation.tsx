import {useEffect, useRef} from "react";
import {
  PERMISSION_CANCEL_COPY,
  PERMISSION_EXPLANATIONS,
} from "../lib/ui/permission-explanation-copy.js";
import type {PermissionSnapshot} from "../lib/ui/permission-explanation-flow.js";

type ModalHandle = HTMLElementTagNameMap["s-modal"];
type Props = {
  snapshot: PermissionSnapshot;
  requestsAvailable: boolean;
  onConnect(session: number, hideOverlay: () => void): void;
  onHide(session: number): void;
  onAfterHide(session: number): void;
};

// One dialog per Settings host. Rendering or opening it never invokes an adapter.
// The host retains this session until afterhide; it must not swap features mid-hide.
export function PermissionExplanation({
  snapshot, requestsAvailable, onConnect, onHide, onAfterHide,
}: Props) {
  const modal = useRef<ModalHandle | null>(null);
  const {feature, phase, session} = snapshot;
  const shownSession = useRef<number | null>(null);
  useEffect(() => {
    const element = modal.current;
    if (!element) return;
    const hide = (event: Event) => { if (event.target === element) onHide(session); };
    const afterHide = (event: Event) => { if (event.target === element) onAfterHide(session); };
    // Native listeners work with the repository's React 18 custom elements.
    element.addEventListener("hide", hide);
    element.addEventListener("afterhide", afterHide);
    return () => {
      element.removeEventListener("hide", hide);
      element.removeEventListener("afterhide", afterHide);
    };
  }, [feature, session, onHide, onAfterHide]);
  useEffect(() => {
    if (feature && phase === "explaining" && shownSession.current !== session) {
      modal.current?.showOverlay();
      shownSession.current = session;
    }
  }, [feature, phase, session]);

  if (feature === null) return null;
  const copy = PERMISSION_EXPLANATIONS[feature];
  const unavailable = !requestsAvailable || phase === "unavailable";
  return (
    <s-modal
      ref={modal}
      id="permission-explanation-modal"
      heading={copy.heading}
      size="base"
      padding="base"
    >
      <s-stack direction="block" gap="base">
        {copy.paragraphs.map((paragraph) => (
          <s-paragraph key={paragraph}>{paragraph}</s-paragraph>
        ))}
        <s-paragraph>{PERMISSION_CANCEL_COPY}</s-paragraph>
        {unavailable ? (
          <s-banner tone="warning" heading="Connection setup is not available yet." />
        ) : null}
      </s-stack>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={unavailable || phase !== "explaining" ? true : undefined}
        loading={phase === "hiding_for_connect" || phase === "starting" ? true : undefined}
        onClick={() => onConnect(session, () => {
          if (!modal.current) throw new Error("PERMISSION_EXPLANATION_NOT_MOUNTED");
          modal.current.hideOverlay();
        })}
      >
        Connect
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        commandFor="permission-explanation-modal"
        command="--hide"
      >
        {unavailable ? "Close" : "Cancel"}
      </s-button>
    </s-modal>
  );
}
