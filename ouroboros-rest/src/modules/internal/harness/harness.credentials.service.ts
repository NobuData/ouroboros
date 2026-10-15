/**
 * Minting, revoking, checking and reconciling run-scoped credentials — DH.2
 * ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * ```
 * mint(run, stage, alias, attempt) ─▶ token (once) · id · expiresAt          internal key
 * revoke(id)                       ─▶ revoked_at                              internal key
 * authenticate(headers)            ─▶ the credential, or a facade refusal     the token itself
 * reconcile(id, harness totals)    ─▶ per-model recorded / reported / difference, stored
 * ```
 *
 * A credential is bound to one live run: one whose run has finished is refused, and so is one
 * presented beside an `x-ouroboros-run` header naming another run — the header is optional, and
 * a stage adapter that sends it (`ANTHROPIC_CUSTOM_HEADERS`) gets the extra check.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { TERMINAL_RUN_STATUSES } from "../../db/schema";
import { InvalidRequestError, NotFoundError } from "../../errors/error.envelope";
import { invokeRunNotFound } from "../internal.errors";
import { digestOfPresented, issue, type MintedCredential } from "./harness.credential";
import { facadeRefusal, type FacadeRefusal } from "./harness.errors";
import {
  HarnessRepository,
  type RecordedUsage,
  type CredentialBinding,
} from "./harness.repository";

/** The clock a suite can bind; the system clock when nothing is. */
export const HARNESS_CLOCK = Symbol("HARNESS_CLOCK");

/** The header a stage adapter may send to bind a call to its run as well as its credential. */
export const HARNESS_RUN_HEADER = "x-ouroboros-run";

/** Token counts, as both sides of a reconciliation state them. */
export interface UsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/**
 * One model's totals as the harness reports them at session end — the Claude Agent SDK's
 * `modelUsage` entry, in its own field names.
 */
export interface ReportedModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
}

/** One model in a reconciliation. */
export interface ModelReconciliation {
  /** The key the harness reported under, or the recorded model the harness did not report. */
  readonly model: string;
  readonly recorded: UsageTotals;
  /** Null when the harness reported nothing for a model the facade recorded. */
  readonly reported: UsageTotals | null;
  /** `reported − recorded`, field by field. Zero everywhere when they agree. */
  readonly difference: UsageTotals;
  readonly matches: boolean;
  /** How many calls the facade recorded for it. */
  readonly calls: number;
}

/** A credential's reconciliation, as answered and as stored. */
export interface Reconciliation {
  /** The credential's id. */
  readonly id: string;
  /** True only when every model matches — a difference is surfaced, never averaged away. */
  readonly matches: boolean;
  readonly models: readonly ModelReconciliation[];
  readonly reconciledAt: string;
}

/** No tokens. */
const ZERO: UsageTotals = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

@Injectable()
export class HarnessCredentialsService {
  private readonly logger = new Logger(HarnessCredentialsService.name);

  constructor(
    private readonly repository: HarnessRepository,
    @Optional() @Inject(HARNESS_CLOCK) private readonly clock?: () => Date,
  ) {}

  /** @returns The time, from the bound clock or the system's. */
  private now(): Date {
    return this.clock === undefined ? new Date() : this.clock();
  }

  /**
   * Mint a credential for one stage attempt of one live run, bound to one alias.
   *
   * @param request - The run, the stage, the alias and the attempt.
   * @returns The credential, its token shown this once.
   * @throws {NotFoundError} `run_not_found` for no such run.
   * @throws {InvalidRequestError} `run_finished` for a run that has ended.
   */
  async mint(request: {
    run: string;
    stage: string;
    alias: string;
    attempt?: number;
  }): Promise<MintedCredential> {
    const run = await this.repository.runOf(request.run);

    if (run === undefined) {
      throw invokeRunNotFound(request.run);
    }

    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status)) {
      throw new InvalidRequestError("run_finished", "A credential is minted for a live run only.", {
        run: request.run,
      });
    }

    const issuance = issue(this.now());
    const attempt = request.attempt ?? 1;
    const id = await this.repository.insert({
      organizationId: run.organizationId,
      runId: request.run,
      stage: request.stage,
      alias: request.alias,
      attempt,
      digest: issuance.digest,
      expiresAt: issuance.expiresAt,
    });

    return issuance.minted({
      id,
      run: request.run,
      stage: request.stage,
      alias: request.alias,
      attempt,
    });
  }

  /**
   * Revoke a credential — at stage end.
   *
   * @param id - The credential.
   * @throws {NotFoundError} `credential_not_found`.
   */
  async revoke(id: string): Promise<void> {
    await this.require(id);
    await this.repository.revoke(id, this.now());
  }

  /**
   * The credential a facade request presents, or why it is refused.
   *
   * @param headers - The request headers, lower-cased.
   * @returns The credential, or a refusal to write.
   */
  async authenticate(
    headers: Readonly<Record<string, unknown>>,
  ): Promise<CredentialBinding | FacadeRefusal> {
    const presented = digestOfPresented(headers);
    const binding = presented === null ? undefined : await this.repository.byDigest(presented);

    if (binding === undefined) {
      return facadeRefusal(
        "credential_invalid",
        "Present a run-scoped credential minted by the control plane.",
      );
    }

    if (binding.revokedAt !== null) {
      return facadeRefusal(
        "credential_revoked",
        "This credential was revoked when its stage ended.",
      );
    }

    if (binding.expiresAt.getTime() <= this.now().getTime()) {
      return facadeRefusal("credential_expired", "This credential has expired.");
    }

    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(binding.runStatus)) {
      return facadeRefusal("run_finished", "This credential's run has finished.");
    }

    const run = headers[HARNESS_RUN_HEADER];

    if (run !== undefined && run !== binding.runId) {
      return facadeRefusal(
        "credential_run_mismatch",
        "This credential was minted for another run.",
      );
    }

    return binding;
  }

  /**
   * Compare the harness's per-model totals with what this credential's calls recorded.
   *
   * @param id - The credential.
   * @param reported - The harness's totals, keyed as it keys them — an alias or a model id.
   * @returns The comparison, also stored on the credential.
   * @throws {NotFoundError} `credential_not_found`.
   */
  async reconcile(
    id: string,
    reported: Readonly<Record<string, ReportedModelUsage>>,
  ): Promise<Reconciliation> {
    const binding = await this.require(id);
    const at = this.now();
    const reconciliation = {
      ...compare(await this.repository.recorded(binding), reported),
      id,
      reconciledAt: at.toISOString(),
    };

    await this.repository.reconciled(id, { ...reconciliation }, at);

    if (!reconciliation.matches) {
      this.logger.warn(
        `harness credential ${id} (run ${binding.runId}, stage ${binding.stage}): ` +
          "the harness's usage totals differ from the recorded usage — " +
          reconciliation.models
            .filter((model) => !model.matches)
            .map((model) => model.model)
            .join(", "),
      );
    }

    return reconciliation;
  }

  /**
   * A credential that must exist.
   *
   * @param id - The credential.
   * @returns It.
   * @throws {NotFoundError} `credential_not_found`.
   */
  private async require(id: string): Promise<CredentialBinding> {
    const binding = await this.repository.byId(id);

    if (binding === undefined) {
      throw new NotFoundError("credential_not_found", "No such harness credential.", { id });
    }

    return binding;
  }
}

/**
 * The comparison itself.
 *
 * A reported key matches the recorded rows whose model **or** alias is that key: the harness
 * asked for an alias and may report under it, or under the model the response named. Every
 * recorded row is used at most once; a recorded model the harness did not report is listed
 * with `reported: null`.
 *
 * @param recorded - The credential's recorded usage, per (alias, model).
 * @param reported - The harness's totals.
 * @returns Whether everything matches, and the models.
 */
export function compare(
  recorded: readonly RecordedUsage[],
  reported: Readonly<Record<string, ReportedModelUsage>>,
): { matches: boolean; models: ModelReconciliation[] } {
  const used = new Set<RecordedUsage>();
  const models: ModelReconciliation[] = [];

  for (const [key, usage] of Object.entries(reported)) {
    const rows = recorded.filter(
      (row) => !used.has(row) && (row.model === key || row.alias === key),
    );

    rows.forEach((row) => used.add(row));
    models.push(entry(key, rows, totalsOf(usage)));
  }

  for (const row of recorded.filter((candidate) => !used.has(candidate))) {
    models.push(entry(row.model, [row], null));
  }

  return { matches: models.every((model) => model.matches), models };
}

/**
 * One model's entry.
 *
 * @param model - The key.
 * @param rows - The recorded rows it matched.
 * @param reported - The harness's totals, or null.
 * @returns The entry.
 */
function entry(
  model: string,
  rows: readonly RecordedUsage[],
  reported: UsageTotals | null,
): ModelReconciliation {
  const recorded = rows.reduce<UsageTotals>(
    (sum, row) => ({
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + row.cacheWriteTokens,
    }),
    ZERO,
  );
  const against = reported ?? ZERO;
  const difference: UsageTotals = {
    inputTokens: against.inputTokens - recorded.inputTokens,
    outputTokens: against.outputTokens - recorded.outputTokens,
    cacheReadTokens: against.cacheReadTokens - recorded.cacheReadTokens,
    cacheWriteTokens: against.cacheWriteTokens - recorded.cacheWriteTokens,
  };

  return {
    model,
    recorded,
    reported,
    difference,
    matches: reported !== null && Object.values(difference).every((value) => value === 0),
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
  };
}

/**
 * The harness's figures in this service's field names.
 *
 * @param usage - One `modelUsage` entry.
 * @returns The totals.
 */
function totalsOf(usage: ReportedModelUsage): UsageTotals {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadInputTokens ?? 0,
    cacheWriteTokens: usage.cacheCreationInputTokens ?? 0,
  };
}
