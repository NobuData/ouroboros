/* eslint-disable @typescript-eslint/require-await -- an in-memory stand-in answers at once; async keeps the store's signatures */
/**
 * An in-memory investigation store — the loop's service and dispatcher tests run on it (#620).
 *
 * {@link MemoryLoopStore} keeps what V106, V108 and V120 keep, and refuses what they refuse:
 * an attempt that was replaced, a checkpoint number that does not rise, a finding with no
 * source (the deferred `brief_claims_finding_cited`), a failure reason on a run that did not
 * fail. Actuals are computed from the rows it holds, as the repository computes them.
 */

import type {
  InvestigationActualsDocument,
  InvestigationFailureReason,
  InvestigationStatus,
} from "../../db/schema";
import type {
  CancelOutcome,
  CheckpointOutcome,
  CheckpointWrite,
  DeliveryWrite,
  EndOutcome,
  EndingWrite,
  InvestigationLoopStore,
  LedgerSource,
  LoopInvestigation,
  Refused,
  StalledInvestigation,
  StartOutcome,
  StartWrite,
  UsageRow,
} from "./investigation-loop.repository";

export const WORKSPACE = "org-acme";
export const INVESTIGATION = "5eed0091-0000-4000-8000-000000000127";

/** A `source_records` id for a cite number. */
export function sourceId(citeNo: number): string {
  return `5eed0092-0000-4000-8000-${citeNo.toString().padStart(12, "0")}`;
}

/** A ledger record. */
export function source(citeNo: number, overrides: Partial<LedgerSource> = {}): LedgerSource {
  return {
    id: sourceId(citeNo),
    citeNo,
    citeKey: null,
    tool: "web",
    kind: "web",
    title: `Source ${citeNo.toString()}`,
    locator: `https://example.com/${citeNo.toString()}`,
    excerpt: "An excerpt.",
    ...overrides,
  };
}

/** RS-127 — a queued deep-dive gap analysis with a priced estimate. */
export function investigation(overrides: Partial<LoopInvestigation> = {}): LoopInvestigation {
  return {
    id: INVESTIGATION,
    organizationId: WORKSPACE,
    displayId: "RS-127",
    status: "queued",
    kind: "gap_analysis",
    playbook: {
      version: 1,
      default_tools: ["web", "competitor", "code", "tickets", "telemetry"],
      synthesis_template: "gap_analysis@1",
      deliverables: ["brief", "matrix"],
    },
    question: "Why do rivals dock reliably in wind and we do not?",
    depth: "deep_dive",
    tools: ["web", "competitor", "code", "tickets", "telemetry"],
    estimate: { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
    ...overrides,
  };
}

/** One investigation's loop row. */
export interface MemoryLoop {
  loopVersion: string;
  attempt: number;
  checkpoint: Record<string, unknown> | null;
  checkpointSeq: number;
  durationMs: number;
  cancelRequestedBy: string | null | undefined;
  failureReason: InvestigationFailureReason | null;
  failureDetail: string | null;
  updatedAt: Date;
}

/** A delivered brief. */
export interface MemoryBrief {
  readonly id: string;
  readonly version: number;
  readonly write: DeliveryWrite;
}

export class MemoryLoopStore implements InvestigationLoopStore {
  readonly investigations = new Map<string, LoopInvestigation>();
  readonly loops = new Map<string, MemoryLoop>();
  readonly sources = new Map<string, LedgerSource[]>();
  readonly usage = new Map<string, Map<number, UsageRow>>();
  readonly briefs = new Map<string, MemoryBrief[]>();
  readonly actuals = new Map<string, InvestigationActualsDocument>();
  readonly provenance = new Map<string, StartWrite>();
  /** The clock `updated_at` is stamped from. */
  now = new Date("2026-10-09T12:00:00Z");

  /**
   * @param seeded - Investigations to start with.
   */
  constructor(...seeded: LoopInvestigation[]) {
    for (const each of seeded) this.investigations.set(each.id, each);
  }

  /** Put sources in an investigation's ledger. */
  archive(investigationId: string, ...sources: LedgerSource[]): void {
    this.sources.set(investigationId, [...(this.sources.get(investigationId) ?? []), ...sources]);
  }

  /** @returns What `investigation_spend_cents()` answers. */
  spendCents(investigationId: string): number | null {
    const rows = [...(this.usage.get(investigationId)?.values() ?? [])];
    if (rows.length === 0) return 0;
    const priced = rows.flatMap((row) => (row.costCents === null ? [] : [row.costCents]));
    return priced.length === 0 ? null : Math.ceil(priced.reduce((sum, cost) => sum + cost, 0));
  }

  async find(investigationId: string): Promise<LoopInvestigation | undefined> {
    return this.investigations.get(investigationId);
  }

  async findIn(
    organizationId: string,
    investigationId: string,
  ): Promise<LoopInvestigation | undefined> {
    const found = this.investigations.get(investigationId);
    return found?.organizationId === organizationId ? found : undefined;
  }

  async start(investigationId: string, write: StartWrite): Promise<StartOutcome> {
    const held = this.investigations.get(investigationId);
    if (held === undefined) return { outcome: "not_found" };
    if (held.status !== "queued" && held.status !== "running") {
      return { outcome: "not_runnable", displayId: held.displayId, status: held.status };
    }

    if (held.status === "queued") this.provenance.set(investigationId, write);
    this.move(held, "running");
    const existing = this.loops.get(investigationId);
    const loop: MemoryLoop =
      existing === undefined
        ? {
            loopVersion: write.loopVersion,
            attempt: 1,
            checkpoint: null,
            checkpointSeq: 0,
            durationMs: 0,
            cancelRequestedBy: undefined,
            failureReason: null,
            failureDetail: null,
            updatedAt: this.now,
          }
        : { ...existing, attempt: existing.attempt + 1, updatedAt: this.now };
    this.loops.set(investigationId, loop);

    return {
      outcome: "started",
      displayId: held.displayId,
      attempt: loop.attempt,
      checkpoint: loop.checkpoint,
      checkpointSeq: loop.checkpointSeq,
      durationMs: loop.durationMs,
      cancelRequested: loop.cancelRequestedBy !== undefined,
    };
  }

  async ledger(investigationId: string): Promise<LedgerSource[]> {
    return [...(this.sources.get(investigationId) ?? [])];
  }

  async knownSources(investigationId: string, sourceIds: readonly string[]): Promise<Set<string>> {
    const held = new Set((this.sources.get(investigationId) ?? []).map((each) => each.id));
    return new Set(sourceIds.filter((id) => held.has(id)));
  }

  async checkpoint(investigationId: string, write: CheckpointWrite): Promise<CheckpointOutcome> {
    const owned = this.owned(investigationId, write.attempt);
    if ("outcome" in owned) return owned;
    if (write.seq <= owned.loop.checkpointSeq) {
      return { outcome: "stale", displayId: owned.held.displayId };
    }

    this.record(investigationId, write.usage);
    owned.loop.checkpoint = structuredClone(write.checkpoint);
    owned.loop.checkpointSeq = write.seq;
    owned.loop.durationMs = Math.max(owned.loop.durationMs, write.durationMs);
    owned.loop.updatedAt = this.now;

    return { outcome: "saved", cancelRequested: owned.loop.cancelRequestedBy !== undefined };
  }

  async deliver(investigationId: string, write: DeliveryWrite): Promise<EndOutcome> {
    const owned = this.owned(investigationId, write.attempt);
    if ("outcome" in owned) return owned;

    // V108's deferred rule, and its composite keys: a finding is cited, by this ledger.
    const held = new Set((this.sources.get(investigationId) ?? []).map((each) => each.id));
    for (const claim of write.claims) {
      if (claim.type === "finding" && claim.sources.length === 0) {
        throw new Error("brief_claims_finding_cited");
      }
      if (claim.sources.some((id) => !held.has(id))) {
        throw new Error("brief_claim_sources_source_fk");
      }
    }

    this.record(investigationId, write.usage);
    const briefs = this.briefs.get(investigationId) ?? [];
    const brief: MemoryBrief = {
      id: `5eed0093-0000-4000-8000-${(briefs.length + 1).toString().padStart(12, "0")}`,
      version: briefs.length + 1,
      write,
    };
    this.briefs.set(investigationId, [...briefs, brief]);

    return {
      outcome: "ended",
      organizationId: owned.held.organizationId,
      displayId: owned.held.displayId,
      status: "brief_ready",
      actuals: this.end(owned.held, owned.loop, "brief_ready", write.durationMs),
      brief: { id: brief.id, version: brief.version },
    };
  }

  async finish(investigationId: string, write: EndingWrite): Promise<EndOutcome> {
    const owned = this.owned(investigationId, write.attempt);
    if ("outcome" in owned) return owned;

    this.record(investigationId, write.usage);
    const actuals = this.end(owned.held, owned.loop, write.outcome, write.durationMs);
    owned.loop.checkpoint = structuredClone(write.checkpoint);
    owned.loop.checkpointSeq = Math.max(owned.loop.checkpointSeq, write.seq);
    owned.loop.failureReason = write.outcome === "failed" ? write.reason : null;
    owned.loop.failureDetail = write.outcome === "failed" ? write.detail : null;

    return {
      outcome: "ended",
      organizationId: owned.held.organizationId,
      displayId: owned.held.displayId,
      status: write.outcome,
      actuals,
      brief: null,
    };
  }

  async requestCancel(
    organizationId: string,
    investigationId: string,
    userId: string | null,
  ): Promise<CancelOutcome> {
    const held = await this.findIn(organizationId, investigationId);
    if (held === undefined) return { outcome: "not_found" };
    if (held.status !== "queued" && held.status !== "running") {
      return { outcome: "not_cancellable", displayId: held.displayId, status: held.status };
    }

    const loop = this.loops.get(investigationId);
    if (loop !== undefined) {
      loop.cancelRequestedBy ??= userId;
      loop.updatedAt = this.now;
    }
    if (held.status === "running" && loop !== undefined) {
      return { outcome: "requested", displayId: held.displayId };
    }

    this.move(held, "cancelled");
    return { outcome: "cancelled", displayId: held.displayId };
  }

  async stalled(before: Date, limit: number): Promise<StalledInvestigation[]> {
    return [...this.loops.entries()]
      .filter(
        ([id, loop]) =>
          this.investigations.get(id)?.status === "running" && loop.updatedAt < before,
      )
      .toSorted(([, a], [, b]) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit)
      .map(([id, loop]) => ({
        id,
        displayId: this.investigations.get(id)?.displayId ?? id,
        attempt: loop.attempt,
        cancelRequested: loop.cancelRequestedBy !== undefined,
      }));
  }

  async abandon(investigationId: string, attempt: number, detail: string | null): Promise<boolean> {
    const owned = this.owned(investigationId, attempt);
    if ("outcome" in owned) return false;

    if (detail === null) {
      this.end(owned.held, owned.loop, "cancelled", owned.loop.durationMs);
      return true;
    }
    this.end(owned.held, owned.loop, "failed", owned.loop.durationMs);
    owned.loop.failureReason = "engine_error";
    owned.loop.failureDetail = detail;
    return true;
  }

  private owned(
    investigationId: string,
    attempt: number,
  ): Refused | { held: LoopInvestigation; loop: MemoryLoop } {
    const held = this.investigations.get(investigationId);
    if (held === undefined) return { outcome: "not_found" };
    if (held.status !== "running") {
      return { outcome: "not_running", displayId: held.displayId, status: held.status };
    }
    const loop = this.loops.get(investigationId);
    if (loop?.attempt !== attempt) return { outcome: "stale", displayId: held.displayId };
    return { held, loop };
  }

  private record(investigationId: string, usage: readonly UsageRow[]): void {
    const rows = this.usage.get(investigationId) ?? new Map<number, UsageRow>();
    for (const row of usage) if (!rows.has(row.seq)) rows.set(row.seq, row);
    this.usage.set(investigationId, rows);
  }

  private end(
    held: LoopInvestigation,
    loop: MemoryLoop,
    status: InvestigationStatus,
    durationMs: number,
  ): InvestigationActualsDocument {
    loop.durationMs = Math.max(loop.durationMs, durationMs);
    const actuals: InvestigationActualsDocument = {
      sources_used: (this.sources.get(held.id) ?? []).length,
      spend_cents: this.spendCents(held.id),
      duration_ms: loop.durationMs,
    };
    this.actuals.set(held.id, actuals);
    this.move(held, status);
    return actuals;
  }

  private move(held: LoopInvestigation, status: InvestigationStatus): void {
    this.investigations.set(held.id, { ...held, status });
  }
}
