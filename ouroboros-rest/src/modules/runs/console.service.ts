/**
 * The Run Console's reads — AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)).
 *
 * Mockup 10 asks for four things on three cadences, and conflating them makes the page either
 * slow or dishonest:
 *
 * ```
 * GET /runs/:id                 the snapshot: head, stepper, three cards      → read()
 * GET /runs/:id/events?after=   the tail: entries past the reader's cursor    → events()
 * GET /runs/:id/transcript.jsonl the export: the same rows, streamed as JSONL  → exportTranscript()
 * ```
 *
 * **Every read starts from `RunsRepository.find`**, the org-scoped lookup #71 built, so a run in
 * another workspace is a `404` indistinguishable from one that never existed — on all three
 * routes, by construction rather than by three checks.
 *
 * **Liveness is the run's state, never how recently an entry arrived** — the build log's rule
 * (`farm/logs/logs.service.ts`). A terminal run answers `live: false` the moment it is
 * terminal, so the `streaming` pill goes quiet with it; while it is live the tail is polled
 * every {@link RUN_EVENTS_POLL_LIVE_SECONDS}, which is honest liveness at that cadence rather
 * than a pill implying push (option **2-A**). SSE (AR.3, #317) replaces the transport, not
 * this contract.
 *
 * **The export is a projection, not a second serializer.** It writes the lines
 * `ouroboros.run_events_jsonl` renders — the view AO.2 pinned byte-for-byte to its fixture —
 * and adds exactly one thing, R4's watermark line, so the file somebody feeds to their own
 * tooling and the transcript the page draws come from one writer.
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { runSummary } from "../dashboard/resources";
import { ACTIVE_RUN_STATUSES, type Run, type RunStatus } from "../db/schema";
import {
  RUN_EVENTS_PAGE_DEFAULT,
  RUN_EVENTS_POLL_LIVE_SECONDS,
  RUN_EXPORT_BATCH,
  RUN_EXPORT_WATERMARK,
} from "./console.policy";
import { ConsoleRepository } from "./console.repository";
import {
  budgetStageOf,
  changesOf,
  entryOf,
  guardrailsOf,
  resourcesOf,
  timelineOf,
  type RouteCap,
  type RunConsoleResource,
  type RunEventsPage,
} from "./console.resources";
import { inheritedTaskOf } from "./console.route";
import { eventsCursorOutOfRange, runNotFound } from "./runs.errors";
import { RunsRepository } from "./runs.repository";

/** What the tenant context supplies about the workspace a read is made in. */
export interface ConsoleTenant {
  /** `organization.id`. */
  readonly id: string;
  /** `organization.slug` — the Guardrails footer's *tenant acme-robotics*. */
  readonly slug: string;
}

/** A transcript export, ready to stream. */
export interface TranscriptExport {
  /** The file name to offer — `loop-1847.jsonl`. */
  readonly filename: string;
  /**
   * The file's text, a batch at a time.
   *
   * Lazy: nothing is read until the first chunk is pulled, and each batch is read only once the
   * previous one has been consumed, so the memory held is one batch whatever the transcript's
   * length. Every chunk ends in a newline.
   */
  readonly chunks: AsyncIterable<string>;
}

/** The query of a tail read, after the pipe. */
export interface EventsCursor {
  /** The last `seq` the reader holds; `0` for the start. */
  readonly after?: number;
  /** The page size. */
  readonly limit?: number;
}

/**
 * Whether a status is one of the three a run still moves in.
 *
 * @param status - `runs.status`.
 * @returns `true` for `coding`, `building` and `review`.
 */
export function isLive(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

@Injectable()
export class ConsoleService {
  /**
   * @param runs - The org-scoped run lookup — the `404` rule.
   * @param console - Every other statement.
   * @param config - The shared poll cadence.
   */
  constructor(
    private readonly runs: RunsRepository,
    private readonly console: ConsoleRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The snapshot's clock — what `asOf` and a live run's elapsed time are measured to.
   *
   * A property rather than a call to `new Date()` inline, so a test can pin it and assert an
   * exact `elapsedSeconds`.
   */
  now: () => Date = () => new Date();

  /**
   * The console page.
   *
   * @param tenant - The workspace, from the tenant context.
   * @param id - The run.
   * @returns The head, the stepper and the three cards.
   * @throws {NotFoundError} `run_not_found` — absent, or another workspace's, indistinguishably.
   */
  async read(tenant: ConsoleTenant, id: string): Promise<RunConsoleResource> {
    const run = await this.find(tenant.id, id);
    const asOf = this.now();

    const [repository, stages, files, commits, spend, guardrails, reservation] = await Promise.all([
      this.console.repository(tenant.id, run.github_repo_id),
      this.console.stages(run.id),
      this.console.files(run.id),
      this.console.commits(run.id),
      this.console.spend(run.id),
      this.console.guardrails(run.id),
      run.reserved_build_job_id === null
        ? Promise.resolve(undefined)
        : this.console.reservation(tenant.id, run.reserved_build_job_id),
    ]);

    const budgetStage = budgetStageOf(stages);
    const route =
      budgetStage === undefined ? undefined : await this.routeOf(run, budgetStage.stage_key);

    return {
      asOf: asOf.toISOString(),
      run: runSummary(run),
      head: {
        loopSeq: run.loop_seq,
        workflowVersion: run.workflow_version_pin,
        branchName: run.branch_name,
        simulated: run.simulated,
        live: isLive(run.status),
        ...(repository === undefined ? {} : { repository }),
      },
      timeline: timelineOf(run.workflow_tag, run.workflow_version_pin, stages),
      changes: changesOf(files, commits, run.merge_strategy),
      resources: resourcesOf({
        spend,
        budgetStage,
        route,
        reservation,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        asOf,
      }),
      guardrails: guardrailsOf(guardrails, run.workflow_tag, run.workflow_version_pin, tenant.slug),
    };
  }

  /**
   * One page of the transcript's tail.
   *
   * The run's `event_seq` is read first and bounds the page, which is what keeps the cursor
   * exact while an executor is still writing — see `console.repository.ts`'s header.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The run.
   * @param cursor - `?after=` and `?limit=`.
   * @returns The entries past the cursor, the next cursor, and the liveness facts.
   * @throws {NotFoundError} `run_not_found` — absent, or another workspace's.
   * @throws {InvalidRequestError} `run_events_cursor_out_of_range` when `after` is past the end.
   */
  async events(organizationId: string, id: string, cursor: EventsCursor): Promise<RunEventsPage> {
    const run = await this.find(organizationId, id);
    const after = cursor.after ?? 0;
    const latestSeq = run.event_seq;

    if (after > latestSeq) {
      throw eventsCursorOutOfRange(latestSeq);
    }

    const rows = await this.console.events(
      run.id,
      after,
      latestSeq,
      cursor.limit ?? RUN_EVENTS_PAGE_DEFAULT,
    );

    const nextAfter = rows.length === 0 ? after : rows[rows.length - 1].seq;
    const live = isLive(run.status);

    return {
      runId: run.id,
      after,
      entries: rows.map(entryOf),
      nextAfter,
      latestSeq,
      hasMore: nextAfter < latestSeq,
      live,
      elided: run.events_elided_at !== null,
      pollAfter: live ? RUN_EVENTS_POLL_LIVE_SECONDS : this.config.dashboardPollSeconds,
    };
  }

  /**
   * The transcript as a JSONL file, streamed.
   *
   * The run is found — and a `404` raised — before anything is streamed, so a refusal is an
   * ordinary error envelope rather than a truncated download. The transcript is exported as it
   * stood at that moment: entries appended while the file is being written belong to the next
   * export, not to the tail of this one.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The run.
   * @returns The file name and its lazily read text.
   * @throws {NotFoundError} `run_not_found` — absent, or another workspace's.
   */
  async exportTranscript(organizationId: string, id: string): Promise<TranscriptExport> {
    const run = await this.find(organizationId, id);

    return {
      filename: `loop-${String(run.loop_seq)}.jsonl`,
      chunks: this.transcriptChunks(run.id, run.event_seq, run.simulated),
    };
  }

  /**
   * The export's text, one batch per chunk.
   *
   * @param run - `runs.id`.
   * @param upTo - `runs.event_seq` when the export began.
   * @param simulated - Whether to open with R4's watermark line.
   * @yields The watermark line (when flagged), then each batch's lines joined, newline-terminated.
   */
  private async *transcriptChunks(
    run: string,
    upTo: number,
    simulated: boolean,
  ): AsyncGenerator<string> {
    if (simulated) {
      yield `${RUN_EXPORT_WATERMARK}\n`;
    }

    let after = 0;

    while (after < upTo) {
      const batch = await this.console.jsonl(run, after, upTo, RUN_EXPORT_BATCH);

      if (batch.length === 0) {
        return;
      }

      yield batch.map((row) => `${row.line}\n`).join("");
      after = batch[batch.length - 1].seq;
    }
  }

  /**
   * The route whose cap applies to a stage — through the pinned document's `inherit_task`.
   *
   * @param run - The run.
   * @param stageKey - The budget stage's DSL node id.
   * @returns The route, or `undefined` when the run has no pin, the pin is unreadable, the stage
   *   pins a model, or the workspace has no such task kind — each of which the card renders as
   *   *no cap* rather than as a guess.
   */
  private async routeOf(run: Run, stageKey: string): Promise<RouteCap | undefined> {
    if (run.workflow_version_pin === null) {
      return undefined;
    }

    const pinned = await this.console.pinnedDefinition(
      run.organization_id,
      run.workflow_tag,
      run.workflow_version_pin,
    );
    const task = pinned === undefined ? undefined : inheritedTaskOf(pinned.definition, stageKey);

    return task === undefined ? undefined : this.console.routeCap(run.organization_id, task);
  }

  /**
   * The run, if it is this workspace's to see.
   *
   * @param organizationId - The workspace.
   * @param id - The run.
   * @returns The row.
   * @throws {NotFoundError} `run_not_found`.
   */
  private async find(organizationId: string, id: string): Promise<Run> {
    const run = await this.runs.find(organizationId, id);

    if (run === undefined) throw runNotFound(id);

    return run;
  }
}
