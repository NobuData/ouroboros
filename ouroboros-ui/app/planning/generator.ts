/**
 * Every decision the generator card makes, and every sentence it says
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * Mockup 09's `c-7` **Generate tickets** card asks a person to let software write into their
 * tracker, so nearly everything it draws is a judgement about what is true: which trackers may be
 * written to, whether every draft really has an estimate, what the push button's count is, what a
 * half-finished push left behind. Each judgement lives here as a small pure function, so its
 * acceptance criterion is a unit test on a value rather than an assertion about markup.
 *
 * **Framework-free and pure**, the way `app/planning/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The drawing is `app/planning/generator-card.tsx`'s and its
 * children's; the writes are `app/planning/generator-actions.ts`'s.
 *
 * ### Four honesty rules the card keeps
 *
 * 1. **`✓ all sized` means every draft** has an estimate — never shown optimistically, because the
 *    effort chips are what the footer's loop time sums ({@link allSized}).
 * 2. **A tracker that cannot be written to is disabled with its reason**, not a button that fails
 *    on click ({@link trackerOptions}).
 * 3. **The `$` is omitted entirely when nothing is priced** (decision N10) — the service leaves
 *    `summary.spend` absent and {@link footerText} never invents one.
 * 4. **A partial push is legible per draft** — `pushed ✓ #612`, `failed — reason` — and **Resume
 *    push** is offered exactly when something selected did not land ({@link pushMode}).
 */

import type {
  PlanningBatch,
  PlanningBatchCreate,
  PlanningDraft,
  PlanningPushResult,
} from "@/app/api/planning";
import type {
  TicketSource,
  TicketSourceCatalog,
  TicketSourceKind,
} from "@/app/api/sources";
import type { Reading } from "@/app/api/reading";
import type { Effort } from "@/app/ui";

/* ------------------------------------------------------------------ the card */

/** The card's heading id — its region's `aria-labelledby` target. */
export const GENERATOR_TITLE_ID = "planning-generator-title";

/**
 * The card's control ids. Fixed rather than `useId`'s: the card appears once per page, and fixed ids
 * render identical markup whichever palette — or whichever render — drew it.
 */
export const GENERATOR_IDS = Object.freeze({
  prompt: "planning-generator-prompt",
  outline: "planning-generator-outline",
  outlineText: "planning-generator-outline-text",
  milestone: "planning-generator-milestone",
  queueNote: "planning-generator-queue-note",
});

/** The card's title, as the mockup names it (the card head upper-cases it). */
export const GENERATOR_TITLE = "Generate tickets";

/** The prompt's label, verbatim from the mockup. */
export const PROMPT_LABEL = "Describe the outcome, not the tasks";

/** The longest prompt the service accepts. */
export const MAX_PROMPT_LENGTH = 16_384;

/** The longest outline the service accepts. */
export const MAX_OUTLINE_LENGTH = 32_768;

/** The disclosure that opens the structured outline. */
export const OUTLINE_TOGGLE_LABEL = "Structured outline (optional)";

/** The outline field's label. */
export const OUTLINE_LABEL = "Structured outline";

/**
 * The outline's syntax hints — AL.1's five rules (`ouroboros-engine/…/planning/outline.py`), in
 * the order a person needs them.
 */
export const OUTLINE_HINT =
  "One ticket per top-level bullet; indented lines become its body. " +
  "Write blocks: OTA-3 or after: OTA-1 to wire a dependency, number the list for a sequence, " +
  "and add [docs-loop] to suggest a workflow.";

/** The guidance note's action — it opens and focuses the outline field. */
export const OUTLINE_GUIDANCE_ACTION = "Write an outline";

/** The guidance region's accessible name. */
export const GUIDANCE_LABEL = "Planner guidance";

/** The tracker segment's accessible name, verbatim from the mockup's `aria-label`. */
export const TRACKER_GROUP_LABEL = "Target tracker";

/** The auto-size switch's label, verbatim. */
export const AUTO_SIZE_LABEL = "Auto-size with estimator";

/** The queue switch's label, verbatim. */
export const QUEUE_SMALL_LABEL = "Queue XS/S tickets immediately";

/**
 * What the queue switch does — decision N7: the toggle composes the backlog's own queue write, with
 * its sized-only rule, rather than being a second queue path.
 */
export const QUEUE_SMALL_NOTE =
  "After the push, XS and S tickets go through the backlog's own queue — once the backlog has " +
  "mirrored and sized them. Anything not ready yet is reported, not queued.";

/** The primary action, verbatim. */
export const DRAFT_LABEL = "Draft tickets ⟳";

/** What the primary action says while the planner is asked. */
export const DRAFTING = "Drafting…";

/** The footer's regenerate action. */
export const REGENERATE_LABEL = "Regenerate";

/** What regenerate says while the planner is asked again. */
export const REGENERATING = "Regenerating…";

/** The resume action. */
export const RESUME_LABEL = "Resume push";

/** What the push actions say while a push runs. */
export const PUSHING = "Pushing…";

/** A row's state while the estimator has not answered for it. */
export const SIZING_MARK = "sizing…";

/** A row's state when auto-size was off and nothing will size it. */
export const UNSIZED_MARK = "unsized";

/** The pill that may only appear when every draft has an estimate. */
export const ALL_SIZED_MARK = "✓ all sized";

/** A row's state while its push is in flight. */
export const PUSHING_MARK = "pushing…";

/** The row's inline edit action. */
export const EDIT_LABEL = "Edit";

/** The inline editor's save action. */
export const SAVE_LABEL = "Save";

/** The inline editor's cancel action. */
export const CANCEL_LABEL = "Cancel";

/** The inline editor's title label. */
export const TITLE_LABEL = "Title";

/** The inline editor's body label. */
export const BODY_LABEL = "Body";

/** The longest title the service accepts. */
export const MAX_TITLE_LENGTH = 512;

/** What the card says before anything has been drafted. */
export const NO_DRAFTS_NOTE = "Drafts appear here for review — nothing reaches a tracker until you push.";

/* ------------------------------------------------------------------ roles */

/** Why a viewer cannot draft: generate, regenerate and edits are `owner|admin|member` (AL.4). */
export const DRAFT_ROLE_REASON = "Drafting tickets is for workspace members — viewers can read the plan.";

/** Why a member cannot push: push and resume are `owner|admin` (AL.4). */
export const PUSH_ROLE_REASON = "Pushing to a tracker is for workspace owners and admins.";

/* ------------------------------------------------------------------ the batch address */

/** The query parameter that names the batch the card has open — a deep link (#519 edits through it). */
export const BATCH_PARAM = "batch";

/** A uuid, as the service's `batch` path parameter requires. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The batch a `?batch=` query names, if it names one.
 *
 * @param value The parameter as Next.js hands it over — absent, one value, or several.
 * @returns The first value when it is a uuid, otherwise `null` — a malformed id opens a fresh card
 *   rather than a refusal about a value nobody meant to type.
 */
export function parseBatchParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;

  return first !== undefined && UUID.test(first) ? first : null;
}

/**
 * The address of the page with a batch open.
 *
 * @param path The planning page's path.
 * @param batchId The batch.
 * @returns `/planning?batch=<id>`.
 */
export function batchHref(path: string, batchId: string): string {
  return `${path}?${BATCH_PARAM}=${encodeURIComponent(batchId)}`;
}

/** What the card says when the batch the address names could not be read. */
export const BATCH_UNREAD = "That batch could not be opened.";

/* ------------------------------------------------------------------ trackers */

/** The monogram tints the mockup draws — the token hues, per kind. */
export type TrackerTint = "gh" | "ji" | "ln" | "neutral";

/** One button of the tracker segment. */
export interface TrackerOption {
  /** A stable React key — the source's id, or `kind:<kind>` for a kind with no source. */
  readonly key: string;
  /** The ticket source a batch would target, or `null` for a kind nobody connected. */
  readonly sourceId: string | null;
  /** Which tracker. */
  readonly kind: TicketSourceKind;
  /** The segment's label — `GitHub Issues`. */
  readonly label: string;
  /** The two-letter monogram — `GH`. */
  readonly monogram: string;
  /** The monogram's hue. */
  readonly tint: TrackerTint;
  /** The tracker's name in the push button — `Push 6 tickets to GitHub →`. */
  readonly pushName: string;
  /** Why this tracker cannot be chosen, when it cannot. Its presence is what disables it. */
  readonly reason?: string;
}

/**
 * The three kinds the mockup always draws, in its order — present even when nobody connected them.
 *
 * Exported for AM.3's tracker-sync rows (`sync.ts`), which draw the same three in the same order:
 * two lists would be two things a reader has to reconcile between two cards of one page.
 */
export const MOCKUP_KINDS: readonly TicketSourceKind[] = ["github", "jira", "linear"];

/**
 * How each kind is named, monogrammed, tinted and called in the push button.
 *
 * Exported for the reason {@link MOCKUP_KINDS} is: the tracker-sync card monograms and tints the
 * same kinds, and a second table would let the two cards disagree about what Jira looks like.
 */
export const KIND_FACE: Record<TicketSourceKind, { label: string; monogram: string; tint: TrackerTint; pushName: string }> = {
  github: { label: "GitHub Issues", monogram: "GH", tint: "gh", pushName: "GitHub" },
  jira: { label: "Jira", monogram: "JI", tint: "ji", pushName: "Jira" },
  linear: { label: "Linear", monogram: "LN", tint: "ln", pushName: "Linear" },
  gitlab: { label: "GitLab Issues", monogram: "GL", tint: "neutral", pushName: "GitLab" },
  custom: { label: "Custom tracker", monogram: "CU", tint: "neutral", pushName: "the tracker" },
};

/** What the segment says when the workspace's sources could not be read. */
export const SOURCES_UNREAD = "The workspace's trackers could not be read.";

/**
 * Why a kind cannot be chosen because nobody connected it.
 *
 * @param label The kind's label.
 * @returns The tooltip.
 */
export function notConnectedReason(label: string): string {
  return `${label} is not connected — connect it under Settings → Ticket sources.`;
}

/**
 * Why a kind cannot be chosen because this build has no provider for it.
 *
 * @param label The kind's label.
 * @returns The tooltip.
 */
export function unsupportedReason(label: string): string {
  return `${label} cannot be connected in this build.`;
}

/** Why every kind is disabled when the catalog — which carries the write capability — was unread. */
export const CATALOG_UNREAD_REASON = "Whether this tracker can be written to could not be read.";

/**
 * The tracker segment, built from the workspace's sources and gated on each kind's write capability
 * (AL.2, [#278](https://github.com/NobuData/ouroboros/issues/278)).
 *
 * The mockup's three kinds are always drawn, in its order: a kind with no source is one disabled
 * button saying it is not connected. Every connected source is a button of its own — two GitHub
 * sources are two choices, labelled by their display names. A kind the catalog does not list, or
 * lists with `push.enabled: false`, is disabled with the catalog's own reason as the tooltip.
 *
 * @param sources The workspace's sources.
 * @param catalog The catalog, which carries each kind's push affordance.
 * @returns The buttons, in order: the mockup's kinds, then any other connected kind.
 */
export function trackerOptions(
  sources: readonly TicketSource[],
  catalog: Reading<TicketSourceCatalog>,
): TrackerOption[] {
  const kinds = [
    ...MOCKUP_KINDS,
    ...sources.map((source) => source.kind).filter((kind) => !MOCKUP_KINDS.includes(kind)),
  ].filter((kind, index, all) => all.indexOf(kind) === index);

  return kinds.flatMap((kind): TrackerOption[] => {
    const face = KIND_FACE[kind];
    const writeReason = kindWriteReason(kind, face.label, catalog);
    const ofKind = sources.filter((source) => source.kind === kind);

    if (ofKind.length === 0) {
      return [
        {
          key: `kind:${kind}`,
          sourceId: null,
          kind,
          label: face.label,
          monogram: face.monogram,
          tint: face.tint,
          pushName: face.pushName,
          reason: notConnectedReason(face.label),
        },
      ];
    }

    return ofKind.map((source) => ({
      key: source.id,
      sourceId: source.id,
      kind,
      label: ofKind.length === 1 && kind !== "custom" ? face.label : source.displayName,
      monogram: face.monogram,
      tint: face.tint,
      pushName: kind === "custom" ? source.displayName : face.pushName,
      ...(writeReason === undefined ? {} : { reason: writeReason }),
    }));
  });
}

/**
 * Why a kind cannot be written to, according to the catalog.
 *
 * @param kind The kind.
 * @param label Its label.
 * @param catalog The catalog read.
 * @returns The reason, or `undefined` when a push may be offered.
 */
function kindWriteReason(
  kind: TicketSourceKind,
  label: string,
  catalog: Reading<TicketSourceCatalog>,
): string | undefined {
  if (!catalog.ok) return CATALOG_UNREAD_REASON;

  const entry = catalog.value.kinds.find((candidate) => candidate.kind === kind);

  if (entry === undefined) return unsupportedReason(label);
  if (!entry.push.enabled) return entry.push.reason ?? unsupportedReason(label);

  return undefined;
}

/**
 * The tracker the card opens on.
 *
 * @param options The segment.
 * @param batchSourceId The open batch's target, when a batch is open.
 * @returns The batch's own tracker when it is among the options, else the first choosable one, else
 *   `null` — nothing may be drafted.
 */
export function initialTracker(
  options: readonly TrackerOption[],
  batchSourceId: string | null,
): string | null {
  const own = options.find((option) => option.sourceId !== null && option.sourceId === batchSourceId);

  if (own !== undefined) return own.sourceId;

  return options.find((option) => option.reason === undefined)?.sourceId ?? null;
}

/* ------------------------------------------------------------------ milestones */

/** The milestone select's label. */
export const MILESTONE_LABEL = "Milestone";

/** The option for no milestone. */
export const NO_MILESTONE = "No milestone";

/** The option that opens the inline create. */
export const NEW_MILESTONE_OPTION = "New milestone…";

/** The inline create's label. */
export const NEW_MILESTONE_LABEL = "New milestone name";

/** The inline create's hint — AL.3's push ensures a milestone by name. */
export const NEW_MILESTONE_HINT = "Created in the tracker when the batch is pushed.";

/** What the select says while the tracker is asked. */
export const MILESTONES_LOADING = "Reading milestones…";

/** What the select says for a tracker without milestones. */
export const MILESTONES_UNSUPPORTED = "This tracker has no milestones.";

/** The longest milestone name the service accepts. */
export const MAX_MILESTONE_LENGTH = 255;

/** The select's value for the inline create. */
export const NEW_MILESTONE_VALUE = "__new__";

/** What the milestone control holds. */
export type MilestoneChoice =
  /** No milestone. */
  | { readonly mode: "none" }
  /** One of the tracker's own. */
  | { readonly mode: "existing"; readonly name: string }
  /** A name typed inline, created at push. */
  | { readonly mode: "new"; readonly name: string };

/**
 * The milestone the batch will carry.
 *
 * @param choice What the control holds.
 * @returns The trimmed name, or `null` for none — including a new milestone left blank.
 */
export function milestoneValue(choice: MilestoneChoice): string | null {
  if (choice.mode === "none") return null;

  const name = choice.name.trim();

  return name === "" ? null : name;
}

/* ------------------------------------------------------------------ drafting */

/** What the card's form holds. */
export interface GeneratorForm {
  readonly prompt: string;
  readonly outline: string;
  readonly sourceId: string | null;
  readonly milestone: MilestoneChoice;
  readonly autoSize: boolean;
  readonly queueSmall: boolean;
}

/** Why **Draft tickets** cannot act without a tracker. */
export const NO_TRACKER_REASON = "Choose a connected tracker to draft for.";

/** Why **Draft tickets** cannot act without a prompt. */
export const NO_PROMPT_REASON = "Describe the outcome first.";

/**
 * What a batch's local keys are prefixed with — the service's own default, sent explicitly because
 * the contract marks it required once defaulted.
 */
export const LOCAL_KEY_PREFIX = "OTA";

/**
 * Why **Draft tickets ⟳** cannot act, if it cannot.
 *
 * @param form What the card holds.
 * @param mayContribute Whether the reader may draft.
 * @param busy What the card is doing, if anything.
 * @returns The reason, or `undefined` when it may act.
 */
export function draftReason(
  form: GeneratorForm,
  mayContribute: boolean,
  busy: string | null,
): string | undefined {
  if (!mayContribute) return DRAFT_ROLE_REASON;
  if (busy !== null) return busy;
  if (form.sourceId === null) return NO_TRACKER_REASON;
  if (form.prompt.trim() === "") return NO_PROMPT_REASON;

  return undefined;
}

/**
 * The body **Draft tickets ⟳** sends.
 *
 * @param form What the card holds. Its `sourceId` must be set — {@link draftReason} guards it.
 * @returns The create body: the prompt trimmed, a blank outline as `null`, the milestone by name.
 */
export function generateBody(form: GeneratorForm): PlanningBatchCreate {
  const outline = form.outline.trim();

  return {
    prompt: form.prompt.trim(),
    outline: outline === "" ? null : outline,
    targetSourceId: form.sourceId ?? "",
    milestone: milestoneValue(form.milestone),
    autoSize: form.autoSize,
    queueSmall: form.queueSmall,
    localKeyPrefix: LOCAL_KEY_PREFIX,
  };
}

/* ------------------------------------------------------------------ the draft list */

/**
 * The draft list's heading — the mockup's `DRAFT — 6 TICKETS`.
 *
 * @param count How many drafts.
 * @returns `Draft — 1 ticket` or `Draft — N tickets`.
 */
export function draftHeading(count: number): string {
  return `Draft — ${count} ${count === 1 ? "ticket" : "tickets"}`;
}

/**
 * The estimator tag — the mockup's `estimator v3`, from the pipeline that actually sized the drafts
 * (decision N3). `heuristic-v0` renders `estimator v0`.
 *
 * @param batch The open batch, or `null`.
 * @returns The tag's text, or `null` while nothing has been sized — no version is claimed before an
 *   estimator has answered.
 */
export function estimatorTag(batch: PlanningBatch | null): string | null {
  const estimators = batch?.summary.estimators ?? [];

  if (estimators.length === 0) return null;

  const versions = estimators
    .map((name) => /-(v\d+)$/.exec(name)?.[1] ?? name)
    .filter((version, index, all) => all.indexOf(version) === index);

  return `estimator ${versions.join(", ")}`;
}

/**
 * Whether the `✓ all sized` pill may appear.
 *
 * @param drafts The batch's drafts.
 * @returns `true` only when there is at least one draft and **every** draft has an estimate.
 */
export function allSized(drafts: readonly PlanningDraft[]): boolean {
  return drafts.length > 0 && drafts.every((draft) => draft.estimate !== null);
}

/**
 * The progress chip shown instead of the pill while sizing runs.
 *
 * @param drafts The batch's drafts.
 * @returns `sized 4 of 6`.
 */
export function sizingProgress(drafts: readonly PlanningDraft[]): string {
  const sized = drafts.filter((draft) => draft.estimate !== null).length;

  return `sized ${sized} of ${drafts.length}`;
}

/** A row's estimate as drawn. */
export type RowSizing =
  /** An effort chip. */
  | { readonly state: "sized"; readonly effort: Effort }
  /** `sizing…` — the estimator will answer. */
  | { readonly state: "sizing" }
  /** `unsized` — auto-size was off. */
  | { readonly state: "unsized" };

/**
 * A row's estimate.
 *
 * @param draft The draft.
 * @param autoSize Whether the batch was generated with auto-size on.
 * @returns The chip, `sizing…`, or `unsized`.
 */
export function rowSizing(draft: PlanningDraft, autoSize: boolean): RowSizing {
  if (draft.estimate !== null) {
    return { state: "sized", effort: draft.estimate.effort.toUpperCase() as Effort };
  }

  return autoSize ? { state: "sizing" } : { state: "unsized" };
}

/**
 * A row's dependency note — the mockup's `blocks OTA-3`.
 *
 * A draft's `dependencies` are what block **it**; the note says what it blocks, so it is the
 * inverse edge, read off the rest of the batch.
 *
 * @param draft The draft.
 * @param drafts Every draft in the batch.
 * @returns `blocks OTA-3` or `blocks OTA-3, OTA-5`, or `null` when it blocks nothing.
 */
export function blocksNote(draft: PlanningDraft, drafts: readonly PlanningDraft[]): string | null {
  const blocked = drafts
    .filter((other) => other.dependencies.includes(draft.localKey))
    .map((other) => other.localKey);

  return blocked.length === 0 ? null : `blocks ${blocked.join(", ")}`;
}

/**
 * Whether a draft is selected, with the reader's pending clicks laid over the stored value.
 *
 * @param draft The draft.
 * @param pending Selections clicked and not yet confirmed, by local key.
 * @returns The live selection.
 */
export function isSelected(draft: PlanningDraft, pending: ReadonlyMap<string, boolean>): boolean {
  return pending.get(draft.localKey) ?? draft.selected;
}

/**
 * The live selection count — what the push button states.
 *
 * @param drafts The batch's drafts.
 * @param pending Selections clicked and not yet confirmed.
 * @returns How many drafts are checked right now.
 */
export function selectedCount(
  drafts: readonly PlanningDraft[],
  pending: ReadonlyMap<string, boolean>,
): number {
  return drafts.filter((draft) => isSelected(draft, pending)).length;
}

/** Why a row's checkbox and editor are inert while a push runs. */
export const PUSH_RUNNING_REASON = "The batch is being pushed.";

/** Why a pushed draft cannot be edited here — the tracker owns its content now. */
export const PUSHED_EDIT_REASON = "Pushed — edit it in the tracker.";

/** Why nothing can be edited in a batch the service closed. */
export const BATCH_CLOSED_REASON = "This batch is closed to edits.";

/**
 * Why a row's inline editor cannot open, if it cannot.
 *
 * @param draft The draft.
 * @param batch The batch it belongs to.
 * @param mayContribute Whether the reader may edit drafts.
 * @param pushing Whether a push is in flight from this card.
 * @returns The reason, or `undefined`.
 */
export function editReason(
  draft: PlanningDraft,
  batch: PlanningBatch,
  mayContribute: boolean,
  pushing: boolean,
): string | undefined {
  if (!mayContribute) return DRAFT_ROLE_REASON;
  if (draft.pushState === "pushed") return PUSHED_EDIT_REASON;
  if (pushing) return PUSH_RUNNING_REASON;
  if (batch.status === "pushed" || batch.status === "abandoned") return BATCH_CLOSED_REASON;

  return undefined;
}

/**
 * Why a row's checkbox cannot change, if it cannot.
 *
 * @param batch The batch.
 * @param mayContribute Whether the reader may select.
 * @param pushing Whether a push is in flight from this card.
 * @returns The reason, or `undefined`.
 */
export function selectReason(
  batch: PlanningBatch,
  mayContribute: boolean,
  pushing: boolean,
): string | undefined {
  if (!mayContribute) return DRAFT_ROLE_REASON;
  if (pushing) return PUSH_RUNNING_REASON;
  if (batch.status === "abandoned") return BATCH_CLOSED_REASON;

  return undefined;
}

/**
 * The patch the inline editor sends.
 *
 * @param title What the title box holds.
 * @param body What the body box holds.
 * @returns The title trimmed, and a blank body as `null` — which clears it.
 */
export function editBody(title: string, body: string): { title: string; body: string | null } {
  return { title: title.trim(), body: body.trim() === "" ? null : body };
}

/** Why the editor cannot save a blank title. */
export const TITLE_REQUIRED = "A ticket needs a title.";

/* ------------------------------------------------------------------ push states */

/** A row's push state as drawn. */
export type RowPush =
  /** Nothing to say — not pushed, and no push running. */
  | { readonly state: "none" }
  /** `pushing…` */
  | { readonly state: "pushing" }
  /** `pushed ✓ #612`, a link when the tracker's ref is known. */
  | { readonly state: "pushed"; readonly text: string; readonly href: string | null }
  /** `failed — reason`. */
  | { readonly state: "failed"; readonly text: string };

/**
 * A row's push state.
 *
 * @param draft The draft.
 * @param selected Whether it is selected now.
 * @param pushing Whether a push is in flight from this card, or the batch says one is.
 * @returns What the row says about its push.
 */
export function rowPush(draft: PlanningDraft, selected: boolean, pushing: boolean): RowPush {
  if (draft.pushState === "pushed") {
    return draft.pushedTicket === null
      ? { state: "pushed", text: "pushed ✓", href: null }
      : { state: "pushed", text: `pushed ✓ ${draft.pushedTicket.externalKey}`, href: draft.pushedTicket.url };
  }

  if (pushing && selected) return { state: "pushing" };

  if (draft.pushState === "failed") {
    return {
      state: "failed",
      text: draft.pushError === null ? "failed" : `failed — ${draft.pushError.message}`,
    };
  }

  return { state: "none" };
}

/** Which push action the footer offers. */
export type PushMode =
  /** Nothing has been pushed yet: **Push N tickets to GitHub →**. */
  | "push"
  /** A push started and something selected did not land: **Resume push**. */
  | "resume"
  /** Everything selected is in the tracker. */
  | "done";

/**
 * Which push action the footer offers.
 *
 * @param drafts The batch's drafts.
 * @param pending Selections clicked and not yet confirmed.
 * @returns `resume` once any draft has left `pending` and some selected draft is not pushed; `done`
 *   once every selected draft is; otherwise `push`.
 */
export function pushMode(
  drafts: readonly PlanningDraft[],
  pending: ReadonlyMap<string, boolean>,
): PushMode {
  const started = drafts.some((draft) => draft.pushState !== "pending");

  if (!started) return "push";

  const remaining = drafts.filter(
    (draft) => isSelected(draft, pending) && draft.pushState !== "pushed",
  ).length;

  return remaining > 0 ? "resume" : "done";
}

/**
 * The push button's label — the mockup's `Push 6 tickets to GitHub →`.
 *
 * @param count The live selection count.
 * @param tracker The tracker's name.
 * @returns The label.
 */
export function pushLabel(count: number, tracker: string): string {
  return `Push ${count} ${count === 1 ? "ticket" : "tickets"} to ${tracker} →`;
}

/** Why the push button cannot act with nothing selected. */
export const NOTHING_SELECTED_REASON = "Select at least one draft to push.";

/**
 * Why everything is already pushed.
 *
 * @param tracker The tracker's name.
 * @returns The reason.
 */
export function allPushedReason(tracker: string): string {
  return `Every selected draft is already in ${tracker}.`;
}

/**
 * Why the push (or resume) action cannot act, if it cannot.
 *
 * @param input.mode Which action the footer offers.
 * @param input.count The live selection count.
 * @param input.tracker The batch's tracker, or `undefined` when it is not among the options.
 * @param input.mayAdminister Whether the reader may push.
 * @param input.busy What the card is doing, if anything.
 * @returns The reason, or `undefined`.
 */
export function pushReason(input: {
  readonly mode: PushMode;
  readonly count: number;
  readonly tracker: TrackerOption | undefined;
  readonly mayAdminister: boolean;
  readonly busy: string | null;
}): string | undefined {
  const name = input.tracker?.pushName ?? "the tracker";

  if (!input.mayAdminister) return PUSH_ROLE_REASON;
  if (input.tracker === undefined) return notConnectedReason("This batch's tracker");
  if (input.tracker.reason !== undefined) return input.tracker.reason;
  if (input.busy !== null) return input.busy;
  if (input.mode === "done") return allPushedReason(name);
  if (input.count === 0) return NOTHING_SELECTED_REASON;

  return undefined;
}

/**
 * Why **Regenerate** cannot act, if it cannot.
 *
 * @param batch The batch.
 * @param mayContribute Whether the reader may draft.
 * @param busy What the card is doing, if anything.
 * @returns The reason, or `undefined`.
 */
export function regenerateReason(
  batch: PlanningBatch,
  mayContribute: boolean,
  busy: string | null,
): string | undefined {
  if (!mayContribute) return DRAFT_ROLE_REASON;
  if (busy !== null) return busy;
  if (batch.status === "pushed" || batch.status === "abandoned") return BATCH_CLOSED_REASON;

  return undefined;
}

/* ------------------------------------------------------------------ the footer */

/**
 * Loop time in days, as the footer writes it.
 *
 * @param days `summary.loopDays`.
 * @returns `1 day`, `3.1 days`, `0.4 days` — one decimal, and none when it is whole.
 */
export function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;

  return rounded === 1 ? "1 day" : `${String(rounded)} days`;
}

/** What the footer says with nothing selected. */
export const NOTHING_SELECTED_FOOTER = "est. total — nothing selected";

/** The tooltip on a spend figure some sized drafts could not be priced into. */
export const PARTIAL_SPEND_NOTE = "Some drafts route to a model with no price, so this is a floor.";

/**
 * The footer's line — the mockup's `est. total ~3 days of loop time · $14 est. spend`.
 *
 * Loop time is the service's real sum of the selected drafts' `est_minutes`, marked `so far` while
 * a selected draft is still unsized. The `$` segment exists only when `summary.spend` does (N10);
 * a partial price is written as a floor, `$14+`.
 *
 * @param batch The batch.
 * @returns The line.
 */
export function footerText(batch: PlanningBatch): string {
  const { summary, drafts } = batch;

  if (summary.selectedCount === 0) return NOTHING_SELECTED_FOOTER;

  const unsizedSelected = drafts.some((draft) => draft.selected && draft.estimate === null);
  const loop = `est. total ~${formatDays(summary.loopDays)} of loop time${unsizedSelected ? " so far" : ""}`;

  if (summary.spend === undefined) return loop;

  return `${loop} · ${summary.spend.display}${summary.spend.partial ? "+" : ""} est. spend`;
}

/* ------------------------------------------------------------------ outcomes */

/** What each queue-small skip reason says. */
const SKIP_REASON: Record<"not_yet_mirrored" | "not_sized" | "already_queued", string> = {
  not_yet_mirrored: "not mirrored yet",
  not_sized: "not sized yet",
  already_queued: "already queued",
};

/**
 * What a finished push run says, under the footer.
 *
 * @param result The push's report and queue-small outcome.
 * @param tracker The tracker's name.
 * @returns The sentences, in order: the run, then what was queued and skipped.
 */
export function pushOutcome(result: PlanningPushResult, tracker: string): string[] {
  const { report, queueSmall } = result;
  const missing = report.drafts.filter((draft) => draft.pushState !== "pushed").length;
  const tickets = (count: number) => `${count} ${count === 1 ? "ticket" : "tickets"}`;
  const lines: string[] = [];

  if (report.outcome === "throttled") {
    const at = report.retryAt === null ? "" : ` after ${report.retryAt.slice(11, 16)} UTC`;
    lines.push(`${tracker} is rate limiting — ${tickets(missing)} did not land. Resume push${at}.`);
  } else if (missing > 0) {
    lines.push(
      `Pushed ${tickets(report.pushedThisRun)} to ${tracker}; ${tickets(missing)} did not land — ` +
        "Resume push re-runs only those.",
    );
  } else {
    lines.push(`Pushed ${tickets(report.pushedThisRun)} to ${tracker}.`);
  }

  if (queueSmall !== null) {
    if (queueSmall.queued.length > 0) lines.push(`Queued ${queueSmall.queued.join(", ")}.`);

    for (const skip of queueSmall.skipped) {
      lines.push(`${skip.localKey} not queued — ${SKIP_REASON[skip.reason]}.`);
    }
  }

  return lines;
}
