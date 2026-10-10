import type {
  BriefCite,
  BriefLedgerSource,
  BriefSource,
  InvestigationBrief,
  InvestigationDetail,
  InvestigationStatus,
} from "@/app/api/research";
import { PLANNING_PATH, RESEARCH_PATH, runPath, testsPath } from "@/app/paths";
import type { ChipTone } from "@/app/ui";

import { DEPTH_LABELS } from "./composer";

/**
 * What the brief card says and decides (CN.4,
 * [#630](https://github.com/NobuData/ouroboros/issues/630)) — mockup 22's **featured
 * investigation** card, as data. Framework-free, so every sentence and rule is a unit test
 * without rendering, and so the `"use server"` module beside it (`brief-actions.ts`) has
 * somewhere to import its result types from.
 *
 * The card is drawn from two reads the service already composes — the brief
 * (`GET …/brief`: paragraphs, cites, the sources panel, the matrix, the proposals) and the
 * investigation's detail (`GET …/{id}`: its deliverables and links) — and nothing here recomputes
 * a severity, a cite number or a label the service decided. What is decided here is *where
 * things go*: which source a marker scrolls to, which deliverable leads where, and the words
 * around them.
 */

/* ---------- the head ---------- */

/** The card's words beside the status pill. */
export const EXPORT_LABEL = "Export brief ↗";

/** The gap kind's payoff. */
export const DRAFT_EPIC_LABEL = "Draft epic from gaps →";

/** …while the batch is being drafted. */
export const DRAFTING_LABEL = "Drafting…";

/** Why **Draft epic from gaps →** is inert for a `viewer`. */
export const VIEWER_DRAFT_REASON =
  "Drafting work is for workspace owners, admins and members — a viewer can read the brief.";

/** The featured seat's heading. The region carries the same title. */
export const FEATURED_TITLE = "Featured brief";

/** What the featured seat says when no investigation has finished yet. */
export const NO_BRIEF_TITLE = "No brief yet";

/** …and under it. */
export const NO_BRIEF_NOTE =
  "The newest finished investigation's brief is read here. Start one above, and it arrives when the brief is ready.";

/** The featured seat when the brief could not be read. */
export const BRIEF_UNAVAILABLE_TITLE = "The brief could not be read";

/**
 * The card's title — the mockup's `AUTONOMOUS DOCKING VS. THE FIELD`: the matrix's title for a
 * gap analysis, the question for every other kind (a brief has no title of its own).
 *
 * @param brief The brief.
 * @returns The title, as written; the sheet sets it in capitals.
 */
export function briefTitle(brief: InvestigationBrief): string {
  return brief.matrix?.title ?? brief.investigation.question;
}

/** The depth's lower-case word for the tag — `deep dive`. */
export function depthWord(depth: InvestigationBrief["investigation"]["depth"]): string {
  return DEPTH_LABELS[depth].toLowerCase();
}

/**
 * The head's tag — `44 sources · deep dive`.
 *
 * @param brief The brief.
 * @returns The tag's text.
 */
export function sourcesTag(brief: InvestigationBrief): string {
  const count = brief.sources.cited;
  return `${String(count)} ${count === 1 ? "source" : "sources"} · ${depthWord(brief.investigation.depth)}`;
}

/** The status pill, in the investigations card's words and hues. */
export const STATUS_PILLS: Readonly<Record<InvestigationStatus, { label: string; tone: ChipTone }>> = {
  queued: { label: "queued", tone: "warn" },
  running: { label: "running", tone: "accent" },
  brief_ready: { label: "✓ brief ready", tone: "ok" },
  issues_filed: { label: "✓ issues filed", tone: "ok" },
  failed: { label: "failed", tone: "err" },
  cancelled: { label: "cancelled", tone: "neutral" },
};

/**
 * Whether the card offers **Draft epic from gaps →** at all: only a brief that proposes an epic
 * — a gap analysis with HIGH or MED rows — has one to draft.
 *
 * @param brief The brief.
 * @returns True when the service proposes something.
 */
export function offersDraftEpic(brief: InvestigationBrief): boolean {
  return brief.proposed !== null && brief.proposed.tickets.length > 0;
}

/* ---------- citations and sources ---------- */

/**
 * The element id a source's row carries — what a marker scrolls to.
 *
 * @param cite A cite, or a source: the number and the symbolic key.
 * @returns `research-source-07`, `research-source-git`.
 */
export function sourceRowId(cite: Pick<BriefCite, "citeNo" | "citeKey">): string {
  return `research-source-${cite.citeKey ?? String(cite.citeNo)}`;
}

/**
 * A source of the panel, by the ledger record a cite names.
 *
 * @param sources The panel.
 * @param sourceId The record.
 * @returns The source, or undefined when the panel does not list it — a matrix cell may cite a
 *   record no claim does, which the full ledger holds.
 */
export function panelSource(
  sources: readonly BriefSource[],
  sourceId: string,
): BriefSource | undefined {
  return sources.find((source) => source.sourceId === sourceId);
}

/** The sources panel's heading — the mockup's `SOURCES — 44 CITED`. */
export function sourcesTitle(cited: number): string {
  return `Sources — ${String(cited)} cited`;
}

/** The panel's way to the whole ledger. */
export const ALL_SOURCES_LABEL = "all ↗";

/** The ledger sheet's heading — `RS-127 — every source, 44 of them`. */
export function ledgerTitle(displayId: string, total: number): string {
  return `${displayId} — every source, ${String(total)} of them`;
}

/** What the sheet says while the ledger is being read. */
export const LEDGER_LOADING = "Reading the ledger…";

/** What the sheet says when it could not be. */
export const LEDGER_UNAVAILABLE = "The ledger could not be read.";

/** The word before a ledger row's excerpt. */
export const EXCERPT_LABEL = "Excerpt";

/** The word before a ledger row's retrieval time. */
export const RETRIEVED_LABEL = "Retrieved";

/**
 * When a record was retrieved, as the sheet prints it — the instant in the reader's locale,
 * to the minute, with the zone, so two readers can agree on what was read when.
 *
 * @param iso The instant.
 * @param locale The reader's locale; the runtime's by default.
 * @returns `10 Oct 2026, 12:07 UTC`-like text.
 */
export function retrievedWords(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/**
 * Whether a ledger record is one the brief's claims cite — drawn apart in the sheet from the
 * records read and not cited.
 *
 * @param record The record.
 * @param panel The panel.
 * @returns True when a claim cites it.
 */
export function isCited(record: BriefLedgerSource, panel: readonly BriefSource[]): boolean {
  return panelSource(panel, record.sourceId) !== undefined;
}

/* ---------- the brief's text ---------- */

/** The marker drawn before an open question. */
export const OPEN_QUESTION_MARK = "open question";

/** The marker drawn beside a demoted claim — offered as a finding, cited nothing. */
export const DEMOTED_MARK = "demoted";

/** What the open-questions paragraph is called. */
export const OPEN_QUESTIONS_HEADING = "Open questions";

/** What the findings paragraphs are called — the mockup's `Finding.`. */
export const FINDING_MARK = "Finding.";

/* ---------- the matrix ---------- */

/** The matrix's first column. */
export const CAPABILITY_HEADER = "Capability";

/** The matrix's last column. */
export const GAP_HEADER = "Gap";

/** What the head of our own column adds — the mockup's `Helios (us)`. */
export function usHeader(label: string): string {
  return `${label} (us)`;
}

/** What a cell's tooltip says for `? unknown` — an honest state, not a blank. */
export const UNKNOWN_CELL_NOTE =
  "The investigation did not find out. Not a blank, and not none.";

/** The tooltip's heading for a cited cell. */
export function cellCitesWords(count: number): string {
  return count === 1 ? "1 source" : `${String(count)} sources`;
}

/** The accessible name of a cell's face — `Skylink: shipping`. */
export function cellName(column: string, label: string): string {
  return `${column}: ${label}`;
}

/* ---------- proposed from gaps ---------- */

/** The word before the chips. */
export const PROPOSED_PREFIX = "Proposed from gaps:";

/**
 * The chip that counts the tickets not named — the mockup's `+3 more`.
 *
 * @param more How many.
 * @returns The chip's text, or null when every ticket is named.
 */
export function moreLabel(more: number): string | null {
  return more > 0 ? `+${String(more)} more` : null;
}

/**
 * The epic's effort, as the chip prints it.
 *
 * @param effort The roll-up, or null when no ticket is sized.
 * @returns `L`, or null.
 */
export function effortLetter(effort: string | null): string | null {
  return effort === null ? null : effort.toUpperCase();
}

/* ---------- the kind variants ---------- */

/** Where a deliverable leads: a page, or a seat of this page. */
export type DeliverableTarget =
  | { readonly kind: "href"; readonly href: string }
  | { readonly kind: "seat"; readonly seat: "pipeline" };

/** One chip of the deliverables strip. */
export interface DeliverableChip {
  /** `fix_draft`, `draft_batch`, `roadmap_doc`, `run`, `evidence`, `culprit`. */
  readonly key: string;
  /** `fix draft`, `open run →`. */
  readonly label: string;
  /** Where it leads; null for a fact with nowhere to go. */
  readonly target: DeliverableTarget | null;
}

/** The sidebar entry a run or its tests keep lit when opened from here. */
export const RESEARCH_ORIGIN = "research";

/**
 * The Planning page on a batch — `/planning?batch=<id>`.
 *
 * @param batchId The batch.
 * @returns The path.
 */
export function planningBatchPath(batchId: string): string {
  return `${PLANNING_PATH}?batch=${encodeURIComponent(batchId)}`;
}

/** The deliverables the strip names, by kind, and what each is called. */
const DELIVERABLE_WORDS: Readonly<Record<string, string>> = {
  fix_draft: "fix draft",
  draft_batch: "drafted tickets",
  roadmap_doc: "roadmap document",
};

/**
 * The culprit a forensics brief names, when its ledger holds a bisect — a `bisect://` record,
 * which the code tool archives with the culprit commit in its label.
 *
 * @param sources The panel.
 * @returns The record, or null when the brief cites no bisect.
 */
export function culpritOf(sources: readonly BriefSource[]): BriefSource | null {
  return sources.find((source) => source.locator.startsWith("bisect://")) ?? null;
}

/**
 * The deliverables strip — what an investigation of any kind led to, each a chip that leads
 * there: a fix draft (Planning), a drafted batch (its batch in Planning), a roadmap document
 * (the pipeline's seat, until #631 mounts the card there), a live run, the evidence run, and a
 * forensics brief's culprit.
 *
 * @param detail The investigation, opened.
 * @param brief The brief, for the culprit.
 * @returns The chips, in that order; empty for a brief that led nowhere yet.
 */
export function deliverableChips(
  detail: InvestigationDetail,
  brief: InvestigationBrief,
): DeliverableChip[] {
  const chips: DeliverableChip[] = [];

  for (const deliverable of detail.deliverables) {
    const label = DELIVERABLE_WORDS[deliverable.kind];
    if (label === undefined) continue;

    const target: DeliverableTarget =
      deliverable.kind === "roadmap_doc"
        ? { kind: "seat", seat: "pipeline" }
        : {
            kind: "href",
            href:
              deliverable.kind === "draft_batch"
                ? planningBatchPath(deliverable.id)
                : PLANNING_PATH,
          };

    chips.push({ key: deliverable.kind, label, target });
  }

  const run = detail.links.run;
  if (run !== null && run.kind === "run") {
    chips.push({
      key: "run",
      label: run.label,
      target: { kind: "href", href: runPath(run.runId, RESEARCH_ORIGIN) },
    });
  }
  const evidence = detail.links.evidence;
  if (evidence !== null && evidence.kind === "evidence") {
    chips.push({
      key: "evidence",
      label: evidence.label,
      target: { kind: "href", href: testsPath(evidence.runId, { from: RESEARCH_ORIGIN }) },
    });
  }

  const culprit = brief.investigation.kind === "regression_forensics" ? culpritOf(brief.sources.panel) : null;
  if (culprit !== null) {
    chips.push({
      key: "culprit",
      label: `culprit · ${culprit.locatorLabel}`,
      target: culprit.href === null ? null : { kind: "href", href: culprit.href },
    });
  }

  return chips;
}

/** The strip's prefix. */
export const DELIVERABLES_PREFIX = "Led to:";

/* ---------- the draft-epic action ---------- */

/** The service's code when the workspace has more than one tracker and none was named. */
export const TARGET_REQUIRED_CODE = "roadmap_target_required";

/** The tracker dialog's heading. */
export const TRACKER_DIALOG_TITLE = "Which tracker are the drafts for?";

/** …and its note. */
export const TRACKER_DIALOG_NOTE =
  "Nothing is filed: the drafts open in Planning for review, and are pushed to this tracker when you are ready.";

/** The dialog's confirm. */
export const TRACKER_CONFIRM_LABEL = "Draft here";

/** The dialog's dismiss. */
export const TRACKER_CANCEL_LABEL = "Cancel";

/** What the dialog says while the trackers are being read. */
export const TRACKERS_LOADING = "Reading the trackers…";

/** A tracker the drafts may be for. */
export interface TrackerChoice {
  readonly id: string;
  readonly displayName: string;
  readonly kind: string;
}

/** What the trackers read answers. */
export type TrackersOutcome =
  | { readonly ok: true; readonly trackers: readonly TrackerChoice[] }
  | { readonly ok: false; readonly refusal: BriefRefusal };

/** A refusal the service made, as a value. */
export interface BriefRefusal {
  readonly code: string;
  readonly message: string;
}

/** What the draft-epic action answers. */
export type DraftEpicOutcome =
  | { readonly ok: true; readonly href: string; readonly created: boolean }
  | { readonly ok: false; readonly refusal: BriefRefusal };

/** What the ledger read answers. */
export type LedgerOutcome =
  | { readonly ok: true; readonly total: number; readonly items: readonly BriefLedgerSource[] }
  | { readonly ok: false; readonly refusal: BriefRefusal };

/* ---------- the export ---------- */

/**
 * This origin's address for one brief's export — what **Export brief ↗** links to. The hop
 * behind it is `app/api/brief-export.ts`.
 *
 * @param id The investigation's id, encoded here.
 * @returns `/api/research/investigations/{id}/brief/export`.
 */
export function briefExportUrl(id: string): string {
  return `/api/research/investigations/${encodeURIComponent(id)}/brief/export`;
}

/* ---------- the featured slot ---------- */

/** The featured brief: the newest investigation that delivered one, with its detail. */
export interface FeaturedBrief {
  readonly brief: InvestigationBrief;
  readonly detail: InvestigationDetail;
}

/** The statuses a featured investigation may hold, newest of the first found first. */
export const FEATURED_STATUSES: readonly InvestigationStatus[] = ["brief_ready", "issues_filed"];

/** This page, for a link that comes back. */
export { RESEARCH_PATH };
