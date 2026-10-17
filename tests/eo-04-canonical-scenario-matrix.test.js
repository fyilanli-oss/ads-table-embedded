import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const matrixPath = "contracts/eo-04-canonical-scenario-matrix-v1.json";
const commonPath = "contracts/eo-04e-three-provider-channel-product-economics-v1.json";

const load = async (path) => JSON.parse(await readFile(path, "utf8"));

test("every EO-04 scenario uses one canonical card and accepted result vocabulary", async () => {
  const matrix = await load(matrixPath);
  const required = matrix.card_schema.required_fields;
  const ids = new Set();

  for (const scenario of matrix.scenarios) {
    for (const field of required) {
      assert.ok(Object.hasOwn(scenario, field), `${scenario.scenario_id ?? "unknown"} missing ${field}`);
    }
    assert.ok(!ids.has(scenario.scenario_id), `duplicate scenario ${scenario.scenario_id}`);
    ids.add(scenario.scenario_id);
    assert.ok(matrix.card_schema.advertised_product_states.includes(
      scenario.advertised_product_evidence.state,
    ));
    assert.ok(matrix.card_schema.channel_resolutions.includes(
      scenario.expected.channel_resolution,
    ));
    assert.ok(matrix.card_schema.sales_roles.includes(scenario.expected.sales_role));
    assert.ok(matrix.card_schema.value_modifiers.includes(scenario.expected.value_modifier));
    assert.ok(matrix.card_schema.evidence_levels.includes(scenario.evidence_level));
    assert.ok(Array.isArray(scenario.expected.channel_names));
    assert.ok(Array.isArray(scenario.forbidden_inferences));
    assert.ok(scenario.forbidden_inferences.length > 0);
  }

  assert.deepEqual(
    [...ids],
    [
      "META-01",
      "META-02",
      "META-03",
      "META-04",
      "META-05",
      "META-06",
      "GOOGLE-01",
      "GOOGLE-02",
      "GOOGLE-03",
      "GOOGLE-04",
      "GOOGLE-05",
      "GOOGLE-06",
      "KLAVIYO-01",
      "KLAVIYO-02",
      "KLAVIYO-03",
      "KLAVIYO-04",
      "KLAVIYO-05",
      "KLAVIYO-06",
    ],
  );
});

test("scenario matrix retains the accepted shared axes and never invents a Meta or Google Medium", async () => {
  const matrix = await load(matrixPath);
  const common = await load(commonPath);

  assert.deepEqual(matrix.card_schema.sales_roles, common.common.sales_roles);
  assert.equal(matrix.common_rules.unknown_channel_is_sales_role, false);
  assert.equal(matrix.common_rules.zero_value_is_sales_role, false);
  assert.equal(matrix.common_rules.sold_product_may_select_channel, false);

  for (const scenario of matrix.scenarios.filter(({provider}) => provider !== "klaviyo")) {
    assert.equal(scenario.expected.medium_state, "not_defined_for_provider_in_eo04");
    assert.equal(scenario.expected.variation_state, "not_applicable");
  }
});

test("Meta multiple-Ad scenarios use provider ad_id facts without multiplying Shopify sales", async () => {
  const {scenarios} = await load(matrixPath);
  const single = scenarios.find(({scenario_id}) => scenario_id === "META-04");
  const multiple = scenarios.find(({scenario_id}) => scenario_id === "META-05");

  assert.equal(single.expected.channel_type, "Ad");
  assert.equal(single.expected.channel_resolution, "exact");
  assert.deepEqual(single.expected.channel_names, ["İnci Küpe Videosu"]);
  assert.equal(single.expected.fact_rule, "ad_id_selects_channel_not_product_membership");

  assert.equal(multiple.expected.channel_type, "Ad");
  assert.equal(multiple.expected.channel_resolution, "exact");
  assert.equal(multiple.expected.channel_names.length, 2);
  assert.equal(
    multiple.expected.fact_rule,
    "preserve_two_provider_attribution_facts_but_do_not_multiply_shopify_sale",
  );
  assert.equal(multiple.next_owner, "A6-EO-05");
});

test("Google PMax scenarios separate clicked-product Channel evidence from sold product and current time", async () => {
  const {scenarios} = await load(matrixPath);
  const exact = scenarios.find(({scenario_id}) => scenario_id === "GOOGLE-03");
  const overlap = scenarios.find(({scenario_id}) => scenario_id === "GOOGLE-04");
  const historical = scenarios.find(({scenario_id}) => scenario_id === "GOOGLE-05");

  assert.equal(exact.expected.channel_type, "Asset Group");
  assert.equal(exact.expected.channel_resolution, "exact");
  assert.equal(exact.expected.sales_role, "Cross-sell");

  assert.equal(overlap.expected.channel_type, "Unknown Channel");
  assert.equal(overlap.expected.channel_resolution, "unknown");
  assert.equal(overlap.expected.sales_role, "Cross-sell");
  assert.ok(overlap.forbidden_inferences.includes("sold Kolye selects second Asset Group"));

  assert.equal(historical.temporal_evidence, "sale_business_day_listing_tree_missing");
  assert.equal(historical.expected.channel_type, "Unknown Channel");
  assert.equal(historical.expected.sales_role, "Advertised");
  assert.equal(historical.next_owner, "A6-EO-05-PMAX-HISTORICAL-LISTING-TREE");
});

test("Klaviyo Message stays Channel while Medium and Variation remain separate axes", async () => {
  const {scenarios} = await load(matrixPath);
  const single = scenarios.find(({scenario_id}) => scenario_id === "KLAVIYO-01");
  const multiple = scenarios.find(({scenario_id}) => scenario_id === "KLAVIYO-02");
  const flow = scenarios.find(({scenario_id}) => scenario_id === "KLAVIYO-05");
  const unknown = scenarios.find(({scenario_id}) => scenario_id === "KLAVIYO-06");

  assert.equal(single.expected.channel_type, "Campaign Message");
  assert.equal(single.expected.medium_state, "Email");
  assert.equal(single.expected.variation_state, "unresolved");

  assert.equal(multiple.expected.channel_resolution, "exact");
  assert.equal(multiple.expected.variation_state, "unresolved");

  assert.equal(flow.expected.channel_type, "Flow Message");
  assert.equal(flow.expected.medium_state, "SMS");
  assert.equal(flow.expected.variation_state, "exact");
  assert.equal(flow.expected.sales_role, "Triggered");

  assert.equal(unknown.expected.channel_type, "Unknown Channel");
  assert.equal(unknown.expected.sales_role, "Unclassified");
});

test("EO-04 scenario book remains draft until explicit package closure", async () => {
  const matrix = await load(matrixPath);
  const book = await readFile(matrix.analysis_design_book, "utf8");

  assert.equal(matrix.closure.book_status, "draft");
  assert.equal(matrix.closure.product_owner_closure_acceptance_required, true);
  assert.equal(matrix.closure.package_status_changed_by_this_contract, false);
  assert.match(book, /Status:\*\* Draft for product-owner closure review/);
  assert.match(book, /META-05/);
  assert.match(book, /GOOGLE-05/);
  assert.match(book, /KLAVIYO-06/);
});
