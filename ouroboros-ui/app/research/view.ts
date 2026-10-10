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
