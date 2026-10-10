/**
 * The shipped decision kinds, as declarations, for the unit suites — and a fixture kind no
 * migration declares.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). The nine MVP declarations live in
 * V093 (three) and V097 (six); these are the same templates, schemas and action rows, so the
 * rendering, validation and action suites run without a database. `decision.kinds.fixture.spec.ts`
 * holds every template here to the migration text, so the two cannot drift apart silently.
 *
 * `SEEDED_PAYLOADS` are the facts constraints.sql renders the mockup's prose from, and
 * `MOCKUP_PROSE` the prose — word for word, mockup 16's for the first three.
 */

import type { DecisionAction, PublishedDecisionKind } from "./decision.types";

/** Shorthand for an action row entry. */
function action(
  id: string,
  label: string,
  style: DecisionAction["style"],
  requiredRole: DecisionAction["required_role"],
  handlerBinding: string,
  takesNote = false,
): DecisionAction {
  return {
    id,
    label,
    style,
    required_role: requiredRole,
    consequence_text: `${label}.`,
    takes_note: takesNote,
    handler_binding: handlerBinding,
  };
}

/** A closed object schema over the given properties, all required. */
function schema(properties: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const count = { type: "integer", minimum: 0 };
const effort = { type: "string", enum: ["XS", "S", "M", "L", "XL"] };
const money = { type: "string", pattern: "^\\$[0-9]+\\.[0-9]{2}$" };

/** Every shipped declaration at v1, by kind id. */
export const SHIPPED_KINDS: Readonly<Record<string, PublishedDecisionKind>> = {
  merge_approval: {
    kindId: "merge_approval",
    version: 1,
    severityDefault: "err",
    questionTemplate: "Approve merge for a {pr_kind} PR?",
    whyTemplate:
      "Policy: anything labeled {policy_label} needs a human. {checks_passed}/{checks_total} checks green, verification matrix {matrix_state}, +{added} −{removed} across {files} files.",
    payloadSchema: schema({
      pr_kind: { type: "string", pattern: "^[a-z][a-z0-9-]*$", maxLength: 40 },
      policy_label: text(64),
      checks_passed: count,
      checks_total: count,
      matrix_state: { type: "string", enum: ["all ✓", "incomplete", "failing"] },
      added: count,
      removed: count,
      files: count,
    }),
    actions: [
      action("approve_merge", "Approve & merge", "primary", "approver", "pr.approve_and_merge"),
      action(
        "open_verification",
        "Open PR verification →",
        "ghost",
        "viewer",
        "navigate.pr_verification",
      ),
      action(
        "return_to_loop",
        "Return to loop with note",
        "ghost",
        "member",
        "run.return_with_note",
        true,
      ),
    ],
    resolutionSemantics: {
      answered_by: ["approve_merge", "return_to_loop"],
      closes_source: ["approve_merge"],
      auto_resolvable: false,
    },
    refShape: { required: ["run", "pr"], optional: ["ticket"], tags: ["{pr_kind}"] },
    escalationWindow: "00:30:00",
    mergeClass: true,
  },
  protected_path_allow_once: {
    kindId: "protected_path_allow_once",
    version: 1,
    severityDefault: "warn",
    questionTemplate: "Allow a one-time edit to a protected path?",
    whyTemplate:
      "{subject} wants to {edit_summary} to {path} — a protected path. Diff is {diff_lines} lines, shown in the run console.",
    payloadSchema: schema({
      subject: text(120),
      edit_summary: text(80),
      path: text(1024),
      diff_lines: { type: "integer", minimum: 1 },
    }),
    actions: [
      action("allow_once", "Allow once", "primary", "approver", "guardrail.allow_once"),
      action("view_diff", "View diff →", "ghost", "viewer", "navigate.run_diff"),
      action("deny", "Deny", "ghost", "approver", "run.deny_protected_path"),
      action(
        "edit_protected_paths",
        "Edit protected paths →",
        "ghost",
        "admin",
        "navigate.protected_paths_settings",
      ),
    ],
    resolutionSemantics: {
      answered_by: ["allow_once", "deny"],
      closes_source: ["allow_once", "deny"],
      auto_resolvable: false,
    },
    refShape: { required: ["run", "path"], optional: ["ticket"], tags: [] },
    escalationWindow: "00:30:00",
    mergeClass: false,
  },
  claim_waiver: {
    kindId: "claim_waiver",
    version: 1,
    severityDefault: "warn",
    questionTemplate: "Waive a claim the bench can't verify?",
    whyTemplate:
      "“{claim}” — the rig has no {missing_capability}. Waiving annotates the PR publicly.",
    payloadSchema: schema({ claim: text(300), missing_capability: text(80) }),
    actions: [
      action(
        "waive_annotate",
        "Waive & annotate",
        "primary",
        "approver",
        "pr.waive_criterion",
        true,
      ),
      action(
        "require_bench_upgrade",
        "Require bench upgrade",
        "ghost",
        "approver",
        "planning.require_bench_upgrade",
      ),
      action("see_evidence", "See evidence →", "ghost", "viewer", "navigate.pr_evidence"),
    ],
    resolutionSemantics: {
      answered_by: ["waive_annotate", "require_bench_upgrade"],
      closes_source: ["waive_annotate"],
      auto_resolvable: false,
    },
    refShape: { required: ["pr"], optional: ["run", "ticket"], tags: ["verification"] },
    escalationWindow: "00:30:00",
    mergeClass: false,
  },
  plan_sign_off: {
    kindId: "plan_sign_off",
    version: 1,
    severityDefault: "warn",
    questionTemplate: "Sign off a plan before the loop builds it?",
    whyTemplate:
      "{subject} is waiting at {stage_label}: its plan touches {plan_files} files. Signing off lets the loop continue.",
    payloadSchema: schema({ subject: text(120), stage_label: text(80), plan_files: count }),
    actions: [
      action("sign_off", "Sign off", "primary", "approver", "workflow.sign_off_plan"),
      action("view_plan", "View plan →", "ghost", "viewer", "navigate.run_plan"),
      action(
        "return_to_loop",
        "Return to loop with note",
        "ghost",
        "member",
        "run.return_with_note",
        true,
      ),
    ],
    resolutionSemantics: {
      answered_by: ["sign_off", "return_to_loop"],
      closes_source: ["sign_off"],
      auto_resolvable: false,
    },
    refShape: { required: ["run"], optional: ["ticket"], tags: [] },
    escalationWindow: "00:30:00",
    mergeClass: false,
  },
  fact_review: {
    kindId: "fact_review",
    version: 1,
    severityDefault: "info",
    questionTemplate: "Should the loops trust this fact?",
    whyTemplate: "“{text}” — {reason}, {provenance_line}.",
    payloadSchema: schema({
      reason: { type: "string", enum: ["awaiting review", "flagged stale"] },
      text: text(600),
      provenance_line: text(200),
    }),
    actions: [
      action("confirm", "Confirm", "primary", "member", "facts.confirm"),
      action("retire", "Retire", "ghost", "member", "facts.retire", true),
      action("open_fact", "Open in Knowledge →", "ghost", "viewer", "navigate.knowledge_fact"),
    ],
    resolutionSemantics: {
      answered_by: ["confirm", "retire"],
      closes_source: ["confirm", "retire"],
      auto_resolvable: false,
    },
    refShape: { required: [], optional: [], tags: ["knowledge"] },
    escalationWindow: "7 days",
    mergeClass: false,
  },
  run_needs_human: {
    kindId: "run_needs_human",
    version: 1,
    severityDefault: "err",
    questionTemplate: "Take over a loop that needs a human?",
    whyTemplate: "{subject} stopped at {stage_label}: {reason}.",
    payloadSchema: schema({ subject: text(120), stage_label: text(80), reason: text(200) }),
    actions: [
      action(
        "retry_with_note",
        "Retry with note",
        "primary",
        "member",
        "run.retry_with_note",
        true,
      ),
      action("open_run", "Open run →", "ghost", "viewer", "navigate.run_console"),
      action("cancel_run", "Cancel loop", "ghost", "member", "run.cancel"),
    ],
    resolutionSemantics: {
      answered_by: ["retry_with_note", "cancel_run"],
      closes_source: ["retry_with_note", "cancel_run"],
      auto_resolvable: false,
    },
    refShape: { required: ["run"], optional: ["pr", "ticket"], tags: [] },
    escalationWindow: "00:30:00",
    mergeClass: false,
  },
  split_approval: {
    kindId: "split_approval",
    version: 1,
    severityDefault: "info",
    questionTemplate: "Approve a split into {draft_count} tickets?",
    whyTemplate:
      "The planner split {subject} into {draft_count} draft tickets. Approving pushes them to {target}.",
    payloadSchema: schema({
      subject: text(120),
      draft_count: { type: "integer", minimum: 1 },
      target: text(200),
    }),
    actions: [
      action("approve_split", "Approve & push", "primary", "admin", "planning.push_batch"),
      action("open_batch", "Open in Planning →", "ghost", "viewer", "navigate.planning_batch"),
      action("discard", "Discard", "ghost", "admin", "planning.abandon_batch"),
    ],
    resolutionSemantics: {
      answered_by: ["approve_split", "discard"],
      closes_source: ["approve_split", "discard"],
      auto_resolvable: false,
    },
    refShape: { required: [], optional: ["ticket"], tags: [] },
    escalationWindow: "1 day",
    mergeClass: false,
  },
  resize_review: {
    kindId: "resize_review",
    version: 1,
    severityDefault: "info",
    questionTemplate: "Accept a re-size of {ticket_key} from {from_effort} to {to_effort}?",
    whyTemplate:
      "The estimator re-sized {ticket_key} from {from_effort} to {to_effort} at {confidence}% confidence. Accepting keeps the new size; keeping restores the old one.",
    payloadSchema: schema({
      ticket_key: text(64),
      from_effort: effort,
      to_effort: effort,
      confidence: { type: "integer", minimum: 0, maximum: 100 },
    }),
    actions: [
      action("accept_resize", "Accept new size", "primary", "member", "estimation.accept_resize"),
      action("keep_size", "Keep the old size", "ghost", "member", "estimation.keep_size"),
      action("open_ticket", "Open ticket →", "ghost", "viewer", "navigate.ticket"),
    ],
    resolutionSemantics: {
      answered_by: ["accept_resize", "keep_size"],
      closes_source: ["accept_resize", "keep_size"],
      auto_resolvable: true,
    },
    refShape: { required: ["ticket"], optional: [], tags: [] },
    escalationWindow: "1 day",
    mergeClass: false,
  },
  spend_approval: {
    kindId: "spend_approval",
    version: 1,
    severityDefault: "warn",
    questionTemplate: "Approve more spend on a loop past its cap?",
    whyTemplate:
      "{subject} has spent {spent} against a {cap} per-run cap; the loop is paused until you decide.",
    payloadSchema: schema({ subject: text(120), spent: money, cap: money }),
    actions: [
      action("approve_spend", "Approve spend", "primary", "approver", "spend.approve_overage"),
      action("open_run", "Open run →", "ghost", "viewer", "navigate.run_console"),
      action("stop_loop", "Stop loop", "ghost", "member", "run.cancel"),
    ],
    resolutionSemantics: {
      answered_by: ["approve_spend", "stop_loop"],
      closes_source: ["approve_spend", "stop_loop"],
      auto_resolvable: false,
    },
    refShape: { required: ["run"], optional: ["ticket"], tags: [] },
    escalationWindow: "00:30:00",
    mergeClass: false,
  },
};

/** The facts constraints.sql renders each kind's prose from (V093's and V097's sections). */
export const SEEDED_PAYLOADS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  merge_approval: {
    pr_kind: "refactor",
    policy_label: "refactor",
    checks_passed: 14,
    checks_total: 14,
    matrix_state: "all ✓",
    added: 214,
    removed: 180,
    files: 6,
  },
  protected_path_allow_once: {
    subject: "The OTA rollback fix",
    edit_summary: "add one line",
    path: "boot/rollback_flag.c",
    diff_lines: 3,
  },
  claim_waiver: {
    claim: "Flake must not reappear across temperature range",
    missing_capability: "thermal chamber",
  },
  plan_sign_off: {
    subject: "Rework the OTA bootloader handoff",
    stage_label: "Plan review",
    plan_files: 9,
  },
  fact_review: {
    reason: "awaiting review",
    text: "CAN frames are DMA-backed on helios-firmware",
    provenance_line: "from PR #514 review cycle",
  },
  run_needs_human: {
    subject: "OTA rollback flag is never cleared",
    stage_label: "Build",
    reason: "attempt limit reached",
  },
  split_approval: {
    subject: "Telemetry v2",
    draft_count: 6,
    target: "acme-robotics/helios-firmware",
  },
  resize_review: { ticket_key: "#486", from_effort: "L", to_effort: "M", confidence: 82 },
  spend_approval: { subject: "OTA rollback flag is never cleared", spent: "$2.61", cap: "$2.50" },
};

/** The prose each seeded payload renders — mockup 16's, word for word, for its three cards. */
export const MOCKUP_PROSE: Readonly<
  Record<string, { question: string; why: string; tags: string[] }>
> = {
  merge_approval: {
    question: "Approve merge for a refactor PR?",
    why: "Policy: anything labeled refactor needs a human. 14/14 checks green, verification matrix all ✓, +214 −180 across 6 files.",
    tags: ["refactor"],
  },
  protected_path_allow_once: {
    question: "Allow a one-time edit to a protected path?",
    why: "The OTA rollback fix wants to add one line to boot/rollback_flag.c — a protected path. Diff is 3 lines, shown in the run console.",
    tags: [],
  },
  claim_waiver: {
    question: "Waive a claim the bench can't verify?",
    why: "“Flake must not reappear across temperature range” — the rig has no thermal chamber. Waiving annotates the PR publicly.",
    tags: ["verification"],
  },
  plan_sign_off: {
    question: "Sign off a plan before the loop builds it?",
    why: "Rework the OTA bootloader handoff is waiting at Plan review: its plan touches 9 files. Signing off lets the loop continue.",
    tags: [],
  },
  fact_review: {
    question: "Should the loops trust this fact?",
    why: "“CAN frames are DMA-backed on helios-firmware” — awaiting review, from PR #514 review cycle.",
    tags: ["knowledge"],
  },
  run_needs_human: {
    question: "Take over a loop that needs a human?",
    why: "OTA rollback flag is never cleared stopped at Build: attempt limit reached.",
    tags: [],
  },
  split_approval: {
    question: "Approve a split into 6 tickets?",
    why: "The planner split Telemetry v2 into 6 draft tickets. Approving pushes them to acme-robotics/helios-firmware.",
    tags: [],
  },
  resize_review: {
    question: "Accept a re-size of #486 from L to M?",
    why: "The estimator re-sized #486 from L to M at 82% confidence. Accepting keeps the new size; keeping restores the old one.",
    tags: [],
  },
  spend_approval: {
    question: "Approve more spend on a loop past its cap?",
    why: "OTA rollback flag is never cleared has spent $2.61 against a $2.50 per-run cap; the loop is paused until you decide.",
    tags: [],
  },
};

/**
 * A kind no migration declares — what an amendment ticket (or a test) registers to join the inbox
 * with **zero changes to inbox core code**. The bench's oven can't hold a temperature.
 */
export const FIXTURE_KIND: PublishedDecisionKind = {
  kindId: "custom:fixture-oven",
  version: 1,
  severityDefault: "warn",
  questionTemplate: "Let the oven at {rig} run {minutes} minutes over?",
  whyTemplate: "{rig} drifted {drift_c}°C off its setpoint; extending lets the soak finish.",
  payloadSchema: schema({
    rig: text(60),
    minutes: { type: "integer", minimum: 1, maximum: 240 },
    drift_c: { type: "number", minimum: 0 },
  }),
  actions: [
    action("extend", "Extend soak", "primary", "member", "farm.extend_soak"),
    action("open_rig", "Open rig →", "ghost", "viewer", "navigate.farm_rig"),
    action("abort", "Abort soak", "danger", "approver", "farm.abort_soak", true),
  ],
  resolutionSemantics: {
    answered_by: ["extend", "abort"],
    closes_source: ["extend", "abort"],
    auto_resolvable: false,
  },
  refShape: { required: ["run"], optional: [], tags: ["{rig}", "farm"] },
  escalationWindow: "00:30:00",
  mergeClass: false,
};
