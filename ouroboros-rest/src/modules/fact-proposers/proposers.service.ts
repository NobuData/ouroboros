/**
 * "Learned by the loop" without a model — BF.3's deterministic fact proposers
 * ([#412](https://github.com/NobuData/ouroboros/issues/412), decisions **K3** and **K5**).
 *
 * ```
 * source written (classification with a note · waiver · steer with remember this)
 *   ─▶ registry entry: propose(source) ─▶ skip {reason}            the rule's own answer
 *   ─▶ sealCandidate                    ─▶ refuses any status key   no auto-confirm, asserted
 *   ─▶ a fact already cites this source? ─▶ already_proposed         re-runs are idempotent
 *   ─▶ normalized text matches a fact    ─▶ suppressed + recorded    any status, rejected too
 *   ─▶ FactsService.propose(actor null)  ─▶ proposed                 "awaiting review"
 * ```
 *
 * **The only write path is the lifecycle's own entry point**, `FactsService.propose`, which inserts
 * `proposed` and nothing else — and V071's trigger refuses any other insert besides. This service
 * never names a status to write; {@link FactProposersService.propose} is generic over a
 * {@link ProposerDefinition}, so adding a proposer is a registry entry and a loader, and the
 * lifecycle service does not change.
 *
 * **It runs when the source is written** — the triage, criteria and controls services report the
 * row on `FACT_SOURCE_OBSERVER` after their own write commits — and on demand over one run (the
 * backfill). A proposer failure is logged and swallowed: the classification, waiver or steer the
 * person just made has already succeeded, and must not turn into an error because of this.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { FactSuppression } from "../db/schema";
import { FactsService } from "../facts/facts.service";
import { provenanceOf } from "../facts/facts.resources";
import { normalizeFactText } from "../facts/facts.text";
import { runNotFound } from "../runs/runs.errors";
import { MAX_SUPPRESSIONS_PAGE } from "./proposers.dto";
import type { FactSourceObserver, FactSourceRef } from "./proposers.observer";
import { PROPOSER_REGISTRY } from "./proposers.registry";
import { ProposerRepository } from "./proposers.repository";
import {
  sealCandidate,
  sourceKey,
  type CandidateSource,
  type LoadableProposerKind,
  type ProposalOutcome,
  type ProposerDefinition,
} from "./proposers.types";
import type { SuppressionResource } from "./proposers.resources";

/** Which provenance ref kind names each loadable source. */
const SOURCE_REF_KIND: Readonly<Record<LoadableProposerKind, CandidateSource["kind"]>> = {
  correction_note: "classification",
  waiver: "waiver",
  steer: "steer",
};

@Injectable()
export class FactProposersService implements FactSourceObserver {
  private readonly logger = new Logger(FactProposersService.name);

  /**
   * @param store - The statements.
   * @param facts - The lifecycle's entry point — the only way a candidate becomes a fact.
   */
  constructor(
    private readonly store: ProposerRepository,
    private readonly facts: FactsService,
  ) {}

  /**
   * `FACT_SOURCE_OBSERVER` — a source writer's report. Never throws.
   *
   * @param organizationId - The workspace.
   * @param source - The row just written.
   */
  async sourceWritten(organizationId: string, source: FactSourceRef): Promise<void> {
    try {
      const outcome = await this.proposeFrom(organizationId, source);

      this.logger.log(
        `fact proposer ${source.kind} over ${source.id}: ${outcome.outcome}` +
          (outcome.outcome === "skipped" ? ` (${outcome.reason})` : ""),
      );
    } catch (error) {
      this.logger.error(
        `fact proposer ${source.kind} over ${source.id} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Load one source and propose from it.
   *
   * @param organizationId - The workspace.
   * @param source - The source's kind and id.
   * @returns What became of it.
   */
  async proposeFrom(organizationId: string, source: FactSourceRef): Promise<ProposalOutcome> {
    const cited: CandidateSource = { kind: SOURCE_REF_KIND[source.kind], id: source.id };

    switch (source.kind) {
      case "correction_note": {
        const row = await this.store.correctionNote(organizationId, source.id);

        return row === undefined
          ? { outcome: "skipped", source: cited, reason: "source_not_found" }
          : this.propose(organizationId, PROPOSER_REGISTRY.correction_note, row, cited);
      }
      case "waiver": {
        const row = await this.store.waiver(organizationId, source.id);

        return row === undefined
          ? { outcome: "skipped", source: cited, reason: "source_not_found" }
          : this.propose(organizationId, PROPOSER_REGISTRY.waiver, row, cited);
      }
      case "steer": {
        const row = await this.store.steer(organizationId, source.id);

        return row === undefined
          ? { outcome: "skipped", source: cited, reason: "source_not_found" }
          : this.propose(organizationId, PROPOSER_REGISTRY.steer, row, cited);
      }
    }
  }

  /**
   * Run one proposer over one source — the generic path every registry entry takes.
   *
   * @param organizationId - The workspace.
   * @param definition - The registry entry.
   * @param source - What it reads.
   * @param cited - The source row, for a skip's answer.
   * @returns What became of it.
   * @throws {ProposerContractViolation} When the entry's output is not a candidate.
   */
  async propose<Source>(
    organizationId: string,
    definition: ProposerDefinition<Source>,
    source: Source,
    cited: CandidateSource,
  ): Promise<ProposalOutcome> {
    const proposal = definition.propose(source);

    if (proposal.kind === "skip") {
      return { outcome: "skipped", source: cited, reason: proposal.reason };
    }

    const candidate = sealCandidate(proposal.candidate);
    // The source's own ref is among the candidate's: a fact carrying it came from this source.
    const sourceRef = candidate.provenance.refs.find((ref) => ref.kind === candidate.source.kind);
    const already =
      sourceRef === undefined ? undefined : await this.store.factCiting(organizationId, sourceRef);

    if (already !== undefined) {
      return { outcome: "already_proposed", source: candidate.source, factId: already };
    }

    const normalizedText = normalizeFactText(candidate.text);
    const existing = (await this.store.factsByText(organizationId, candidate.repoRef)).get(
      normalizedText,
    );

    if (existing !== undefined) {
      const suppressionId = await this.store.insertSuppression(organizationId, {
        candidate,
        normalizedText,
        matchedFactId: existing.id,
        sourceKey: sourceKey(candidate.source),
      });

      return {
        outcome: "suppressed",
        source: candidate.source,
        matchedFactId: existing.id,
        suppressionId,
        candidate,
      };
    }

    const fact = await this.facts.propose(
      organizationId,
      {
        text: candidate.text,
        repoRef: candidate.repoRef,
        proposer: candidate.proposer,
        provenance: candidate.provenance,
      },
      null,
    );

    return { outcome: "proposed", source: candidate.source, factId: fact.id, candidate };
  }

  /**
   * Run every proposer over one run's sources — oldest first, idempotent.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @returns One outcome per source.
   * @throws {NotFoundError} `404 run_not_found` — absent, or another workspace's.
   */
  async backfillRun(organizationId: string, runId: string): Promise<ProposalOutcome[]> {
    if (!(await this.store.runExists(organizationId, runId))) throw runNotFound(runId);

    const outcomes: ProposalOutcome[] = [];

    for (const source of await this.store.runSources(organizationId, runId)) {
      outcomes.push(await this.proposeFrom(organizationId, source));
    }

    return outcomes;
  }

  /**
   * The workspace's recorded suppressions, newest first.
   *
   * @param organizationId - The workspace.
   * @param limit - At most this many (1–{@link MAX_SUPPRESSIONS_PAGE}).
   * @returns The suppressions.
   */
  async suppressions(organizationId: string, limit: number): Promise<SuppressionResource[]> {
    const rows = await this.store.suppressions(
      organizationId,
      Math.min(Math.max(1, limit), MAX_SUPPRESSIONS_PAGE),
    );

    return rows.map(suppressionResource);
  }
}

/**
 * @param row - A `fact_suppressions` row.
 * @returns Its resource.
 */
export function suppressionResource(row: FactSuppression): SuppressionResource {
  return {
    id: row.id,
    proposer: row.proposer,
    proposerVersion: row.proposer_version,
    repoRef: row.repo_ref,
    text: row.text,
    matchedFactId: row.matched_fact_id,
    provenance: provenanceOf(row.provenance),
    sourceKey: row.source_key,
    createdAt: row.created_at.toISOString(),
  };
}
