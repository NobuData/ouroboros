/**
 * `/ouro dry-run <ticket> [workflow]` — rehearse with no writes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537), per its #562 amendment).
 *
 * One write: `DryRunsService.start`, which is what `POST /api/v1/workflows/:id/dry-runs` calls.
 * The harness's guards are what make *"no writes, no PRs"* a property rather than a promise, and
 * they are the service's — this file adds no path around them and writes nothing else.
 *
 * ```
 * workflow   the slug typed, else the one trigger evaluation pins for the ticket (#143)
 * draft      WorkflowsService.draftBase → the workflow's id and the revision to rehearse
 * start      DryRunsService.start(ticketId, draftRev)            → the acknowledgement
 * ending     DryRunAftermath tells every registered listener      → the result message
 * ```
 *
 * **The command is slow, so it does not pretend.** `run` answers as soon as the run is recorded
 * as started; what it found follows as its own message when {@link DryRunAftermath} reports the
 * ending — the registration the copilot uses for its debrief. If the harness deadline
 * ({@link ENGINE_DRY_RUN_TIMEOUT_MS}) passes with nothing heard — a restart, a lost process — the
 * promise still settles, with a reply that claims no result.
 */

import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { BacklogDetailService } from "../../backlog/detail.service";
import type { DryRun } from "../../db/schema";
import { DryRunAftermath } from "../../dry-runs/dry-runs.aftermath";
import { DryRunsService } from "../../dry-runs/dry-runs.service";
import { DryRunSuggestionsService } from "../../dry-runs/suggestions.service";
import { ENGINE_DRY_RUN_TIMEOUT_MS } from "../../engine/engine.dryruns";
import { DomainError } from "../../errors/error.envelope";
import { WorkflowRegistryService } from "../../workflows/registry.service";
import { TriggerService } from "../../workflows/trigger.service";
import { WORKFLOW_ERRORS } from "../../workflows/workflows.errors";
import { WorkflowsService } from "../../workflows/workflows.service";
import type {
  BindingResult,
  CommandBinding,
  CommandContext,
  CommandReply,
  ReplyLink,
} from "../grammar.types";
import { argument, optionalArgument, ticketReference } from "./binding.arguments";
import { draftAbsentForDryRun, ticketNotCanonical, workflowUndecided } from "./planes.errors";
import { copilotLink, DRY_RUN_STARTED, dryRunResult, dryRunStillRunning } from "./replies";

/** How many ended runs are remembered for a command that has not yet started listening. */
const REMEMBERED_ENDINGS = 32;

/** A command waiting to hear its run ended. */
interface Waiter {
  readonly settle: (run: DryRun | undefined) => void;
  readonly timer: NodeJS.Timeout;
}

@Injectable()
export class DryRunBinding implements CommandBinding, OnModuleInit, OnModuleDestroy {
  readonly command = "dry-run";

  /** The commands waiting on a run, by dry-run id. */
  private readonly waiting = new Map<string, Waiter>();

  /**
   * Runs that ended with nobody waiting yet, newest last. A run can end between `start`
   * returning and this binding listening for it; this is where that ending is found.
   */
  private readonly ended = new Map<string, DryRun>();

  /**
   * @param dryRuns - The dry-run service — the one write.
   * @param aftermath - Where a run's ending is announced.
   * @param suggestions - The suggestions a run filed, for the result's count.
   * @param workflows - The workflow and its draft revision, by slug.
   * @param triggers - Which workflow claims a ticket when none was typed.
   * @param registry - The workflows the workspace offers, for the refusal that lists them.
   * @param backlog - The issue's labels and estimate, which trigger evaluation reads.
   */
  constructor(
    private readonly dryRuns: DryRunsService,
    private readonly aftermath: DryRunAftermath,
    private readonly suggestions: DryRunSuggestionsService,
    private readonly workflows: WorkflowsService,
    private readonly triggers: TriggerService,
    private readonly registry: WorkflowRegistryService,
    private readonly backlog: BacklogDetailService,
  ) {}

  /** Ask to be told when a dry run ends — the registration the copilot's debrief uses. */
  onModuleInit(): void {
    this.aftermath.register((run) => {
      this.heard(run);

      return Promise.resolve();
    });
  }

  /** Settle every command still waiting, so a shutdown leaves no promise pending. */
  onModuleDestroy(): void {
    for (const [id, waiter] of this.waiting) {
      clearTimeout(waiter.timer);
      this.waiting.delete(id);
      waiter.settle(undefined);
    }
  }

  /**
   * Start the dry run and acknowledge it.
   *
   * @param context - The invocation.
   * @returns `started`, with the result to follow — or `done` when the run ended at once
   *   (the draft failed its pre-check, so there is nothing to wait for).
   * @throws {InvalidRequestError} `chat_ticket_not_canonical`, `chat_workflow_undecided`.
   * @throws {DomainError} The planes' own refusals: `workflow_not_found`,
   *   `workflow_draft_absent`, `dry_run_in_progress`, `dry_run_source_unsupported`, …
   */
  async run(context: CommandContext): Promise<BindingResult> {
    const { organizationId } = context;
    const ticket = argument(context, "ticket", "ticket");
    const typed = optionalArgument(context, "workflow", "workflow");
    const reference = ticketReference(ticket);

    if (ticket.ticketId === null) {
      throw ticketNotCanonical(`${ticket.repository}${reference}`);
    }

    const slug = typed?.slug ?? (await this.pinned(organizationId, ticket.issueId, reference));
    const { workflow } = await this.workflows.draftBase(organizationId, slug);
    const link = copilotLink(context.appUrl, slug);
    const subject = `${slug} on ${reference}`;

    let started;
    try {
      started = await this.dryRuns.start(organizationId, workflow.id, {
        ticketId: ticket.ticketId,
        draftRev: workflow.draft_rev,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === WORKFLOW_ERRORS.draftAbsent) {
        throw draftAbsentForDryRun(error.code, slug);
      }
      throw error;
    }

    const ref = { dryRunId: started.id, workflow: slug, issueNumber: ticket.number };

    if (started.status !== "running" && started.status !== "precheck") {
      return {
        kind: "done",
        reply: dryRunResult(
          subject,
          {
            status: started.status,
            failureReason: started.failureReason,
            durationMs: started.totals.durationMs,
            costCents: started.totals.costCents,
            guardsClean: started.guardsClean,
            guardBlocks: started.guardAudit.length,
            suggestions: null,
          },
          link,
        ),
        ref,
      };
    }

    return {
      kind: "started",
      reply: { text: DRY_RUN_STARTED, link },
      ref,
      result: this.heardFrom(started.id).then((run) => this.result(run, subject, link)),
    };
  }

  /**
   * The workflow trigger evaluation pins for a ticket nobody named a workflow for.
   *
   * @param organizationId - The workspace.
   * @param issueId - The mirrored issue.
   * @param reference - The issue, for the refusal.
   * @returns The slug.
   * @throws {InvalidRequestError} `chat_workflow_undecided` when no trigger matches and the issue
   *   has no estimate to suggest one.
   */
  private async pinned(
    organizationId: string,
    issueId: string,
    reference: string,
  ): Promise<string> {
    const { issue, estimate } = await this.backlog.detailOf(organizationId, issueId);
    const [pin] = await this.triggers.pin(
      organizationId,
      [
        {
          source: "github",
          labels: issue.labels,
          effort: estimate?.effort ?? null,
          suggestedWorkflow: estimate?.suggestedWorkflow ?? "",
        },
      ],
      undefined,
    );

    if (pin === undefined || pin.slug === "") {
      const offered = await this.registry.offered(organizationId);

      throw workflowUndecided(reference, offered.slugs);
    }

    return pin.slug;
  }

  /**
   * The ending of one run, when it is heard — or `undefined` at the harness deadline.
   *
   * @param dryRunId - The run.
   * @returns The run as it ended, or `undefined` when nothing was heard in time.
   */
  private heardFrom(dryRunId: string): Promise<DryRun | undefined> {
    const already = this.ended.get(dryRunId);

    if (already !== undefined) {
      this.ended.delete(dryRunId);

      return Promise.resolve(already);
    }

    return new Promise((settle) => {
      const timer = setTimeout(() => {
        this.waiting.delete(dryRunId);
        settle(undefined);
      }, ENGINE_DRY_RUN_TIMEOUT_MS);

      // A waiting command must not hold the process open.
      timer.unref();
      this.waiting.set(dryRunId, { settle, timer });
    });
  }

  /**
   * A dry run ended: settle the command waiting on it, or remember it for one about to.
   *
   * @param run - The run, as it ended.
   */
  private heard(run: DryRun): void {
    const waiter = this.waiting.get(run.id);

    if (waiter !== undefined) {
      clearTimeout(waiter.timer);
      this.waiting.delete(run.id);
      waiter.settle(run);

      return;
    }

    this.ended.set(run.id, run);

    const [oldest] = this.ended.keys();
    if (this.ended.size > REMEMBERED_ENDINGS && oldest !== undefined) this.ended.delete(oldest);
  }

  /**
   * The message that follows the acknowledgement.
   *
   * @param run - The run as it ended, or `undefined` when the deadline passed first.
   * @param subject - What ran — `standard-fix on #486`.
   * @param link - The Copilot page.
   * @returns The result, or the honest "not yet".
   */
  private async result(
    run: DryRun | undefined,
    subject: string,
    link: ReplyLink,
  ): Promise<CommandReply> {
    if (run === undefined) return dryRunStillRunning(subject, link);

    return dryRunResult(
      subject,
      {
        status: run.status,
        failureReason: run.failure_reason,
        durationMs: run.duration_ms === null ? null : Number(run.duration_ms),
        costCents: run.cost_cents,
        guardsClean: run.guards_clean,
        guardBlocks: run.guard_audit.length,
        suggestions: await this.suggestionCount(run),
      },
      link,
    );
  }

  /**
   * How many suggestions the run filed — one read, and never a reason to lose the result.
   *
   * @param run - The run.
   * @returns The count, or `null` when it could not be read.
   */
  private async suggestionCount(run: DryRun): Promise<number | null> {
    try {
      const filed = await this.suggestions.list(run.organization_id, run.workflow_id, run.id);

      return filed.suggestions.length;
    } catch {
      return null;
    }
  }
}
