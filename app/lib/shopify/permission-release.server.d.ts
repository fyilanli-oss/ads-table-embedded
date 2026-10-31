import type {PermissionFeature} from "../ui/permission-explanation-flow.js";
export type PermissionSetupRelease = Readonly<{
  shopifyRequestsEnabled: boolean;
  optionalScopesReleased: boolean;
  availability: Readonly<Record<PermissionFeature, boolean>>;
  unavailableReasons: Readonly<Partial<Record<PermissionFeature, string>>>;
}>;
export function readPermissionSetupRelease(environment?: NodeJS.ProcessEnv): PermissionSetupRelease;
