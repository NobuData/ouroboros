/**
 * Where a newly ingested ticket goes next — the source-neutral half of the *"before you ever
 * ask it to work"* handoff.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)). The issue asks the sync loop
 * to *"hand new or updated rows to the estimation pipeline (intake #107)"*, and this is the
 * port it hands them through.
 *
 * ---------------------------------------------------------------------------
 * **Why this is a second port rather than a reuse of `backlog-sync/estimation.intake.ts`.**
 *
 * That port's `EstimableIssue` carries `githubRepoId` and a numeric `number`, and its
 * `issueId` is `github_issues.id` — three fields the canonical model deliberately does not
 * have, pointing at a table the canonical model deliberately is not. Handing a `tickets.id`
 * to `EstimationOrchestrator.accept` would queue a uuid that `estimation.repository.ts` then
 * looks up in `github_issues` and does not find; the pipeline would log a miss per ticket and
 * size nothing.
 *
 * That file said this would happen, and said so as the reason it stayed where it was:
 *
 *   > it is what the **sync** depends on, and a port that lives with its consumer is a port a
 *   > second implementation can be written against — which is what Q.3's ticket-source
 *   > providers will need when GitHub stops being the only thing that fills this table.
 *
 * ---------------------------------------------------------------------------
 * **It is bound to a placeholder that logs, and that is this ticket's whole position on the
 * cut-over.**
 *
 * `estimation.intake.ts` shipped exactly this way under K.4 and stayed that way until L.3 built
 * the queue; the shape is the module's own precedent rather than an improvisation. What makes
 * it right *here* is that the estimation pipeline is not a queue that needs writing — it exists
 * — it is a pipeline **bound to the wrong table**. Moving it means re-pointing
 * `issue_estimates` at `tickets.id`, and that is a migration and a cut-over of every intake
 * read, which the roadmap assigns to Q.3 (#140) — *"the ticket that changes the writer"* — and
 * V030's own header says the same:
 *
 *   > A migration that copied nine rows into `tickets` while the shipped sync kept writing
 *   > `github_issues` would not deliver the canonical model; it would deliver two records of
 *   > the same backlog.
 *
 * The same is true one layer up. A loop that queued canonical tickets into a pipeline keyed on
 * `github_issues` would not deliver the handoff; it would deliver a log full of misses. So the
 * port is declared, the loop hands over exactly the tickets it should, after the transaction
 * that stored them has committed, and what receives them today says so out loud — see
 * {@link LoggingTicketIntake}. Q.3 changes one `provide` and nothing else in this module moves,
 * which is the property a port is for.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { TicketSourceKind } from "../db/schema";

/** Why a ticket is being handed over. */
export type TicketIntakeReason = "imported" | "reopened";

/** One ticket being handed to the estimation pipeline. */
export interface EstimableTicket {
  /** The workspace, so the pipeline can resolve a model and a budget without a second read. */
  readonly organizationId: string;
  /** `tickets.id` — the row to estimate, and what an estimate will be versioned against. */
  readonly ticketId: string;
  /** `ticket_sources.id` — which tracker it came from. */
  readonly sourceId: string;
  /**
   * The source's kind.
   *
   * Carried because a pipeline may legitimately want it — R.1's trigger predicates
   * ([#143](https://github.com/NobuData/ouroboros/issues/143)) match on *source kind* among
   * other things — and because it is free here and a join there. It is **not** a licence for a
   * consumer to branch on the tracker for behaviour; what it identifies is provenance.
   */
  readonly sourceKind: TicketSourceKind;
  /**
   * The display form — `#485`, `PROJ-142` — for a log line a person can follow to the tracker.
   *
   * The key rather than the id, because the key is the one somebody can paste into their
   * tracker's search box. See V030 on why those are two columns.
   */
  readonly externalKey: string;
  /**
   * Why it is being estimated: it is new to this mirror, or it has reopened.
   *
   * Carried because the two are different events to a queue that may want to prioritise or
   * de-duplicate — and because *"reopened"* is a fact the sync knows and nothing downstream
   * could recover from the row alone.
   */
  readonly reason: TicketIntakeReason;
}

/**
 * The port the sync loop hands new work to.
 *
 * One method, and it takes a batch rather than a ticket: a sync produces a page's worth at
 * once, and a queue that wants to bound its own admission needs to see them together.
 */
export interface TicketIntake {
  /**
   * Take these tickets into the estimation pipeline.
   *
   * Called **after** the transaction that stored them has committed, so an implementation may
   * assume every row it is told about exists.
   *
   * @param tickets - The new and reopened tickets, in the order the provider listed them. May
   *   be empty, which is the common case: most syncs change nothing.
   * @returns When the pipeline has accepted them. An implementation that rejects must not throw
   *   for a reason the loop could not act on — the sync has already committed, and a failure
   *   here costs the handoff rather than the mirror.
   */
  accept(tickets: readonly EstimableTicket[]): Promise<void>;
}

/** The Nest token {@link TicketIntake} is bound under. */
export const TICKET_INTAKE = "TICKET_INTAKE";

/**
 * What is bound to {@link TICKET_INTAKE} until Q.3 re-points the estimation pipeline at
 * `tickets`.
 *
 * It logs and returns. Not a silent no-op and not a `throw`, and both halves of that are
 * deliberate: a silent port makes *"the handoff happens"* unobservable, which is the one thing
 * the suites here need to be able to see; and a throwing port would cost a committed sync its
 * cycle for a step that has nothing yet to do.
 *
 * **It is also the thing that makes the gap legible from a running process.** An operator who
 * turns this loop on with a provider registered sees one line per page saying that tickets were
 * ingested and where they stopped — which is a more honest description of this build than a
 * queue that accepted them and did nothing. See this file's header for why the cut-over is
 * Q.3's rather than this ticket's.
 */
@Injectable()
export class LoggingTicketIntake implements TicketIntake {
  /** Where the handoff is reported. */
  private readonly logger = new Logger(LoggingTicketIntake.name);

  /**
   * Report the tickets that would be estimated.
   *
   * @param tickets - The new and reopened tickets.
   * @returns Immediately. Nothing is queued — see this class's header.
   */
  accept(tickets: readonly EstimableTicket[]): Promise<void> {
    if (tickets.length === 0) {
      return Promise.resolve();
    }

    const imported = tickets.filter((ticket) => ticket.reason === "imported").length;

    this.logger.log(
      `${String(tickets.length)} canonical ticket(s) ready to estimate ` +
        `(${String(imported)} new, ${String(tickets.length - imported)} reopened); ` +
        "the estimation pipeline still reads github_issues, so nothing was queued — Q.3 (#140) " +
        "is the cut-over.",
    );

    return Promise.resolve();
  }
}
