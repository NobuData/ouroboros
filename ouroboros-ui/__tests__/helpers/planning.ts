import type {
  GeneratedPlanningBatch,
  PlanningBatch,
  PlanningDraft,
  PlanningEpic,
  PlanningPushResult,
  PlanningRoadmap,
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
 * The seeded roadmap: *Helios 2.1*, *Q3–Q4 2026*, five lanes.
 *
 * @returns The roadmap.
 */
export function seededRoadmap(): PlanningRoadmap {
  const names = [
    "OTA hardening",
    "BLE provisioning v2",
    "Motor control refactor",
    "Fleet telemetry dashboard",
    "Zephyr 4.2 migration",
  ];

  return {
    name: "Helios 2.1",
    window: "Q3–Q4 2026",
    lanes: names.map((name, index) =>
      planningEpic({ id: `5eed0280-0000-4000-8000-00000000ee0${index + 1}`, name, sortOrder: index + 1 }),
    ),
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

/**
 * What the page's reader answers with.
 *
 * @param roadmap The roadmap read. Defaults to the seed's.
 * @param over The other readings that differ. Defaults: the seed's two sources, a catalog whose
 *   GitHub writes ({@link writableCatalog}), and no batch.
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
    batch: null,
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
