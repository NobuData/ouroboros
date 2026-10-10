import type {
  InvestigationDepth,
  InvestigationDetail,
  InvestigationKind,
  InvestigationKindCatalog,
  InvestigationProgress,
  Researcher,
  ResearchSettings,
  ResearchToolCatalog,
  ResearchToolCatalogEntry,
  ScopeEstimate,
} from "@/app/api/research";
import type { Reading } from "@/app/api/reading";

import { VIEWER_START_REASON } from "./view";

/**
 * What the investigation composer says and decides (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) — mockup 22's **START AN
 * INVESTIGATION** card, as data. Framework-free, so every sentence and every rule is a unit
 * test without rendering, and so the `"use server"` module beside it (`composer-actions.ts`),
 * which may export nothing but functions, has somewhere to import its result types from.
 *
 * ### The honesty rule, kept here too
 * The estimate line is the service's `label`, printed verbatim: when the researcher is unpriced
 * it carries no `$`, and nothing in this module composes a dollar figure from a number it does
 * not have. The one dollar figure this module *does* format is a run's **spend so far**
 * ({@link formatSpend}) — a measurement the service made, never an estimate — and it is omitted
 * entirely, not printed as `$0.00`, when the service says the spend is unknown (`null`).
 */

/* ---------- what the composer is read from ---------- */

/** The three reads the composer is drawn from, each allowed to fail on its own. */
export interface ComposerReadings {
  /** The workspace's investigation kinds — the segmented control. */
  readonly kinds: Reading<InvestigationKindCatalog>;
  /** The installation's research tools — the chips. */
  readonly tools: Reading<ResearchToolCatalog>;
  /** Who may start here — why **Start investigation** may be inert. */
  readonly settings: Reading<ResearchSettings>;
}

/* ---------- the words ---------- */

/** The card's heading. The seat's region carries the same title. */
export const COMPOSER_TITLE = "Start an investigation";

/** The question field's label — verbatim from the mockup and the issue. */
export const QUESTION_LABEL = "Ask like you'd ask a principal engineer";

/** The question field's placeholder — the issue's example question. */
export const QUESTION_PLACEHOLDER = "Why are we losing autonomous-docking deals?";

/** The field's own name, for the form. */
export const QUESTION_NAME = "question";

/** The segmented control's accessible name. */
export const KINDS_LABEL = "Investigation kind";

/** The chips group's accessible name — the mockup's. */
export const TOOLS_LABEL = "Research tools to use";

/** The word before the chips. */
export const TOOLS_PREFIX = "Tools:";

/** The Depth menu's accessible name. */
export const DEPTH_MENU_LABEL = "Depth";

/** The word before the deliverable steps. */
export const DELIVERABLE_PREFIX = "Deliverable:";

/** The last step of every deliverable line links here by name. */
export const PLANNING_WORD = "Planning";

/** The primary action — the mockup's glyph included. */
export const START_LABEL = "Start investigation ⟳";

/** What the primary action says while the start is in flight. */
export const STARTING_LABEL = "Starting…";

/** The researcher pill's prefix — `researcher: researcher-long-ctx`. */
export const RESEARCHER_PREFIX = "researcher:";

/** The pill before the first estimate has answered. */
export const RESEARCHER_RESOLVING = "resolving…";

/** The pill when routing has nothing to run. */
export const RESEARCHER_NONE = "none routed";

/** The estimate line while the first estimate is being read. */
export const ESTIMATING = "estimating…";

/** The estimate line when the service could not be read. No `$`. */
export const ESTIMATE_UNAVAILABLE = "estimate unavailable";

/** The estimate line when no tool is on — nothing to estimate. */
export const ESTIMATE_NEEDS_TOOLS = "turn on a tool to estimate";

/** What the progress surface's stop action says. */
export const CANCEL_LABEL = "Cancel";

/** …and while the cancel is being asked for. */
export const CANCELLING_LABEL = "Cancelling…";

/** The finished surface's way back to the brief seat — the mockup's `brief ↑`. */
export const VIEW_BRIEF_LABEL = "View brief ↑";

/** The finished surface's way back to a blank composer. */
export const START_ANOTHER_LABEL = "Start another";

/** The card when its catalogs could not be read. */
export const COMPOSER_UNAVAILABLE_TITLE = "The composer could not be read";

/** …and the control that asks again. */
export const RELOAD_LABEL = "Reload";

/** The card when the workspace has no investigation kinds at all. */
export const NO_KINDS_NOTE =
  "This workspace has no investigation kinds, so there is nothing to start. The four built-in kinds arrive with the workspace; ask an owner to check its setup.";

/* ---------- why Start is inert ---------- */

/**
 * Why **Start investigation** is inert for a reader holding only `viewer`, verbatim from the
 * frame (`view.ts`) so the head and the card say the same thing.
 */
export { VIEWER_START_REASON };

/** Why it is inert for a member when the workspace lets only owners and admins start. */
export const ADMIN_ONLY_START_REASON =
  "This workspace lets only owners and admins start an investigation.";

/** Why it is inert while the question is blank. */
export const NO_QUESTION_REASON = "Write the question first.";

/** Why it is inert while no tool is on. */
export const NO_TOOLS_REASON = "Turn on at least one research tool.";

/** Why it is inert when routing has no researcher to run. */
export const NO_RESEARCHER_REASON =
  "No researcher is routed: the research task kind resolves to nothing usable. See Models.";

/** Why it is inert while the estimate has not answered. */
export const ESTIMATE_PENDING_REASON = "The estimate is still being read.";

/** Why it is inert when the estimate could not be read. */
export const ESTIMATE_FAILED_REASON = "The estimate could not be read, so nothing can be started.";

/* ---------- kinds ---------- */

/** The kind the composer opens on — the mockup's selection — when the workspace has it. */
export const DEFAULT_KIND = "gap_analysis";

/**
 * The kind the composer opens on.
 *
 * @param kinds The catalog, in its order.
 * @returns {@link DEFAULT_KIND} when present, else the first kind, else `null`.
 */
export function initialKind(kinds: readonly InvestigationKind[]): InvestigationKind | null {
  return kinds.find((kind) => kind.slug === DEFAULT_KIND) ?? kinds[0] ?? null;
}

/* ---------- depth ---------- */

/** The Depth menu's values, in its order. */
export const DEPTHS: readonly InvestigationDepth[] = ["quick", "standard", "deep_dive"];

/** The depth the composer opens on — the mockup's. */
export const DEFAULT_DEPTH: InvestigationDepth = "deep_dive";

/** Each depth's label. */
export const DEPTH_LABELS: Readonly<Record<InvestigationDepth, string>> = {
  quick: "Quick",
  standard: "Standard",
  deep_dive: "Deep dive",
};

/**
 * The menu button's text — the mockup's `Depth: Deep dive`.
 *
 * @param depth The chosen depth.
 * @returns The text.
 */
export function depthButtonLabel(depth: InvestigationDepth): string {
  return `${DEPTH_MENU_LABEL}: ${DEPTH_LABELS[depth]}`;
}

/** Every depth's estimate, so the menu can show each option's budget. */
export type DepthEstimates = Readonly<Record<InvestigationDepth, ScopeEstimate>>;

/**
 * One option's budget summary — the service's estimate line for that depth, so the menu's
 * figures are the same figures the estimate line prints once the depth is chosen.
 *
 * @param depth The option.
 * @param estimates Every depth's estimate, or null while none has answered.
 * @returns The line, or {@link ESTIMATING} while it is not known.
 */
export function depthBudget(depth: InvestigationDepth, estimates: DepthEstimates | null): string {
  return estimates === null ? ESTIMATING : estimates[depth].label;
}

/* ---------- tools ---------- */

/** What a chip is: pressed, released, or not a toggle at all. */
export type ChipState = "on" | "off" | "idle";

/**
 * The chip's state for a tool.
 *
 * @param tool The tool.
 * @param on The slugs that are on.
 * @returns `idle` for a tool with no adapter, whatever the selection says.
 */
export function chipState(tool: ResearchToolCatalogEntry, on: ReadonlySet<string>): ChipState {
  if (!tool.connected) return "idle";
  return on.has(tool.slug) ? "on" : "off";
}

/** The glyph before a chip's name — the mockup's tick, and its dot for a chip that is not on. */
export const CHIP_GLYPH: Readonly<Record<ChipState, string>> = { on: "✓", off: "·", idle: "·" };

/** Where an idle chip sends the reader: the tools card's seat, which holds the enable flow. */
export const TOOLS_SEAT_HREF = "#tools";

/**
 * What an idle chip explains — not connected yet, and where that changes.
 *
 * @param tool The tool.
 * @returns The sentence.
 */
export function idleChipTip(tool: ResearchToolCatalogEntry): string {
  return `${tool.name} is not connected yet — enable it in Research tools.`;
}

/**
 * The chips on when a kind is chosen: its playbook's defaults, less any tool this installation
 * has no adapter for. The composer never turns on a chip it cannot press.
 *
 * @param kind The kind.
 * @param tools The catalog.
 * @returns The slugs, in the catalog's order.
 */
export function defaultSelection(
  kind: InvestigationKind,
  tools: readonly ResearchToolCatalogEntry[],
): string[] {
  const defaults = new Set(kind.playbook.defaultTools);
  return tools.filter((tool) => tool.connected && defaults.has(tool.slug)).map((tool) => tool.slug);
}

/**
 * The selection with one tool toggled.
 *
 * @param on The slugs that are on.
 * @param slug The tool pressed.
 * @param tools The catalog, which fixes the order the selection is sent in.
 * @returns The new selection, in the catalog's order.
 */
export function toggleTool(
  on: ReadonlySet<string>,
  slug: string,
  tools: readonly ResearchToolCatalogEntry[],
): string[] {
  const next = new Set(on);
  if (next.has(slug)) next.delete(slug);
  else next.add(slug);

  return tools.filter((tool) => next.has(tool.slug)).map((tool) => tool.slug);
}

/* ---------- the deliverable line ---------- */

/** Each deliverable, in the order the line reads them. */
export const DELIVERABLE_ORDER: readonly string[] = ["brief", "matrix", "roadmap_doc", "fix_draft"];

/** What each deliverable is called on the line. */
export const DELIVERABLE_WORDS: Readonly<Record<string, string>> = {
  brief: "cited research brief",
  matrix: "capability matrix",
  roadmap_doc: "roadmap document",
  fix_draft: "drafted fix ticket",
};

/** The last step when the playbook drafts work in bulk — the mockup's gap analysis. */
export const DRAFTED_TICKETS = "drafted epics & tickets";

/**
 * The steps of the deliverable line, from a kind's playbook — the mockup's `cited research
 * brief → capability matrix → drafted epics & tickets in Planning`.
 *
 * A playbook that delivers a `fix_draft` ends on that ticket; every other playbook ends on the
 * drafted epics and tickets Planning receives. The last step is the one that is *in Planning*,
 * which the card links.
 *
 * @param deliverables The playbook's deliverables, in any order.
 * @returns The steps, the last of which is in Planning.
 */
export function deliverableSteps(deliverables: readonly string[]): string[] {
  const named = DELIVERABLE_ORDER.filter((kind) => deliverables.includes(kind)).map(
    (kind) => DELIVERABLE_WORDS[kind]!,
  );

  return deliverables.includes("fix_draft") ? named : [...named, DRAFTED_TICKETS];
}

/* ---------- the estimate line and the pill ---------- */

/**
 * The researcher pill's words.
 *
 * @param researcher The estimate's researcher: resolved, `null` when routing has nothing, or
 *   `undefined` before any estimate has answered.
 * @returns `researcher: <alias>`, or the two honest alternatives.
 */
export function researcherWords(researcher: Researcher | null | undefined): string {
  if (researcher === undefined) return `${RESEARCHER_PREFIX} ${RESEARCHER_RESOLVING}`;
  if (researcher === null) return `${RESEARCHER_PREFIX} ${RESEARCHER_NONE}`;

  return `${RESEARCHER_PREFIX} ${researcher.alias}`;
}

/** What the composer knows about its estimate right now. */
export type EstimateState =
  /** No tool is on; nothing to ask. */
  | { readonly kind: "no-tools" }
  /** The first answer has not arrived. */
  | { readonly kind: "pending" }
  /** The service could not be read. */
  | { readonly kind: "failed"; readonly reason: string }
  /** Every depth's estimate. `stale` while a newer ask is in flight. */
  | { readonly kind: "ready"; readonly estimates: DepthEstimates; readonly stale: boolean };

/**
 * The estimate line.
 *
 * @param state The estimate's state.
 * @param depth The chosen depth.
 * @returns The service's label for the chosen depth, or one of the three honest alternatives —
 *   none of which carries a `$`.
 */
export function estimateWords(state: EstimateState, depth: InvestigationDepth): string {
  switch (state.kind) {
    case "no-tools":
      return ESTIMATE_NEEDS_TOOLS;
    case "pending":
      return ESTIMATING;
    case "failed":
      return ESTIMATE_UNAVAILABLE;
    case "ready":
      return state.estimates[depth].label;
  }
}

/**
 * What the composer knows about its estimate, from the ask it is making and the last answer.
 *
 * @param askKey The current ask — the kind and the selection — or null when no tool is on.
 * @param answer The last answer and the ask it answered, or null before any.
 * @returns `no-tools` with nothing to ask; `pending` until an answer; the answer when it is to
 *   this ask; an earlier *estimate*, marked stale, while a newer ask is in flight — but never an
 *   earlier *refusal*, which said nothing about these choices.
 */
export function estimateStateOf(
  askKey: string | null,
  answer: { readonly key: string; readonly outcome: EstimateOutcome } | null,
): EstimateState {
  if (askKey === null) return { kind: "no-tools" };
  if (answer === null) return { kind: "pending" };

  const current = answer.key === askKey;
  if (answer.outcome.ok) return { kind: "ready", estimates: answer.outcome.estimates, stale: !current };

  return current ? { kind: "failed", reason: answer.outcome.refusal.message } : { kind: "pending" };
}

/** The inputs that decide whether **Start investigation** can act. */
export interface StartInputs {
  /** Why the workspace or the reader's role forbids a start, or null. */
  readonly gate: string | null;
  /** The question, as typed. */
  readonly question: string;
  /** How many tools are on. */
  readonly toolsOn: number;
  /** The estimate's state. */
  readonly estimate: EstimateState;
  /** The chosen depth. */
  readonly depth: InvestigationDepth;
}

/**
 * Why **Start investigation** is inert, or null when it may act.
 *
 * The order is the order a reader can do something about: the gate first (nothing to do but
 * ask), then the question, the tools, and last the estimate — which also carries the routing
 * answer, so an unrouted researcher is reported here rather than as a failed start.
 *
 * @param inputs See {@link StartInputs}.
 * @returns The reason, or null.
 */
export function startReason(inputs: StartInputs): string | null {
  if (inputs.gate !== null) return inputs.gate;
  if (inputs.question.trim() === "") return NO_QUESTION_REASON;
  if (inputs.toolsOn === 0) return NO_TOOLS_REASON;

  switch (inputs.estimate.kind) {
    case "no-tools":
      return NO_TOOLS_REASON;
    case "pending":
      return ESTIMATE_PENDING_REASON;
    case "failed":
      return ESTIMATE_FAILED_REASON;
    case "ready":
      return inputs.estimate.estimates[inputs.depth].researcher === null
        ? NO_RESEARCHER_REASON
        : null;
  }
}

/**
 * Why the workspace, or the reader's role in it, forbids a start — or null.
 *
 * @param mayContribute Whether the reader holds `owner`, `admin` or `member`.
 * @param mayAdminister Whether the reader holds `owner` or `admin`.
 * @param settings The workspace's setting, or why it could not be read — then the service is
 *   left to decide, and a refused start is shown as the service's own refusal.
 * @returns The reason, or null.
 */
export function startGate(
  mayContribute: boolean,
  mayAdminister: boolean,
  settings: Reading<ResearchSettings>,
): string | null {
  if (!mayContribute) return VIEWER_START_REASON;
  if (settings.ok && settings.value.startRole === "admin" && !mayAdminister) {
    return ADMIN_ONLY_START_REASON;
  }

  return null;
}

/* ---------- the progress surface ---------- */

/** The status word of a reading — the investigations card's pill words. */
export function statusWords(progress: InvestigationProgress): string {
  switch (progress.status) {
    case "queued":
      return "queued";
    case "running":
      return progress.cancelRequested ? "cancelling" : "running";
    case "brief_ready":
      return "✓ brief ready";
    case "issues_filed":
      return "✓ issues filed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

/**
 * A source count, in words.
 *
 * @param count The ledger's row count.
 * @returns `1 source`, `12 sources`.
 */
export function sourcesWords(count: number): string {
  return `${String(count)} ${count === 1 ? "source" : "sources"}`;
}

/**
 * A run's spend so far, as the mockup prints it — `$1.40`.
 *
 * This is the one dollar figure the composer formats itself, and it is a **measurement**: what
 * the service says the run's priced model calls have cost. It is never computed from an
 * estimate, and a caller with `null` — no priced call so far — prints nothing, not `$0.00`.
 *
 * @param cents The spend in cents.
 * @returns The figure, with two decimals.
 */
export function formatSpend(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The progress surface's line — `running · 12 sources · $1.40`, or without the spend when the
 * service has none to report.
 *
 * @param progress The reading.
 * @returns The parts, joined with the mockup's separator.
 */
export function progressWords(progress: InvestigationProgress): string {
  const parts = [statusWords(progress), sourcesWords(progress.sources)];
  if (progress.spendCents !== null) parts.push(formatSpend(progress.spendCents));

  return parts.join(" · ");
}

/**
 * Which round is being worked — `round 2 of 4` — or null before the first checkpoint and once
 * the run has ended.
 *
 * @param progress The reading.
 * @returns The words, or null.
 */
export function roundWords(progress: InvestigationProgress): string | null {
  if (progress.iteration === null || !inFlight(progress.status)) return null;

  return `round ${String(progress.iteration)} of ${String(progress.iterations)}`;
}

/**
 * Whether a run can still change.
 *
 * @param status Its status.
 * @returns True while queued or running.
 */
export function inFlight(status: InvestigationProgress["status"]): boolean {
  return status === "queued" || status === "running";
}

/**
 * Whether a finished run produced a brief to read.
 *
 * @param status Its status.
 * @returns True for `brief_ready` and `issues_filed`.
 */
export function hasBrief(status: InvestigationProgress["status"]): boolean {
  return status === "brief_ready" || status === "issues_filed";
}

/** What the progress surface says under a cancelled run's line. */
export const CANCELLED_NOTE = "Stopped where it was. Its sources and spend are kept.";

/** What it says under a run that failed, before the reason. */
export const FAILED_NOTE = "The investigation did not finish.";

/* ---------- the run the card follows ---------- */

/** The investigation the card is following, from its start to its end. */
export interface ComposerRun {
  readonly id: string;
  /** `RS-128`. */
  readonly displayId: string;
  /** The latest reading. */
  readonly progress: InvestigationProgress;
  /** The estimate it started under — the line, verbatim. */
  readonly estimateLabel: string;
  /** Whether this reader may cancel it. */
  readonly mayCancel: boolean;
  /** Why it failed, once the detail has been read; null otherwise. */
  readonly failure: InvestigationDetail["failure"];
}

/**
 * The run as a start answered it.
 *
 * @param started The start's answer.
 * @returns The run.
 */
export function runOf(started: {
  readonly investigation: InvestigationDetail;
  readonly estimate: { readonly label: string };
}): ComposerRun {
  return {
    id: started.investigation.id,
    displayId: started.investigation.displayId,
    progress: started.investigation.progress,
    estimateLabel: started.estimate.label,
    mayCancel: started.investigation.mayCancel,
    failure: started.investigation.failure,
  };
}

/* ---------- the actions' outcomes ---------- */

/** A refusal the service made, as a value. */
export interface ComposerRefusal {
  /** The envelope's code — `forbidden`, `research_researcher_unavailable`, … */
  readonly code: string;
  /** The envelope's sentence, written for a person. */
  readonly message: string;
}

/** What the estimate action answers. */
export type EstimateOutcome =
  | { readonly ok: true; readonly estimates: DepthEstimates }
  | { readonly ok: false; readonly refusal: ComposerRefusal };

/** What the start action answers. */
export type StartOutcome =
  | { readonly ok: true; readonly run: ComposerRun }
  | { readonly ok: false; readonly refusal: ComposerRefusal };

/** What the cancel action answers. */
export type CancelOutcome =
  | { readonly ok: true; readonly state: "cancelled" | "cancelling"; readonly run: ComposerRun }
  | { readonly ok: false; readonly refusal: ComposerRefusal };

/** What the read action answers. */
export type DetailOutcome =
  | { readonly ok: true; readonly detail: InvestigationDetail }
  | { readonly ok: false; readonly refusal: ComposerRefusal };

/**
 * The run as a detail re-read describes it, keeping the estimate line the start answered.
 *
 * @param run The run as followed so far.
 * @param detail The detail.
 * @returns The run, with the detail's progress, permission and failure.
 */
export function runFromDetail(run: ComposerRun, detail: InvestigationDetail): ComposerRun {
  return {
    ...run,
    progress: detail.progress,
    mayCancel: detail.mayCancel,
    failure: detail.failure,
  };
}
