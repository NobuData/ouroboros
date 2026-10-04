/**
 * The trail's vocabulary — what may be recorded, and what a record may carry.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)). This module holds no
 * behaviour at all: it is the set of names the writers agree on and the shape they agree to
 * write, in one file, so that `where action = 'provider.revealed'` finds every reveal.
 *
 * ---------------------------------------------------------------------------
 * **Why the vocabulary is here and not in the schema mirror.** V022 constrains `action` to
 * an identifier grammar and deliberately *not* to a list — adding an event has to be an
 * application release rather than a migration. So `db/schema.ts` declares `action: string`,
 * which is what the column holds, and this file declares what this service writes. The two
 * are different questions and drift for different reasons.
 *
 * **Nothing here is secret material, and the type says so.** {@link AuditDetail} is a flat
 * record of scalars, which is not a stylistic preference: flatness is what makes
 * *enumerate the keys and you have read the whole payload* true, and both secrecy greps —
 * `audit.secrecy.spec.ts` here and the `audit_events` section of `ouroboros-db`'s
 * `tests/seed.sql` — depend on it. A nested object would give a credential somewhere to hide
 * from a top-level scan.
 *
 * There is also nothing in this file that *takes* a credential. No builder below has a
 * parameter a plaintext, a mask or an envelope could be passed to, which is a stronger
 * statement than a rule about what callers should do: the compiler refuses the call.
 */

/**
 * The kind of thing an event is about.
 *
 * Half of V022's deliberately non-referential subject — see that migration on why an event
 * about a connection must outlive the connection. Three members today; #26 adds
 * `organization` when it lands its own events.
 *
 * `runner` and `enrollment_token` joined with AH.2
 * ([#250](https://github.com/NobuData/ouroboros/issues/250)), and they are the first subjects
 * here that name a machine rather than a person's credential. The rule is AD.4's own, applied
 * one epic further out: an operation that changes who may connect to a workspace is audited
 * from the day it exists. A runner's `subjectId` is its row id; an enrollment token's is its
 * row id too — never its value, which by then exists only as an envelope.
 *
 * `runner_pool` joined with AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)),
 * which owns mockup 08's POOLS card. A pool is not a credential, and it is audited for the
 * neighbouring reason: it decides what a build runs *under* — the executor, the pinned image
 * and the environment a job may carry onto a machine this product does not administer. An
 * `env_allowlist` widened by one name is a change somebody has to be able to find later.
 *
 * `github_credential` joined with K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)):
 * a workspace's GitHub token is a credential like a provider's, and decision **AD.4**'s rule
 * is that credential operations are audited from the day they exist rather than from the day
 * somebody asks who changed one. Its `subjectId` is the workspace id — there is one token per
 * workspace, so the credential has no identity of its own to name.
 */
export type AuditSubjectType =
  | "provider_connection"
  | "run"
  | "github_credential"
  | "runner"
  | "runner_pool"
  | "enrollment_token"
  | "build_job"
  | "test_case"
  | "test_run"
  | "pr_waiver"
  | "pr_criterion"
  | "pr_approval"
  | "pr_thread_entry"
  | "repository"
  | "org_policy"
  | "analysis_run"
  | "analysis_schedule"
  | "runner_pool_window"
  | "farm_job_hook"
  | "analysis_suggestion"
  | "draft_batch"
  | "workspace"
  | "member"
  | "invitation"
  | "service_account";

/** A provider connection was created — or an attempt to create one was refused. */
export const PROVIDER_ADDED_EVENT = "provider.added";

/** A stored provider credential was handed back to a person — or a request for one was refused. */
export const PROVIDER_REVEALED_EVENT = "provider.revealed";

/** A provider credential was replaced by a new, live-validated one — or the replacement failed. */
export const PROVIDER_ROTATED_EVENT = "provider.rotated";

/** A connection was switched on. */
export const PROVIDER_ENABLED_EVENT = "provider.enabled";

/** A connection was switched off. */
export const PROVIDER_DISABLED_EVENT = "provider.disabled";

/** A connection's monthly spend cap moved. */
export const PROVIDER_CAP_CHANGED_EVENT = "provider.cap_changed";

/**
 * A connection's settings changed in some way the three names above do not single out — its
 * name, its address, its capability note, or more than one thing at once.
 *
 * **AD.4's scope does not list this name and AD.2 already writes it**, which is worth an
 * argument rather than a shrug. That scope names `enabled`, `disabled` and `cap_changed`
 * because those are the three settings mockup 07 exposes as affordances of their own — the
 * switch on a card, and the cap under it — and a trail that said *updated* where a person saw
 * themselves press a switch would be describing the request instead of the act.
 *
 * It does not follow that every other edit is not an event. `PATCH` also renames a
 * connection and re-points its address, and *somebody changed where this workspace's
 * inference goes* is exactly the kind of fact an audit trail exists to hold. Inventing
 * `provider.renamed` and `provider.address_changed` from outside AD.4 would be putting names
 * into its vocabulary; dropping the event would be losing the fact. So AD.2's own general
 * name is kept for the general case, and {@link providerUpdateEvent} is the one place that
 * decides which of the four a given edit was.
 */
export const PROVIDER_UPDATED_EVENT = "provider.updated";

/** A connection was removed — or a removal was refused. */
export const PROVIDER_DELETED_EVENT = "provider.deleted";

/** A connection was checked against its live provider. */
export const PROVIDER_TESTED_EVENT = "provider.tested";

/**
 * A worker was told how to reach a local provider (AD.3,
 * [#224](https://github.com/NobuData/ouroboros/issues/224)).
 *
 * Named without the word it describes — `LEASE_GRANTED_EVENT` rather than
 * `CREDENTIAL_LEASE_GRANTED` — because `ouroboros/no-secret-logging` reports an identifier
 * whose words include `credential` inside a call to a sink, and this constant is passed to
 * one. The rule is right to be loud: the string is a name and the identifier is not the place
 * to restate it. `lease.audit.ts` chose the same spelling for the same reason, and imports
 * this one rather than keeping its own.
 */
export const LEASE_GRANTED_EVENT = "credential.lease_granted";

/**
 * A workspace's GitHub token was stored for the first time — or an attempt to store one was
 * refused (K.3, [#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * Separate from {@link GITHUB_TOKEN_ROTATED_EVENT} because the two answer different
 * questions. *"When did this workspace start syncing"* is this one, once. *"Has the token
 * been replaced since, and by whom"* is the other, and a trail that spelled both `set` would
 * make the second unanswerable without counting.
 */
export const GITHUB_TOKEN_SET_EVENT = "github.token_set";

/** A workspace's GitHub token was replaced by a new one — or the replacement was refused. */
export const GITHUB_TOKEN_ROTATED_EVENT = "github.token_rotated";

/**
 * A workspace's GitHub token was removed — or a removal was refused.
 *
 * Written even when there was nothing to remove, with `removed: false` in the detail: an
 * administrator pressing *Clear* on a workspace that already had no token performed the
 * operation, and a trail that only recorded the presses that changed something would be a
 * trail of outcomes rather than of actions.
 */
export const GITHUB_TOKEN_CLEARED_EVENT = "github.token_cleared";

/* ---------------------------------------------------------------------------
 * The build farm's identity lifecycle — AH.2
 * ([#250](https://github.com/NobuData/ouroboros/issues/250)), decision **B3**.
 *
 * Five names, which are the five the issue's scope lists. They are namespaced `runner.*` for
 * the reason the `provider.*` family is: `where action like 'runner.%'` should be the whole
 * of *what has happened to this workspace's fleet*, and a bare `token_minted` would leave
 * that query naming a prefix nobody enforces.
 *
 * `runner.cert_revoked` is a sixth, and it is not in the issue's list because the issue
 * writes `removed` for the operator action that AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254))
 * performs. Revoking a certificate and removing a runner are different acts — a certificate
 * is revoked when a machine is suspected, and a runner is removed when it is retired, and
 * only the first is an incident — so the trail gets a name for each.
 * ------------------------------------------------------------------------ */

/** An enrollment token was minted. Its value existed once, in the response; not here. */
export const RUNNER_TOKEN_MINTED_EVENT = "runner.token_minted";

/** An enrollment token was revoked before it expired. */
export const RUNNER_TOKEN_REVOKED_EVENT = "runner.token_revoked";

/** A machine enrolled — or an attempt to enrol was refused. */
export const RUNNER_ENROLLED_EVENT = "runner.enrolled";

/** A runner replaced its certificate over the already-authenticated channel. */
export const RUNNER_CERT_RENEWED_EVENT = "runner.cert_renewed";

/** A runner's certificate was revoked, so the next handshake refuses it. */
export const RUNNER_CERT_REVOKED_EVENT = "runner.cert_revoked";

/**
 * A runner was removed from the fleet.
 *
 * Written by AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), which owns the
 * lifecycle action. The name is declared here rather than there because this file is the
 * vocabulary — one place where `where action = …` can be answered from — and AH.2's scope is
 * where the farm's five names were decided.
 */
export const RUNNER_REMOVED_EVENT = "runner.removed";

/**
 * A runner was withdrawn from dispatch — and the answer to *who drained bigiron?*
 *
 * Written by AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). V040 splits
 * `runners.status` from `runners.desired_state` so that an operator's decision cannot be
 * overwritten by a measurement, and its own comment names the question that split exists to
 * make answerable. The column says a decision was made; this says who made it.
 */
export const RUNNER_DRAINED_EVENT = "runner.drained";

/** A drained runner was returned to dispatch. The other half of {@link RUNNER_DRAINED_EVENT}. */
export const RUNNER_UNDRAINED_EVENT = "runner.undrained";

/**
 * A pool was created, changed or deleted — mockup 08's POOLS card (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * Three names rather than one `pool.changed`, because the three are different events to
 * whoever is reading the trail after something went wrong: a pool that was *switched off* took
 * no new work from that moment, a pool whose *image* changed builds different artefacts from
 * that moment, and a pool that was *deleted* had nothing pointing at it. `runner.pool_updated`
 * carries the field names that changed — never their values, which for `env_allowlist` would
 * be the shape of a workspace's secrets.
 *
 * **In the `runner` family, not a `pool` one of their own.** A pool is how the fleet is
 * configured, and `action like 'runner.%'` should stay the one question that answers *what
 * has happened to our build farm* — a second family would make it two questions, and the
 * second one is the one somebody forgets to ask.
 */
export const RUNNER_POOL_CREATED_EVENT = "runner.pool_created";

/** A pool's configuration changed, including its enabled switch. */
export const RUNNER_POOL_UPDATED_EVENT = "runner.pool_updated";

/** A pool was deleted — only ever one nothing pointed at. */
export const RUNNER_POOL_DELETED_EVENT = "runner.pool_deleted";

/**
 * A build was submitted to a pool — the answer to *who sent this to our hardware?*
 *
 * Written by AH.4's submission ([#252](https://github.com/NobuData/ouroboros/issues/252)) since
 * AI.5 ([#260](https://github.com/NobuData/ouroboros/issues/260)) gave it a dialog. A
 * submission runs a command, chosen by whoever submitted it, on a machine the workspace owns
 * and this product does not administer; the job row says *what* ran and this says *who asked*.
 * Its subject is the build (`build_job`), and its actor is `null` when a run submitted it
 * rather than a person (AJ.3, [#265](https://github.com/NobuData/ouroboros/issues/265)).
 *
 * **In the `runner` family**, for {@link RUNNER_POOL_CREATED_EVENT}'s reason: `action like
 * 'runner.%'` stays the one question that answers *what has happened to our build farm*. And
 * one dot, because V022's `audit_events_action_grammar` refuses a second.
 */
export const RUNNER_JOB_SUBMITTED_EVENT = "runner.job_submitted";

/**
 * A runner was flagged with a farm health note because a failure it ran was classified
 * `infra_rig` (AT.4, [#332](https://github.com/NobuData/ouroboros/issues/332)). In the `runner`
 * family, so *what has happened to our fleet* stays one question. The note itself is on the
 * runner row; the detail names the classification that wrote it.
 */
export const RUNNER_FLAGGED_EVENT = "runner.flagged";

/**
 * A person classified a failing test case on the Mark & Route card (AT.4, #332, decision
 * **T7**). Subject `test_case`; the detail carries the class, the subtype, what was routed —
 * `control_id`, `rerun_job_id`, `target_attempt` — and never the correction note, which is in
 * the classification row and the transcript.
 *
 * **A family of its own, `triage`.** Classifying, re-running and waiving are decisions about test
 * results, not about credentials or the fleet, and `action like 'triage.%'` is the question
 * *who decided what about our failures*.
 */
export const TRIAGE_CLASSIFIED_EVENT = "triage.classified";

/** *Re-run failed* or *Re-run full suite* dispatched a new build attempt (#332). Subject `test_run`. */
export const TRIAGE_RERUN_REQUESTED_EVENT = "triage.rerun_requested";

/**
 * A waiver was recorded (#332, decision **T8**). Subject `pr_waiver`; the reason is in the row.
 * The PR annotation is AV.2's ([#344](https://github.com/NobuData/ouroboros/issues/344)) and is
 * not attempted.
 */
export const TRIAGE_WAIVED_EVENT = "triage.waived";

/**
 * A person set the run's PR toggles on the Mark & Route card without classifying anything
 * ([#340](https://github.com/NobuData/ouroboros/issues/340), decision **T8**). Subject `run`; the
 * detail carries only the toggles the request named, as they were set. Toggles sent with a
 * classification are part of that decision and are not audited a second time under this name.
 */
export const TRIAGE_INTENTS_SET_EVENT = "triage.intents_set";

/**
 * A person marked an acceptance criterion `verified` on mockup 12's matrix (AX.3,
 * [#359](https://github.com/NobuData/ouroboros/issues/359), decision **V6**). Subject
 * `pr_criterion`; the detail carries the PR, the status it left and how many evidence rows back it.
 *
 * **A family of its own, `pr_criterion`.** *Who decided this PR does what the ticket says* is a
 * question about claims, not about test failures (`triage`), and `action like 'pr_criterion.%'`
 * answers it whole.
 */
export const PR_CRITERION_VERIFIED_EVENT = "pr_criterion.verified";

/** A person moved a verified criterion back to `unverified` (#359). Subject `pr_criterion`. */
export const PR_CRITERION_UNVERIFIED_EVENT = "pr_criterion.unverified";

/**
 * A person waived a criterion (#359, decision **V9**): the AS.4 waiver was written and the host PR
 * annotation attempted. Subject `pr_criterion`; the detail names the waiver, the status it left and
 * how the annotation landed (`annotated` or `failed`) — never the reason, which is in the waiver
 * row and on the PR.
 */
export const PR_CRITERION_WAIVED_EVENT = "pr_criterion.waived";

/**
 * A person asked for a human review of a PR — *Request human review* opened an approval slot (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361), decision **V5**). Subject
 * `pr_approval`; the detail carries the PR, the revision asked about and whether a host reviewer
 * was asked.
 *
 * **A family of its own, `pr_approval`.** *Who approved the code that merged* is its own question,
 * and `action like 'pr_approval.%'` answers it whole.
 */
export const PR_APPROVAL_REQUESTED_EVENT = "pr_approval.requested";

/** A reviewer approved a PR's slot (#361). Subject `pr_approval`; never the note. */
export const PR_APPROVAL_APPROVED_EVENT = "pr_approval.approved";

/** A reviewer declined a PR's slot (#361). Subject `pr_approval`; never the note. */
export const PR_APPROVAL_DECLINED_EVENT = "pr_approval.declined";

/**
 * A person resolved an entry of a PR's review thread
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)). Subject `pr_thread_entry`; the
 * detail carries the PR, whether the entry was blocking, whether a reply was written and how its
 * host mirror landed — never the reply.
 *
 * **A family of its own, `pr_thread`.** The row records what was said and not who resolved it, so
 * *who cleared the objection that blocked this PR* is answered here, by
 * `action like 'pr_thread.%'`.
 */
export const PR_THREAD_RESOLVED_EVENT = "pr_thread.resolved";

/**
 * A person applied a rule-file import to a repository (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)): its `CLAUDE.md`, `AGENTS.md`,
 * `.cursorrules` or Copilot instructions became draft skills and proposed facts. Subject
 * `repository`, whose id is the `owner/name` reference (a repository has no row of its own); the
 * detail carries the counts written and deduped, the created skills' slugs and the preview's
 * fingerprint. Each fact's own creation is also in `fact_transitions`, with the same actor.
 *
 * **A family of its own, `knowledge`.** *Where did this skill come from* is answered by the skill's
 * provenance; *who brought this file in, and when* is answered here.
 */
export const KNOWLEDGE_IMPORTED_EVENT = "knowledge.imported";

/**
 * The repo-map generator ran for a repository (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)) — nightly (no actor) or on request.
 * Subject `repository` (`owner/name`); the detail carries the trigger, the outcome (`published`,
 * `unchanged` or `skipped`), the skill and version in force, why a skip happened, and the module
 * count. Written on **every** run, so a night that found nothing to publish is recorded too.
 */
export const KNOWLEDGE_REPO_MAP_GENERATED_EVENT = "knowledge.repo_map_generated";

/**
 * A person saved a repository's environment recipe as its next version (BE.4's table, served for
 * BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)) — mockup 14's Environment block,
 * the ordered setup commands the farm's container pools, the prebuild tier and execution workspace
 * prep run. Subject `repository` (`owner/name`); the detail carries the version written, the
 * version it follows (`0` for a repository that had none) and the command count. A version is
 * immutable once written (V073), so *what did the environment look like when the build broke* is
 * the row, and *who moved the SDK* is this.
 */
export const KNOWLEDGE_ENV_RECIPE_SAVED_EVENT = "knowledge.env_recipe_saved";

/**
 * A person flipped the workspace's dry-run policy (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)) — the switch between *"draft PRs,
 * never merges"* and letting the loop merge without a person. Subject `org_policy`, whose id is
 * the workspace id (one policy row per workspace); the detail carries `dry_run` (the new value),
 * `previous` (the value in force before) and `previous_explicit` (whether that was a stored
 * answer or the default). Written on every persisted flip, re-affirmations included — so *"when
 * did we start auto-merging, and who decided"* is one query.
 */
export const POLICY_DRY_RUN_CHANGED_EVENT = "policy.dry_run_changed";

/**
 * A person asked for a Build Analyzer run — *Run analysis now* (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), decision **A7**). Subject
 * `analysis_run`, the run that started; the detail carries the repository and the trigger. Only the
 * manual trigger is audited: a weekly slot or the fiftieth build is a schedule an administrator
 * already saved, and the run row records which trigger started it.
 *
 * **A family of its own, `analyzer`.** *Who keeps re-running the analysis* is its own question, and
 * `action like 'analyzer.%'` answers it whole.
 */
export const ANALYZER_RUN_REQUESTED_EVENT = "analyzer.run_requested";

/**
 * An administrator saved a repository's Build Analyzer schedule — the weekly slot, the every-N
 * threshold and the budgets every run is held to (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)). Subject `analysis_schedule`; the
 * detail carries the repository and the saved values. The live build counter is not part of it:
 * a save never changes it.
 */
export const ANALYZER_SCHEDULE_UPDATED_EVENT = "analyzer.schedule_updated";

/**
 * The Danger zone's six transitions (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)),
 * all subject `workspace` with the workspace id as `subjectId`. Each is also written to the
 * `audit_event_outbox` as `audit.<action>`, for BR.3's webhook delivery.
 *
 * `workspace.purged` is the one whose `audit_events` row cannot survive: the trail cascades with
 * its workspace (V022), so the purge's record is the `workspace_tombstones` row and its outbox
 * event, both of which outlive the workspace on purpose. Its actor is `null` — the system.
 */
export const WORKSPACE_PAUSED_EVENT = "workspace.paused";
/** All loops resumed: the workspace returned from `paused` to `active` (#489). */
export const WORKSPACE_RESUMED_EVENT = "workspace.resumed";
/** The GitHub source was disconnected: token cleared, sources paused, loops paused (#489). */
export const WORKSPACE_DISCONNECTED_EVENT = "workspace.disconnected";
/** The owner asked for deletion: the workspace is `pending_delete` for 30 days (#489). */
export const WORKSPACE_DELETE_REQUESTED_EVENT = "workspace.delete_requested";
/** The owner restored a workspace pending deletion to `active` (#489). */
export const WORKSPACE_RESTORED_EVENT = "workspace.restored";
/** The scheduled purge ran: DEK destroyed, data deleted, tombstone written (#489). */
export const WORKSPACE_PURGED_EVENT = "workspace.purged";

/**
 * An administrator saved the Settings workspace card's name or tenant domain (BQ.4,
 * [#483](https://github.com/NobuData/ouroboros/issues/483)). Subject `workspace`; the detail names
 * the changed `fields` and each changed field's new and previous value. A save that changes
 * nothing writes no event.
 */
export const WORKSPACE_UPDATED_EVENT = "workspace.updated";

/**
 * A runner was given a time-windowed pool assignment — *"forge-02 joins pool-a between
 * 14:00–16:00 UTC on weekdays"* (BV.5, [#514](https://github.com/NobuData/ouroboros/issues/514)).
 * Subject `runner_pool_window`; the detail names the runner, the pool, the days and the window.
 * The `runner` family, because it changes what a machine of the workspace builds, and when.
 */
export const RUNNER_POOL_WINDOW_ADDED_EVENT = "runner.pool_window_added";

/** A time-windowed pool assignment was removed (#514). Subject `runner_pool_window`. */
export const RUNNER_POOL_WINDOW_REMOVED_EVENT = "runner.pool_window_removed";

/**
 * A job hook was registered — *"re-warm ccache right after deps-refresh merges"* (#514). Subject
 * `farm_job_hook`; the detail names the repository, the pool, the event and its title filter,
 * **never the command**, for {@link RUNNER_JOB_SUBMITTED_EVENT}'s reason: argv is where a pasted
 * token would ride. Each job a hook submits is audited as a submission with no actor.
 */
export const RUNNER_JOB_HOOK_REGISTERED_EVENT = "runner.job_hook_registered";

/** A job hook was removed (#514). Subject `farm_job_hook`. */
export const RUNNER_JOB_HOOK_REMOVED_EVENT = "runner.job_hook_removed";

/**
 * A Build Analyzer suggestion was applied (BV.5, #514, decision A4) — the owning plane accepted the
 * change. Subject `analysis_suggestion`; the detail carries the repository, the plane, the preview
 * the person confirmed, the resolved payload (as JSON text) and where it landed. The spelling is
 * V081's: the suggestion's `applied_event_id` must name an event of exactly this action.
 */
export const ANALYSIS_SUGGESTION_APPLIED_EVENT = "analysis_suggestion.applied";

/** A suggestion was dismissed, with its reason (#514). Subject `analysis_suggestion`. */
export const ANALYSIS_SUGGESTION_DISMISSED_EVENT = "analysis_suggestion.dismissed";

/**
 * A ticket-draft or spike suggestion was drafted into a planning batch (#514). Subject
 * `analysis_suggestion`; the detail names the batch.
 */
export const ANALYSIS_SUGGESTION_DRAFTED_EVENT = "analysis_suggestion.drafted";

/**
 * An analyzer-drafted batch was pushed to its tracker (#514). Subject `draft_batch`; the detail
 * carries the outcome and how many drafts landed this run.
 */
export const ANALYZER_BATCH_PUSHED_EVENT = "analyzer.batch_pushed";

/**
 * The Members & Roles card's writes (BR.1, [#485](https://github.com/NobuData/ouroboros/issues/485)).
 * A person was invited to the workspace. Subject `invitation`; the detail names the email and role.
 */
export const MEMBER_INVITED_EVENT = "member.invited";
/** A pending invitation's expiry was refreshed (#485). Subject `invitation`. */
export const MEMBER_INVITATION_RESENT_EVENT = "member.invitation_resent";
/** A pending invitation was revoked (#485). Subject `invitation`. */
export const MEMBER_INVITATION_REVOKED_EVENT = "member.invitation_revoked";
/**
 * A member's role changed (#485). Subject `member`; the detail carries `before` and `after`. A
 * refused attempt on the last owner is recorded too, with `outcome: failure` and its `reason`.
 */
export const MEMBER_ROLE_CHANGED_EVENT = "member.role_changed";
/** A member was removed (#485). Subject `member`; a refusal is recorded like a role change's. */
export const MEMBER_REMOVED_EVENT = "member.removed";
/** A member's `can_approve_loops` was set (#485). Subject `member`; `before`/`after`. */
export const MEMBER_CAPABILITY_CHANGED_EVENT = "member.capability_changed";

/** A service account was created and its first token shown (#485). Subject `service_account`. */
export const SERVICE_ACCOUNT_CREATED_EVENT = "service_account.created";
/** A service account's token was rotated: the old one stopped working (#485). */
export const SERVICE_ACCOUNT_ROTATED_EVENT = "service_account.rotated";
/** A service account was revoked: its token is dead and the account disabled (#485). */
export const SERVICE_ACCOUNT_REVOKED_EVENT = "service_account.revoked";

/**
 * Every action this service writes.
 *
 * A named list rather than a dozen loose constants, so `openapi.yaml`'s prose, the trail
 * endpoint's filter validation, the UI's renderer and this module's own suite can all be held
 * to one enumeration — which is what stops a tenth operation shipping with no trail because
 * nobody remembered to add one.
 */
export const AUDIT_ACTIONS = [
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
] as const;

/** One of {@link AUDIT_ACTIONS}. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Whether the operation the event records did what it was asked to. */
export type AuditOutcome = "success" | "failure";

/**
 * The `detail` payload — a flat record of scalars, and never anything else.
 *
 * See this file's header on why flatness is load-bearing rather than tidy. `undefined` is
 * permitted as a *value* so a builder can write `{kind, reason: undefined}` without a
 * conditional at every call site; {@link auditDetail} is what drops those keys, so what
 * reaches the column is an object with no `undefined` in it — which `JSON.stringify` would
 * otherwise silently remove anyway, and silently is the objectionable part.
 */
export type AuditDetail = Record<string, string | number | boolean | null | undefined>;

/** What every writer hands the service. */
export interface AuditRecord {
  /** The workspace — resolved from the session, never taken from the request. */
  readonly organizationId: string;
  /**
   * Who did it — `"user"."id"`.
   *
   * `null` when nobody did: a lease grant is a worker authenticated by a service key. Never
   * an address: an id is what the trail's join reads, and an address in this column would be
   * a second copy of a person's contact details in a table nothing prunes.
   */
  readonly actorId: string | null;
  /** What happened. */
  readonly action: AuditAction;
  /** What kind of thing it was about. */
  readonly subjectType: AuditSubjectType;
  /** Which one — `null` when the operation named a kind rather than an instance. */
  readonly subjectId: string | null;
  /** When. Supplied by the caller rather than defaulted, so one operation's events agree. */
  readonly at: Date;
  /** The rest of what happened. Optional; an event with nothing more to say carries `{}`. */
  readonly detail?: AuditDetail;
}

/**
 * Which of the four settings events an edit was.
 *
 * The one place that decides, so that a `PATCH` writes **exactly one** event and the name it
 * writes is the same one every time. The rule is deliberately simple, and simple is the
 * property that matters: *a specialised name when that was the only thing that changed, and
 * the general name otherwise.*
 *
 * A request that flips the switch **and** raises the cap is one act with two effects, and
 * `provider.updated` naming both in its `fields` is a truer record of it than either
 * specialised name would be — `provider.enabled` on a request that also tripled the spend
 * ceiling is a trail that answers *what happened* with half of it.
 *
 * @param fields - Which settings the request actually wrote, in the names the DTO uses.
 *   Order is irrelevant; only the contents are read.
 * @param enabled - What `enabled` was set to, when it was one of the fields. Ignored
 *   otherwise, and required to be present when `fields` is exactly `["enabled"]` — a switch
 *   whose direction is unknown cannot be named.
 * @returns The action to record.
 */
export function providerUpdateEvent(fields: readonly string[], enabled?: boolean): AuditAction {
  if (fields.length !== 1) {
    return PROVIDER_UPDATED_EVENT;
  }

  if (fields[0] === "enabled") {
    return enabled === true ? PROVIDER_ENABLED_EVENT : PROVIDER_DISABLED_EVENT;
  }

  return fields[0] === "monthlyCapCents" ? PROVIDER_CAP_CHANGED_EVENT : PROVIDER_UPDATED_EVENT;
}

/**
 * A payload with its absent fields removed.
 *
 * Every builder below composes its detail with `undefined` where a field does not apply, and
 * this is what turns that into the object the column stores. Done here rather than left to
 * `JSON.stringify`: the serialiser drops `undefined` too, but it does it invisibly, and a
 * payload whose shape depends on a serialiser's habit is one nobody can assert against.
 *
 * @param detail - The payload, possibly with `undefined` values.
 * @returns The same payload with those keys gone. Never `undefined` itself — an event with
 *   nothing to say carries `{}`, which is what makes `detail` a document rather than a null
 *   every reader has to test for.
 */
export function auditDetail(
  detail: AuditDetail = {},
): Record<string, string | number | boolean | null> {
  const kept: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(detail)) {
    if (value !== undefined) {
      kept[key] = value;
    }
  }

  return kept;
}
