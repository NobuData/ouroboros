/**
 * The investigation loop's control-plane half — the service behind
 * `/internal/research/investigations/:id/*` (CM.1,
 * [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * The engine runs the loop; this owns what the loop leaves behind:
 *
 *   start       queued → running (or a running one resumed as a new attempt), provenance
 *               recorded, and the checkpoint and ledger handed back
 *   checkpoint  the loop's state after a step, plus the model usage since the last one; the
 *               answer says whether a person asked for the run to stop
 *   brief       the brief, its claims and the playbook's deliverable inputs → brief_ready
 *   finish      failed (with a reason) or cancelled — the ledger, checkpoint and usage kept
 *
 * **The citation rule is enforced here as well as in the engine and the database.** A finding
 * with no source is `422 brief_claim_uncited`; a citation naming a source that is not in *this
 * investigation's* ledger — a claim's or a deliverable's — is `422 brief_source_unknown`. The
 * engine's gate should make both impossible; if it ever stops, this is what turns a confident
 * uncited brief into a refusal instead of a page.
 *
 * **Actuals are never taken from the caller.** Sources used and spend are computed from the
 * ledger and the usage rows in the transaction that ends the run (`investigation-loop.repository.ts`).
 */

import { Injectable, Logger } from "@nestjs/common";

import type {
  BriefBodyDocument,
  InvestigationActualsDocument,
  InvestigationDeliverable,
} from "../../db/schema";
import { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import { MatrixBuilderService } from "../briefs/matrix-builder.service";
import { ResearchEstimateService } from "../estimate.service";
import { RESEARCH_ERRORS, investigationNotFound } from "../research.errors";
import { investigationNotRunning } from "../tools/research-tool.errors";
import type {
  BriefDto,
  CheckpointDto,
  FinishDto,
  StartDto,
  UsageDto,
} from "./investigation-loop.dto";
import {
  briefInvalid,
  checkpointStale,
  checkpointTooLarge,
  claimUncited,
  deliverableUnexpected,
  endingInvalid,
  notRunnable,
  sourceUnknown,
} from "./investigation-loop.errors";
import {
  InvestigationLoopRepository,
  type ClaimWrite,
  type InvestigationLoopStore,
  type LedgerSource,
  type Refused,
  type UsageRow,
} from "./investigation-loop.repository";

/** The most a checkpoint may weigh, in bytes — V120's `investigation_loops_checkpoint_shape`. */
export const MAX_CHECKPOINT_BYTES = 2_097_152;

/** The most a deliverable input may weigh, in bytes — V120's payload check. */
export const MAX_DELIVERABLE_BYTES = 524_288;

/** How deep a deliverable input is searched for citations; deeper is refused. */
export const MAX_DELIVERABLE_DEPTH = 16;

/** The key a deliverable's items list their `source_records` ids under. */
const SOURCES_KEY = "sources";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SPAN_REF = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The answer to a start. */
export interface StartedResource {
  /** `RS-127`. */
  readonly investigation: string;
  readonly attempt: number;
  readonly checkpoint: Record<string, unknown> | null;
  readonly checkpointSeq: number;
  readonly durationMs: number;
  readonly cancelRequested: boolean;
  readonly sources: readonly LedgerSource[];
}

/** The answer to a checkpoint. */
export interface CheckpointResource {
  readonly cancelRequested: boolean;
}

/** What a run used, in this service's names. */
export interface ActualsResource {
  readonly sourcesUsed: number;
  readonly spendCents: number | null;
  readonly durationMs: number;
}

/** The answer to a delivery or an ending. */
export interface EndedResource {
  /** `RS-127`. */
  readonly investigation: string;
  readonly status: string;
  readonly actuals: ActualsResource;
  /** The brief, when one was delivered. */
  readonly brief: { readonly id: string; readonly version: number } | null;
}

@Injectable()
export class InvestigationLoopService {
  private readonly logger = new Logger(InvestigationLoopService.name);
  private readonly store: InvestigationLoopStore;

  /**
   * @param repository - Loop state, the ledger and the brief.
   * @param estimates - Records estimate vs actuals once a run has delivered.
   * @param matrices - Builds a gap analysis's capability matrix from its delivered input.
   */
  constructor(
    repository: InvestigationLoopRepository,
    private readonly estimates: ResearchEstimateService,
    private readonly matrices: MatrixBuilderService,
  ) {
    this.store = repository;
  }

  /**
   * Claim a queued investigation, or resume a running one as a new attempt.
   *
   * @param investigationId - The investigation.
   * @param request - The researcher, its alias and the engine task.
   * @returns The attempt, the checkpoint to continue from and the ledger so far.
   * @throws {NotFoundError} `investigation_not_found`.
   * @throws {ConflictError} `investigation_not_runnable` once it has ended.
   */
  async start(investigationId: string, request: StartDto): Promise<StartedResource> {
    const started = await this.store.start(investigationId, {
      loopVersion: request.loopVersion,
      alias: request.alias,
      resolutionRef: request.resolutionRef ?? null,
      task: request.task,
    });

    if (started.outcome === "not_found") throw investigationNotFound(investigationId);
    if (started.outcome === "not_runnable") {
      throw notRunnable(started.displayId, started.status);
    }

    if (started.attempt > 1) {
      this.logger.warn(
        `${started.displayId} resumed as attempt ${started.attempt.toString()} from checkpoint ${started.checkpointSeq.toString()}`,
      );
    }

    return {
      investigation: started.displayId,
      attempt: started.attempt,
      checkpoint: started.checkpoint,
      checkpointSeq: started.checkpointSeq,
      durationMs: started.durationMs,
      cancelRequested: started.cancelRequested,
      sources: await this.store.ledger(investigationId),
    };
  }

  /**
   * Save the loop's state after a step.
   *
   * @param investigationId - The investigation.
   * @param request - The state, the working time and the usage since the last write.
   * @returns Whether a person asked for the run to stop.
   * @throws {ConflictError} `investigation_checkpoint_stale` from a replaced attempt or a
   *   repeated write; `investigation_not_running` once it has ended.
   * @throws {InvalidRequestError} `investigation_checkpoint_too_large`.
   */
  async checkpoint(investigationId: string, request: CheckpointDto): Promise<CheckpointResource> {
    assertCheckpointFits(request.checkpoint);

    const saved = await this.store.checkpoint(investigationId, {
      attempt: request.attempt,
      seq: request.seq,
      checkpoint: request.checkpoint,
      durationMs: request.durationMs,
      usage: request.usage.map(usageRow),
    });
    if (saved.outcome !== "saved") throw refusal(investigationId, request.attempt, saved);

    return { cancelRequested: saved.cancelRequested };
  }

  /**
   * Deliver the brief; the investigation becomes `brief_ready`.
   *
   * @param investigationId - The investigation.
   * @param request - The brief, its claims and the deliverable inputs.
   * @returns The brief's version and the actuals recorded.
   * @throws {InvalidRequestError} `brief_invalid`, `brief_claim_uncited`,
   *   `brief_source_unknown` or `brief_deliverable_unexpected`.
   * @throws {ConflictError} `investigation_checkpoint_stale` or `investigation_not_running`.
   */
  async deliver(investigationId: string, request: BriefDto): Promise<EndedResource> {
    const investigation = await this.store.find(investigationId);
    if (investigation === undefined) throw investigationNotFound(investigationId);

    const body = briefBody(request.body);
    const claims = briefClaims(body, request);
    const expected = investigation.playbook.deliverables.filter(
      (deliverable): deliverable is InvestigationDeliverable => deliverable !== "brief",
    );
    const deliverables = deliverableInputs(request.deliverables, expected);

    // Every citation — a claim's or a deliverable item's — names a record of this ledger.
    const cited = new Map<string, string[]>();
    for (const claim of claims) cited.set(`claim ${claim.ref}`, [...claim.sources]);
    for (const [deliverable, payload] of deliverables) {
      cited.set(deliverable, citedSources(payload));
    }
    const known = await this.store.knownSources(investigationId, [
      ...new Set([...cited.values()].flat()),
    ]);
    for (const [where, sources] of cited) {
      const unknown = sources.filter((source) => !known.has(source));
      if (unknown.length > 0) throw sourceUnknown(where, unknown);
    }

    const ended = await this.store.deliver(investigationId, {
      attempt: request.attempt,
      durationMs: request.durationMs,
      usage: request.usage.map(usageRow),
      body,
      claims,
      deliverables,
    });
    if (ended.outcome !== "ended") throw refusal(investigationId, request.attempt, ended);

    const demoted = claims.filter((claim) => claim.demoted).length;
    const findings = claims.filter((claim) => claim.type === "finding").length;
    this.logger.log(
      `${ended.displayId} delivered brief v${(ended.brief?.version ?? 0).toString()}: ` +
        `${findings.toString()} findings, ${(claims.length - findings).toString()} open questions` +
        (demoted > 0 ? ` (${demoted.toString()} demoted — uncited)` : ""),
    );

    await this.reconcile(ended.organizationId, investigationId, ended.displayId);
    if (deliverables.has("matrix")) {
      await this.buildMatrix(ended.organizationId, investigationId, ended.displayId);
    }

    return ended_(ended.displayId, ended.status, ended.actuals, ended.brief);
  }

  /**
   * End a run as `failed` or `cancelled`. What it gathered is kept.
   *
   * @param investigationId - The investigation.
   * @param request - The outcome, its reason and the final state.
   * @returns The actuals recorded.
   * @throws {InvalidRequestError} `investigation_ending_invalid`.
   * @throws {ConflictError} `investigation_checkpoint_stale` or `investigation_not_running`.
   */
  async finish(investigationId: string, request: FinishDto): Promise<EndedResource> {
    const failed = request.outcome === "failed";
    if (failed && (request.reason === undefined || request.detail === undefined)) {
      throw endingInvalid("a failed investigation needs a reason and a detail");
    }
    if (!failed && (request.reason !== undefined || request.detail !== undefined)) {
      throw endingInvalid("a cancelled investigation has no failure reason");
    }
    assertCheckpointFits(request.checkpoint);

    const ended = await this.store.finish(investigationId, {
      attempt: request.attempt,
      outcome: request.outcome,
      reason: failed ? (request.reason ?? null) : null,
      detail: failed ? (request.detail ?? null) : null,
      durationMs: request.durationMs,
      usage: request.usage.map(usageRow),
      seq: request.seq,
      checkpoint: request.checkpoint,
    });
    if (ended.outcome !== "ended") throw refusal(investigationId, request.attempt, ended);

    this.logger.warn(
      `${ended.displayId} ${request.outcome}` +
        (failed ? ` (${request.reason ?? ""})` : "") +
        ` after ${ended.actuals.sources_used.toString()} sources; partials kept`,
    );

    return ended_(ended.displayId, ended.status, ended.actuals, null);
  }

  /**
   * Build the capability matrix from the matrix input just stored (CM.2, #621). Never fails a
   * delivery: the brief is written and stands on its own, and a matrix the builder refuses —
   * an incomplete row, an uncited cell — is logged with its reason rather than stored in part.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @param displayId - `RS-127`, for the log.
   */
  private async buildMatrix(
    organizationId: string,
    investigationId: string,
    displayId: string,
  ): Promise<void> {
    try {
      await this.matrices.build(organizationId, investigationId);
    } catch (error) {
      this.logger.error(
        `${displayId}'s capability matrix could not be built from its input.`,
        describeForLog(error),
      );
    }
  }

  /**
   * Record estimate vs actuals for calibration. Never fails a delivery: the brief is written,
   * and an investigation that was never estimated simply has nothing to compare.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @param displayId - `RS-127`, for the log.
   */
  private async reconcile(
    organizationId: string,
    investigationId: string,
    displayId: string,
  ): Promise<void> {
    try {
      await this.estimates.reconcile(organizationId, investigationId);
    } catch (error) {
      if (error instanceof DomainError && error.code === RESEARCH_ERRORS.outcomeUnavailable) return;
      this.logger.error(
        `${displayId}'s estimate could not be reconciled with its actuals.`,
        describeForLog(error),
      );
    }
  }
}

/**
 * @param displayId - `RS-127`.
 * @param status - Where it ended.
 * @param actuals - What it used.
 * @param brief - The brief, when one was delivered.
 * @returns The resource.
 */
function ended_(
  displayId: string,
  status: string,
  actuals: InvestigationActualsDocument,
  brief: { readonly id: string; readonly version: number } | null,
): EndedResource {
  return {
    investigation: displayId,
    status,
    actuals: {
      sourcesUsed: actuals.sources_used,
      spendCents: actuals.spend_cents,
      durationMs: actuals.duration_ms,
    },
    brief,
  };
}

/**
 * The refusal a store outcome is.
 *
 * @param investigationId - The investigation, as the caller named it.
 * @param attempt - The attempt that wrote.
 * @param refused - The outcome.
 * @returns The error to throw.
 */
function refusal(investigationId: string, attempt: number, refused: Refused): DomainError {
  switch (refused.outcome) {
    case "not_found":
      return investigationNotFound(investigationId);
    case "not_running":
      return investigationNotRunning(refused.displayId, refused.status);
    case "stale":
      return checkpointStale(refused.displayId, attempt);
  }
}

/**
 * @param usage - A validated usage entry.
 * @returns The row to record.
 */
function usageRow(usage: UsageDto): UsageRow {
  return {
    seq: usage.seq,
    stage: usage.stage,
    alias: usage.alias,
    hop: usage.hop,
    connection: usage.connection,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costCents: usage.costCents ?? null,
  };
}

/**
 * @param checkpoint - The engine's state.
 * @throws {InvalidRequestError} `investigation_checkpoint_too_large`.
 */
function assertCheckpointFits(checkpoint: Record<string, unknown>): void {
  const bytes = Buffer.byteLength(JSON.stringify(checkpoint), "utf8");
  if (bytes > MAX_CHECKPOINT_BYTES) throw checkpointTooLarge(bytes, MAX_CHECKPOINT_BYTES);
}

/**
 * Read a brief body, keeping exactly V108's shape: paragraphs of spans, a span being `{text}`
 * or `{text, claim}`.
 *
 * @param candidate - The request's `body`.
 * @returns The body to store.
 * @throws {InvalidRequestError} `brief_invalid`.
 */
export function briefBody(candidate: Record<string, unknown>): BriefBodyDocument {
  const paragraphs = candidate.paragraphs;
  if (
    Object.keys(candidate).length !== 1 ||
    !Array.isArray(paragraphs) ||
    paragraphs.length === 0
  ) {
    throw briefInvalid("a brief body is {paragraphs: [...]} with at least one paragraph");
  }

  const refs = new Set<string>();
  return {
    paragraphs: paragraphs.map((paragraph: unknown) => {
      const spans = isRecord(paragraph) ? paragraph.spans : undefined;
      if (
        !isRecord(paragraph) ||
        Object.keys(paragraph).length !== 1 ||
        !Array.isArray(spans) ||
        spans.length === 0
      ) {
        throw briefInvalid("a paragraph is {spans: [...]} with at least one span");
      }

      return {
        spans: spans.map((span: unknown) => {
          if (!isRecord(span) || typeof span.text !== "string" || span.text.trim() === "") {
            throw briefInvalid("a span has non-blank text");
          }
          if (Object.keys(span).some((key) => key !== "text" && key !== "claim")) {
            throw briefInvalid("a span is {text} or {text, claim}");
          }
          if (span.claim === undefined) return { text: span.text };
          if (typeof span.claim !== "string" || !SPAN_REF.test(span.claim)) {
            throw briefInvalid("a span's claim is a span ref");
          }
          if (refs.has(span.claim)) {
            throw briefInvalid(`claim span ${span.claim} is stated twice`);
          }
          refs.add(span.claim);
          return { text: span.text, claim: span.claim };
        }),
      };
    }),
  };
}

/**
 * Hold a brief's claims to its body and to the citation rule.
 *
 * @param body - The validated body.
 * @param request - The delivery.
 * @returns The claims to store, each claim's sources distinct.
 * @throws {InvalidRequestError} `brief_invalid` when spans and claims disagree or a finding is
 *   marked demoted; `brief_claim_uncited` when a finding cites nothing.
 */
export function briefClaims(body: BriefBodyDocument, request: BriefDto): ClaimWrite[] {
  const stated = new Set(
    body.paragraphs.flatMap((paragraph) =>
      paragraph.spans.flatMap((span) => (span.claim === undefined ? [] : [span.claim])),
    ),
  );
  const seen = new Set<string>();

  const claims = request.claims.map((claim): ClaimWrite => {
    if (seen.has(claim.ref)) throw briefInvalid(`claim ${claim.ref} is written twice`);
    seen.add(claim.ref);
    if (!stated.has(claim.ref)) {
      throw briefInvalid(`claim ${claim.ref} is not stated by a span of the body`);
    }

    const sources = [...new Set(claim.sources.map((source) => source.toLowerCase()))];
    const demoted = claim.demoted === true;
    if (claim.type === "finding") {
      if (sources.length === 0) throw claimUncited(claim.ref);
      if (demoted) throw briefInvalid(`claim ${claim.ref} is a finding and cannot be demoted`);
    }

    return { ref: claim.ref, type: claim.type, text: claim.text, sources, demoted };
  });

  for (const ref of stated) {
    if (!seen.has(ref)) throw briefInvalid(`span ${ref} states a claim that was not written`);
  }

  return claims;
}

/**
 * Read the deliverable inputs, holding them to what the playbook produces.
 *
 * @param candidate - The request's `deliverables`.
 * @param expected - The playbook's deliverables besides the brief.
 * @returns The inputs, by deliverable.
 * @throws {InvalidRequestError} `brief_deliverable_unexpected` for a key the playbook does not
 *   produce; `brief_invalid` for an input that is not an object or is too large.
 */
export function deliverableInputs(
  candidate: Record<string, unknown>,
  expected: readonly InvestigationDeliverable[],
): Map<InvestigationDeliverable, Record<string, unknown>> {
  const inputs = new Map<InvestigationDeliverable, Record<string, unknown>>();

  for (const [key, payload] of Object.entries(candidate)) {
    const deliverable = expected.find((name) => name === key);
    if (deliverable === undefined) throw deliverableUnexpected(key, expected);
    if (!isRecord(payload)) throw briefInvalid(`the ${key} input is an object`);
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_DELIVERABLE_BYTES) {
      throw briefInvalid(
        `the ${key} input is larger than ${MAX_DELIVERABLE_BYTES.toString()} bytes`,
      );
    }
    inputs.set(deliverable, payload);
  }

  return inputs;
}

/**
 * Every source a deliverable input cites — the strings under any `sources` key, at any depth.
 *
 * @param payload - The input.
 * @returns The distinct ids, lower-cased.
 * @throws {InvalidRequestError} `brief_invalid` when a `sources` entry is not a source id, or the
 *   input nests deeper than {@link MAX_DELIVERABLE_DEPTH}.
 */
export function citedSources(payload: Record<string, unknown>): string[] {
  const found = new Set<string>();

  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DELIVERABLE_DEPTH) {
      throw briefInvalid("a deliverable input nests too deeply");
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, item] of Object.entries(value)) {
      if (key !== SOURCES_KEY) {
        walk(item, depth + 1);
        continue;
      }
      if (!Array.isArray(item) || item.some((id) => typeof id !== "string" || !UUID.test(id))) {
        throw briefInvalid("a deliverable's sources are source record ids");
      }
      for (const id of item as string[]) found.add(id.toLowerCase());
    }
  };
  walk(payload, 0);

  return [...found];
}

/**
 * @param value - Anything.
 * @returns Whether it is a plain JSON object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
