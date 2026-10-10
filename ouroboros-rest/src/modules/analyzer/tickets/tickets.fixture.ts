/**
 * The drafted-tickets card's fixtures (BW.4, #519) — mockup 18's four drafts as the dev seed
 * stores them: one `analyzer-v1` batch, `BA-1…BA-4`, each sized by the estimator and each with the
 * body the composer writes.
 */

import type { BatchResource, DraftResource } from "../../planning/planning.resources";
import type { UndraftedTicketRow } from "./tickets.repository";

/** The repository the fixtures are about. */
export const HELIOS = "acme-robotics/helios-firmware";

/** The seeded analyzer batch. */
export const BATCH_ID = "5eed006a-0000-4000-8000-000000000001";

/** The seeded GitHub ticket source the batch targets. */
export const SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";

/** A build the OTA fixture ticket cites. */
export const BUILD_ID = "5eed0062-0000-4000-8000-000000000412";

/** A waiver the thermal-chamber ticket cites. */
export const WAIVER_ID = "5eed006d-0000-4000-8000-000000000471";

/**
 * A body as the composer writes it.
 *
 * @param line - The evidence line.
 * @param refs - The reference lines, already `kind \`id\``.
 * @param suggestion - The suggestion's ordinal in the seed (21–24).
 * @returns The body.
 */
export function composedBody(line: string, refs: readonly string[], suggestion: number): string {
  return [
    `**Evidence:** ${line}`,
    "",
    "**References:**",
    ...(refs.length === 0
      ? ["- (the cited findings carry no references)"]
      : refs.map((ref) => `- ${ref}`)),
    "",
    `Drafted by the Build Analyzer from suggestion \`5eed0067-0000-4000-8000-0000000000${String(suggestion)}\` ` +
      `(confidence 84%) over ${HELIOS}, analysis run \`5eed0065-0000-4000-8000-000000000002\`.`,
  ].join("\n");
}

/**
 * One draft of the seeded batch.
 *
 * @param ordinal - Its place in the batch — the `1` of `BA-1`.
 * @param overrides - What differs.
 * @returns The draft.
 */
export function draft(ordinal: number, overrides: Partial<DraftResource> = {}): DraftResource {
  const seeded = [
    {
      title: "Refactor tests/ota fixtures — shared setup times out under load",
      line: "7.2% of OTA suite failures share one fixture timeout signature (31 builds)",
      refs: [`build \`${BUILD_ID}\``],
      effort: "m" as const,
      estMinutes: 660,
    },
    {
      title: "Bump ccache 4.9 → 4.11 — upstream fixes the hash misses in our logs",
      line: "cache-miss signature matches ccache issue #1412 in 118 builds",
      refs: [`build \`${BUILD_ID}\``],
      effort: "xs" as const,
      estMinutes: 120,
    },
    {
      title: "Add thermal chamber to rig helios-rig-02",
      line: "3 verification waivers in 60 days cite missing thermal coverage",
      refs: [`waiver \`${WAIVER_ID}\``],
      effort: "l" as const,
      estMinutes: 1020,
    },
    {
      title: "Delete 12 dead Kconfig options — never set in any build since May",
      line: "0 of 1,284 builds toggled them; 4 caused config-drift warnings",
      refs: [],
      effort: "s" as const,
      estMinutes: 360,
    },
  ][ordinal - 1];

  if (seeded === undefined) {
    throw new Error(`the seeded batch has no BA-${String(ordinal)}`);
  }

  return {
    id: `5eed006b-0000-4000-8000-00000000000${String(ordinal)}`,
    localKey: `BA-${String(ordinal)}`,
    title: seeded.title,
    body: composedBody(seeded.line, seeded.refs, 20 + ordinal),
    selected: true,
    suggestedWorkflow: "standard-fix",
    provenance: "planned",
    milestone: null,
    labels: [],
    research: null,
    dependencies: [],
    blockedByTicketIds: [],
    pushState: "pending",
    pushedTicketId: null,
    pushedTicket: null,
    pushError: null,
    estimate: {
      effort: seeded.effort,
      confidence: 84,
      estMinutes: seeded.estMinutes,
      estTokens: 200_000,
      routedModel: "claude-sonnet-5",
      estimator: "heuristic-v0",
      version: 1,
    },
    ...overrides,
  };
}

/**
 * The seeded batch, as planning answers it.
 *
 * @param overrides - What differs.
 * @returns The batch.
 */
export function seededBatch(overrides: Partial<BatchResource> = {}): BatchResource {
  return {
    id: BATCH_ID,
    status: "sized",
    planner: "analyzer-v1",
    prompt: `Build Analyzer: tickets drafted from the patterns in ${HELIOS}'s last 90 days of builds`,
    outline: null,
    targetSourceId: SOURCE_ID,
    milestone: null,
    epicId: null,
    autoSize: true,
    queueSmall: false,
    createdAt: "2026-08-08T06:12:00.000Z",
    updatedAt: "2026-08-08T06:13:20.000Z",
    drafts: [draft(1), draft(2), draft(3), draft(4)],
    summary: {
      draftCount: 4,
      selectedCount: 4,
      sizedCount: 4,
      allSized: true,
      estimators: ["heuristic-v0"],
      estMinutes: 2160,
      loopDays: 1.5,
    },
    ...overrides,
  };
}

/**
 * A ticket suggestion nobody has drafted yet.
 *
 * @param overrides - What differs.
 * @returns The row.
 */
export function undraftedRow(overrides: Partial<UndraftedTicketRow> = {}): UndraftedTicketRow {
  return {
    id: "5eed0067-0000-4000-8000-000000000025",
    title: "Pin the west manifest — nightly fetches drift between runners",
    evidence_line: "9 builds in 30 days failed on a manifest revision another runner never saw",
    confidence: 77,
    evidence_refs: [
      { kind: "waiver", id: WAIVER_ID },
      { kind: "build", id: BUILD_ID },
    ],
    ...overrides,
  };
}
