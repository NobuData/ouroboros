/**
 * Every state the planning page can be in that is not *the populated page*
 * (AM.5, [#287](https://github.com/NobuData/ouroboros/issues/287)).
 *
 * The four cards were each built for their happy path — the frame
 * ([#283](https://github.com/NobuData/ouroboros/issues/283)), the generator
 * ([#284](https://github.com/NobuData/ouroboros/issues/284)), tracker sync and backlog health
 * ([#285](https://github.com/NobuData/ouroboros/issues/285)) and the gantt
 * ([#286](https://github.com/NobuData/ouroboros/issues/286)). This module is what the page consults
 * when there is nothing to show, nowhere to push to, no permission to act, or nothing that could be
 * read — the shape `app/issues/states.ts` and `app/sources/states.ts` already take, so a fifth page
 * does not invent a fifth vocabulary.
 *
 * **Framework-free and pure.** Nothing here imports React, `next/*` or the server-only client.
 *
 * ### *Could not be read* and *nothing here yet* are different sentences
 *
 * That distinction is the ticket's, and DASH-I.7's ([#86](https://github.com/NobuData/ouroboros/issues/86))
 * before it. A read that failed wears the banner — said **once**, with the page's only retry
 * ({@link planningFailures}); a workspace that has simply not done anything yet wears a guidance
 * card with the next step on it. Before this issue both wore an `EmptyState` and a full outage
 * printed four separate reasons down the page, which is the nine-times-over problem the dashboard
 * issue was written against.
 *
 * ### Drafting needs a tracker, and the page says so rather than pretending otherwise
 *
 * The ticket's premise is that a fresh workspace can draft immediately because *"generation needs
 * no tracker"*. **That is not true of the contract as built**: `PlanningBatchCreate.targetSourceId`
 * is required and `draft_batches.target_source_id` is `not null`, with a tenancy trigger that
 * resolves the workspace *through* it — a batch is filed against a tracker from the moment it
 * exists. So the honest half-working state is not *draft now, push later*; it is a generator that
 * stays fully visible, keeps its prompt and its controls, and says plainly that a tracker has to be
 * connected before a draft can be filed — with the control to do it ({@link CONNECT_TRACKER_TITLE}).
 * Hiding the card would waste the state; claiming a draft would fail on the first click.
 */

import type { Reading } from "@/app/api/reading";
import type { TicketSourceCatalog, TicketSourcePage } from "@/app/api/sources";

import { pushableTrackers } from "./generator";
import type { PlanningReadings } from "./view";

/* ------------------------------------------------------------------ the failed reads */

/** One page-wide read that failed: what it was, in the page's words, and what the service said. */
export interface PlanningFailure {
  /** The read, named for a reader. */
  readonly what: string;
  /** The service's own sentence. */
  readonly reason: string;
}

/** Each read's name in the banner, in the order the page draws the things they fill. */
export const ROADMAP_READ = "The roadmap";
export const SOURCES_READ = "The workspace's trackers";
export const CATALOG_READ = "The source catalog";
export const HEALTH_READ = "Backlog health";
export const BATCH_READ = "The batch this address names";

/**
 * The page-wide reads that failed, in the page's own order.
 *
 * The batch is included **only when the address named one**: a page with no `?batch=` has no batch
 * read to fail, and `null` is not a failure.
 *
 * @param readings What the page read.
 * @returns What failed. Empty when nothing did.
 */
export function planningFailures(readings: PlanningReadings): readonly PlanningFailure[] {
  return readsOf(readings).flatMap(([what, reading]) =>
    reading.ok ? [] : [{ what, reason: reading.reason }],
  );
}

/**
 * Every read this page actually made, named, in the order the page draws what they fill.
 *
 * One list, so {@link planningFailures} and {@link planningReadCount} cannot come to disagree about
 * how many reads there were — which is the whole of what separates *part of this page* from *this
 * page* in the banner's headline. A sixth read added to `data.ts` is added here once.
 *
 * @param readings What the page read.
 * @returns Each read with its name. The batch appears only when the address named one: a page with
 *   no `?batch=` made no batch read, and `null` is not a failure.
 */
function readsOf(readings: PlanningReadings): [string, Reading<unknown>][] {
  const always: [string, Reading<unknown>][] = [
    [ROADMAP_READ, readings.roadmap],
    [SOURCES_READ, readings.sources],
    [CATALOG_READ, readings.catalog],
    [HEALTH_READ, readings.health],
  ];

  return readings.batch === null ? always : [...always, [BATCH_READ, readings.batch]];
}

/**
 * The banner's reason for a degraded page — *The roadmap: …  · Backlog health: …*.
 *
 * @param failures What failed. An empty list answers an empty string rather than throwing, so a
 *   caller that forgot to check cannot crash the page over having nothing to say.
 * @returns The joined sentence.
 */
export function planningFailureReason(failures: readonly PlanningFailure[]): string {
  return failures.map((failure) => `${failure.what}: ${failure.reason}`).join(" · ");
}

/** The banner's headline when some of the page could not be read. */
export const PLANNING_DEGRADED_HEADLINE = "Part of this page could not be read.";

/** …and when none of it could. */
export const PLANNING_FAILED_HEADLINE = "This page could not be read.";

/**
 * The banner's headline for what failed.
 *
 * @param failures What failed.
 * @param total How many reads the page made — `failures.length` matching it is a total outage.
 * @returns The headline.
 */
export function planningHeadline(
  failures: readonly PlanningFailure[],
  total: number,
): string {
  return failures.length >= total && total > 0
    ? PLANNING_FAILED_HEADLINE
    : PLANNING_DEGRADED_HEADLINE;
}

/**
 * How many reads a set of readings actually made — the denominator {@link planningHeadline} wants.
 *
 * Counted from {@link readsOf} rather than written down, so it cannot drift from the list the
 * failures are found in.
 *
 * @param readings What the page read.
 * @returns The count.
 */
export function planningReadCount(readings: PlanningReadings): number {
  return readsOf(readings).length;
}

/**
 * The one line a card shows where its read failed.
 *
 * Deliberately **not** the service's reason: that is the banner's, said once, and a card that
 * repeated it would put the same sentence on the screen up to five times. The card's own title
 * still names *what* is missing; this says where to find *why*.
 */
export const CARD_UNREAD_NOTE = "The banner above carries the reason, and the retry.";

/* ------------------------------------------------------------------ the tracker state */

/** Whether this workspace has a tracker a batch could be filed against. */
export type TrackerState =
  /** At least one connected source whose tracker can be written to. */
  | "ready"
  /** Sources were read, and none of them can be written to — the guidance path. */
  | "none-writable"
  /** The sources or the catalog could not be read, so nothing can be said about them. */
  | "unread";

/**
 * Whether anything on this page could be drafted against.
 *
 * Both reads matter and for different reasons: the listing says what is *connected*, and the
 * catalog says which kinds can be *written to* (AL.2,
 * [#278](https://github.com/NobuData/ouroboros/issues/278)). A workspace with two connected
 * read-only trackers is as unable to draft as one with none, and saying *not connected* to it would
 * be the wrong next step.
 *
 * @param sources The workspace's sources.
 * @param catalog The catalog read.
 * @returns Which state the page is in.
 */
export function trackerState(
  sources: Reading<TicketSourcePage>,
  catalog: Reading<TicketSourceCatalog>,
): TrackerState {
  if (!sources.ok || !catalog.ok) return "unread";

  return pushableTrackers(sources.value.items, catalog).length > 0 ? "ready" : "none-writable";
}

/** The guidance card's heading when nothing here can be drafted against. */
export const CONNECT_TRACKER_TITLE = "Connect a tracker to draft";

/**
 * …and why, which is the half of it a reader cannot guess.
 *
 * It says *filed into*, not *pushed to*, because the binding happens at generation rather than at
 * push — see this module's note. A reader told only *push is disabled* would reasonably expect to
 * be able to draft and be refused on the first click.
 */
export const CONNECT_TRACKER_NOTE =
  "Every draft is filed against a tracker from the moment it is generated, so one has to be " +
  "connected before this card can draft. Connecting a tracker takes a minute, and the generator " +
  "is ready the moment one is.";

/** The admin's control, which the tracker-sync card's rows already spell this way. */
export const CONNECT_TRACKER_LABEL = "Open settings";

/**
 * What a reader who may not connect one is told **instead of** the control.
 *
 * An explanation rather than an inert button, which is the rule `app/issues/states.ts` states for
 * its own first-run state and the providers page's before it: a guidance card is the first thing a
 * new member sees, and a disabled control with a tooltip is a worse first sentence than one naming
 * who can act.
 */
export const CONNECT_TRACKER_MEMBER_NOTE =
  "Connecting a tracker is for workspace owners and admins. Ask one of them to connect one — the " +
  "generator drafts against it the moment they do.";

/* ------------------------------------------------------------------ the sizing pipeline */

/**
 * Why a draft is still reading `sizing…`.
 *
 * INTAKE-L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)) sizes drafts through one
 * shared estimator queue, and `ouroboros-rest`'s `estimation.sweeper.ts` re-queues an estimate
 * whose process died between the claim and the write. Both facts are the reason a row can sit at
 * `sizing…` for longer than a moment, and neither is visible from the outside — so without this the
 * card looks hung, which is the one reading of it that is wrong.
 *
 * It says nothing about *how long*, because nothing here knows: the queue's depth is another
 * workspace's business and the sweep's period is configuration this page does not read.
 */
export const SWEEP_NOTE =
  "Sizing runs through one shared estimator queue, so a draft can wait behind other work. " +
  "Nothing is lost while it waits — an estimate that stalls is picked up again by the recovery " +
  "sweep — and the effort chips fill in as each answer lands.";

/** The accessible name of the region the sweep note lives in. */
export const SWEEP_LABEL = "Sizing progress";
