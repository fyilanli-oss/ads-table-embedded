// Synthetic server metadata only. Never a native attribution/FX acceptance claim.
export function recordMetadata(context, facts) {
  return {binding: {...context}, expected_target_currency: "TRY", entries: facts.map(fact => {
    const scope = structuredClone(fact.scope), root = scope.ancestors[0], parent = scope.ancestors.at(-1);
    return {scope, metadata_references: {...fact.source_execution.metadata_references}, enrichment: {
      scope: structuredClone(scope), entity: {campaign_type: scope.flow === "retail_pmax" ? "performance_max" : "standard",
        root_entity_type: root.entity_type, root_entity_id: root.entity_id, root_entity_name: "Root",
        parent_entity_type: parent.entity_type === "ad_group" ? "adgroup" : parent.entity_type,
        parent_entity_id: parent.entity_id, parent_entity_name: root.entity_id === parent.entity_id ? "Root" : "Parent",
        entity_type: scope.entity_type, entity_id: scope.entity_id, entity_name: "Leaf"},
      currency: {source_currency: scope.source_currency, target_currency: "TRY", fx_rate: 42,
        fx_rate_date: scope.business_date, fx_provider: "synthetic", fx_engine_version: "test-v1"},
      fx_for_business_date: scope.business_date, time: {source_timezone: scope.source_timezone,
        business_date: scope.business_date, time_engine_version: "test-v1"},
      references: {entity: "synthetic-entity", time: "synthetic-time", fx: "synthetic-fx", reporting_currency: "synthetic-currency"},
      provenance: {source_system: scope.provider, adapter_version: "test-v1", source_confidence: "real", synthetic: true},
    }};
  })};
}
