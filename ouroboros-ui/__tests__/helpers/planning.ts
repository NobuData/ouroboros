import type {
  GeneratedPlanningBatch,
  PlanningBacklogHealth,
  PlanningBatch,
  PlanningDraft,
  PlanningEpic,
  PlanningEpicLinks,
  PlanningPushResult,
  PlanningRoadmap,
  PlanningTicket,
} from "@/app/api/planning";
import type { PlanningReadings } from "@/app/planning/view";

import type { TicketSourceCatalog } from "@/app/api/sources";

import { SEEDED_GITHUB_ID, catalogPayload, githubEntry, sourcePage } from "./sources";

/**
 * Planning fixtures (#283, #284): the development seed's *Helios 2.1* roadmap and its OTA batch
 * (`ouroboros-db/migrations/R__dev_seed_ticket_planning.sql`), trimmed to what the page reads.
 */

/**
 * One lane, seed-shaped.
 *
 * @param over Fields to replace.
 * @returns The lane.
 */
export function planningEpic(over: Partial<PlanningEpic> = {}): PlanningEpic {
  return {
    id: "5eed0280-0000-4000-8000-00000000ee01",
    name: "OTA hardening",
    tint: "accent",
    status: "active",
    startMonth: "2026-07",
    endMonth: "2026-09",
    sortOrder: 1,
    roadmapName: "Helios 2.1",
    roadmapWindow: "Q3–Q4 2026",
    chips: { issues: 12, done: 8 },
    ...over,
  };
}

/**
 * The seeded roadmap, as mockup 09 draws it: *Helios 2.1*, *Q3–Q4 2026*, five lanes — the seed's
 * relative months pinned to a read in August 2026 ({@link SEEDED_READ_MONTH}), so the columns are the
 * mockup's Jul–Dec and TODAY falls in the second one.
 *
 * @returns The roadmap.
 */
export function seededRoadmap(): PlanningRoadmap {
  const lanes: readonly [string, PlanningEpic["tint"], string | null, string | null, number, number, PlanningEpic["status"]][] = [
    ["OTA hardening", "accent", "2026-07", "2026-09", 12, 8, "active"],
    ["BLE provisioning v2", "model", "2026-08", "2026-10", 9, 2, "active"],
    ["Motor control refactor", "warn", "2026-09", "2026-11", 14, 0, "active"],
    ["Fleet telemetry dashboard", "ok", "2026-10", "2026-12", 7, 0, "active"],
    ["Zephyr 4.2 migration", "neutral", null, null, 0, 0, "proposed"],
  ];

  return {
    name: "Helios 2.1",
    window: "Q3–Q4 2026",
    lanes: lanes.map(([name, tint, startMonth, endMonth, issues, done, status], index) =>
      planningEpic({
        id: `5eed0280-0000-4000-8000-00000000ee0${String(index + 1)}`,
        name,
        tint,
        startMonth,
        endMonth,
        status,
        sortOrder: index + 1,
        chips: { issues, done },
      }),
    ),
  };
}

/** August 2026, as `gantt.ts` indexes a month — the month the seed's roadmap is read in. */
export const SEEDED_READ_MONTH = 2026 * 12 + 7;

/**
 * One canonical ticket, seed-shaped.
 *
 * @param over Fields to replace.
 * @returns The ticket.
 */
export function planningTicket(over: Partial<PlanningTicket> = {}): PlanningTicket {
  return {
    id: "5eed0280-0000-4000-8000-0000000071c1",
    sourceId: SEEDED_GITHUB_ID,
    externalKey: "#548",
    title: "Verify checksum before the A/B swap",
    state: "open",
    url: "https://github.com/acme-robotics/helios-firmware/issues/548",
    ...over,
  };
}

/**
 * The OTA lane's lists: two tickets, one done, and its GitHub parent issue.
 *
 * @param over Fields to replace.
 * @returns The links.
 */
export function epicLinks(over: Partial<PlanningEpicLinks> = {}): PlanningEpicLinks {
  return {
    epicId: "5eed0280-0000-4000-8000-00000000ee01",
    tickets: [
      planningTicket(),
      planningTicket({
        id: "5eed0280-0000-4000-8000-0000000071c2",
        externalKey: "#540",
        title: "Stage A/B partitions",
        state: "closed",
        url: "https://github.com/acme-robotics/helios-firmware/issues/540",
      }),
    ],
    mirrors: [
      { sourceId: SEEDED_GITHUB_ID, sourceName: "GitHub · acme-robotics", kind: "parent_issue", externalRef: "#612" },
    ],
    ...over,
  };
}

/** A workspace that has planned nothing. */
export const EMPTY_ROADMAP: PlanningRoadmap = { name: null, window: null, lanes: [] };

/**
 * The catalog as AL.2 answers it for a build whose GitHub provider writes (#278): push enabled,
 * native dependencies, parent-issue epics, milestones.
 *
 * @returns The catalog.
 */
export function writableCatalog(): TicketSourceCatalog {
  const github = githubEntry();

  return catalogPayload([
    {
      ...github,
      capabilities: {
        ...github.capabilities,
        bidirectionalWrites: true,
        write: { createTicket: true, nativeDependencies: true, epicMapping: "parent_issue", milestones: true },
      },
      push: { enabled: true, reason: null },
    },
  ]);
}

/* ------------------------------------------------------------ backlog health (#281, #285) */

/** The instant the seeded page is read in, so every *ago* in a suite is arithmetic. */
export const SEEDED_READ_AT = "2026-09-17T12:00:00.000Z";

/**
 * The seed's backlog health, as mockup 09's card draws it — `42 open`, `38/42 · 4 · 6`.
 *
 * The figures are `R__dev_seed_ticket_planning.sql`'s, which builds rows so that each falls out
 * of the obvious aggregate: thirty-eight of forty-two open tickets sized, four blocked through a
 * mix of planned and synced edges, six untouched for over a month.
 *
 * @param over What differs.
 * @returns The payload.
 */
export function seededHealth(
  over: Partial<PlanningBacklogHealth> = {},
): PlanningBacklogHealth {
  return {
    open: 42,
    sized: { count: 38, total: 42, filter: { state: "open", sizing: "unsized" } },
    blocked: { count: 4, filter: { state: "open", blocked: true } },
    stale: { count: 6, thresholdDays: 30, filter: { state: "open", staleDays: 30 } },
    reestimation: {
      schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 100 },
      lastRun: {
        startedAt: "2026-09-17T02:14:00.000Z",
        finishedAt: "2026-09-17T02:16:00.000Z",
        status: "succeeded",
        found: 4,
        queued: 4,
        inFlight: 0,
      },
    },
    ...over,
  };
}

/** A workspace that has planned and ingested nothing — AM.5's guidance path, and #285's zeros. */
export function emptyHealth(): PlanningBacklogHealth {
  return {
    open: 0,
    sized: { count: 0, total: 0, filter: { state: "open", sizing: "unsized" } },
    blocked: { count: 0, filter: { state: "open", blocked: true } },
    stale: { count: 0, thresholdDays: 30, filter: { state: "open", staleDays: 30 } },
    reestimation: {
      schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 100 },
      lastRun: null,
    },
  };
}

/**
 * What the page's reader answers with.
 *
 * @param roadmap The roadmap read. Defaults to the seed's.
 * @param over The other readings that differ. Defaults: the seed's two sources, a catalog whose
 *   GitHub writes ({@link writableCatalog}), the seed's health, and no batch.
 * @returns The readings.
 */
export function planningReadings(
  roadmap: PlanningReadings["roadmap"] = { ok: true, value: seededRoadmap() },
  over: Partial<Omit<PlanningReadings, "roadmap">> = {},
): PlanningReadings {
  return {
    roadmap,
    sources: { ok: true, value: sourcePage() },
    catalog: { ok: true, value: writableCatalog() },
    health: { ok: true, value: seededHealth() },
    batch: null,
    now: SEEDED_READ_AT,
    ...over,
  };
}

/* ------------------------------------------------------------------ the seeded batch (#284) */

/** The seed's batch. */
export const SEEDED_BATCH_ID = "5eed0021-0000-4000-8000-000000000001";

/** The seed's prompt, verbatim — the mockup's textarea. */
export const SEEDED_PROMPT =
  "We need OTA updates to survive power loss mid-flash: staged A/B partitions, checksum " +
  "verification before swap, automatic rollback, and a recovery beacon over BLE if both slots are bad.";

/** The six rows: key ordinal, title, workflow, effort, minutes, blocked-by. */
const SEEDED_ROWS: readonly [number, string, string, "l" | "m" | "xs", number, string[]][] = [
  [1, "Partition table & bootloader slot flag for A/B scheme", "feature-loop", "l", 1080, []],
  [2, "SHA-256 checksum verification before slot swap", "feature-loop", "m", 600, []],
  [3, "Rollback state machine on failed boot confirmation", "feature-loop", "l", 1140, ["OTA-1", "OTA-2"]],
  [4, "BLE recovery beacon when both slots fail checksum", "feature-loop", "m", 660, []],
  [5, "Power-loss integration tests on HIL rig (kill power mid-flash)", "hil-verify", "m", 720, ["OTA-3", "OTA-4"]],
  [6, "Operator docs: recovery procedure & beacon pairing", "docs-loop", "xs", 120, []],
];

/**
 * One draft, seed-shaped.
 *
 * @param over Fields to replace.
 * @returns The draft — `OTA-1`, sized L, selected, pending.
 */
export function planningDraft(over: Partial<PlanningDraft> = {}): PlanningDraft {
  return {
    id: "5eed0022-0000-4000-8000-000000000001",
    localKey: "OTA-1",
    title: "Partition table & bootloader slot flag for A/B scheme",
    body: null,
    selected: true,
    suggestedWorkflow: "feature-loop",
    provenance: "planned",
    dependencies: [],
    blockedByTicketIds: [],
    pushState: "pending",
    pushedTicketId: null,
    pushedTicket: null,
    pushError: null,
    estimate: {
      effort: "l",
      confidence: 81,
      estMinutes: 1080,
      estTokens: 450_000,
      routedModel: "claude-fable-5",
      estimator: "heuristic-v0",
      version: 1,
    },
    ...over,
  };
}

/**
 * The seed's six drafts.
 *
 * @returns The drafts, in key order.
 */
export function seededDrafts(): PlanningDraft[] {
  return SEEDED_ROWS.map(([ordinal, title, workflow, effort, minutes, dependencies]) =>
    planningDraft({
      id: `5eed0022-0000-4000-8000-00000000000${ordinal}`,
      localKey: `OTA-${ordinal}`,
      title,
      suggestedWorkflow: workflow,
      dependencies,
      estimate: { ...planningDraft().estimate!, effort, estMinutes: minutes },
    }),
  );
}

/**
 * A batch, defaulting to the seed's: six sized drafts, ~3 days, $14.
 *
 * @param over Fields to replace.
 * @returns The batch.
 */
export function planningBatch(over: Partial<PlanningBatch> = {}): PlanningBatch {
  return {
    id: SEEDED_BATCH_ID,
    status: "sized",
    planner: "outline-v0",
    prompt: SEEDED_PROMPT,
    outline: "- Partition table & bootloader slot flag for A/B scheme  blocks: OTA-3  [feature-loop]",
    targetSourceId: SEEDED_GITHUB_ID,
    milestone: "Helios 2.1",
    epicId: null,
    autoSize: true,
    queueSmall: false,
    createdAt: "2026-09-16T15:00:00.000Z",
    updatedAt: "2026-09-16T15:02:00.000Z",
    drafts: seededDrafts(),
    summary: {
      draftCount: 6,
      selectedCount: 6,
      sizedCount: 6,
      allSized: true,
      estimators: ["heuristic-v0"],
      estMinutes: 4320,
      loopDays: 3,
      spend: { cents: 1400, display: "$14", partial: false },
    },
    ...over,
  };
}

/**
 * A generation's answer.
 *
 * @param over Batch fields to replace.
 * @param notes The planner's notes.
 * @returns The batch with its notes.
 */
export function generatedBatch(
  over: Partial<PlanningBatch> = {},
  notes: string[] = [],
): GeneratedPlanningBatch {
  return { ...planningBatch(over), notes };
}

/**
 * A push's answer, defaulting to every seeded draft pushed as `#612`… with queue-small off.
 *
 * @param over Report fields to replace.
 * @returns The result.
 */
export function pushResult(
  over: Partial<PlanningPushResult["report"]> = {},
): PlanningPushResult {
  return {
    report: {
      batchId: SEEDED_BATCH_ID,
      outcome: "pushed",
      batchStatus: "pushed",
      pushedThisRun: 6,
      links: { native: 4, fallback: 0 },
      retryAt: null,
      milestone: { externalRef: "3", name: "Helios 2.1" },
      epic: null,
      drafts: seededDrafts().map((draft, index) => ({
        draftId: draft.id,
        localKey: draft.localKey,
        pushState: "pushed" as const,
        ticketId: `5eed0099-0000-4000-8000-00000000000${index + 1}`,
        ticket: {
          externalId: String(612 + index),
          externalKey: `#${612 + index}`,
          url: `https://github.com/acme-robotics/helios-firmware/issues/${612 + index}`,
        },
        error: null,
      })),
      ...over,
    },
    queueSmall: null,
  };
}
