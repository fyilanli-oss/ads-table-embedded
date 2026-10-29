import type {PermissionFeature} from "./permission-explanation-flow.js";
export const PERMISSION_EXPLANATIONS: Readonly<Record<PermissionFeature, Readonly<{heading: string; paragraphs: readonly string[]}>>>;
export const PERMISSION_CANCEL_COPY: string;
