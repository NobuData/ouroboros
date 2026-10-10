import { RESEARCH_PATH } from "@/app/paths";

/**
 * What the Research page says and where its parts sit
 * (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)) — mockup 22's head and frame,
 * as data. Framework-free, so the copy, the grid and the address rule are each testable alone.
 */

/* ---------- the head ---------- */

/** The eyebrow over the headline. */
export const RESEARCH_EYEBROW = "Research";

/** The page's thesis. Verbatim from the issue — the regions under it are what prove it. */
export const RESEARCH_HEADLINE =
  "Ask a hard question. Get an evidenced answer — and the tickets to act on it.";

/** The four-clause subline, with the em-dashed list of the four investigation kinds. Verbatim. */
export const RESEARCH_SUBLINE =
  "The same loop that handles the build runs investigations — root-cause briefs for bug fixes, " +
  "forensics on regressions, product roadmaps and improvement proposals, and project & " +
  "competitive gap analysis — with full research tools, every claim cited, every finding one " +
  "click from a drafted ticket.";

/** The ghost action's label. */
export const LIBRARY_LABEL = "Research library";

/** The primary action's label. */
export const NEW_INVESTIGATION_LABEL = "New investigation";

/**
 * Why **New investigation** is inert for a reader who holds only the `viewer` role: starting an
 * investigation spends the workspace's money. The full role pass is CN.7
 * ([#633](https://github.com/NobuData/ouroboros/issues/633)).
 */
export const VIEWER_START_REASON =
  "Starting an investigation is for workspace owners, admins and members — a viewer can read " +
  "the research.";

/* ---------- the address ---------- */

/** The query parameter that names which view of the page the address opens. */
export const VIEW_PARAM = "view";

/** Which view an address opens: the page from its top, or the library. */
export type ResearchView = "page" | "library";

/**
 * The library's address — where **Research library** goes.
 *
 * The frame owns it so the head button has a real destination from its first day: today the
 * address lands on the investigations seat, and CN.6
 * ([#632](https://github.com/NobuData/ouroboros/issues/632)) draws the filtered list at the same
 * address without the head changing.
 */
export const RESEARCH_LIBRARY_PATH = `${RESEARCH_PATH}?${VIEW_PARAM}=library`;

/**
 * Read the view an address names.
 *
 * @param raw The `view` parameter as Next.js hands it: absent, one value, or several.
 * @returns `"library"` for exactly that value; `"page"` for anything else, so an address nobody
 *   wrote opens the page from its top rather than failing.
 */
export function parseView(raw: string | string[] | undefined): ResearchView {
  return raw === "library" ? "library" : "page";
}

/* ---------- the library's facets (CN.6, #632) ---------- */

/** The query parameters the library's three facets travel in, and the open investigation. */
export const KIND_PARAM = "kind";
export const STATUS_PARAM = "status";
export const QUARTER_PARAM = "quarter";
export const OPEN_PARAM = "open";

/** The status facet's values — each status, or `active` for the four the card counts. */
export const STATUS_FILTERS = [
  "active",
  "queued",
  "running",
  "brief_ready",
  "issues_filed",
  "failed",
  "cancelled",
] as const;

/** One of {@link STATUS_FILTERS}. */
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** A kind's slug, as V106 spells one. */
const KIND_SLUG = /^[a-z][a-z0-9_]{0,47}$/;

/** A quarter — `current`, or `2026-Q4`. */
const QUARTER = /^(?:current|\d{4}-Q[1-4])$/;

/** A uuid, in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The library's facets: each null when unset. */
export interface LibraryFilters {
  readonly kind: string | null;
  readonly status: StatusFilter | null;
  readonly quarter: string | null;
}

/** No facet set. */
export const NO_FILTERS: LibraryFilters = { kind: null, status: null, quarter: null };

/** The query as Next.js hands it over. */
export type AddressQuery = Readonly<Record<string, string | string[] | undefined>>;

/**
 * The first value of a parameter, or null.
 *
 * @param raw The parameter: absent, one value, or several.
 * @returns The first value; null when absent or empty.
 */
function first(raw: string | string[] | undefined): string | null {
  const value = typeof raw === "string" ? raw : raw?.[0];
  return value === undefined || value === "" ? null : value;
}

/**
 * Read the library's facets off an address. A value nobody wrote is read as unset rather than
 * failing, so a mistyped address opens the library unfiltered.
 *
 * @param query The address's query.
 * @returns The facets.
 */
export function parseLibraryFilters(query: AddressQuery): LibraryFilters {
  const kind = first(query[KIND_PARAM]);
  const status = first(query[STATUS_PARAM]);
  const quarter = first(query[QUARTER_PARAM]);

  return {
    kind: kind !== null && KIND_SLUG.test(kind) ? kind : null,
    status: (STATUS_FILTERS as readonly string[]).includes(status ?? "") ? (status as StatusFilter) : null,
    quarter: quarter !== null && QUARTER.test(quarter) ? quarter : null,
  };
}

/**
 * Read the investigation an address opens, if it opens one.
 *
 * @param query The address's query.
 * @returns Its id, or null.
 */
export function parseOpen(query: AddressQuery): string | null {
  const open = first(query[OPEN_PARAM]);
  return open !== null && UUID.test(open) ? open : null;
}

/**
 * The address of a view of the investigations — the page's, or the library's with its facets
 * and, when one is open, the investigation. What **Research library**, **History**, a facet
 * change and a row press each write, so a filtered view is shareable.
 *
 * @param view Which view.
 * @param filters The facets; unset ones are left off the address.
 * @param open The open investigation, or null.
 * @returns `/research?view=library&kind=gap_analysis&status=active`, `/research?open=…`, or
 *   `/research` for the page with nothing set.
 */
export function researchAddress(
  view: ResearchView,
  filters: LibraryFilters = NO_FILTERS,
  open: string | null = null,
): string {
  const query = new URLSearchParams();

  if (view === "library") query.set(VIEW_PARAM, "library");
  if (filters.kind !== null) query.set(KIND_PARAM, filters.kind);
  if (filters.status !== null) query.set(STATUS_PARAM, filters.status);
  if (filters.quarter !== null) query.set(QUARTER_PARAM, filters.quarter);
  if (open !== null) query.set(OPEN_PARAM, open);

  const search = query.toString();
  return search === "" ? RESEARCH_PATH : `${RESEARCH_PATH}?${search}`;
}

/* ---------- the regions ---------- */

/** The six regions under the head. The head itself is the seventh. */
export type ResearchRegionId = "composer" | "tools" | "watch" | "brief" | "pipeline" | "investigations";

/**
 * Where a region sits in the mockup's twelve columns: `main` is its `c-7`, `side` is a card in
 * its `c-5` side column, and `wide` is a `c-12` card under both.
 */
export type RegionPlace = "main" | "side" | "wide";

/** One region of the page. */
export interface ResearchRegion {
  /** The region, and the element id its seat carries — an anchor's target. */
  readonly id: ResearchRegionId;
  /** The heading its seat draws until its card exists. */
  readonly title: string;
  /** Where it sits. */
  readonly place: RegionPlace;
  /** What fills the seat and the issue that builds it — the seat's one line until then. */
  readonly arrives: string;
}

/**
 * The regions in the mockup's order: the composer beside the side column (tools over the
 * regression watch), then the three full-width cards.
 */
export const RESEARCH_REGIONS: readonly ResearchRegion[] = [
  {
    id: "composer",
    title: "Start an investigation",
    place: "main",
    arrives:
      "The composer — a question, a kind, a depth and a tool mix, with a computed estimate — arrives with #628.",
  },
  {
    id: "tools",
    title: "Research tools",
    place: "side",
    arrives: "Each research tool, with its health and how to enable it, arrives with #629.",
  },
  {
    id: "watch",
    title: "Regression watch",
    place: "side",
    arrives: "Drift against each release baseline, from detection to merged fix, arrives with #629.",
  },
  {
    id: "brief",
    title: "Featured brief",
    place: "wide",
    arrives: "A cited brief, with its capability matrix and numbered sources, arrives with #630.",
  },
  {
    id: "pipeline",
    title: "Roadmap pipeline",
    place: "wide",
    arrives: "A brief's roadmap document, and the issues filed from it, arrive with #631.",
  },
  {
    id: "investigations",
    title: "Investigations",
    place: "wide",
    arrives:
      "Every investigation — and the library, filtered by kind, status and quarter — arrives with #632.",
  },
];

/** The region **New investigation** lands on. */
export const COMPOSER_REGION: ResearchRegionId = "composer";

/** The region a finished investigation's **View brief ↑** lands on (CN.2, #628). */
export const BRIEF_REGION: ResearchRegionId = "brief";

/** The region a roadmap brief's document chip lands on (CN.4, #630), until #631's card. */
export const PIPELINE_REGION: ResearchRegionId = "pipeline";

/** The region the library's address lands on. */
export const LIBRARY_REGION: ResearchRegionId = "investigations";

/**
 * The regions at one place, in the page's order.
 *
 * @param place The place.
 * @returns Its regions.
 */
export function regionsAt(place: RegionPlace): readonly ResearchRegion[] {
  return RESEARCH_REGIONS.filter((region) => region.place === place);
}

/**
 * The id of a region's heading, which names its seat's card.
 *
 * @param id The region.
 * @returns The heading's element id.
 */
export function regionTitleId(id: ResearchRegionId): string {
  return `research-${id}-title`;
}

/**
 * The region an address opens on, if it opens on one.
 *
 * @param view The address's view.
 * @returns The library's region for the library view; `null` for the page from its top.
 */
export function landingRegion(view: ResearchView): ResearchRegionId | null {
  return view === "library" ? LIBRARY_REGION : null;
}
