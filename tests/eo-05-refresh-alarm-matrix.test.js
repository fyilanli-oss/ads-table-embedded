import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const matrix=JSON.parse(read("contracts/eo-05-refresh-alarm-matrix-v1.json"));
const design=JSON.parse(read("contracts/eo-05a-global-refresh-design-v1.json"));
const plan=read("docs/EXECUTION_PLAN.md");

// Contract consistency only. These are NOT executed outage injections or live alert delivery tests.
function valid(value) {
  return value.cadence.queue_check_interval_seconds===60 && value.cadence.workspace_refresh_interval_seconds===3600
    && value.cadence.every_queue_check_fetches_all_workspaces===false
    && value.heartbeat.overdue_when_elapsed_seconds_gt===120
    && value.heartbeat.deadline_reset_before_durable_check_evidence===false
    && value.heartbeat.one_healthy_worker_or_tenant_masks_others===false
    && value.independence.watchdog_uses_same_refresh_trigger===false
    && value.independence.watchdog_requires_primary_database_to_detect_silence===false
    && value.notification.notification_acceptance_is_human_ack===false
    && value.incident_policy.intentional_disconnect_backfill===false
    && value.incident_policy.known_stop_acknowledgement_is_resume_permission===false
    && value.evidence.outbound_secrets_PII_raw_payload_or_raw_error===false
    && value.scope.runtime_alarm_engine_implemented===false && value.scope.live_monitoring_active===false
    && value.scope.failure_injection_runtime_pass_claimed===false
    && value.matrix.length===16 && new Set(value.matrix.map(row=>row.id)).size===16
    && value.matrix.every((row,index)=>row.id===`AL${String(index+1).padStart(2,"0")}`
      && ["critical","action_required","informational"].includes(row.severity)
      && ["stage","detect","guard","test","implementation"].every(field=>typeof row[field]==="string"&&row[field].length>0));
}

test("alarm design freezes minute checks, hourly staggered data and strictly over two minutes of silence",()=>{
  assert.equal(valid(matrix),true);
  assert.equal(matrix.cadence.workspace_due_slots_staggered,true);
  assert.equal(matrix.cadence.deep_reconciliation_interval_hours,24);
  assert.equal(design.fairness_and_cadence.queue_check_interval_seconds,60);
  assert.equal(design.fairness_and_cadence.workspace_refresh_interval_seconds,3600);
  assert.equal(design.fairness_and_cadence.queue_check_missing_success_critical_after_seconds,120);
  assert.match(matrix.heartbeat.startup,/120_seconds/);
  assert.equal(matrix.heartbeat.replay_or_future_dated_signal_resets_deadline,false);
  assert.match(matrix.heartbeat.signal,/durable_queue_check_not_HTTP/);
  assert.equal(matrix.heartbeat.heartbeat_is_Dataset_freshness_proof,false);
});

test("every stage has prevention and a planned fault scenario in both machine and analyst language",()=>{
  for(const row of matrix.matrix) assert.ok(plan.includes(`${row.id} —`),row.id);
  assert.equal(matrix.matrix.find(row=>row.stage==="expected_no_work").severity,"informational");
  assert.equal(matrix.matrix.find(row=>row.stage==="provider_request").severity,"action_required");
  assert.equal(matrix.matrix.find(row=>row.stage==="Dataset_commit").severity,"critical");
  assert.match(matrix.incident_policy.stage_deadlines,/measured_and_approved/);
  assert.equal(matrix.incident_policy.capacity_p95_45_minutes_is_per_job_timeout,false);
  assert.match(matrix.incident_policy.uncertain_execution,/no_timer_driven_release_or_blind_replay/);
  assert.match(matrix.incident_policy.first_open_provider_error,/no_automatic_retry/);
  assert.equal(matrix.incident_policy.missing_unknown_partial_stale_unsupported_and_real_zero_are_distinct,true);
});

test("independent witness, alert delivery and explicit human acknowledgement cannot be replaced by HTTP health",()=>{
  assert.equal(matrix.independence.application_HTTP_200_is_sufficient,false);
  assert.match(matrix.independence.watchdog_absence,/independent_witness/);
  assert.match(matrix.notification.delivery_proof_unavailable,/unknown_not_success/);
  assert.match(matrix.notification.canary,/explicit_human_ack/);
  assert.match(matrix.notification.recipient_and_backup_owner,/pending_not_all_merchants/);
  assert.match(matrix.incident_policy.resolution,/ack_or_HTTP_success_alone_is_insufficient/);
  assert.equal(matrix.independence.all_shared_failure_domains_eliminated,false);
  assert.ok(matrix.activation_gates.includes("approved_primary_backup_routes_recipients_ack_and_escalation_rules"));
});

test("missing stages and reversed safety gates cannot pass the contract consistency check",()=>{
  for(const [object,key,value] of [["cadence","every_queue_check_fetches_all_workspaces",true],
    ["heartbeat","overdue_when_elapsed_seconds_gt",180],["heartbeat","deadline_reset_before_durable_check_evidence",true],
    ["heartbeat","one_healthy_worker_or_tenant_masks_others",true],["independence","watchdog_uses_same_refresh_trigger",true],
    ["independence","watchdog_requires_primary_database_to_detect_silence",true],["notification","notification_acceptance_is_human_ack",true],
    ["incident_policy","intentional_disconnect_backfill",true],["incident_policy","known_stop_acknowledgement_is_resume_permission",true],
    ["evidence","outbound_secrets_PII_raw_payload_or_raw_error",true],["scope","live_monitoring_active",true],
    ["scope","failure_injection_runtime_pass_claimed",true]]) {
    const changed=structuredClone(matrix);changed[object][key]=value;assert.equal(valid(changed),false,`${object}.${key}`);
  }
  const missing=structuredClone(matrix);missing.matrix.pop();assert.equal(valid(missing),false);
  const duplicate=structuredClone(matrix);duplicate.matrix[1].id="AL01";assert.equal(valid(duplicate),false);
});

test("design alone selects no service, changes no runtime authority and cannot close EO05E or Dataset decisions",()=>{
  for(const field of ["provider_or_notification_calls_authorized","migration_or_environment_change_authorized",
    "new_service_or_subscription_authorized","deployment_authorized","merge_authorized","zero_risk_guaranteed"]) assert.equal(matrix.scope[field],false);
  assert.equal(matrix.independence.monitor_product_selected,false);
  assert.match(matrix.heartbeat.observer_sampling_and_delivery_latency,/approved_before_activation/);
  assert.ok(matrix.activation_gates.includes("explicit_product_owner_live_activation_approval"));
  assert.equal(design.end_to_end_alarm_design,"contracts/eo-05-refresh-alarm-matrix-v1.json");
  assert.equal(design.repository_work_stops_slice.accepted_commit,"31a244155e539648acd1b95318b4c11a1ae297f6");
  assert.equal(design.listing_tree_work_order.resume_requires_explicit_product_owner_approval,true);
  const brief=JSON.parse(read("contracts/eo-05-start-brief-v1.json"));
  assert.equal(brief.scope_clarifications_2026_10_20.product_level_physical_table_selected,false);
  assert.match(plan,/EO-05-E tamamlandı sayılmaz/);
});
