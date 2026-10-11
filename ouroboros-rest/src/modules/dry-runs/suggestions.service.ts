/**
 * Suggestions — filing them, and Apply / Explain / Ignore (CD.5,
 * [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * ```
 * dry run ends ─▶ file()      rule pack over the run's rows ─▶ dry_run_suggestions (source: rule)
 *              └▶ propose()   the copilot's own, validated as operations     (source: llm)
 *
 * Apply   ─▶ lock the draft ─▶ fold proposed_ops over it ─┬─ an operation no longer fits ─▶ 409
 *                                                         └─ apply_draft_batch(actor: suggestion)
 *                                                            ─▶ applied + batch ─▶ the new rev
 * Explain ─▶ the rule, its version, the evidence, the scoring inputs
 * Ignore  ─▶ ignored; the same rule does not re-propose it on this draft revision
 * ```
 *
 * Decisions:
 *
 *   * **Apply is the one write path.** `apply_draft_batch()` with the `suggestion` actor and the
 *     suggestion's id, inside the transaction that holds the draft lock and settles the
 *     suggestion — so the draft, the log and the suggestion cannot be written apart.
 *   * **A moved-on draft is surfaced, not forced.** The operations are computed when the
 *     suggestion is made; Apply checks each against the draft *as it is now* and answers `409`
 *     with the operation that no longer fits. A draft that moved without disturbing what the
 *     operations touch still applies.
 *   * **Ignore is remembered per draft revision.** A rule's finding equal (rule, title,
 *     operations) to one ignored on an earlier run of the same revision is not filed again; a
 *     new revision is a new question.
 *   * **The copilot's suggestions are validated and unscored.** Their operations are folded
 *     over the draft exactly as Apply would; one that does not fit is refused with the
 *     validator's sentence. They carry no confidence — `llm_unscored`, with the alias that
 *     produced them.
 *   * **Filing never fails a dry run.** The run has already ended in the record; a rule that
 *     throws is logged and the card simply has no callouts.
 */

import { isDeepStrictEqual } from "node:util";

import { Injectable, Logger } from "@nestjs/common";

import { unresolvedReferences } from "../copilot/copilot.references";
import { DatabaseService } from "../db/db.service";
import type { DryRun, StoredDraftOperation } from "../db/schema";
import { describeForLog } from "../errors/failure";
import { WorkflowCatalogService } from "../workflows/catalog.service";
import { draftEtag } from "../workflows/draft.etag";
import { workflowNotFound } from "../workflows/workflows.errors";
import { draftSpendGuardCents, effectiveBudget } from "./dry-runs.budget";
import { dryRunNotFound } from "./dry-runs.errors";
import { DryRunsRepository } from "./dry-runs.repository";
import { dryRunDraftLabel } from "./dry-runs.resources";
import {
  suggestionConflict,
  suggestionNotApplicable,
  suggestionNotFound,
  suggestionResolved,
} from "./suggestions.errors";
import { foldOperations } from "./suggestions.ops";
import {
  DryRunSuggestionsRepository,
  type IgnoredSuggestion,
  type NewSuggestion,
} from "./suggestions.repository";
import {
  dryRunSuggestion,
  dryRunSuggestionExplanation,
  type DryRunSuggestionAppliedResource,
  type DryRunSuggestionExplanationResource,
  type DryRunSuggestionResource,
  type DryRunSuggestionsResource,
} from "./suggestions.resources";
import { RULE_STATUSES, dollars, evaluatePack, type PackFinding } from "./suggestions.rules";

/** The basis method of a copilot suggestion — validated, never scored. */
export const LLM_UNSCORED = "llm_unscored";

/** What the copilot proposed, as its tool call carried it. */
export interface CopilotSuggestionProposal {
  readonly title: string;
  readonly body: string;
  readonly ops: readonly StoredDraftOperation[];
}

/** Where a copilot suggestion came from. */
export interface CopilotSuggestionProvenance {
  readonly sessionId: string;
  /** The routing alias the exchange resolved to. */
  readonly alias: string;
  readonly resolutionVersion: string | null;
}

/** Recorded, or refused with a sentence written for the model. */
export type ProposalOutcome =
  | { readonly ok: true; readonly suggestion: DryRunSuggestionResource }
  | { readonly ok: false; readonly message: string };

/**
 * Whether a finding is one somebody already ignored.
 *
 * @param finding - The rule's finding.
 * @param ignored - What was ignored on this draft revision.
 * @returns `true` when the rule, the title and the operations are the same.
 */
export function wasIgnored(finding: PackFinding, ignored: readonly IgnoredSuggestion[]): boolean {
  // Compared by value, not by text: `jsonb` returns an object's keys in its own order.
  return ignored.some(
    (row) =>
      row.rule_id === finding.rule.id &&
      row.title === finding.title &&
      isDeepStrictEqual(row.proposed_ops, finding.proposedOps),
  );
}

@Injectable()
export class DryRunSuggestionsService {
  private readonly logger = new Logger(DryRunSuggestionsService.name);

  /**
   * @param suggestions - The suggestions' statements.
   * @param dryRuns - The dry runs' statements — the run, its rows, its ticket, its budget.
   * @param catalog - The names that exist (R.3), for W7 and the validator.
   * @param database - The pool, for Apply's transaction.
   */
  constructor(
    private readonly suggestions: DryRunSuggestionsRepository,
    private readonly dryRuns: DryRunsRepository,
    private readonly catalog: WorkflowCatalogService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * File the rule pack's suggestions for a dry run that has just ended.
   *
   * Once per run, and only for a run that ended with results. Never throws: the run is already
   * recorded, and a card without callouts is the honest result of a rule that could not run.
   *
   * @param run - The dry run, as it ended.
   * @returns What was filed.
   */
  async file(run: DryRun): Promise<DryRunSuggestionResource[]> {
    if (!RULE_STATUSES.includes(run.status)) return [];

    try {
      if (await this.suggestions.hasRuleSuggestions(run.id)) return [];

      const [stages, ticket, draft, catalogue, capCents, traces, replay, ignored] =
        await Promise.all([
          this.dryRuns.stages(run.id),
          this.dryRuns.ticket(run.organization_id, run.ticket_id),
          this.dryRuns.draftDefinition(run.workflow_id),
          this.catalog.dslCatalogue(run.organization_id),
          this.dryRuns.workspaceCapCents(run.organization_id),
          this.dryRuns.guardTraces(run.organization_id, run.workflow_id),
          this.suggestions.replay(run.organization_id, run.workflow_id),
          this.suggestions.ignoredAtRevision(run),
        ]);
      if (ticket === undefined) return [];

      const findings = evaluatePack({
        run: { status: run.status, costCents: run.cost_cents },
        stages,
        ticket: { key: ticket.external_key, labels: ticket.labels },
        draft,
        budget: effectiveBudget(capCents, draftSpendGuardCents(traces)),
        catalogue,
        unresolved: unresolvedReferences(draft, catalogue),
        replay,
      }).filter((finding) => !wasIgnored(finding, ignored));

      const rows = await this.suggestions.insert(
        run,
        findings.map((finding): NewSuggestion => ({
          source: "rule",
          ruleId: finding.rule.id,
          ruleVersion: finding.rule.version,
          title: finding.title,
          body: finding.body,
          evidence: finding.evidence,
          proposedOps: finding.proposedOps,
          confidence: finding.score.confidence,
          confidenceBasis: finding.score.basis,
        })),
      );
      return rows.map(dryRunSuggestion);
    } catch (error) {
      this.logger.error(`suggestions for dry run ${run.id} were not filed`, describeForLog(error));
      return [];
    }
  }

  /**
   * A dry run's suggestions.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @returns The callouts, in card order.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`.
   */
  async list(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
  ): Promise<DryRunSuggestionsResource> {
    const run = await this.requireRun(organizationId, workflowId, dryRunId);
    const rows = await this.suggestions.forRun(run.id);

    return { dryRunId: run.id, suggestions: rows.map(dryRunSuggestion) };
  }

  /**
   * Explain a suggestion — the rule, its version, its evidence and the scoring inputs.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @param suggestionId - The suggestion.
   * @returns The derivation.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`,
   *   `dry_run_suggestion_not_found`.
   */
  async explain(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
    suggestionId: string,
  ): Promise<DryRunSuggestionExplanationResource> {
    const run = await this.requireRun(organizationId, workflowId, dryRunId);
    const row = await this.suggestions.find(run.id, suggestionId);
    if (row === undefined) throw suggestionNotFound(suggestionId);

    return dryRunSuggestionExplanation(row);
  }

  /**
   * Ignore a suggestion. It stays in the record, and the same rule does not propose it again
   * on a later dry run of this draft revision.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @param suggestionId - The suggestion.
   * @param userId - Who ignored it.
   * @returns The suggestion, ignored.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`,
   *   `dry_run_suggestion_not_found`.
   * @throws {ConflictError} `dry_run_suggestion_resolved` when it was already settled.
   */
  async ignore(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
    suggestionId: string,
    userId: string | null,
  ): Promise<DryRunSuggestionResource> {
    const run = await this.requireRun(organizationId, workflowId, dryRunId);
    const row = await this.suggestions.find(run.id, suggestionId);
    if (row === undefined) throw suggestionNotFound(suggestionId);
    if (row.status !== "open") throw suggestionResolved(row.id, row.status);

    const ignored = await this.suggestions.markIgnored(row.id, userId);
    // Settled between the read and the write: say what it is now.
    if (ignored === undefined) {
      const current = await this.suggestions.find(run.id, suggestionId);
      throw suggestionResolved(row.id, current?.status ?? "applied");
    }

    return dryRunSuggestion(ignored);
  }

  /**
   * Apply a suggestion to the draft.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @param suggestionId - The suggestion.
   * @param userId - Who applied it — the batch's actor user.
   * @returns The suggestion, applied, and the draft revision it produced.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`,
   *   `dry_run_suggestion_not_found`.
   * @throws {ConflictError} `dry_run_suggestion_resolved`, `dry_run_suggestion_not_applicable`,
   *   or `dry_run_suggestion_conflict` when the draft moved on and an operation no longer fits —
   *   in which case nothing was written.
   */
  async apply(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
    suggestionId: string,
    userId: string | null,
  ): Promise<DryRunSuggestionAppliedResource> {
    const run = await this.requireRun(organizationId, workflowId, dryRunId);
    const catalogue = await this.catalog.dslCatalogue(organizationId);

    return this.database.transaction(async (trx) => {
      // The draft first, then the suggestion: every draft writer takes the draft lock first.
      const draft = await this.suggestions.lockDraft(run.workflow_id, trx);
      const row = await this.suggestions.find(run.id, suggestionId, trx);
      if (row === undefined) throw suggestionNotFound(suggestionId);
      if (row.status !== "open") throw suggestionResolved(row.id, row.status);
      if (row.proposed_ops.length === 0) throw suggestionNotApplicable(row.id);

      const fold = foldOperations(draft?.definition ?? null, row.proposed_ops, catalogue);
      if (!fold.ok) {
        const current = await this.suggestions.revision(run.workflow_id, trx);
        throw suggestionConflict(row.id, {
          operation: fold.operation,
          kind: fold.kind,
          reason: fold.reason,
          testedDraftRev: run.draft_rev,
          draftRev: current.draft_rev,
        });
      }

      const batch = await this.suggestions.applyBatch(run, row.id, userId, fold.operations, trx);
      const applied = await this.suggestions.markApplied(row.id, batch.batch_id, userId, trx);
      const [written, revision] = await Promise.all([
        this.suggestions.draft(run.workflow_id, trx),
        this.suggestions.revision(run.workflow_id, trx),
      ]);

      return {
        suggestion: dryRunSuggestion(applied),
        draftRev: batch.draft_rev,
        draftLabel: dryRunDraftLabel(revision.current_version, revision.draft_rev),
        etag: draftEtag(written),
      };
    });
  }

  /**
   * Record a suggestion the copilot proposed, if its operations fit the draft.
   *
   * It attaches to the conversation's newest dry run that ended with results. The operations
   * are validated by folding them over the draft as it stands — what Apply will do — and a
   * proposal that does not fit is refused with the validator's sentence, for the model to read.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param proposal - What the copilot proposed.
   * @param provenance - The session and the model alias that proposed it.
   * @returns The recorded suggestion, or the refusal.
   */
  async propose(
    organizationId: string,
    workflowId: string,
    proposal: CopilotSuggestionProposal,
    provenance: CopilotSuggestionProvenance,
  ): Promise<ProposalOutcome> {
    const title = proposal.title.trim();
    const body = proposal.body.trim();
    if (title === "" || title.length > 200 || body === "" || body.length > 2000) {
      return {
        ok: false,
        message: "a suggestion needs a title (at most 200 characters) and a body (at most 2000).",
      };
    }
    if (proposal.ops.length === 0 || proposal.ops.length > 50) {
      return {
        ok: false,
        message:
          "a suggestion carries 1 to 50 operations — the exact change Apply would make. Say it in your reply instead if there is no operation to propose.",
      };
    }

    const run = await this.suggestions.latestForSession(
      organizationId,
      workflowId,
      provenance.sessionId,
    );
    if (run === undefined) {
      return {
        ok: false,
        message:
          "this conversation has no finished dry run to attach a suggestion to — propose a dry run first.",
      };
    }

    const [draft, catalogue] = await Promise.all([
      this.dryRuns.draftDefinition(workflowId),
      this.catalog.dslCatalogue(organizationId),
    ]);
    const fold = foldOperations(draft, proposal.ops, catalogue);
    if (!fold.ok) {
      return {
        ok: false,
        message: `operation ${String(fold.operation + 1)} (${fold.kind}) does not fit the draft: ${fold.reason}`,
      };
    }

    const [row] = await this.suggestions.insert(run, [
      {
        source: "llm",
        ruleId: null,
        ruleVersion: null,
        title,
        body,
        evidence: {
          session_id: provenance.sessionId,
          alias: provenance.alias,
          resolution_version: provenance.resolutionVersion,
          dry_run_id: run.id,
          tested_draft_rev: run.draft_rev,
        },
        proposedOps: fold.operations,
        confidence: null,
        confidenceBasis: {
          method: LLM_UNSCORED,
          inputs: {
            alias: provenance.alias,
            resolution_version: provenance.resolutionVersion,
            validated_ops: fold.operations.length,
          },
        },
      },
    ]);

    return { ok: true, suggestion: dryRunSuggestion(row) };
  }

  /**
   * A finished dry run as the copilot is told about it — the rows, the totals and what the
   * rules already suggested, so the model reasons over the results and does not repeat a rule.
   *
   * @param run - The dry run.
   * @returns The message, or `undefined` when the run did not end with results or its ticket
   *   is gone.
   */
  async debriefing(run: DryRun): Promise<string | undefined> {
    if (!RULE_STATUSES.includes(run.status)) return undefined;

    const [stages, ticket, filed] = await Promise.all([
      this.dryRuns.stages(run.id),
      this.dryRuns.ticket(run.organization_id, run.ticket_id),
      this.suggestions.forRun(run.id),
    ]);
    if (ticket === undefined) return undefined;

    const rows = stages.map((stage) => {
      const skip =
        stage.skip_kind === null
          ? ""
          : ` [${stage.skip_kind}${stage.skip_input === null ? "" : `: ${stage.skip_input}`}]`;
      return `- ${stage.stage_key}: ${stage.verdict} (${stage.how})${skip}${stage.note === "" ? "" : ` — ${stage.note}`}`;
    });
    const rules = filed
      .filter((row) => row.source === "rule")
      .map((row) => `- ${row.title} (rule ${row.rule_id ?? ""})`);
    const cost = run.cost_cents === null ? "unpriced" : dollars(run.cost_cents);

    return [
      `[dry run results — reported by the system, not typed by the user]`,
      `The dry run of draft ${dryRunDraftLabel(run.base_version, run.draft_rev)} against ${ticket.external_key} ("${ticket.title}") ended ${run.status}: cost ${cost}, guards ${run.guards_clean ? "clean" : "NOT clean"}.`,
      `Result rows:`,
      ...rows,
      rules.length === 0
        ? `The rule pack made no suggestion.`
        : `A rule already made these suggestions — do not repeat them:`,
      ...rules,
      `Tell the user in one or two sentences how the run went. If the rows show a further improvement no rule covered, propose it with propose_suggestion (exact operations, no confidence); otherwise propose nothing.`,
    ].join("\n");
  }

  /**
   * A dry run of a workflow, org-scoped.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param dryRunId - The dry run.
   * @returns The row.
   * @throws {NotFoundError} `workflow_not_found`, `dry_run_not_found`.
   */
  private async requireRun(
    organizationId: string,
    workflowId: string,
    dryRunId: string,
  ): Promise<DryRun> {
    const workflow = await this.dryRuns.workflow(organizationId, workflowId);
    if (workflow === undefined) throw workflowNotFound(workflowId);

    const run = await this.dryRuns.find(organizationId, workflow.id, dryRunId);
    if (run === undefined) throw dryRunNotFound(dryRunId);

    return run;
  }
}
