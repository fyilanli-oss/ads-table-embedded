import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/shopify-app-deploy.yml",
  import.meta.url,
);

test("Shopify deploy stays manual, scoped and non-destructive", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(workflow, /inputs\.confirmation == 'DEPLOY'/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /@shopify\/cli@4\.8\.5/);
  assert.equal(
    workflow.match(
      /SHOPIFY_APP_AUTOMATION_TOKEN: \$\{\{ secrets\.SHOPIFY_APP_AUTOMATION_TOKEN \}\}/g,
    )?.length,
    2,
  );
  assert.match(workflow, /shopify app config validate --no-color/);
  assert.match(workflow, /shopify app deploy --allow-updates/);
  assert.match(workflow, /--source-control-url/);
  assert.doesNotMatch(workflow, /--allow-deletes/);
  assert.doesNotMatch(workflow, /SHOPIFY_FLAG_ALLOW_DELETES/);
});
