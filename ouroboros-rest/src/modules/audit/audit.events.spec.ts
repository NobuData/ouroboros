import {
  RUNNER_POOL_WINDOW_ADDED_EVENT,
  RUNNER_POOL_WINDOW_REMOVED_EVENT,
  RUNNER_JOB_HOOK_REGISTERED_EVENT,
  RUNNER_JOB_HOOK_REMOVED_EVENT,
  ANALYSIS_SUGGESTION_APPLIED_EVENT,
  ANALYSIS_SUGGESTION_DISMISSED_EVENT,
  ANALYSIS_SUGGESTION_DRAFTED_EVENT,
  ANALYZER_BATCH_PUSHED_EVENT,
  ANALYZER_RUN_REQUESTED_EVENT,
  ANALYZER_SCHEDULE_UPDATED_EVENT,
  AUDIT_ACTIONS,
  WORKSPACE_DELETE_REQUESTED_EVENT,
  WORKSPACE_DISCONNECTED_EVENT,
  WORKSPACE_PAUSED_EVENT,
  WORKSPACE_PURGED_EVENT,
  WORKSPACE_RESTORED_EVENT,
  WORKSPACE_RESUMED_EVENT,
  WORKSPACE_UPDATED_EVENT,
  auditDetail,
  GITHUB_TOKEN_CLEARED_EVENT,
  RUNNER_CERT_RENEWED_EVENT,
  RUNNER_CERT_REVOKED_EVENT,
  RUNNER_DRAINED_EVENT,
  RUNNER_ENROLLED_EVENT,
  RUNNER_JOB_SUBMITTED_EVENT,
  RUNNER_POOL_CREATED_EVENT,
  RUNNER_POOL_DELETED_EVENT,
  RUNNER_POOL_UPDATED_EVENT,
  RUNNER_REMOVED_EVENT,
  RUNNER_UNDRAINED_EVENT,
  RUNNER_TOKEN_MINTED_EVENT,
  RUNNER_TOKEN_REVOKED_EVENT,
  GITHUB_TOKEN_ROTATED_EVENT,
  GITHUB_TOKEN_SET_EVENT,
  LEASE_GRANTED_EVENT,
  providerUpdateEvent,
  PROVIDER_ADDED_EVENT,
  PROVIDER_CAP_CHANGED_EVENT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_DISABLED_EVENT,
  PROVIDER_ENABLED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_TESTED_EVENT,
  PROVIDER_UPDATED_EVENT,
  RUNNER_FLAGGED_EVENT,
  TRIAGE_CLASSIFIED_EVENT,
  TRIAGE_RERUN_REQUESTED_EVENT,
  TRIAGE_WAIVED_EVENT,
  TRIAGE_INTENTS_SET_EVENT,
  PR_CRITERION_VERIFIED_EVENT,
  PR_CRITERION_UNVERIFIED_EVENT,
  PR_CRITERION_WAIVED_EVENT,
  PR_APPROVAL_APPROVED_EVENT,
  PR_APPROVAL_DECLINED_EVENT,
  PR_THREAD_RESOLVED_EVENT,
  PR_APPROVAL_REQUESTED_EVENT,
  KNOWLEDGE_IMPORTED_EVENT,
  KNOWLEDGE_REPO_MAP_GENERATED_EVENT,
  KNOWLEDGE_ENV_RECIPE_SAVED_EVENT,
  POLICY_DRY_RUN_CHANGED_EVENT,
  MEMBER_INVITED_EVENT,
  MEMBER_INVITATION_RESENT_EVENT,
  MEMBER_INVITATION_REVOKED_EVENT,
  MEMBER_ROLE_CHANGED_EVENT,
  MEMBER_REMOVED_EVENT,
  MEMBER_CAPABILITY_CHANGED_EVENT,
  SERVICE_ACCOUNT_CREATED_EVENT,
  SERVICE_ACCOUNT_ROTATED_EVENT,
  SERVICE_ACCOUNT_REVOKED_EVENT,
  DECISION_FILED_EVENT,
  DECISION_REFRESHED_EVENT,
  DECISION_SOURCE_RESOLVED_EVENT,
} from "./audit.events";

/**
 * The vocabulary, and the three things it has to be.
 *
 * **AD.4's own names** ([#225](https://github.com/NobuData/ouroboros/issues/225)), spelled
 * as that issue's scope spelled them, so somebody grepping the trail later finds the strings
 * that were agreed rather than ones a module invented. **Storable**, which means every one of
 * them satisfies the grammar V022 constrains the column to — a name this service could write
 * and PostgreSQL would refuse is a credential operation that fails at its last statement.
 * And **decidable**, because a `PATCH` that changed two things must still write exactly one
 * event and the same one every time.
 */

describe("the vocabulary", () => {
  it("is the ten names AD.4 and AD.3 wrote down, plus K.3's three, AH.2's six and AH.6's five", () => {
    // The three `github.*` names are K.3's ([#101](https://github.com/NobuData/ouroboros/issues/101)),
    // under decision **AD.4**'s rule that credential operations are audited from the day they
    // exist. A workspace's GitHub token is a credential like a provider's, and adding a name
    // is an application release rather than a migration — V022 constrains the *grammar* and
    // not the vocabulary.
    //
    // The six `runner.*` names are AH.2's ([#250](https://github.com/NobuData/ouroboros/issues/250)),
    // under the same rule one epic further out: an operation that changes who may connect to a
    // workspace is audited from the day it exists. Five are that issue's own scope;
    // `runner.removed` is declared here and written by AH.6 (#254), because this file is the
    // vocabulary and a name that existed in one place and was filtered for in another is the
    // thing the list exists to prevent.
    //
    // The last five are AH.6's own ([#254](https://github.com/NobuData/ouroboros/issues/254)):
    // the lifecycle actions on mockup 08's `⋯` menu and the POOLS card's CRUD. Draining is
    // here because V040 split `status` from `desired_state` precisely so that "who drained
    // bigiron?" has an answer, and the column records that a decision was made while this
    // records who made it.
    //
    // The last is AI.5's ([#260](https://github.com/NobuData/ouroboros/issues/260)): a build
    // submission runs somebody's command on the workspace's own hardware, and *who sent it*
    // is not on the job row.
    //
    // The last four are AT.4's ([#332](https://github.com/NobuData/ouroboros/issues/332)): a
    // runner flagged with a health note, and the three Mark & Route decisions — classify,
    // re-run, waive — each of which dispatches something or records a judgement.
    //
    // The last three are AX.3's ([#359](https://github.com/NobuData/ouroboros/issues/359)): a
    // criterion's status changes on mockup 12's matrix — verified, unverified, waived — each a
    // judgement about whether the PR does what the ticket said.
    //
    // The last eight are BV.5's ([#514](https://github.com/NobuData/ouroboros/issues/514)): the
    // farm configuration the Build Analyzer composes — pool windows and job hooks — and the
    // analyzer's own actions on a suggestion. `analysis_suggestion.applied` is spelled as V081
    // requires of the event an applied suggestion names.
    //
    // The last six are BR.5's ([#489](https://github.com/NobuData/ouroboros/issues/489)): the
    // Danger zone's transitions — pause, resume, disconnect, delete, restore and the purge.
    expect([...AUDIT_ACTIONS]).toEqual([
      "provider.added",
      "provider.revealed",
      "provider.rotated",
      "provider.enabled",
      "provider.disabled",
      "provider.cap_changed",
      "provider.updated",
      "provider.deleted",
      "provider.tested",
      "credential.lease_granted",
      "github.token_set",
      "github.token_rotated",
      "github.token_cleared",
      "runner.token_minted",
      "runner.token_revoked",
      "runner.enrolled",
      "runner.cert_renewed",
      "runner.cert_revoked",
      "runner.removed",
      "runner.drained",
      "runner.undrained",
      "runner.pool_created",
      "runner.pool_updated",
      "runner.pool_deleted",
      "runner.job_submitted",
      "runner.flagged",
      "triage.classified",
      "triage.rerun_requested",
      "triage.waived",
      "triage.intents_set",
      "pr_criterion.verified",
      "pr_criterion.unverified",
      "pr_criterion.waived",
      "pr_approval.requested",
      "pr_approval.approved",
      "pr_approval.declined",
      "pr_thread.resolved",
      "knowledge.imported",
      "knowledge.repo_map_generated",
      "knowledge.env_recipe_saved",
      "policy.dry_run_changed",
      "analyzer.run_requested",
      "runner.pool_window_added",
      "runner.pool_window_removed",
      "runner.job_hook_registered",
      "runner.job_hook_removed",
      "analysis_suggestion.applied",
      "analysis_suggestion.dismissed",
      "analysis_suggestion.drafted",
      "analyzer.batch_pushed",
      "analyzer.schedule_updated",
      "workspace.paused",
      "workspace.resumed",
      "workspace.disconnected",
      "workspace.delete_requested",
      "workspace.restored",
      "workspace.purged",
      "workspace.updated",
      "member.invited",
      "member.invitation_resent",
      "member.invitation_revoked",
      "member.role_changed",
      "member.removed",
      "member.capability_changed",
      "service_account.created",
      "service_account.rotated",
      "service_account.revoked",
      "decision.filed",
      "decision.refreshed",
      "decision.source_resolved",
    ]);
  });

  it("has no duplicates, so a filter on one name cannot mean two things", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("satisfies the grammar V022 enforces", () => {
    // `family.event`, lower snake on both sides — `audit_events_action_grammar`. Asserted
    // against the same pattern the migration carries, because the two rules are only useful
    // if they agree.
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });

  it("files each event under a family somebody would think to filter on", () => {
    // Nine provider events, one credential-delivery event, three about the workspace's GitHub
    // token, thirteen about its build farm — its machines, the pools they run in and the
    // builds sent to them — three decisions about its failing tests (#332), three about
    // whether a PR does what its ticket said (#359), three about who approved a PR (#361), and one
    // about who resolved a review-thread entry (#368), and one about who flipped the dry-run
    // policy (#382), under `policy.` so every org-policy change is one question, and one about
    // who asked for a Build Analyzer run (#510), under `analyzer.`, and `analysis_suggestion.`
    // for what was done with a suggestion (#514) — V081 spells the apply event that way — and
    // `workspace.` for the Danger zone's lifecycle (#489), `member.` for the Members & Roles card
    // and `service_account.` for its non-human principals (#485), and `decision.` for what the
    // planes file into the Needs-You inbox and what closes itself out of band (#461). The
    // families are what make `action like 'provider.%'` a useful question — and what keeps
    // *"who changed our GitHub token"* and *"what has happened to our fleet"* answerable
    // without knowing every name in either. The pool events are deliberately inside
    // `runner.` rather than a family of their own, so the fleet stays one question.
    const families = new Set(AUDIT_ACTIONS.map((action) => action.split(".")[0]));

    expect([...families].sort()).toEqual([
      "analysis_suggestion",
      "analyzer",
      "credential",
      "decision",
      "github",
      "knowledge",
      "member",
      "policy",
      "pr_approval",
      "pr_criterion",
      "pr_thread",
      "provider",
      "runner",
      "service_account",
      "triage",
      "workspace",
    ]);
  });

  it("exports every name individually as well as in the list", () => {
    // The list is what a filter validates against; the constants are what the writers use. A
    // name in one and not the other is an event that can be written and not filtered for, or
    // filtered for and never written.
    const named = [
      PROVIDER_ADDED_EVENT,
      PROVIDER_REVEALED_EVENT,
      PROVIDER_ROTATED_EVENT,
      PROVIDER_ENABLED_EVENT,
      PROVIDER_DISABLED_EVENT,
      PROVIDER_CAP_CHANGED_EVENT,
      PROVIDER_UPDATED_EVENT,
      PROVIDER_DELETED_EVENT,
      PROVIDER_TESTED_EVENT,
      LEASE_GRANTED_EVENT,
      GITHUB_TOKEN_SET_EVENT,
      GITHUB_TOKEN_ROTATED_EVENT,
      GITHUB_TOKEN_CLEARED_EVENT,
      RUNNER_TOKEN_MINTED_EVENT,
      RUNNER_TOKEN_REVOKED_EVENT,
      RUNNER_ENROLLED_EVENT,
      RUNNER_CERT_RENEWED_EVENT,
      RUNNER_CERT_REVOKED_EVENT,
      RUNNER_REMOVED_EVENT,
      RUNNER_DRAINED_EVENT,
      RUNNER_UNDRAINED_EVENT,
      RUNNER_POOL_CREATED_EVENT,
      RUNNER_POOL_UPDATED_EVENT,
      RUNNER_POOL_DELETED_EVENT,
      RUNNER_JOB_SUBMITTED_EVENT,
      RUNNER_FLAGGED_EVENT,
      TRIAGE_CLASSIFIED_EVENT,
      TRIAGE_RERUN_REQUESTED_EVENT,
      TRIAGE_WAIVED_EVENT,
      TRIAGE_INTENTS_SET_EVENT,
      PR_CRITERION_VERIFIED_EVENT,
      PR_CRITERION_UNVERIFIED_EVENT,
      PR_CRITERION_WAIVED_EVENT,
      PR_APPROVAL_REQUESTED_EVENT,
      PR_APPROVAL_APPROVED_EVENT,
      PR_APPROVAL_DECLINED_EVENT,
      PR_THREAD_RESOLVED_EVENT,
      KNOWLEDGE_IMPORTED_EVENT,
      KNOWLEDGE_REPO_MAP_GENERATED_EVENT,
      KNOWLEDGE_ENV_RECIPE_SAVED_EVENT,
      POLICY_DRY_RUN_CHANGED_EVENT,
      ANALYZER_RUN_REQUESTED_EVENT,
      RUNNER_POOL_WINDOW_ADDED_EVENT,
      RUNNER_POOL_WINDOW_REMOVED_EVENT,
      RUNNER_JOB_HOOK_REGISTERED_EVENT,
      RUNNER_JOB_HOOK_REMOVED_EVENT,
      ANALYSIS_SUGGESTION_APPLIED_EVENT,
      ANALYSIS_SUGGESTION_DISMISSED_EVENT,
      ANALYSIS_SUGGESTION_DRAFTED_EVENT,
      ANALYZER_BATCH_PUSHED_EVENT,
      ANALYZER_SCHEDULE_UPDATED_EVENT,
      WORKSPACE_PAUSED_EVENT,
      WORKSPACE_RESUMED_EVENT,
      WORKSPACE_DISCONNECTED_EVENT,
      WORKSPACE_DELETE_REQUESTED_EVENT,
      WORKSPACE_RESTORED_EVENT,
      WORKSPACE_PURGED_EVENT,
      WORKSPACE_UPDATED_EVENT,
      MEMBER_INVITED_EVENT,
      MEMBER_INVITATION_RESENT_EVENT,
      MEMBER_INVITATION_REVOKED_EVENT,
      MEMBER_ROLE_CHANGED_EVENT,
      MEMBER_REMOVED_EVENT,
      MEMBER_CAPABILITY_CHANGED_EVENT,
      SERVICE_ACCOUNT_CREATED_EVENT,
      SERVICE_ACCOUNT_ROTATED_EVENT,
      SERVICE_ACCOUNT_REVOKED_EVENT,
      DECISION_FILED_EVENT,
      DECISION_REFRESHED_EVENT,
      DECISION_SOURCE_RESOLVED_EVENT,
    ];

    expect(named).toEqual([...AUDIT_ACTIONS]);
  });
});

describe("which name a settings change gets", () => {
  it("is the switch's own name when the switch is all that moved", () => {
    expect(providerUpdateEvent(["enabled"], true)).toBe(PROVIDER_ENABLED_EVENT);
    expect(providerUpdateEvent(["enabled"], false)).toBe(PROVIDER_DISABLED_EVENT);
  });

  it("is the cap's own name when the cap is all that moved", () => {
    expect(providerUpdateEvent(["monthlyCapCents"])).toBe(PROVIDER_CAP_CHANGED_EVENT);
  });

  it("is the general name for an edit AD.4 singles nothing out for", () => {
    // Renaming a connection and re-pointing its address are both events — *somebody changed
    // where this workspace's inference goes* is exactly what a trail is for — and inventing
    // `provider.renamed` here would be putting a name into AD.4's vocabulary from outside it.
    expect(providerUpdateEvent(["displayName"])).toBe(PROVIDER_UPDATED_EVENT);
    expect(providerUpdateEvent(["config"])).toBe(PROVIDER_UPDATED_EVENT);
    expect(providerUpdateEvent(["capabilityNote"])).toBe(PROVIDER_UPDATED_EVENT);
  });

  it("is the general name when the request did more than one thing", () => {
    // One act with two effects. `provider.enabled` on a request that also tripled the spend
    // ceiling would answer *what happened* with half of it.
    expect(providerUpdateEvent(["enabled", "monthlyCapCents"], true)).toBe(PROVIDER_UPDATED_EVENT);
  });

  it("is the general name for an edit that wrote nothing, which is a state no caller reaches", () => {
    // `PATCH {}` writes no event at all — the service returns before it records — so this is
    // a defensive answer rather than a path. It is asserted because the alternative to an
    // answer is a `switch` with a hole in it.
    expect(providerUpdateEvent([])).toBe(PROVIDER_UPDATED_EVENT);
  });

  it("calls a switch of unknown direction disabled rather than guessing enabled", () => {
    // Unreachable from the service, which only passes `enabled` when `enabled` is a field.
    // The answer still has to be one of the two, and *off* is the conservative reading of a
    // switch nobody can prove was turned on.
    expect(providerUpdateEvent(["enabled"])).toBe(PROVIDER_DISABLED_EVENT);
  });
});

describe("what reaches the detail column", () => {
  it("keeps every field that has a value", () => {
    expect(auditDetail({ kind: "anthropic", latency_ms: 38, ok: true, cap: null })).toEqual({
      kind: "anthropic",
      latency_ms: 38,
      ok: true,
      cap: null,
    });
  });

  it("drops the fields a builder left undefined", () => {
    // Builders compose their payloads with `undefined` where a field does not apply, so this
    // is what turns that into the object the column stores.
    expect(auditDetail({ kind: "anthropic", reason: undefined })).toEqual({ kind: "anthropic" });
  });

  it("keeps null, because null is an answer and undefined is the absence of one", () => {
    // `from_cap_cents: null` on a cap change means *there was no cap before*, which is the
    // most interesting cap change there is. Dropping it would make that indistinguishable
    // from a payload that forgot to say.
    expect(auditDetail({ from_cap_cents: null, to_cap_cents: 60000 })).toEqual({
      from_cap_cents: null,
      to_cap_cents: 60000,
    });
  });

  it("answers an event with nothing to say with an object rather than nothing", () => {
    // V022 defaults the column to `{}` for the same reason: a document a reader can
    // enumerate, rather than a null every reader has to test for first.
    expect(auditDetail()).toEqual({});
    expect(auditDetail({})).toEqual({});
  });

  it("is flat, which is what makes enumerating the keys the whole of reading it", () => {
    // The type refuses a nested value, and this is the runtime half of the same statement:
    // both secrecy greps scan the top level, so a nested object would be somewhere for a
    // credential to hide from them.
    for (const value of Object.values(auditDetail({ kind: "anthropic", latency_ms: 38 }))) {
      expect(typeof value).not.toBe("object");
    }
  });
});
