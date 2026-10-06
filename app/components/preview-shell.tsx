import type {ReactNode} from "react";

type PreviewShellProps = {
  heading: string;
  sectionHeading: string;
  children: ReactNode;
};

export function PreviewShell({heading, sectionHeading, children}: PreviewShellProps) {
  return (
    <s-page heading={heading}>
      <s-section heading="Preview navigation">
        <s-stack direction="inline" gap="base">
          <s-link href="/">Funnel</s-link>
          <s-link href="/ad-analysis">Ad Analysis</s-link>
          <s-link href="/settings">Settings</s-link>
        </s-stack>
      </s-section>
      <s-section heading={sectionHeading}>
        <s-paragraph>{children}</s-paragraph>
      </s-section>
    </s-page>
  );
}
