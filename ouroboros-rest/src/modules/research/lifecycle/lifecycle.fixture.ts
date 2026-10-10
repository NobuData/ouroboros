/**
 * Test fixtures for the investigation lifecycle (CM.6, #625): mockup 22's four featured rows
 * as records, and an in-memory {@link LifecycleStore}.
 */

import type { InvestigationStatus, ResearchStartRole } from "../../db/schema";
import type { PageWindow } from "../../tenancy/pagination";
import type {
  InvestigationDraft,
  InvestigationFilter,
  LifecycleStore,
} from "./lifecycle.repository";
import { ACTIVE_STATUSES, type InvestigationRecord } from "./lifecycle.resources";
import type { Quarter } from "./quarter";

export const WORKSPACE = "org-acme";
export const KEN = "user-ken";
export const MAYA = "user-maya";

/**
 * A deterministic uuid.
 *
 * @param prefix - Eight hex digits naming what it identifies.
 * @param n - A number.
 * @returns The uuid.
 */
export function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

/**
 * An investigation's id.
 *
 * @param seq - `127` for RS-127.
 * @returns The id.
 */
export function investigationId(seq: number): string {
  return uuid("5eed0091", seq);
}

/**
 * A record, RS-127's unless told otherwise.
 *
 * @param overrides - What differs.
 * @returns The record.
 */
export function record(overrides: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return {
    id: investigationId(127),
    displayId: "RS-127",
    kind: { slug: "gap_analysis", name: "Gap analysis", tint: "gap" },
    question: "Autonomous docking vs. Skylink / AeroMesh / Novum",
    depth: "deep_dive",
    tools: ["web", "competitor", "code", "tickets", "telemetry"],
    status: "brief_ready",
    origin: "user",
    startedBy: { id: KEN, name: "Ken Suenobu" },
    createdAt: new Date("2026-10-08T09:00:00Z"),
    updatedAt: new Date("2026-10-08T09:42:00Z"),
    estimate: { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
    estimateCalibrationVersion: 1,
    actuals: { sources_used: 44, spend_cents: 612, duration_ms: 2_520_000 },
    provenance: { researcher: "loop-v1", alias: "researcher-long-ctx", resolution_ref: null },
    sources: 44,
    spendCents: 612,
    brief: {
      id: uuid("5eed0093", 127),
      version: 1,
      createdAt: new Date("2026-10-08T09:42:00Z"),
      deliverables: {},
    },
    matrixId: uuid("5eed0095", 127),
    loop: null,
    evidence: null,
    fixRunId: null,
    ...overrides,
  };
}

/** RS-118 — a finished bug investigation whose fix is being built. */
export function rs118(overrides: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return record({
    id: investigationId(118),
    displayId: "RS-118",
    kind: { slug: "bug_root_cause", name: "Bug root cause", tint: "bug" },
    question: "Root cause: altimeter spikes below −10 °C",
    depth: "standard",
    tools: ["code", "tickets", "telemetry"],
    estimate: null,
    estimateCalibrationVersion: null,
    actuals: { sources_used: 18, spend_cents: 214, duration_ms: 1_140_000 },
    sources: 18,
    spendCents: 214,
    brief: {
      id: uuid("5eed0093", 118),
      version: 1,
      createdAt: new Date("2026-10-06T10:00:00Z"),
      deliverables: { fix_draft: uuid("5eed0090", 1498) },
    },
    matrixId: null,
    fixRunId: uuid("5eed0010", 498),
    ...overrides,
  });
}

/** RS-121 — queued, with evidence already in its ledger. */
export function rs121(overrides: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return record({
    id: investigationId(121),
    displayId: "RS-121",
    kind: { slug: "regression_forensics", name: "Regression forensics", tint: "reg" },
    question: "Motor PID overshoot appeared between v2.0.4 → v2.1.0-rc1",
    depth: "standard",
    tools: ["code", "telemetry", "tickets"],
    status: "queued",
    estimate: null,
    estimateCalibrationVersion: null,
    actuals: null,
    provenance: null,
    sources: 9,
    spendCents: 0,
    brief: null,
    matrixId: null,
    evidence: { testRunId: uuid("5eed0020", 1), runId: uuid("5eed0010", 512) },
    ...overrides,
  });
}

/** RS-124 — a roadmap investigation whose issues were filed. */
export function rs124(overrides: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return record({
    id: investigationId(124),
    displayId: "RS-124",
    kind: { slug: "roadmap_improvements", name: "Roadmap & improvements", tint: "road" },
    question: "Q4 product improvements from support tickets + churn interviews",
    tools: ["tickets", "web", "competitor"],
    status: "issues_filed",
    estimate: null,
    estimateCalibrationVersion: null,
    actuals: { sources_used: 312, spend_cents: 1880, duration_ms: 3_420_000 },
    sources: 312,
    spendCents: 1880,
    brief: {
      id: uuid("5eed0093", 124),
      version: 1,
      createdAt: new Date("2026-10-05T10:00:00Z"),
      deliverables: {
        draft_batch: uuid("5eed0090", 124),
        roadmap_doc: uuid("5eed0097", 124),
      },
    },
    matrixId: null,
    ...overrides,
  });
}

/** The card's four rows, newest first. */
export function featured(): InvestigationRecord[] {
  return [record(), rs124(), rs121(), rs118()];
}

/** An in-memory store over a list of records. */
export class MemoryLifecycleStore implements LifecycleStore {
  /** The starter role, per workspace. */
  readonly roles = new Map<string, ResearchStartRole>();
  /** Every draft handed to {@link create}. */
  readonly created: InvestigationDraft[] = [];
  /** Every id handed to {@link discard}. */
  readonly discarded: string[] = [];
  /** The kinds this workspace has. */
  kinds = new Set([
    "bug_root_cause",
    "regression_forensics",
    "roadmap_improvements",
    "gap_analysis",
  ]);
  /** The ledger of each investigation, per tool. */
  readonly ledgers = new Map<string, { tool: string; count: number }[]>();

  /**
   * @param records - The workspace's investigations.
   * @param workspace - The workspace they belong to.
   */
  constructor(
    public records: InvestigationRecord[] = featured(),
    private readonly workspace: string = WORKSPACE,
  ) {}

  /** @inheritdoc */
  startRole(organizationId: string): Promise<ResearchStartRole> {
    return Promise.resolve(this.roles.get(organizationId) ?? "member");
  }

  /** @inheritdoc */
  saveStartRole(organizationId: string, role: ResearchStartRole): Promise<ResearchStartRole> {
    this.roles.set(organizationId, role);
    return Promise.resolve(role);
  }

  /** @inheritdoc */
  create(organizationId: string, draft: InvestigationDraft): Promise<string | undefined> {
    if (organizationId !== this.workspace || !this.kinds.has(draft.kind)) {
      return Promise.resolve(undefined);
    }
    this.created.push(draft);

    const id = investigationId(128);
    this.records = [
      record({
        id,
        displayId: "RS-128",
        kind: { slug: draft.kind, name: draft.kind, tint: "gap" },
        question: draft.question,
        depth: draft.depth,
        tools: draft.tools,
        status: "queued",
        startedBy: { id: draft.userId, name: "Starter" },
        estimate: draft.estimate,
        estimateCalibrationVersion: draft.calibrationVersion,
        actuals: null,
        provenance: null,
        sources: 0,
        spendCents: 0,
        brief: null,
        matrixId: null,
      }),
      ...this.records,
    ];
    return Promise.resolve(id);
  }

  /** @inheritdoc */
  discard(organizationId: string, investigationId: string): Promise<void> {
    if (organizationId !== this.workspace) return Promise.resolve();
    this.discarded.push(investigationId);
    this.set(investigationId, { status: "cancelled" });
    return Promise.resolve();
  }

  /** @inheritdoc */
  find(organizationId: string, investigationId: string): Promise<InvestigationRecord | undefined> {
    return Promise.resolve(
      organizationId === this.workspace
        ? this.records.find((candidate) => candidate.id === investigationId)
        : undefined,
    );
  }

  /** @inheritdoc */
  list(
    organizationId: string,
    filter: InvestigationFilter,
    window: PageWindow,
  ): Promise<{ readonly records: InvestigationRecord[]; readonly total: number }> {
    const matching = (organizationId === this.workspace ? this.records : []).filter(
      (candidate) =>
        (filter.kind === undefined || candidate.kind.slug === filter.kind) &&
        (filter.statuses === undefined || filter.statuses.includes(candidate.status)) &&
        (filter.quarter === undefined || within(candidate, filter.quarter)),
    );

    return Promise.resolve({
      records: matching.slice(window.offset, window.offset + window.limit),
      total: matching.length,
    });
  }

  /** @inheritdoc */
  counts(
    organizationId: string,
    quarter: Quarter,
  ): Promise<{ readonly active: number; readonly thisQuarter: number }> {
    const mine = organizationId === this.workspace ? this.records : [];

    return Promise.resolve({
      active: mine.filter((candidate) =>
        (ACTIVE_STATUSES as readonly InvestigationStatus[]).includes(candidate.status),
      ).length,
      thisQuarter: mine.filter((candidate) => within(candidate, quarter)).length,
    });
  }

  /** @inheritdoc */
  ledgerByTool(investigationId: string): Promise<{ tool: string; count: number }[]> {
    return Promise.resolve(this.ledgers.get(investigationId) ?? []);
  }

  /**
   * Change a record in place.
   *
   * @param investigationId - Which.
   * @param change - What differs.
   */
  set(investigationId: string, change: Partial<InvestigationRecord>): void {
    this.records = this.records.map((candidate) =>
      candidate.id === investigationId ? { ...candidate, ...change } : candidate,
    );
  }
}

/**
 * Whether a record was started inside a quarter.
 *
 * @param candidate - The record.
 * @param quarter - The quarter.
 * @returns True when its creation falls in `[from, to)`.
 */
function within(candidate: InvestigationRecord, quarter: Quarter): boolean {
  return candidate.createdAt >= quarter.from && candidate.createdAt < quarter.to;
}
