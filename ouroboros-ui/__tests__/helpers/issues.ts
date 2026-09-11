import type {
  BacklogEstimate,
  BacklogIssueDetail,
  BacklogListing,
  BacklogRow,
  EstimationAccepted,
  EstimationFanout,
  IssueDetail,
  IssueEstimateDetail,
  QueuedSelection,
  SyncStatus,
} from "@/app/api/backlog";
import type { EnabledRepo } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";
import { PAGE_SIZE } from "@/app/issues/paging";
import type { BacklogCounts, IssuesReadings } from "@/app/issues/view";

/**
 * Fixtures for the intake screen ([#115](https://github.com/NobuData/ouroboros/issues/115),
 * [#116](https://github.com/NobuData/ouroboros/issues/116),
 * [#117](https://github.com/NobuData/ouroboros/issues/117),
 * [#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * The numbers are the development seed's (`R__dev_seed_intake.sql`, K.5): nine mirrored issues in
 * `acme-robotics / helios-firmware`, every one of them open and seven of them sized — the head the
 * seeded workspace reads, *"9 open issues. 7 already sized."* — the four labels mockup 03's chip
 * set draws, the nine rows themselves in the order M.1's `sort=effort` puts them, and the panel's
 * `#485` in full, with the seed's `#483` and `#490` for the states the mockup does not draw.
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

/**
 * A seeded issue's id — the seed computes it from a literal prefix and the issue number, so a
 * suite can name a row the way the contract's own example does.
 *
 * @param number The issue number.
 * @returns `5eed0018-0000-4000-8000-000000000485`.
 */
export function issueId(number: number): string {
  return `5eed0018-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

/** Mockup 03's selected trio — `#485`, `#484` and `#491` — by the ids the contract's example uses. */
export const SELECTED_TRIO: readonly string[] = [issueId(485), issueId(484), issueId(491)];

/** The seed's freshness stamp — `github_issues.synced_at`, forty seconds before {@link READ_AT}. */
export const SEEDED_SYNCED_AT = "2026-09-10T15:41:12.000Z";

/**
 * When the page was read, in these suites: forty seconds after the sync, which is the mockup's
 * own `synced 40s ago`.
 */
export const READ_AT = Date.UTC(2026, 8, 10, 15, 41, 52);

/**
 * One seeded row.
 *
 * @param number The issue number.
 * @param title Its title.
 * @param labels Its labels, in the seed's order.
 * @param sizingStatus Where it is in the pipeline.
 * @param queued Whether the dashboard seed's queue holds it.
 * @param estimate The estimate in force, or `null`.
 * @returns The row, in `acme-robotics / helios-firmware`.
 */
function seededRow(
  number: number,
  title: string,
  labels: readonly string[],
  sizingStatus: BacklogRow["sizingStatus"],
  queued: boolean,
  estimate: BacklogEstimate | null,
): BacklogRow {
  return {
    id: issueId(number),
    number,
    title,
    labels: [...labels],
    state: "open",
    sizingStatus,
    queued,
    githubRepoId: HELIOS.id,
    repository: `${HELIOS.login}/${HELIOS.name}`,
    estimate,
  };
}

/**
 * The seeded backlog under `sort=effort` — chip order, confidence descending within a chip, the
 * unsized last — which the seed makes total so no two machines can disagree about it.
 *
 * Two facts differ from the mockup's table, and both are the seed's own documented decisions:
 * the queue rows are DASH-F.5's, so `#485`, `#490` and `#491` are queued here where the mockup
 * draws them `sized` and `needs human`, and `#489` is not where the mockup draws it `queued`;
 * and `#485` carries the panel's fourth label, `priority-high`, which the mockup's cell omits.
 *
 * Each estimate's `estMinutes` is the seed's breakdown figure
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)), so the mockup's selected trio —
 * `#485`, `#484`, `#491` — sums to the 125 minutes M.3 answers for it, not the mockup's 70.
 */
export const SEEDED_ROWS: readonly BacklogRow[] = [
  seededRow(488, "Typo sweep in operator manual + pairing guide", ["docs", "good-first-issue"], "sized", true, {
    effort: "xs",
    confidence: 98,
    suggestedWorkflow: "docs-loop",
    routedModel: "ollama/qwen3-coder",
    estMinutes: 15,
  }),
  seededRow(491, "Add CRC32 to config persistence layer", ["bug", "tech-debt"], "sized", true, {
    effort: "s",
    confidence: 95,
    suggestedWorkflow: "standard-fix",
    routedModel: "copilot/gpt-5-codex",
    estMinutes: 30,
  }),
  seededRow(485, "Watchdog reset on I²C bus lockup", ["bug", "i2c", "watchdog", "priority-high"], "sized", true, {
    effort: "m",
    confidence: 92,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    estMinutes: 45,
  }),
  seededRow(484, "Motor PID integral windup on wheel stall", ["bug", "motor-control"], "sized", false, {
    effort: "m",
    confidence: 88,
    suggestedWorkflow: "standard-fix",
    routedModel: "cursor/composer-2",
    estMinutes: 50,
  }),
  seededRow(489, "CAN arbitration-lost storm under full telemetry load", ["bug", "can-bus"], "sized", false, {
    effort: "m",
    confidence: 78,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-sonnet-5",
    estMinutes: 60,
  }),
  seededRow(486, "Expose battery health over BLE GATT service", ["enhancement", "ble"], "sized", true, {
    effort: "l",
    confidence: 84,
    suggestedWorkflow: "feature-loop",
    routedModel: "claude-sonnet-5",
    estMinutes: 90,
  }),
  seededRow(487, "Delta OTA updates for images larger than 1 MB", ["enhancement", "ota"], "sized", false, {
    effort: "l",
    confidence: 71,
    suggestedWorkflow: "feature-loop",
    routedModel: "claude-fable-5",
    estMinutes: 110,
  }),
  seededRow(490, "Migrate build system to Zephyr RTOS 4.2", ["tech-debt", "zephyr"], "needs_human", true, {
    effort: "xl",
    confidence: 61,
    suggestedWorkflow: "deps-refresh",
    routedModel: "claude-fable-5",
    estMinutes: 180,
  }),
  seededRow(483, "Telemetry frame drops when BLE and CAN both saturated", ["bug", "telemetry"], "estimating", false, null),
];

/** What the seeded trio's estimates add up to — M.3's own answer for the mockup's selection. */
export const SEEDED_TRIO_MINUTES = 125;

/** The one seeded row with no estimate — `estimating`, mid-flight. */
export const ESTIMATING_ROW = SEEDED_ROWS[SEEDED_ROWS.length - 1]!;

/**
 * A listing as `GET /api/v1/backlog` answers it.
 *
 * @param over The figures this case is about. `items` defaults to the seeded nine under the
 *   default sort; `total` to the open count, which is the seeded world, where nothing is closed;
 *   `labelFacets` to the seeded chip set; `syncedAt` to the seed's stamp.
 * @returns The listing.
 */
export function backlogListing(
  over: {
    items?: readonly BacklogRow[];
    openCount?: number;
    sizedCount?: number;
    total?: number;
    limit?: number;
    offset?: number;
    labelFacets?: readonly string[];
    syncedAt?: string | null;
  } = {},
): BacklogListing {
  const openCount = over.openCount ?? SEEDED_OPEN;

  return {
    items: [...(over.items ?? SEEDED_ROWS)],
    total: over.total ?? openCount,
    limit: over.limit ?? PAGE_SIZE,
    offset: over.offset ?? 0,
    meta: {
      openCount,
      sizedCount: over.sizedCount ?? SEEDED_SIZED,
      syncedAt: over.syncedAt === undefined ? SEEDED_SYNCED_AT : over.syncedAt,
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
 * A read of the page that succeeded.
 *
 * @param over What the listing carries — see {@link backlogListing}.
 * @returns The reading.
 */
export function paged(over: Parameters<typeof backlogListing>[0] = {}): Reading<BacklogListing> {
  return { ok: true, value: backlogListing(over) };
}

/** A read of the page that failed, with {@link UNCOUNTED_REASON}. */
export const UNPAGED: Reading<BacklogListing> = { ok: false, reason: UNCOUNTED_REASON };

/**
 * Everything the screen draws.
 *
 * @param over The readings this case is about. Each defaults to the seeded one.
 * @returns The readings.
 */
export function issuesReadings(over: Partial<IssuesReadings> = {}): IssuesReadings {
  return {
    counts: counted(),
    facets: FACETED,
    repos: LISTED,
    listing: paged(),
    readAt: READ_AT,
    ...over,
  };
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
 * @param estMinutes Their combined estimate. Defaults to forty-five minutes a row.
 * @returns The created rows and their combined estimate.
 */
export function queuedSelection(count = SELECTED_TRIO.length, estMinutes = 45 * count): QueuedSelection {
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
    estMinutes,
  };
}

/**
 * What a sync press answers — the status at the moment the cycle started.
 *
 * @param over The fields this case is about. Defaults to a running cycle over an `ok` loop.
 * @returns The status.
 */
export function syncStatus(over: Partial<SyncStatus> = {}): SyncStatus {
  return {
    syncedAt: SEEDED_SYNCED_AT,
    state: "ok",
    pause: null,
    message: null,
    retryAfterSeconds: null,
    running: true,
    repositories: [],
    ...over,
  };
}

/* ------------------------------------------------------------------ the detail panel (#119) */

/** Where the seeded repository lives on GitHub — the base of every `ghUrl`. */
const GITHUB_REPO_URL = `https://github.com/${HELIOS.login}/${HELIOS.name}`;

/**
 * When the seed's `#485` was sized — two minutes before {@link READ_AT}, which is the mockup's
 * own *2m ago*. The seed writes it relative to `now()` for exactly this reason.
 */
export const SEEDED_SIZED_AT = "2026-09-10T15:39:52.000Z";

/** When the seed's `#485` was opened — forty-eight hours before {@link READ_AT}: *opened 2d ago*. */
export const SEEDED_OPENED_AT = "2026-09-08T15:41:52.000Z";

/** The seed's `#485` body — the mockup's excerpt, without the quotation marks the panel adds. */
export const SEEDED_BODY =
  "Unit 07 in the Fremont pilot rebooted 14 times overnight. Logs show the IMU holding SDA low " +
  "after a burst read; the bus never recovers and the hardware watchdog fires ~2 s later. We need " +
  "a bus-recovery sequence (9 clock pulses + re-init) before the watchdog trips.";

/** The seed's `#485` file list — the mockup's three paths. */
export const SEEDED_FILES: readonly string[] = [
  "drivers/i2c_recovery.c",
  "drivers/imu_bmi270.c",
  "tests/unit/test_i2c_lockup.c",
];

/** The seed's `#485` risk rationale — the sentence under the mockup's meter. */
export const SEEDED_RISK_NOTE =
  "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.";

/**
 * One issue as the panel's head reads it, over a seeded row.
 *
 * @param row The row, from {@link SEEDED_ROWS}.
 * @param over The panel's four fields, and anything else this case is about.
 * @returns The issue — the row minus its estimate, plus the body, author, opening instant and
 *   GitHub URL.
 */
export function issueOf(row: BacklogRow, over: Partial<BacklogIssueDetail> = {}): BacklogIssueDetail {
  const { estimate, ...issue } = row;
  void estimate;

  return {
    ...issue,
    body: SEEDED_BODY,
    authorLogin: "field-support",
    ghCreatedAt: SEEDED_OPENED_AT,
    ghUrl: `${GITHUB_REPO_URL}/issues/${row.number}`,
    ...over,
  };
}

/**
 * The seed's estimate of `#485`, in full — the mockup's *AI Work Breakdown* field for field,
 * with the trace the seed actually writes: `heuristic-v0`, no tokens, no signals.
 *
 * @param over The fields this case is about.
 * @returns The estimate.
 */
export function estimateDetail(over: Partial<IssueEstimateDetail> = {}): IssueEstimateDetail {
  return {
    version: 1,
    effort: "m",
    confidence: 92,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    breakdown: {
      files: [...SEEDED_FILES],
      estTokens: 180_000,
      cycleMin: 12,
      cycleMax: 18,
      estMinutes: 45,
    },
    risk: "low",
    riskNote: SEEDED_RISK_NOTE,
    trace: {
      estimator: "heuristic-v0",
      sizedAt: SEEDED_SIZED_AT,
      tokensUsed: 0,
      signals: [],
    },
    ...over,
  };
}

/** The seeded row of `#485` — the panel's issue. */
const PANEL_ROW = SEEDED_ROWS.find((row) => row.number === 485)!;

/**
 * The seed's `#485` as `GET /api/v1/backlog/{id}` answers it — mockup 03's panel in one
 * answer, with the two seed divergences the table's fixture also carries: `queued`, since the
 * dashboard seed holds it, and the fourth label.
 *
 * @param over The parts this case is about. `issue` and `estimate` are merged over the seed's;
 *   `history` replaces it.
 * @returns The answer.
 */
export function issueDetail(
  over: { issue?: Partial<BacklogIssueDetail>; estimate?: Partial<IssueEstimateDetail> | null; history?: IssueDetail["history"] } = {},
): IssueDetail {
  const estimate = over.estimate === null ? null : estimateDetail(over.estimate ?? {});

  return {
    issue: issueOf(PANEL_ROW, over.issue),
    estimate,
    history:
      over.history ??
      (estimate === null
        ? []
        : [{ version: estimate.version, estimator: estimate.trace.estimator, createdAt: estimate.trace.sizedAt }]),
  };
}

/**
 * The seed's `#483` as the endpoint answers it — `estimating`, with no `issue_estimates` row at
 * all: the issue-only shape, which is the panel's first-estimate state.
 *
 * @param sizingStatus Where the issue is. Defaults to the seed's `estimating`; `unsized` is the
 *   same shape a moment earlier.
 * @returns The answer.
 */
export function estimatingDetail(sizingStatus: BacklogRow["sizingStatus"] = "estimating"): IssueDetail {
  return {
    issue: issueOf(ESTIMATING_ROW, {
      sizingStatus,
      authorLogin: "jorge-reyes",
      ghCreatedAt: "2026-09-05T15:41:52.000Z",
      body:
        "Under a full telemetry load the BLE notify queue and the CAN receive path contend for the " +
        "same DMA channel, and frames are dropped without any counter moving. Reproduced on bench " +
        "unit 12 with both radios at full duty.",
    }),
    estimate: null,
    history: [],
  };
}

/** The seeded row of `#490` — the one the seed sends to a human. */
const NEEDS_HUMAN_ROW = SEEDED_ROWS.find((row) => row.number === 490)!;

/**
 * The seed's `#490` as the endpoint answers it — `needs_human`, with the estimate that sent it
 * there: XL at 61%, under the floor.
 *
 * @param over The issue's fields this case is about — `queued: false` for a panel whose head
 *   reads the sizing status rather than the queue.
 * @returns The answer.
 */
export function needsHumanDetail(over: Partial<BacklogIssueDetail> = {}): IssueDetail {
  const estimate = estimateDetail({
    effort: "xl",
    confidence: 61,
    suggestedWorkflow: "deps-refresh",
    routedModel: "claude-fable-5",
    breakdown: {
      files: [
        "west.yml",
        "boards/helios_rev_c.dts",
        "boards/helios_rev_d.dts",
        "CMakeLists.txt",
        "ci/build-matrix.yml",
        "docs/porting-4.2.md",
      ],
      estTokens: 900_000,
      cycleMin: 90,
      cycleMax: 150,
      estMinutes: 180,
    },
    risk: "high",
    riskNote: "Moves every board file and the CI images at once; a partial migration leaves nothing that builds.",
    trace: {
      estimator: "heuristic-v0",
      sizedAt: "2026-09-10T14:11:52.000Z",
      tokensUsed: 0,
      signals: [],
    },
  });

  return {
    issue: issueOf(NEEDS_HUMAN_ROW, {
      authorLogin: "renovate[bot]",
      ghCreatedAt: "2026-09-10T01:41:52.000Z",
      body:
        "Zephyr 3.7 leaves support this year, and 4.2 moves the device-tree bindings and the west " +
        "manifest. This touches every board file and the CI images at once, so it wants a human to " +
        "sequence it rather than a single loop.",
      ...over,
    }),
    estimate,
    history: [{ version: 1, estimator: "heuristic-v0", createdAt: estimate.trace.sizedAt }],
  };
}

/**
 * What a **Re-estimate** press answers — the issue, already `estimating`.
 *
 * @param number The issue's number. Defaults to the panel's.
 * @returns The acceptance.
 */
export function estimationAccepted(number = 485): EstimationAccepted {
  return {
    issueId: issueId(number),
    number,
    repository: `${HELIOS.login}/${HELIOS.name}`,
    status: "estimating",
  };
}
