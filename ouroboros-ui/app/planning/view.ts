/**
 * Every decision the planning frame makes, and every sentence it says
 * (AM.1, [#283](https://github.com/NobuData/ouroboros/issues/283)).
 *
 * Mockup 09's frame is a head, two actions and three regions. What those draw is mostly copy
 * and a handful of judgements — why **Import from Jira** cannot act, why **New roadmap** cannot
 * act for a member, what the roadmap region is headed with — and each lives here so its
 * acceptance criterion is a unit test on a small value rather than an assertion about markup.
 *
 * **Framework-free and pure**, the way `app/workflows/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The read is `app/planning/data.ts`'s and the drawing is
 * `app/planning/planning-screen.tsx`'s.
 *
 * ### The subline is verbatim, and that is a claim the controls keep true
 *
 * It names all three trackers. The page does not hedge it: the tracker segment
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)) renders Jira and Linear by
 * their real connection state, so the copy stays true because the controls beneath it are
 * honest rather than because the copy apologises.
 */

import type { Reading } from "@/app/api/reading";
import type {
  PlanningBacklogHealth,
  PlanningBatch,
  PlanningRoadmap,
} from "@/app/api/planning";
import type { TicketSourceCatalog, TicketSourcePage } from "@/app/api/sources";

/* ------------------------------------------------------------------ the head */

/** The eyebrow over the heading, verbatim from the mockup. */
export const PLANNING_EYEBROW = "Planning";

/** The page heading, verbatim from the mockup. */
export const PLANNING_TITLE = "Describe the work. Ouroboros writes the tickets.";

/** The subline under the heading, verbatim from the mockup — see the module note. */
export const PLANNING_SUBLINE =
  "Draft epics and tickets straight into GitHub Issues, Jira, or Linear — sized by the " +
  "estimator, wired with dependencies, and queued for the loop the moment you approve them.";

/** The ghost action's label. */
export const IMPORT_JIRA_LABEL = "Import from Jira";

/** The mark an unbuilt control carries in its text, as the sidebar's *soon* rows do. */
export const SOON_MARK = "soon";

/**
 * Why **Import from Jira** cannot act — AN.3 ([#291](https://github.com/NobuData/ouroboros/issues/291)),
 * gated behind Jira write support (AN.2, #290). A live button would open a dialog that cannot
 * import anything, so the control is inert and names the issue that builds it.
 */
export const IMPORT_JIRA_SOON_NOTE = "Importing from Jira arrives with #291.";

/** The primary action's label. */
export const NEW_ROADMAP_LABEL = "New roadmap";

/**
 * Why **New roadmap** is inert for a reader who is not an `owner` or an `admin` — every lane
 * write is theirs (AL.4). The service enforces it; this is only what the control says.
 */
export const NEW_ROADMAP_ROLE_REASON = "Planning a roadmap is for workspace owners and admins.";

/**
 * The reason **New roadmap** is inert for this reader, if it is.
 *
 * @param mayAdminister Whether the reader is an `owner` or an `admin`.
 * @returns The sentence, or `undefined` when the control may act.
 */
export function newRoadmapReason(mayAdminister: boolean): string | undefined {
  return mayAdminister ? undefined : NEW_ROADMAP_ROLE_REASON;
}

/* ------------------------------------------------------------------ the regions */

/** The roadmap card's heading id. */
export const ROADMAP_REGION_ID = "planning-roadmap-title";

/** The roadmap card's title before any roadmap is named. */
export const ROADMAP_TITLE = "Roadmap";

/**
 * The roadmap card's title — the mockup's `ROADMAP — HELIOS 2.1`.
 *
 * @param roadmap The roadmap read, or a failure.
 * @returns `Roadmap — <name>` when the read named one, otherwise `Roadmap`.
 */
export function roadmapTitle(roadmap: Reading<PlanningRoadmap>): string {
  if (!roadmap.ok || roadmap.value.name === null) return ROADMAP_TITLE;

  return `${ROADMAP_TITLE} — ${roadmap.value.name}`;
}

/** What the roadmap card says when this workspace has planned nothing. */
export const ROADMAP_EMPTY_TITLE = "No roadmap yet";

/** …and the line under it: how to start one. */
export const ROADMAP_EMPTY_NOTE = "New roadmap names one and creates its first epic.";

/**
 * What it says when a roadmap has been named and has no lanes on it yet (AM.5,
 * [#287](https://github.com/NobuData/ouroboros/issues/287)).
 *
 * A different sentence from {@link ROADMAP_EMPTY_TITLE}, because it is a different fact and the
 * card's own head is already printing the roadmap's name above it — *No roadmap yet* under
 * *Roadmap — Helios 2.1* read as a contradiction.
 */
export const ROADMAP_NO_EPICS_TITLE = "No epics on this roadmap yet";

/** …and the line under it. */
export const ROADMAP_NO_EPICS_NOTE =
  "An epic is a lane on the gantt — a named piece of work with a month range. Adding the first " +
  "one draws the roadmap.";

/** What the roadmap card is headed with when the read failed, before the service's reason. */
export const ROADMAP_UNREAD = "The roadmap could not be read.";

/** Everything the planning page reads. */
export interface PlanningReadings {
  /** The roadmap — its head and lanes — or why it could not be read. */
  readonly roadmap: Reading<PlanningRoadmap>;
  /**
   * The workspace's ticket sources — the generator's tracker segment (AM.2) and the tracker-sync
   * rows (AM.3), which also read the page's `pollIntervalSeconds` for the cadence tag.
   */
  readonly sources: Reading<TicketSourcePage>;
  /** The source catalog, which carries each kind's write capability (AL.2). */
  readonly catalog: Reading<TicketSourceCatalog>;
  /** The backlog health figures the health card's meters are (AL.5, drawn by AM.3). */
  readonly health: Reading<PlanningBacklogHealth>;
  /** The batch a `?batch=` address names, or `null` when it names none (AM.2). */
  readonly batch: Reading<PlanningBatch> | null;
  /** The instant the page was read, ISO 8601 — see `data.ts`'s note on why it is taken once. */
  readonly now: string;
}
