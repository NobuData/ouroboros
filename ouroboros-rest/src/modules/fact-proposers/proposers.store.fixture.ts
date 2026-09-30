/**
 * An in-memory world for BF.3's proposers (#412): the sources a proposer reads, the suppression
 * record V074 keeps, and — through `facts.store.fixture.ts`'s `FactStore` — the facts, with V071's
 * rules (born `proposed`, provenance resolved). The service under test is the real
 * `FactProposersService` over the real `FactsService`, so "nothing auto-confirms" is asserted of
 * the path production takes.
 */

import type { DatabaseService } from "../db/db.service";
import type { FactSuppression } from "../db/schema";
import type { FactProvenanceRef } from "../facts/facts.resources";
import { FactsService } from "../facts/facts.service";
import { FactStore } from "../facts/facts.store.fixture";
import { normalizeFactText } from "../facts/facts.text";
import type {
  CorrectionNoteSource,
  SourceRun,
  SteerSource,
  WaiverSource,
} from "./proposers.registry";
import type {
  ExistingFact,
  NewSuppression,
  ProposerRepository,
  ProposerStore,
  RunSourceRef,
} from "./proposers.repository";
import { FactProposersService } from "./proposers.service";

/** The workspace every fixture lives in. */
export const PROPOSER_ORG = "org-acme";

/** Another workspace, for tenancy. */
export const OTHER_ORG = "org-other";

/** Run `#482` — Loop #1847. */
export const RUN_ID = "5eed0021-0000-4000-8000-000000000482";

/** PR #514, the run's. */
export const PR_ID = "5eed0026-0000-4000-8000-000000000514";

/** Ken's correction note on Build 1. */
export const CLASSIFICATION_ID = "5eed0037-0000-4000-8000-000000048201";

/** A waiver of failing cases. */
export const WAIVER_ID = "5eed0040-0000-4000-8000-000000000001";

/** The PR's test-suite gate. */
export const GATE_ID = "5eed0041-0000-4000-8000-000000000001";

/** A steer flagged remember this, and one that is not. */
export const REMEMBERED_STEER_ID = "5eed0042-0000-4000-8000-000000000001";
export const ORDINARY_STEER_ID = "5eed0042-0000-4000-8000-000000000002";

/** The stage a steer was asked in. */
export const STAGE_ID = "5eed0043-0000-4000-8000-000000000004";

/** Ken. */
export const KEN = "5eed0003-0000-4000-8000-000000000001";

/** The seeded note — its first sentence is the mockup's awaiting-review fact. */
export const K_MSGQ_NOTE =
  "Team prefers `k_msgq` over `k_fifo` in ISR paths. Keep the `k_msgq`, but move PID sampling " +
  "out of the ISR.";

/** The run around every source. */
export const SOURCE_RUN: SourceRun = {
  id: RUN_ID,
  loopSeq: 1847,
  repoRef: "acme-robotics/helios-firmware",
  pullRequest: { id: PR_ID, number: 514 },
};

/** A clock for the sources' order. */
const AT = (minutes: number): Date => new Date(Date.UTC(2026, 8, 20, 10, minutes));

export class ProposerWorld {
  readonly facts = new FactStore();
  readonly correctionNotes = new Map<string, CorrectionNoteSource>();
  readonly waivers = new Map<string, WaiverSource>();
  readonly steers = new Map<string, SteerSource>();
  readonly runs = new Set<string>([RUN_ID]);
  readonly runSourceList: (RunSourceRef & { at: Date })[] = [];
  readonly suppressionRows: FactSuppression[] = [];

  /** Every row provenance may cite, as V074's resolver would find them in this workspace. */
  constructor() {
    this.facts.citable.set(
      PROPOSER_ORG,
      new Set([
        RUN_ID,
        PR_ID,
        CLASSIFICATION_ID,
        WAIVER_ID,
        GATE_ID,
        REMEMBERED_STEER_ID,
        ORDINARY_STEER_ID,
        STAGE_ID,
        KEN,
      ]),
    );
  }

  /**
   * Add Ken's correction note on run #482 — the seed's.
   *
   * @param overrides - Fields to replace.
   * @returns The world.
   */
  withCorrectionNote(overrides: Partial<CorrectionNoteSource> = {}): this {
    this.correctionNotes.set(CLASSIFICATION_ID, {
      classificationId: CLASSIFICATION_ID,
      note: K_MSGQ_NOTE,
      actor: "human",
      run: SOURCE_RUN,
      ...overrides,
    });
    this.runSourceList.push({ kind: "correction_note", id: CLASSIFICATION_ID, at: AT(1) });
    return this;
  }

  /**
   * Add a waiver of failing cases on PR #514.
   *
   * @param reason - Its reason.
   * @returns The world.
   */
  withWaiver(reason: string): this {
    this.waivers.set(WAIVER_ID, {
      waiverId: WAIVER_ID,
      reason,
      gateIds: [GATE_ID],
      run: SOURCE_RUN,
    });
    this.runSourceList.push({ kind: "waiver", id: WAIVER_ID, at: AT(2) });
    return this;
  }

  /**
   * Add a steer.
   *
   * @param id - Which of the two steer ids.
   * @param payload - Its text.
   * @param remember - The *remember this* flag.
   * @returns The world.
   */
  withSteer(id: string, payload: string, remember: boolean): this {
    this.steers.set(id, {
      controlId: id,
      payload,
      remember,
      stage: { id: STAGE_ID, label: "Implement" },
      actorId: KEN,
      run: SOURCE_RUN,
    });
    if (remember) this.runSourceList.push({ kind: "steer", id, at: AT(3) });
    return this;
  }

  /**
   * The store the service reads through.
   *
   * @returns A stand-in for `ProposerRepository`.
   */
  store(): ProposerStore {
    return {
      correctionNote: (organizationId, id) =>
        Promise.resolve(organizationId === PROPOSER_ORG ? this.correctionNotes.get(id) : undefined),
      waiver: (organizationId, id) =>
        Promise.resolve(organizationId === PROPOSER_ORG ? this.waivers.get(id) : undefined),
      steer: (organizationId, id) =>
        Promise.resolve(organizationId === PROPOSER_ORG ? this.steers.get(id) : undefined),
      runExists: (organizationId, runId) =>
        Promise.resolve(organizationId === PROPOSER_ORG && this.runs.has(runId)),
      runSources: () =>
        Promise.resolve(
          [...this.runSourceList]
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .map(({ kind, id }) => ({ kind, id })),
        ),
      factsByText: (organizationId, repoRef) =>
        Promise.resolve(this.byText(organizationId, repoRef)),
      factCiting: (organizationId, ref) => Promise.resolve(this.citing(organizationId, ref)),
      insertSuppression: (organizationId, suppression) =>
        Promise.resolve(this.suppress(organizationId, suppression)),
      suppressions: (organizationId, limit) =>
        Promise.resolve(
          this.suppressionRows
            .filter((row) => row.organization_id === organizationId)
            .slice(-limit)
            .reverse(),
        ),
    };
  }

  /**
   * The facts service over the fact store — the lifecycle's real entry point.
   *
   * @returns The service.
   */
  factsService(): FactsService {
    const database = {
      transaction: (work: (trx: unknown) => Promise<unknown>) => work({}),
    } as unknown as DatabaseService;

    return new FactsService(this.facts.asRepository(), database);
  }

  /**
   * The service under test.
   *
   * @param facts - The facts service, when a suite wants to spy on it.
   * @returns The service.
   */
  service(facts: FactsService = this.factsService()): FactProposersService {
    return new FactProposersService(this.store() as ProposerRepository, facts);
  }

  /**
   * @param organizationId - The workspace.
   * @param repoRef - The candidate's repository.
   * @returns The oldest fact per normalized text, any status.
   */
  private byText(organizationId: string, repoRef: string | null): Map<string, ExistingFact> {
    const byText = new Map<string, ExistingFact>();

    for (const fact of this.facts.facts) {
      if (fact.organization_id !== organizationId) continue;
      if (repoRef !== null && fact.repo_ref !== null && fact.repo_ref !== repoRef) continue;

      const key = normalizeFactText(fact.text);
      if (!byText.has(key)) byText.set(key, { id: fact.id, status: fact.status });
    }

    return byText;
  }

  /**
   * @param organizationId - The workspace.
   * @param ref - A source's ref.
   * @returns A fact citing it.
   */
  private citing(organizationId: string, ref: FactProvenanceRef): string | undefined {
    return this.facts.facts.find(
      (fact) =>
        fact.organization_id === organizationId &&
        ((fact.provenance as { refs?: FactProvenanceRef[] }).refs ?? []).some(
          (cited) => JSON.stringify(cited) === JSON.stringify(ref),
        ),
    )?.id;
  }

  /**
   * V074's insert, with its `(organization, source, matched fact)` key.
   *
   * @param organizationId - The workspace.
   * @param suppression - The row.
   * @returns Its id — the existing one on a repeat.
   */
  private suppress(organizationId: string, suppression: NewSuppression): string {
    const existing = this.suppressionRows.find(
      (row) =>
        row.organization_id === organizationId &&
        row.source_key === suppression.sourceKey &&
        row.matched_fact_id === suppression.matchedFactId,
    );

    if (existing !== undefined) return existing.id;

    const id = `00000000-0000-4000-9000-${String(this.suppressionRows.length + 1).padStart(12, "0")}`;
    const { candidate } = suppression;

    this.suppressionRows.push({
      id,
      organization_id: organizationId,
      repo_ref: candidate.repoRef,
      proposer: candidate.proposer,
      proposer_version: candidate.proposerVersion,
      text: candidate.text,
      normalized_text: suppression.normalizedText,
      matched_fact_id: suppression.matchedFactId,
      provenance: JSON.parse(JSON.stringify(candidate.provenance)) as unknown,
      source_key: suppression.sourceKey,
      created_at: this.facts.tick(),
    });

    return id;
  }
}
