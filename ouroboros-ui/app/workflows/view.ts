/**
 * Every decision the workflow studio's frame makes, as functions with inputs and outputs
 * (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * Mockup 04's frame is a head, a segmented control, three actions and a rail. Most of what
 * those draw is a judgement rather than markup — what the subline says, which tab leads
 * somewhere, why an action cannot act, which rail entry is lit and which carries the err-dot
 * — and each judgement lives here so its acceptance criterion is a unit test on a small value
 * rather than an assertion about rendered text.
 *
 * **Framework-free and pure**, the way `app/models/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The read is `app/workflows/data.ts`'s and the drawing is
 * the screen's. The two imports beyond the contract's types are `app/format.ts` (the one
 * clock-to-words rule) and `app/paths.ts`, which is value-only for exactly this reason: the
 * tab set and the rail name routes, and a route typed out here as a string would be a second
 * spelling of one.
 *
 * ### The one sentence this module composes, and the ones it does not
 *
 * The rail's captions and the head's usage figure arrive **composed** — `6 stages ·
 * auto-merge`, `used by 61% of runs`, `no runs yet` — and are printed as they arrive
 * (`app/api/workflows.ts` says why). What the contract serves as *structure* is the trigger:
 * `{event: "ticket_queued", conditions: {effort_lte: "m"}}`. The ticket asks for it **in
 * words**, and the honesty rule behind that is worth stating: a stored sentence would be wrong
 * the moment somebody edited the predicate, so the sentence is derived from the definition on
 * every render and there is no field anywhere that holds it.
 */

import type { Reading } from "@/app/api/reading";
import type { WorkflowDefinition, WorkflowDetail, WorkflowRailEntry } from "@/app/api/workflows";
import { relativeAgo } from "@/app/format";
import { WORKFLOWS_PATH, workflowPath } from "@/app/paths";

/* ------------------------------------------------------------------ what the page reads */

/**
 * Everything the studio was able to read, and why it could not read the rest.
 *
 * It lives in this pure module rather than beside the calls that produce it
 * (`app/workflows/data.ts`, which is server-only) for the reason `ModelsReadings` does: the
 * screen and its tests can then name the shape without pulling `server-only`, `next/headers`
 * and a configured environment in behind it.
 */
export interface StudioReadings {
  /**
   * The rail — every workflow of the workspace with its captions — or why it could not be
   * read. A workspace with no workflows reads successfully and answers an empty array, which is
   * the studio's empty state and a different fact from a rail nobody could read.
   */
  readonly rail: Reading<readonly WorkflowRailEntry[]>;
  /**
   * The slug the URL named, or `null` for the section's landing (`/workflows`), which opens
   * on the rail's first entry. Kept so the page can say *which* workflow it was asked for and
   * could not find.
   */
  readonly requested: string | null;
  /**
   * The workflow the studio is open on: its rail entry, and the full read behind it — or why
   * that second read failed. `null` when nothing was selected: the rail was empty, the rail
   * could not be read, or the URL named a slug the rail does not hold.
   *
   * Two readings rather than one because they are two requests and degrade separately: a
   * workflow whose definition could not be read still has its rail entry, and the head still
   * prints the entry's name, version and usage from it.
   */
  readonly selected: SelectedWorkflow | null;
  /**
   * When the page was read, ISO 8601. Every *Last edited 2h ago* is measured from this one
   * instant rather than from each render's clock, so a server render and its hydration agree.
   */
  readonly now: string;
}

/** The workflow the studio is open on. */
export interface SelectedWorkflow {
  /** Its row on the rail, with the composed captions. */
  readonly entry: WorkflowRailEntry;
  /** The entity, its draft slot and the version in force — or why they could not be read. */
  readonly detail: Reading<WorkflowDetail>;
}

/* ------------------------------------------------------------------ the page head */

/** The eyebrow — the section's name, as the mockup writes it. */
export const STUDIO_EYEBROW = "Workflow Studio";

/** The separator the composed subline's facts are joined with — the mockup's spaced middle dot. */
export const SEPARATOR = " · ";

/**
 * The five efforts, smallest first — the vocabulary `conditions.effort_lte` is drawn from
 * (`docs/WORKFLOW_DSL.md` § 3).
 */
export const EFFORTS = ["xs", "s", "m", "l", "xl"] as const;

/** One of the five. */
export type Effort = (typeof EFFORTS)[number];

/** The one trigger event the DSL defines today. */
export const TICKET_QUEUED = "ticket_queued";

/**
 * What the subline says for a definition with no trigger to describe — a blank draft, a
 * `{}` canvas, a document nobody has written yet.
 *
 * A sentence rather than an em-dash, because the subline is prose and a dash in the middle of
 * it reads as a typo; and an honest one, because *Runs when …* would be a claim about a
 * predicate that does not exist.
 */
export const NO_TRIGGER = "Runs on nothing yet — the definition names no trigger.";

/** The subject of a trigger with an empty `conditions`, which fires on every queued issue. */
export const ANY_ISSUE = "any issue";

/**
 * How each tracker is named in prose — `ticket_sources.kind`'s vocabulary (V030), spelled
 * the way its owner spells it. A source this table does not know is printed as its kind.
 */
const SOURCE_NAMES: Readonly<Record<string, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira",
  linear: "Linear",
};

/** A trigger's predicate, read out of a definition as facts rather than as a document. */
export interface TriggerFacts {
  /** The event, as the document spells it. */
  readonly event: string;
  /** The `effort_lte` condition, or `null` when there is none — or when it names no effort. */
  readonly effortLte: Effort | null;
  /** The `labels` condition — every label the ticket must carry. Empty when there is none. */
  readonly labels: readonly string[];
  /** The `source` condition, or `null` when there is none. */
  readonly source: string | null;
}

/**
 * Whether a value is a plain object — the only thing true of every document on this API.
 *
 * @param value Anything.
 * @returns `true` for a non-null object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is one of the five efforts.
 *
 * @param value Anything.
 * @returns `true` for `xs` … `xl`, exactly as the DSL spells them.
 */
function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

/**
 * Read a definition's trigger as facts.
 *
 * **Defensive on purpose.** A definition is typed as a JSON object and nothing more, because
 * a draft is stored unvalidated (`app/api/workflows.ts`): `{}` is the blank canvas, and a
 * half-built document may carry a trigger with no conditions, conditions with no trigger, or a
 * label list holding something that is not a string. Each of those is read as *absent* rather
 * than thrown on — the head of a workflow somebody is still building has to render.
 *
 * @param definition The document, or `null` when the workflow has none.
 * @returns The facts, or `null` when the document names no trigger event at all.
 */
export function readTrigger(definition: WorkflowDefinition | null): TriggerFacts | null {
  const trigger = definition?.trigger;
  if (!isRecord(trigger) || typeof trigger.event !== "string") return null;

  const conditions = isRecord(trigger.conditions) ? trigger.conditions : {};
  const labels = Array.isArray(conditions.labels)
    ? conditions.labels.filter((label): label is string => typeof label === "string")
    : [];

  return {
    event: trigger.event,
    effortLte: isEffort(conditions.effort_lte) ? conditions.effort_lte : null,
    labels,
    source: typeof conditions.source === "string" ? conditions.source : null,
  };
}

/**
 * A list in prose — `docs`, `dependencies and tech-debt`, `a, b and c`.
 *
 * @param items The words, in the order the document holds them.
 * @returns The list, joined the way a sentence joins one.
 */
export function naturalList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The subject of the trigger sentence — *a sized issue with effort ≤ M*, *an issue labelled
 * docs*, *any issue*.
 *
 * Three clauses, each present exactly when its condition is: the effort makes the issue a
 * *sized* one, because an unsized ticket satisfies no effort condition
 * (`ouroboros-rest/src/modules/workflows/trigger.evaluation.ts`); the labels are the ones the
 * ticket must carry, **all** of them, which is what *labelled a and b* means; the source is
 * the tracker it came from. A trigger with none of the three is the catch-all, and says so.
 *
 * @param facts The predicate.
 * @returns The subject, without its verb.
 */
export function triggerSubject(facts: TriggerFacts): string {
  const { effortLte, labels, source } = facts;

  if (effortLte === null && labels.length === 0 && source === null) return ANY_ISSUE;

  const subject =
    effortLte === null ? "an issue" : `a sized issue with effort ≤ ${effortLte.toUpperCase()}`;
  const labelled = labels.length === 0 ? "" : ` labelled ${naturalList(labels)}`;
  const from = source === null ? "" : ` from ${SOURCE_NAMES[source] ?? source}`;

  return `${subject}${labelled}${from}`;
}

/**
 * The trigger predicate, in words — the mockup's *Runs when a sized issue with effort ≤ M is
 * queued.*
 *
 * Composed from the definition on every read and stored nowhere, which is the ticket's own
 * criterion: *the trigger sentence is composed from the definition rather than stored*.
 *
 * @param definition The document the sentence describes, or `null` for a workflow with none.
 * @returns The sentence, with its full stop. {@link NO_TRIGGER} for a document that names no
 *   event; a document naming an event this build does not know is described by that event's
 *   name rather than guessed at.
 */
export function triggerSentence(definition: WorkflowDefinition | null): string {
  const facts = readTrigger(definition);

  if (facts === null) return NO_TRIGGER;
  if (facts.event !== TICKET_QUEUED) return `Runs on ${facts.event}.`;

  return `Runs when ${triggerSubject(facts)} is queued.`;
}

/**
 * Which document the head describes: the version in force, or — for a workflow that has
 * published nothing — the draft the canvas opens on.
 *
 * The version first, because the subline sits beside `v14` and *runs when* is a claim about
 * what runs; a draft's trigger is what *will* run once it is published, and is described only
 * when there is nothing in force to describe instead.
 *
 * @param detail The workflow.
 * @returns The document, or `null` when the workflow has neither a version nor a draft.
 */
export function describedDefinition(detail: WorkflowDetail): WorkflowDefinition | null {
  return detail.version?.definition ?? detail.draft.definition;
}

/** What the subline says of a workflow with no draft open. */
export const NO_DRAFT = "No open draft";

/** What the version segment reads for a workflow that has published nothing — P.4's own word. */
export const NOT_PUBLISHED = "not published";

/**
 * The mockup's *Last edited 2h ago*, from the draft's stamp.
 *
 * The draft's rather than the entity's, deliberately: `WorkflowSummary.updatedAt` moves on a
 * rename, a pause or a publish, and `WorkflowDraft.updatedAt` is what the contract names as
 * *the mockup's Last edited*. A workflow with no draft has not been edited since it was
 * published, and says so rather than borrowing a stamp that means something else.
 *
 * @param updatedAt The draft's stamp, ISO 8601, or `null` when there is no draft.
 * @param now The instant the page was read.
 * @returns *Last edited 2h ago*, or {@link NO_DRAFT}.
 */
export function lastEdited(updatedAt: string | null, now: Date): string {
  return updatedAt === null ? NO_DRAFT : `Last edited ${relativeAgo(updatedAt, now)}`;
}

/**
 * The version in force, as the head's chip spells it.
 *
 * @param version `currentVersion`, or `null` for a workflow that has published nothing.
 * @returns `v14`, or {@link NOT_PUBLISHED}.
 */
export function versionWord(version: number | null): string {
  return version === null ? NOT_PUBLISHED : `v${version}`;
}

/**
 * The subline, as the mockup composes it: the trigger in words, then the three facts.
 *
 * *Runs when a sized issue with effort ≤ M is queued. Last edited 2h ago · v14 · used by 61%
 * of runs.* — the first sentence derived here, the usage caption served by P.4 and printed as
 * it arrived, and the two between them read off the workflow itself.
 *
 * @param detail The workflow, for its definition, its draft's stamp and its version.
 * @param entry Its rail entry, for the usage caption.
 * @param now The instant the page was read.
 * @returns The subline.
 */
export function studioSubline(detail: WorkflowDetail, entry: WorkflowRailEntry, now: Date): string {
  const facts = [
    lastEdited(detail.draft.updatedAt, now),
    versionWord(detail.currentVersion),
    entry.usageCaption,
  ].join(SEPARATOR);

  return `${triggerSentence(describedDefinition(detail))} ${facts}.`;
}

/* ------------------------------------------------------------------ the actions */

/** The mockup's first ghost action. */
export const BROWSE_TEMPLATES_LABEL = "Browse templates";

/**
 * Why it cannot act yet.
 *
 * The ticket routes it to the onboarding placeholder until T.5 makes it real; there is no
 * such placeholder in this module (#49's routes were never pages, only *soon* rows), so the
 * honest rendering is the product's one way of switching a control off — a reason that names
 * what is missing (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5). The templates themselves exist as
 * data since #381; what is missing is the surface that browses them.
 */
export const BROWSE_TEMPLATES_SOON =
  "The template library arrives with #159 — the starter workflows are seeded (#381), and " +
  "this is where they will be browsed.";

/**
 * The mockup's second ghost action, without the mockup's `#485`: the issue a dry run walks is
 * chosen from the queue when the flow exists, and a number this page did not compute is not a
 * number it may print.
 */
export const DRY_RUN_LABEL = "Dry run";

/** Why it cannot act yet — the flow is S.6's. */
export const DRY_RUN_SOON =
  "Dry runs arrive with #152 — a queued issue is walked through the definition, and the path " +
  "it takes is highlighted on the canvas.";

/**
 * The primary action's label — *Publish v15* beside a `v14` chip.
 *
 * The next number rather than the current one, which is what the button *does*: V029 holds
 * versions dense from 1, so the next version of a workflow at 14 is 15 and of one that has
 * published nothing is 1.
 *
 * @param currentVersion The version in force, or `null` for a workflow that has none.
 * @returns The label.
 */
export function publishLabel(currentVersion: number | null): string {
  return `Publish v${(currentVersion ?? 0) + 1}`;
}

/** Why **Publish** cannot act yet — the dialog, its validation findings and the change note are S.6's. */
export const PUBLISH_SOON =
  "Publishing arrives with #152 — the dialog, the validation findings it shows, and the " +
  "change note it records.";

/* ------------------------------------------------------------------ the segmented control */

/**
 * The studio surfaces that are built — the ids a page may claim as the tab it *is*.
 *
 * A type rather than a list, so the tab set below cannot link to a surface that does not
 * exist. `"code"` joins it with V.1 ([#169](https://github.com/NobuData/ouroboros/issues/169))
 * and `"copilot"` with CE.1 ([#565](https://github.com/NobuData/ouroboros/issues/565)) — the
 * two amendments recorded on the ticket — and the compiler will name the tab that has to
 * change with each, which is what the union is for.
 */
export type StudioSurface = "visual";

/** Every segment's id, built or not. */
export type StudioTabId = StudioSurface | "code" | "copilot";

/** What every segment carries: a stable id, which is also the React key, and what it says. */
interface StudioTabBase {
  readonly id: StudioTabId;
  readonly label: string;
}

/** A segment whose surface exists. It links there. */
export interface LiveStudioTab extends StudioTabBase {
  readonly id: StudioSurface;
  /** Where it goes — spelled from `app/paths.ts`, so the tab and the route are one fact. */
  readonly href: string;
}

/**
 * A segment whose surface does not exist yet. It names its owner instead of linking.
 *
 * `note` is required here and impossible on a live segment — the honesty pair `NavEntry` and
 * the Models tab set already use: a surface that is not ready is **labelled**, never dead and
 * never a link to a `404`. The ticket says so in as many words: *they ship visibly disabled and
 * labelled, not as buttons that quietly do nothing.*
 */
export interface SoonStudioTab extends StudioTabBase {
  readonly id: Exclude<StudioTabId, StudioSurface>;
  /** Why it is not reachable — which surface owns it, and when it arrives. */
  readonly note: string;
}

/** One segment of the control: built and linking, or unbuilt and saying so. */
export type StudioTab = LiveStudioTab | SoonStudioTab;

/**
 * Whether a segment leads somewhere.
 *
 * @param tab The segment.
 * @returns `true` for a built surface, narrowing the type to the one that carries an `href`.
 */
export function isLiveTab(tab: StudioTab): tab is LiveStudioTab {
  return "href" in tab;
}

/** Why **Code** leads nowhere yet — mockup 05's roadmap, V.1. */
export const CODE_SOON_NOTE = "Workflow as code arrives with #169.";

/** Why **Copilot** leads nowhere yet — mockup 20's roadmap, CE.1. */
export const COPILOT_SOON_NOTE = "The workflow copilot arrives with #565.";

/**
 * The segmented control — Visual · Code · Copilot — in the order mockup 04 draws it.
 *
 * A function rather than a constant, because the one live segment links to *this* workflow:
 * the Visual surface of `standard-fix` is `/workflows/standard-fix`, and a tab set that linked
 * every workflow's Visual segment to the section's landing would deselect the workflow on
 * every press. With nothing selected — an empty rail, a refused read — it links to the landing,
 * which is the only Visual surface there is.
 *
 * @param slug The selected workflow's slug, or `null` when nothing is selected.
 * @returns The three segments.
 */
export function studioTabs(slug: string | null): readonly StudioTab[] {
  return [
    { id: "visual", label: "Visual", href: slug === null ? WORKFLOWS_PATH : workflowPath(slug) },
    { id: "code", label: "Code", note: CODE_SOON_NOTE },
    { id: "copilot", label: "Copilot", note: COPILOT_SOON_NOTE },
  ];
}

/* ------------------------------------------------------------------ the rail */

/** The rail's accessible name — the navigation region a reader moves between workflows in. */
export const RAIL_LABEL = "Workflows";

/** The dashed tile's label, as the mockup writes it. */
export const NEW_WORKFLOW_LABEL = "+ New workflow";

/** Why the tile cannot act for a reader whose role may not create a workflow. */
export const NEW_WORKFLOW_MEMBER_REASON =
  "Creating a workflow is for workspace owners and admins.";

/**
 * Why the tile cannot act, or `undefined` when it can.
 *
 * The gate that **enforces** is the service's (`app/workflows/create-actions.ts`); this is
 * presentation, and its job is that a member sees the tile labelled with the reason rather
 * than a dialog that ends in a `403`.
 *
 * @param mayAdminister `app/api/membership.ts`'s answer for this reader.
 * @returns The reason, or `undefined`.
 */
export function newWorkflowReason(mayAdminister: boolean): string | undefined {
  return mayAdminister ? undefined : NEW_WORKFLOW_MEMBER_REASON;
}

/** One entry on the rail, decided. */
export interface RailItem {
  /** The slug — the React key, and what the URL names. */
  readonly slug: string;
  /** The human title the rail prints. */
  readonly name: string;
  /** The composed caption, printed as served — `6 stages · auto-merge`, `5 stages · paused`. */
  readonly caption: string;
  /** Where the entry links — `workflowPath(slug)`. */
  readonly href: string;
  /** Whether this is the workflow the studio is open on: the accent-gradient treatment. */
  readonly active: boolean;
  /**
   * Whether the entry carries the mockup's err-dot. `paused` and nothing else: `archived`
   * never reaches the rail, and an `active` workflow is the ordinary case.
   */
  readonly paused: boolean;
}

/**
 * The rail, decided: one item per entry, in the order the service listed them.
 *
 * The order is not touched. P.4 lists by `created_at`, which is what makes the seeded rail
 * read `standard-fix`, `feature-loop`, `deps-refresh`, `docs-loop`, `hotfix-p0` — and a sort
 * here would be a second opinion about what the rail's order means.
 *
 * @param entries The rail as served.
 * @param activeSlug The selected workflow's slug, or `null` when nothing is selected.
 * @returns The items.
 */
export function railItems(
  entries: readonly WorkflowRailEntry[],
  activeSlug: string | null,
): readonly RailItem[] {
  return entries.map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    caption: entry.caption,
    href: workflowPath(entry.slug),
    active: entry.slug === activeSlug,
    paused: entry.status === "paused",
  }));
}
