import type { BacklogListing, EstimationFanout, QueuedSelection } from "@/app/api/backlog";
import type { EnabledRepo } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";
import type { BacklogCounts, IssuesReadings } from "@/app/issues/view";

/**
 * Fixtures for the intake screen ([#115](https://github.com/NobuData/ouroboros/issues/115),
 * [#116](https://github.com/NobuData/ouroboros/issues/116)).
 *
 * The numbers are the development seed's (`R__dev_seed_intake.sql`, K.5): nine mirrored issues in
 * `acme-robotics / helios-firmware`, every one of them open and seven of them sized — the head the
 * seeded workspace reads, *"9 open issues. 7 already sized."* — and the four labels mockup 03's
 * chip set draws.
 */

/** Open issues in the seeded workspace — and every issue it mirrors, since none is closed. */
export const SEEDED_OPEN = 9;

/** How many of those are sized. */
export const SEEDED_SIZED = 7;

/** The mockup's chip set — M.1's `labelFacets` for the seeds, ascending by name. */
export const SEEDED_FACETS: readonly string[] = ["bug", "enhancement", "good-first-issue", "tech-debt"];

/** The seeded repository the mockup's select names, as the enablement list reports it. */
export const HELIOS: EnabledRepo = {
  id: "5eed0006-0000-4000-8000-000000000001",
  name: "helios-firmware",
  login: "acme-robotics",
};

/** A second enabled repository of the same workspace. */
export const ATLAS: EnabledRepo = {
  id: "5eed0006-0000-4000-8000-000000000004",
  name: "atlas-scheduler",
  login: "acme-robotics",
};

/** The seeded workspace's enabled repositories, in the listing's order. */
export const SEEDED_REPOS: readonly EnabledRepo[] = [HELIOS, ATLAS];

/** Mockup 03's selected trio — `#485`, `#484` and `#491` — by the ids the contract's example uses. */
export const SELECTED_TRIO: readonly string[] = [
  "5eed0018-0000-4000-8000-000000000485",
  "5eed0018-0000-4000-8000-000000000484",
  "5eed0018-0000-4000-8000-000000000491",
];

/**
 * A listing as `GET /api/v1/backlog` answers it one row long.
 *
 * @param over The figures this case is about. `total` defaults to the open count, which is the
 *   seeded world, where nothing is closed; `labelFacets` to the seeded chip set.
 * @returns The listing, with no rows — the page draws none yet.
 */
export function backlogListing(
  over: {
    openCount?: number;
    sizedCount?: number;
    total?: number;
    labelFacets?: readonly string[];
  } = {},
): BacklogListing {
  const openCount = over.openCount ?? SEEDED_OPEN;

  return {
    items: [],
    total: over.total ?? openCount,
    limit: 1,
    offset: 0,
    meta: {
      openCount,
      sizedCount: over.sizedCount ?? SEEDED_SIZED,
      syncedAt: "2026-09-10T15:41:12.000Z",
    },
    labelFacets: [...(over.labelFacets ?? SEEDED_FACETS)],
  };
}

/**
 * The head's three figures.
 *
 * @param over The figures this case is about.
 * @returns The seeded counts, overridden.
 */
export function seededCounts(over: Partial<BacklogCounts> = {}): BacklogCounts {
  return { openCount: SEEDED_OPEN, sizedCount: SEEDED_SIZED, mirroredCount: SEEDED_OPEN, ...over };
}

/**
 * A read of the counts that succeeded.
 *
 * @param over The figures this case is about.
 * @returns The reading.
 */
export function counted(over: Partial<BacklogCounts> = {}): Reading<BacklogCounts> {
  return { ok: true, value: seededCounts(over) };
}

/** The reason a failed read of the counts carries in these suites. */
export const UNCOUNTED_REASON = "The backlog service is not answering.";

/** A read of the counts that failed. */
export const UNCOUNTED: Reading<BacklogCounts> = { ok: false, reason: UNCOUNTED_REASON };

/** A read of the chip set that succeeded, with the seeded labels. */
export const FACETED: Reading<readonly string[]> = { ok: true, value: SEEDED_FACETS };

/** A read of the repositories that succeeded, with the seeded two. */
export const LISTED: Reading<readonly EnabledRepo[]> = { ok: true, value: SEEDED_REPOS };

/**
 * Everything the screen draws.
 *
 * @param over The readings this case is about. Each defaults to the seeded one.
 * @returns The readings.
 */
export function issuesReadings(over: Partial<IssuesReadings> = {}): IssuesReadings {
  return { counts: counted(), facets: FACETED, repos: LISTED, ...over };
}

/**
 * What **Re-estimate all** answers.
 *
 * @param over The figures this case is about. Defaults to a press that started every seeded issue.
 * @returns The fan-out.
 */
export function fanout(over: Partial<EstimationFanout> = {}): EstimationFanout {
  return { enqueued: SEEDED_OPEN, skipped: 0, total: SEEDED_OPEN, ...over };
}

/**
 * What a queue press answers.
 *
 * @param count How many rows the service created.
 * @returns The created rows and their combined estimate.
 */
export function queuedSelection(count = SELECTED_TRIO.length): QueuedSelection {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      id: `7a1c0b90-0000-4000-8000-00000000000${index + 1}`,
      issueNumber: 485 - index,
      issueTitle: `Seeded issue ${index + 1}`,
      effort: "m" as const,
      workflowTag: "standard-fix",
      position: index + 4,
      estMinutes: 45,
      enqueuedAt: "2026-09-10T15:41:12.000Z",
    })),
    estMinutes: 45 * count,
  };
}
