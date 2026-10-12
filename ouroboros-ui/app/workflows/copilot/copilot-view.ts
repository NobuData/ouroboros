/**
 * Every decision the copilot's frame makes, as functions with inputs and outputs (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)) — mockup 20's page head, and the gate
 * behind its two actions.
 *
 * The head is copy; almost everything else on this page is a judgement: whether **Promote draft**
 * may be pressed and what stands in its way, whether there is anything to **Discard**, which
 * unresolved references block and which only flag (decision **W7**), whether the conversation is
 * shown read-only and why. Each lives here so its acceptance criterion is a unit test on a small
 * value rather than an assertion about rendered text.
 *
 * **Framework-free and pure**, the way `app/workflows/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client — the API types are type-only imports, erased before a
 * Client Component could pull them in.
 *
 * ### What this ticket draws, and what it seats
 *
 * CE.1 is the frame: the route, the head, the live segment, and promote and discard. The
 * conversation is CE.2's card (#566, `conversation.ts`), the draft's stage list is CE.3's
 * (#567, `stages.ts`) and the dry run is CE.4's (#568, `dry-run.ts`). Each has a **labelled
 * seat** here ({@link COPILOT_SEATS}) — what is drawn in the card's place when its read failed.
 *
 * ### The anchor contract
 *
 * A validation finding a refused promote returns is anchored to its stage: {@link stageAnchorId}
 * is the element id the stage list gives each row and {@link stageAnchorHref} is the link a
 * finding carries. CE.3 (#567, `stages-card.tsx`) draws the rows and takes their ids from here,
 * so the two cannot drift.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { Reading } from "@/app/api/reading";
import type {
  CopilotConversation,
  CopilotGuard,
  CopilotMessage,
  CopilotPromotion,
  CopilotReadiness,
  CopilotReference,
  CopilotStageDraft,
} from "@/app/api/workflow-copilot";
import type { RoutingAlias } from "@/app/api/routing";
import type { WorkflowDefinition, WorkflowDetail, WorkflowRailEntry } from "@/app/api/workflows";

import type { DryRunBoard } from "./dry-run";

/* ------------------------------------------------------------------ what the page reads */

/** The workflow the copilot is open on, and the reads behind it. */
export interface SelectedCopilot {
  /** Its row on the rail. */
  readonly entry: WorkflowRailEntry;
  /**
   * The workflow as the other surfaces read it — its draft's document is what a refused
   * promote's findings are anchored in. A failed read costs only that anchoring.
   */
  readonly detail: Reading<WorkflowDetail>;
  /** What a promote would publish and whether it can — or why that could not be read. */
  readonly promotion: Reading<CopilotPromotion>;
  /**
   * The conversation — the active one, else the most recently closed one — `null` inside a
   * successful reading for a workflow that never had one, or why it could not be read.
   */
  readonly conversation: Reading<CopilotConversation | null>;
  /**
   * Whether a message sent now could be answered — the gateway, the copilot's route, and the dry
   * run in the way (CE.2, #566). A failed read gates nothing: the composer stays live and the
   * service refuses what it must.
   */
  readonly readiness: Reading<CopilotReadiness>;
  /**
   * The shared draft with who each stage is by — what the stage list draws (CE.3, #567). Its own
   * read, so the list does not depend on there being a conversation. A failed read costs the
   * list and nothing else.
   */
  readonly draft: Reading<CopilotStageDraft>;
  /**
   * The workspace's model aliases, for the stage list's model tags (`coder-std` →
   * `claude-sonnet-5`). A failed read costs only the resolution: a tag then names the alias.
   */
  readonly aliases: Reading<readonly RoutingAlias[]>;
  /**
   * The dry-run card's board (CE.4, #568): the history, the newest run in full and its
   * suggestions. A workflow that has never been dry-run is a successful reading with no run. A
   * failed read costs the card and nothing else.
   */
  readonly dryRun: Reading<DryRunBoard>;
}

/** Everything the copilot route was able to read, and why it could not read the rest. */
export interface CopilotReadings {
  /** The rail, or why it could not be read. An empty array is the empty workspace. */
  readonly rail: Reading<readonly WorkflowRailEntry[]>;
  /** The slug the URL named. */
  readonly requested: string;
  /** The workflow the URL named, with its reads — `null` when the rail does not hold it. */
  readonly selected: SelectedCopilot | null;
  /** When the page was read, ISO 8601. */
  readonly now: string;
}

/** Which of the page's states the reads put it in. */
export type CopilotState =
  /** The rail read was refused. */
  | { readonly kind: "failed"; readonly reason: string }
  /** The workspace has no workflows. */
  | { readonly kind: "empty" }
  /** The rail holds no workflow with the slug the URL named. */
  | { readonly kind: "missing"; readonly slug: string }
  /** The rail has the workflow; the page is open on it, each read degrading on its own. */
  | ({ readonly kind: "open" } & SelectedCopilot);

/**
 * Decide the page's state.
 *
 * @param readings What the route read.
 * @returns The state.
 */
export function copilotState(readings: CopilotReadings): CopilotState {
  if (!readings.rail.ok) return { kind: "failed", reason: readings.rail.reason };
  if (readings.rail.value.length === 0) return { kind: "empty" };
  if (readings.selected === null) return { kind: "missing", slug: readings.requested };

  return { kind: "open", ...readings.selected };
}

/* ------------------------------------------------------------------ the page head */

/** The eyebrow, as mockup 20 writes it. */
export const COPILOT_EYEBROW = "Workflow Studio · Copilot";

/** The `<h1>`, verbatim from mockup 20. */
export const COPILOT_TITLE = "Describe the workflow. Watch it build. Test it before it touches anything.";

/** The subline, verbatim from mockup 20. */
export const COPILOT_SUBLINE =
  "The third way to edit workflows — same graph as the canvas and the code, driven by " +
  "conversation. Every draft can dry-run against a real issue first.";

/** The banner over a promotion summary that could not be read. */
export const PROMOTION_FAILED_HEADLINE = "The draft's promotion summary could not be read.";

/** The banner over a conversation that could not be read. */
export const CONVERSATION_FAILED_HEADLINE = "The conversation could not be read.";

/* ------------------------------------------------------------------ the anchor contract */

/**
 * The element id of a stage's row in the draft's stage list — `stage-plan`.
 *
 * The contract CE.1 establishes and CE.3 ([#567](https://github.com/NobuData/ouroboros/issues/567))
 * draws: every row of the stage list carries this id, so a finding can link to the stage it is
 * about.
 *
 * @param nodeId The stage's node id, as the definition spells it.
 * @returns The id.
 */
export function stageAnchorId(nodeId: string): string {
  return `stage-${nodeId}`;
}

/**
 * The in-page link to a stage's row — `#stage-plan`.
 *
 * @param nodeId The stage's node id.
 * @returns The fragment, encoded so a node id cannot spell a second fragment or a query.
 */
export function stageAnchorHref(nodeId: string): string {
  return `#${encodeURIComponent(stageAnchorId(nodeId))}`;
}

/* ------------------------------------------------------------------ the unresolved references */

/** A promotion's references, split the way decision W7's policy splits them. */
export interface ReferenceSplit {
  /** The ones a publish is refused for. */
  readonly blockers: readonly CopilotReference[];
  /** The ones a publish goes through with, flagged. */
  readonly flags: readonly CopilotReference[];
}

/**
 * Split references into blockers and flags, each in the service's order.
 *
 * @param references The promotion's references.
 * @returns Both lists.
 */
export function splitReferences(references: readonly CopilotReference[]): ReferenceSplit {
  return {
    blockers: references.filter((reference) => reference.blocking),
    flags: references.filter((reference) => !reference.blocking),
  };
}

/**
 * One reference, by stage and by name — *stage `plan` · `security-review`*.
 *
 * @param reference The reference.
 * @returns The stage it is on and the name that resolved to nothing.
 */
export function referenceLine(reference: CopilotReference): string {
  return `stage ${reference.node} · ${reference.name}`;
}

/**
 * The count that leads a list of flags.
 *
 * @param count How many advisory references there are; at least one.
 * @returns *1 unresolved reference is flagged* or *3 unresolved references are flagged*.
 */
export function flaggedHeading(count: number): string {
  return count === 1 ? "1 unresolved reference is flagged" : `${count} unresolved references are flagged`;
}

/** What follows the flags: that they do not stop a promote. */
export const FLAGGED_NOTE = "Flagged references do not stop a promote.";

/** The heading over what blocks a promote. */
export const BLOCKED_HEADING = "This draft cannot be promoted yet";

/** The heading over the blocking references, under the reasons. */
export const BLOCKERS_HEADING = "Unresolved references that block it";

/** The link that leads to where references are resolved. */
export const RESOLVE_LABEL = "Resolve them on the Visual surface";

/** The link under a missing draft: where a draft is made by hand. */
export const OPEN_VISUAL_LABEL = "Edit this workflow on the Visual surface";

/** What stands in for the reasons when the service blocks a promote and names none. */
export const BLOCKED_FALLBACK = "The validation policy blocks this draft.";

/* ------------------------------------------------------------------ promote */

/** The promote action's words before its target. */
export const PROMOTE_VERB = "Promote draft";

/**
 * The primary action's label — *Promote draft → security-patch v1*.
 *
 * @param target What a promote publishes, as the service labels it — `security-patch v1` — or
 *   `null` where there is no workflow to name.
 * @returns The label.
 */
export function promoteLabel(target: string | null): string {
  return target === null ? PROMOTE_VERB : `${PROMOTE_VERB} → ${target}`;
}

/**
 * What a promote publishes, when the promotion summary could not be read: the rail's own facts.
 *
 * @param entry The workflow's rail entry.
 * @returns `security-patch v1` — the slug and the version after the one in force.
 */
export function fallbackTarget(entry: WorkflowRailEntry): string {
  return `${entry.slug} v${(entry.currentVersion ?? 0) + 1}`;
}

/** Why **Promote draft** cannot act for a reader whose role may not publish. */
export const PROMOTE_MEMBER_REASON = "Promoting a draft is for workspace owners and admins.";

/** Why **Discard draft** cannot act for a reader whose role may not discard. */
export const DISCARD_MEMBER_REASON = "Discarding a draft is for workspace owners and admins.";

/** Why neither action can act on a page with no workflow open. */
export const ACTIONS_NEED_WORKFLOW = "Promote and discard act on a workflow's draft, and this page has no workflow open.";

/** Why neither action can act when the promotion summary could not be read. */
export const ACTIONS_NEED_PROMOTION =
  "What this draft would publish could not be read, so it can be neither promoted nor discarded from here.";

/** Why **Promote draft** cannot act when there is no draft. */
export const NO_DRAFT_REASON = "There is no draft to promote — this workflow has no unpublished changes.";

/** Why **Promote draft** cannot act on a blocked draft — the short form; the reasons are listed beside it. */
export const BLOCKED_REASON = "This draft cannot be promoted yet — the reasons are listed beside this button.";

/** Why **Discard draft** cannot act when there is nothing to discard. */
export const NOTHING_TO_DISCARD_REASON = "There is no draft and no active conversation to discard.";

/** What the page knows when it decides the two actions. */
export interface GateFacts {
  /** The workflow's rail entry, or `null` when no workflow is open. */
  readonly entry: WorkflowRailEntry | null;
  /** The promotion summary, `null` when no workflow is open. */
  readonly promotion: Reading<CopilotPromotion> | null;
  /** Whether the reader's role may publish and discard — `mayAdminister`. */
  readonly mayAdminister: boolean;
}

/** The promote action, decided. */
export interface PromoteGate {
  /** The button's label. */
  readonly label: string;
  /** Why it cannot act, or `undefined` when it can. */
  readonly reason: string | undefined;
  /**
   * Whether the draft itself is what stops it — blocked by policy, or absent — rather than the
   * reader's role or a failed read. What is listed beside the button is listed for this.
   */
  readonly draftBlocked: boolean;
  /** The service's reasons for a blocked draft, never empty when `draftBlocked` by policy. */
  readonly reasons: readonly string[];
  /** The references a publish is refused for. */
  readonly blockers: readonly CopilotReference[];
  /** The references a publish goes through with, flagged. */
  readonly flags: readonly CopilotReference[];
}

/**
 * Decide **Promote draft**.
 *
 * The order is the order a reader could do something about it: nothing is open; the role may
 * not; the summary could not be read; there is no draft; the draft is blocked. A draft's
 * references are reported whatever the role, because *what stands in the way* is worth reading
 * for someone who will ask an admin to promote it.
 *
 * @param facts What the page knows.
 * @returns The gate.
 */
export function promoteGate(facts: GateFacts): PromoteGate {
  const { entry, promotion, mayAdminister } = facts;
  const none = { draftBlocked: false, reasons: [], blockers: [], flags: [] } as const;

  if (entry === null || promotion === null) {
    return { label: promoteLabel(null), reason: ACTIONS_NEED_WORKFLOW, ...none };
  }
  if (!promotion.ok) {
    return {
      label: promoteLabel(fallbackTarget(entry)),
      reason: mayAdminister ? ACTIONS_NEED_PROMOTION : PROMOTE_MEMBER_REASON,
      ...none,
    };
  }

  const summary = promotion.value;
  const label = promoteLabel(summary.publishes.label);
  const { blockers, flags } = splitReferences(summary.references);

  if (!summary.draft.present) {
    return {
      label,
      reason: mayAdminister ? NO_DRAFT_REASON : PROMOTE_MEMBER_REASON,
      draftBlocked: true,
      reasons: [NO_DRAFT_REASON],
      blockers: [],
      flags: [],
    };
  }
  if (summary.blocked) {
    return {
      label,
      reason: mayAdminister ? BLOCKED_REASON : PROMOTE_MEMBER_REASON,
      draftBlocked: true,
      reasons: summary.blockedReasons.length > 0 ? summary.blockedReasons : [BLOCKED_FALLBACK],
      blockers,
      flags,
    };
  }

  return {
    label,
    reason: mayAdminister ? undefined : PROMOTE_MEMBER_REASON,
    draftBlocked: false,
    reasons: [],
    blockers,
    flags,
  };
}

/** The ghost action's label, as mockup 20 writes it. */
export const DISCARD_LABEL = "Discard draft";

/**
 * Why **Discard draft** cannot act, or `undefined` when it can.
 *
 * There is something to discard when there is a draft, or a conversation still open — either
 * alone is enough, which is the service's own rule (`409 copilot_nothing_to_discard` otherwise).
 *
 * @param facts What the page knows.
 * @returns The reason, or `undefined`.
 */
export function discardReason(facts: GateFacts): string | undefined {
  const { entry, promotion, mayAdminister } = facts;

  if (entry === null || promotion === null) return ACTIONS_NEED_WORKFLOW;
  if (!mayAdminister) return DISCARD_MEMBER_REASON;
  if (!promotion.ok) return ACTIONS_NEED_PROMOTION;

  const { draft, session } = promotion.value;

  return draft.present || session?.status === "active" ? undefined : NOTHING_TO_DISCARD_REASON;
}

/* ------------------------------------------------------------------ the promote confirmation */

/** The heading over what a promote publishes. */
export const PUBLISHING_HEADING = "What is being published";

/** The label beside the version a promote makes. */
export const PUBLISHES_TERM = "Publishes";

/** The label beside the draft a promote freezes. */
export const DRAFT_TERM = "From draft";

/** The heading over the guards. */
export const GUARDS_HEADING = "Guards";

/** What the guards list says when the version carries none. */
export const NO_GUARDS = "This version carries no guards — nothing in the definition or the conversation set one.";

/** How each guard's origin is named. */
export const GUARD_SOURCE_WORDS: Readonly<Record<CopilotGuard["source"], string>> = {
  definition: "from the definition",
  conversation: "set in the conversation",
};

/** How each enforcement is named — the second never as protection. */
export const GUARD_ENFORCEMENT_WORDS: Readonly<Record<CopilotGuard["enforcement"], string>> = {
  enforced: "Enforced on real runs",
  dry_run_only: "Not enforced on real runs yet",
};

/** What a `dry_run_only` guard is told plainly, under where it is checked. */
export const DRY_RUN_ONLY_NOTE =
  "Publishing does not make this a protection: it is checked in dry runs only, and a real run is not held to it yet.";

/** The heading over the references a publish goes through with. */
export const FLAGS_HEADING = "Flagged — published as they are";

/** The lead sentence over a refused promote's findings — each leads to its stage's row. */
export const PROMOTE_FINDINGS_MESSAGE =
  "This draft cannot be published yet. Each finding leads to the stage it is about — nothing was published.";

/**
 * What an anchored finding's link says it does.
 *
 * @param stageTitle The stage's title, or its id when it has none.
 * @returns *Go to stage Plan the fix*.
 */
export function findingStageTarget(stageTitle: string): string {
  return `Go to stage ${stageTitle}`;
}

/**
 * The notice a promote that took leaves.
 *
 * @param label What was published, as the service labelled it before the publish — `security-patch v1`.
 * @returns The sentence.
 */
export function promotedNotice(label: string): string {
  return `Promoted the draft to ${label}. Runs queued from now on use it, and the conversation is kept read-only.`;
}

/**
 * The document a refused promote's findings are anchored in.
 *
 * The workflow's draft as the canvas reads it; failing that, the draft as the conversation sees
 * it; failing both, an empty document — in which every finding is listed and none is a link.
 *
 * @param selected The open workflow's reads.
 * @returns The document.
 */
export function anchorDefinition(selected: SelectedCopilot): WorkflowDefinition {
  const fromDetail = selected.detail.ok ? selected.detail.value.draft.definition : null;
  const fromConversation = selected.conversation.ok ? (selected.conversation.value?.draft.definition ?? null) : null;

  return fromDetail ?? fromConversation ?? {};
}

/* ------------------------------------------------------------------ the discard confirmation */

/** The discard dialog's title. */
export const DISCARD_TITLE = "Discard this draft?";

/** The answer that discards. */
export const DISCARD_CONFIRM = "Discard draft";

/** The answer that keeps everything. */
export const DISCARD_CANCEL = "Keep the draft";

/** What the dialog says while the discard is in flight. */
export const DISCARDING = "Discarding…";

/**
 * What a discard does, said before it is done.
 *
 * @param name The workflow's name.
 * @param currentVersion The version in force, or `null` for a workflow that has published nothing.
 * @returns The sentences: the draft goes, the workflow stays, the conversation is kept read-only.
 */
export function discardBody(name: string, currentVersion: number | null): string {
  const returns =
    currentVersion === null
      ? `${name} stays and, having never been published, is left empty`
      : `${name} stays and returns to its published version, v${currentVersion}`;

  return (
    `The draft is thrown away and cannot be brought back. ${returns}. ` +
    "The conversation is kept, read-only, so what was tried can still be read."
  );
}

/** The code a `409` answers when there is neither a draft nor an open conversation. */
export const COPILOT_NOTHING_TO_DISCARD = "copilot_nothing_to_discard";

/** The code a `409` answers while a dry run of the draft is still running. */
export const DRY_RUN_IN_PROGRESS = "dry_run_in_progress";

/** What a discard refused because there was nothing left to discard says. */
export const NOTHING_TO_DISCARD_MESSAGE =
  "There was nothing left to discard — the draft and the conversation were already closed. Nothing changed.";

/** What a discard refused because a dry run is still running says. */
export const DRY_RUN_IN_PROGRESS_MESSAGE =
  "A dry run of this draft is still running, so the draft was not discarded. Wait for it to finish, or cancel it, and discard again.";

/** What a discard refused for the reader's role says. */
export const DISCARD_FORBIDDEN_MESSAGE =
  "Discarding a draft is for workspace owners and admins. Nothing was discarded.";

/**
 * What a refused discard tells the reader.
 *
 * @param refusal The service's envelope.
 * @returns The sentence. A refusal this table does not know is told in the service's own words.
 */
export function discardFailure(refusal: ErrorEnvelope): string {
  switch (refusal.code) {
    case COPILOT_NOTHING_TO_DISCARD:
      return NOTHING_TO_DISCARD_MESSAGE;
    case DRY_RUN_IN_PROGRESS:
      return DRY_RUN_IN_PROGRESS_MESSAGE;
    case "forbidden":
      return DISCARD_FORBIDDEN_MESSAGE;
    default:
      return refusal.message;
  }
}

/** The notice a discard that threw a draft away leaves. */
export const DISCARDED_NOTICE = "The draft was discarded. The conversation is kept read-only.";

/** The notice a discard that only closed a conversation leaves — there was no draft. */
export const CONVERSATION_CLOSED_NOTICE = "The conversation was closed and is kept read-only. There was no draft to discard.";

/**
 * The notice a discard that took leaves.
 *
 * @param draftDiscarded Whether there was a draft to throw away.
 * @returns The sentence.
 */
export function discardedNotice(draftDiscarded: boolean): string {
  return draftDiscarded ? DISCARDED_NOTICE : CONVERSATION_CLOSED_NOTICE;
}

/* ------------------------------------------------------------------ the seats */

/** The page's three regions. */
export type CopilotSeatId = "conversation" | "stages" | "dry-run";

/** One seat: what the region is, and what it says when its card cannot be drawn. */
export interface CopilotSeat {
  /** The region's id — the suffix of its element id, `copilot-conversation`. */
  readonly id: CopilotSeatId;
  /** The card's heading, as mockup 20 writes it. */
  readonly title: string;
  /** What is said in the card's place — that its read failed, or which issue builds it. */
  readonly note: string;
}

/** The seats, in mockup 20's order: the conversation on the left; the stage list and the dry run on the right. */
export const COPILOT_SEATS: Readonly<Record<CopilotSeatId, CopilotSeat>> = {
  conversation: {
    id: "conversation",
    title: "Conversation",
    note: "The conversation could not be read, so there is nothing to continue from here. The banner above carries the reason, and the retry.",
  },
  stages: {
    id: "stages",
    title: "Draft stages",
    note: "The draft's stages could not be read, so there are no rows to show. The banner above carries the reason, and the retry.",
  },
  "dry-run": {
    id: "dry-run",
    title: "Dry run",
    note: "The dry run could not be read, so there are no results to show. The banner above carries the reason, and the retry.",
  },
};

/**
 * A seat's element id.
 *
 * @param id The seat.
 * @returns `copilot-conversation`, `copilot-stages`, `copilot-dry-run`.
 */
export function seatElementId(id: CopilotSeatId): string {
  return `copilot-${id}`;
}

/* ------------------------------------------------------------------ the read-only conversation */

/** Why a conversation is shown read-only rather than as something to continue. */
export type TranscriptReason = "discarded" | "promoted" | "role";

/** The note over a discarded conversation's transcript. */
export const DISCARDED_TRANSCRIPT_NOTE =
  "This conversation was discarded with its draft. It is kept for reference.";

/** The note over an open conversation, for a reader whose role may not edit workflows. */
export const ROLE_TRANSCRIPT_NOTE =
  "This conversation is shown read-only: continuing it edits the workflow, which is for workspace owners and admins.";

/**
 * The note over a promoted conversation's transcript.
 *
 * It names the workflow and not a version number: a session records that it was promoted, not
 * which version that made, and a workflow published again since would make a number here wrong.
 *
 * @param name The workflow's name.
 * @returns The sentence.
 */
export function promotedTranscriptNote(name: string): string {
  return `This conversation was promoted to a published version of ${name}. It is kept for reference.`;
}

/**
 * Whether the conversation is read-only, and why.
 *
 * A closed conversation is read-only for everyone. An open one is read-only for a reader whose
 * role may not edit; for a reader who may, the conversation card
 * (CE.2, [#566](https://github.com/NobuData/ouroboros/issues/566)) has its composer.
 *
 * @param conversation The conversation, or `null` when the workflow never had one.
 * @param mayAdminister Whether the reader's role may edit workflows.
 * @returns The reason, or `null` when it may be continued — or there is none.
 */
export function transcriptReason(
  conversation: CopilotConversation | null,
  mayAdminister: boolean,
): TranscriptReason | null {
  if (conversation === null) return null;
  if (conversation.session.status === "discarded") return "discarded";
  if (conversation.session.status === "promoted") return "promoted";

  return mayAdminister ? null : "role";
}

/**
 * The note over a transcript.
 *
 * @param reason Why it is read-only.
 * @param name The workflow's name.
 * @returns The sentence.
 */
export function transcriptNote(reason: TranscriptReason, name: string): string {
  switch (reason) {
    case "discarded":
      return DISCARDED_TRANSCRIPT_NOTE;
    case "promoted":
      return promotedTranscriptNote(name);
    case "role":
      return ROLE_TRANSCRIPT_NOTE;
  }
}

/** What a closed conversation with no messages says. */
export const TRANSCRIPT_EMPTY = "Nothing was said in this conversation.";

/** How each side of the conversation is named. */
export const SPEAKER_WORDS: Readonly<Record<CopilotMessage["role"], string>> = {
  user: "You",
  copilot: "Copilot",
};

/** What stands in a bubble for a reply that was interrupted before it said anything. */
export const INTERRUPTED_BODY = "(This reply was interrupted before it said anything.)";

/* ------------------------------------------------------------------ the states with no workflow */

/** What the page's body says in a state with no workflow open. */
export interface CopilotSeatCopy {
  readonly title: string;
  readonly note: string;
}

/** The body's title for a rail that could not be read. */
export const COPILOT_FAILED_TITLE = "Nothing to draw";

/** …and its note. */
export const COPILOT_FAILED_NOTE = "The workflows could not be read, so there is no conversation to open. The banner above carries the reason, and the retry.";

/** The body's title for a workspace with no workflows. */
export const COPILOT_EMPTY_TITLE = "No workflows yet";

/** …and its note for a reader who may create one. */
export const COPILOT_EMPTY_NOTE =
  "A conversation always belongs to a workflow. Create one with + New workflow and choose Copilot to start it here.";

/** …and for a reader who may not. */
export const COPILOT_EMPTY_MEMBER_NOTE =
  "A conversation always belongs to a workflow, and this workspace has none yet. An owner or an admin can create one.";

/** The body's title for a slug the rail does not hold. */
export const COPILOT_MISSING_TITLE = "No such workflow";

/**
 * The body's note for a slug the rail does not hold.
 *
 * @param slug What the URL named.
 * @returns The sentence, naming it and pointing at the rail.
 */
export function copilotMissingNote(slug: string): string {
  return `This workspace has no workflow called ${slug}. The rail lists every workflow it has.`;
}

/**
 * What the body says in place of the seats.
 *
 * @param state A state with no workflow open.
 * @param mayAdminister Whether the reader may create workflows.
 * @returns The title and the note.
 */
export function copilotSeatCopy(
  state: Exclude<CopilotState, { kind: "open" }>,
  mayAdminister: boolean,
): CopilotSeatCopy {
  switch (state.kind) {
    case "failed":
      return { title: COPILOT_FAILED_TITLE, note: COPILOT_FAILED_NOTE };
    case "empty":
      return { title: COPILOT_EMPTY_TITLE, note: mayAdminister ? COPILOT_EMPTY_NOTE : COPILOT_EMPTY_MEMBER_NOTE };
    case "missing":
      return { title: COPILOT_MISSING_TITLE, note: copilotMissingNote(state.slug) };
  }
}
