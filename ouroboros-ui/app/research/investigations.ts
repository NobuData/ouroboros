import type {
  Investigation,
  InvestigationBrief,
  InvestigationDetail,
  InvestigationKind,
  InvestigationList,
  InvestigationProgress,
} from "@/app/api/research";
import { runPath, testsPath } from "@/app/paths";
import type { ChipTone } from "@/app/ui";

import { RESEARCH_ORIGIN } from "./brief";
import { DEPTH_LABELS } from "./composer";
import { type LibraryFilters, STATUS_FILTERS, type StatusFilter } from "./view";

/**
 * What the investigations card says and decides (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632)) — mockup 22's closing card, as
 * data. Framework-free, so every sentence and rule is a unit test without rendering, and so the
 * `"use server"` module beside it (`investigations-actions.ts`) has somewhere to import its
 * result types from.
 *
 * The rows are the service's (`GET /research/investigations`): the pill and the contextual link
 * are **derived there, never here** — a row cannot say one thing in the list and another when
 * opened. What is decided here is the address each link leads to, the words around the rows,
 * and how a live row changes while its stream is open.
 */

/* ---------- the card ---------- */

/** The card's heading. The seat's region carries the same title. */
export const INVESTIGATIONS_TITLE = "Investigations";

/** The library's heading, when the card shows every investigation with its facets. */
export const LIBRARY_TITLE = "Research library";

/** The card's toggle into the library — the mockup's `History`. */
export const HISTORY_LABEL = "History";

/** …and back to the active list. */
export const ACTIVE_LABEL = "Active";

/** The closing line — verbatim from the mockup. */
export const CLOSING_CAPTION =
  "Every investigation ends the same way the build loop does: with evidence — and, when you approve, with tickets the loop picks up next.";

/** The list's accessible name. */
export const LIST_LABEL = "Investigations";

/** What the card says when the filters match nothing. */
export const NO_MATCHES = "No investigation matches these filters.";

/** What the card says when the workspace has started none. */
export const NO_INVESTIGATIONS = "No investigation yet. Start one above.";

/** What the card says when the list could not be read. */
export const LIST_UNAVAILABLE_TITLE = "The investigations could not be read";

/** The way back from an open investigation to the rows. */
export const BACK_LABEL = "← All investigations";

/** What an open investigation says while its brief is read. */
export const OPENING = "Opening the investigation…";

/** What an open investigation without a brief says. */
export const NO_BRIEF_YET = "No brief yet — this investigation has not finished.";

/** The load-more control, when the page holds fewer rows than match. */
export function moreLabel(shown: number, total: number): string {
  return `Show more — ${String(shown)} of ${String(total)}`;
}

/**
 * The head's tag — `4 active · 23 this quarter`, the service's two computed counts, the quarter
 * a real UTC calendar window the service counted over.
 *
 * @param counts The list's counts.
 * @returns The tag's text.
 */
export function countsTag(counts: InvestigationList["counts"]): string {
  return `${String(counts.active)} active · ${String(counts.thisQuarter)} this quarter`;
}

/* ---------- the rows ---------- */

/**
 * A row's sub-line — the source count and the depth, which the row carries. The mockup's
 * sub-lines are hand-written summaries the service does not compose (its rows carry the
 * deliverables on the detail instead), so the line says what is measured.
 *
 * @param row The row.
 * @returns `44 sources · deep dive`.
 */
export function subLine(row: Pick<Investigation, "sources" | "depth">): string {
  return `${String(row.sources)} ${row.sources === 1 ? "source" : "sources"} · ${DEPTH_LABELS[row.depth].toLowerCase()}`;
}

/** The chip's hue for each pill tone the service names — the mockup's `.pill` modifiers. */
export const PILL_TONES: Readonly<Record<Investigation["pill"]["tone"], ChipTone>> = {
  run: "accent",
  warn: "warn",
  ok: "ok",
  err: "err",
  idle: "neutral",
};

/** Where a row's contextual link leads: a page, a seat of this page, or the row's own detail. */
export type RowLinkTarget =
  | { readonly kind: "href"; readonly href: string }
  | { readonly kind: "seat"; readonly seat: "brief" | "pipeline" }
  | { readonly kind: "open" };

/**
 * Where a row's link leads. The service names the target; the address is this page's.
 *
 * @param row The row.
 * @param featuredId The investigation the Featured brief seat shows, or null.
 * @returns `open run →` and `evidence →` lead to their consoles, lit under Research; `to roadmap →`
 *   lands on the pipeline's seat (the placeholder until #631); `brief ↑` lands on the brief's seat
 *   when the row is the featured one, and opens the row otherwise. Null for a row with no link.
 */
export function rowLinkTarget(row: Investigation, featuredId: string | null): RowLinkTarget | null {
  const link = row.link;
  if (link === null) return null;

  switch (link.kind) {
    case "run":
      return { kind: "href", href: runPath(link.runId, RESEARCH_ORIGIN) };
    case "evidence":
      return { kind: "href", href: testsPath(link.runId, { from: RESEARCH_ORIGIN }) };
    case "roadmap":
      return { kind: "seat", seat: "pipeline" };
    case "brief":
      return row.id === featuredId ? { kind: "seat", seat: "brief" } : { kind: "open" };
    default:
      return null;
  }
}

/** The accessible name of a row's open control — `Open RS-127`. */
export function openRowName(row: Pick<Investigation, "displayId">): string {
  return `Open ${row.displayId}`;
}

/* ---------- live rows ---------- */

/**
 * Whether a row's run can still change — the rows whose stream the card follows.
 *
 * @param row The row.
 * @returns True while queued or running.
 */
export function isLive(row: Pick<Investigation, "status">): boolean {
  return row.status === "queued" || row.status === "running";
}

/**
 * A row as a progress reading leaves it — the source count and the pill, in the service's own
 * words for a run in flight. A reading that ends the run is not applied here: the list is re-read
 * for the pill and link the service derives.
 *
 * @param row The row.
 * @param progress The reading.
 * @returns The row with its sources and pill moved on.
 */
export function rowFromProgress(row: Investigation, progress: InvestigationProgress): Investigation {
  const pill: Investigation["pill"] =
    progress.status === "running"
      ? progress.cancelRequested
        ? { state: "cancelling", label: "cancelling", tone: "warn", live: true }
        : { state: "running", label: "running", tone: "run", live: true }
      : { state: "queued", label: "queued", tone: "warn", live: false };

  return { ...row, status: progress.status, sources: progress.sources, pill };
}

/* ---------- the facets ---------- */

/** The status facet's words. */
export const STATUS_WORDS: Readonly<Record<StatusFilter, string>> = {
  active: "Active",
  queued: "queued",
  running: "running",
  brief_ready: "✓ brief ready",
  issues_filed: "✓ issues filed",
  failed: "failed",
  cancelled: "cancelled",
};

/** The facets' labels. */
export const KIND_FACET_LABEL = "Kind";
export const STATUS_FACET_LABEL = "Status";
export const QUARTER_FACET_LABEL = "Quarter";

/** The option that unsets a facet. */
export const ANY_KIND = "All kinds";
export const ANY_STATUS = "All statuses";
export const ANY_QUARTER = "All quarters";

/** The quarter facet's first choice — the service's own current quarter. */
export const CURRENT_QUARTER = "current";

/** How many quarters back the facet offers, the current one included. */
export const QUARTER_CHOICES = 8;

/**
 * The quarters the facet offers: the current one, then the ones before it, newest first.
 *
 * @param currentKey The service's current quarter — `2026-Q4`.
 * @param count How many, the current one included.
 * @returns The keys, in order.
 */
export function quarterChoices(currentKey: string, count = QUARTER_CHOICES): string[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(currentKey);
  if (match === null) return [];

  let year = Number(match[1]);
  let quarter = Number(match[2]);
  const keys: string[] = [];

  for (let at = 0; at < count; at += 1) {
    keys.push(`${String(year)}-Q${String(quarter)}`);
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }

  return keys;
}

/**
 * A quarter key in words — `Q4 2026`.
 *
 * @param key The key.
 * @returns The words; the key itself when it is not one.
 */
export function quarterWords(key: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(key);
  return match === null ? key : `Q${match[2]!} ${match[1]!}`;
}

/** The status facet's choices, in order. */
export const STATUS_CHOICES: readonly StatusFilter[] = STATUS_FILTERS;

/**
 * The query the list is read with for a view.
 *
 * @param view The page, or the library.
 * @param filters The library's facets.
 * @returns The card's `status=active` for the page; the facets as given for the library.
 */
export function listQuery(view: "page" | "library", filters: LibraryFilters): LibraryFilters {
  return view === "page" ? { kind: null, status: "active", quarter: null } : filters;
}

/**
 * The service's query for a set of facets.
 *
 * @param filters The facets.
 * @param limit The page size.
 * @param offset Where the page starts.
 * @returns What `GET /research/investigations` takes.
 */
export function toListQuery(
  filters: LibraryFilters,
  limit: number,
  offset = 0,
): { kind?: string; status?: StatusFilter; quarter?: string; limit: number; offset: number } {
  return {
    ...(filters.kind === null ? {} : { kind: filters.kind }),
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.quarter === null ? {} : { quarter: filters.quarter }),
    limit,
    offset,
  };
}

/** How many rows a page of the library holds. */
export const PAGE_SIZE = 25;

/** The kinds the facet offers — the composer's catalog. */
export type KindChoice = Pick<InvestigationKind, "slug" | "name">;

/* ---------- the actions' outcomes ---------- */

/** A refusal the service made, as a value. */
export interface ListRefusal {
  readonly code: string;
  readonly message: string;
}

/** What a list read answers. */
export type ListOutcome =
  | { readonly ok: true; readonly list: InvestigationList }
  | { readonly ok: false; readonly refusal: ListRefusal };

/** An investigation, opened from a row: its detail, and its brief when it has one. */
export interface OpenedInvestigation {
  readonly detail: InvestigationDetail;
  /** Null while the investigation has not delivered one. */
  readonly brief: InvestigationBrief | null;
}

/** What opening a row answers. */
export type OpenOutcome =
  | { readonly ok: true; readonly opened: OpenedInvestigation }
  | { readonly ok: false; readonly refusal: ListRefusal };

/** The service's code for an investigation without a brief. */
export const BRIEF_NOT_FOUND_CODE = "brief_not_found";
