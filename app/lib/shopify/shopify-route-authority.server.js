import {
  readVerifiedShopifyAdminIdentity,
} from "./admin-identity.server.js";
import {
  bootstrapWorkspaceInstallation,
} from "./installation-authority.server.js";
import {
  createShopifyRuntimeRepositories,
} from "../database/shopify-runtime-repositories.server.js";
import {
  oauthInstallationAuthority,
} from "../oauth/oauth-transaction.server.js";

export async function resolveShopifyRouteAuthority({
  request,
  authenticateAdmin,
  database,
}) {
  if (typeof authenticateAdmin !== "function") {
    throw new TypeError("authenticateAdmin is required");
  }
  const context = await authenticateAdmin(request);
  const identity = await readVerifiedShopifyAdminIdentity({
    admin: context.admin,
    sessionToken: context.sessionToken,
  });
  const installation = await bootstrapWorkspaceInstallation({
    session: identity.session,
    shop: identity.shop,
    verifiedAt: new Date(),
    repository: createShopifyRuntimeRepositories(database).installation,
  });
  return Object.freeze({
    context,
    identity,
    installation,
    installationAuthority: oauthInstallationAuthority(installation),
  });
}
