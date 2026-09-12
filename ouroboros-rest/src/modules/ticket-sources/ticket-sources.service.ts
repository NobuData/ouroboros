/**
 * `TicketSourcesService` — the generalized sync loop, and the file the *"zero provider-specific
 * branches"* criterion is really about.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)), roadmap decisions **P5** and
 * **P6**.
 *
 * ```
 * for each active source:
 *   registry.find(kind)      ─ nothing? skip, and leave the row alone
 *   open the credential      ─ sealed column → plaintext, for the length of one call
 *   cursor === null          ─ fullSync(ctx)  :  incrementalSync(ctx, cursor)
 *   applySync(page)          ─ one transaction: rows, cursor, synced_at, status
 *   intake.accept(new)       ─ after the commit, never inside it
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## There is no `kind` anywhere below this line, and that is the point
 *
 * The issue is blunt about why the discipline needs enforcing: *"it decays the first time
 * someone adds `if (source.kind === 'github')` to the sync loop because it was quicker"*. So
 * the only thing this file does with a kind is hand it to {@link TicketSourceRegistry.find},
 * and everything a tracker differs by — how to authenticate, what a page is, what the cursor
 * means, which states collapse to `closed`, what counts as a rate limit — is behind
 * `TicketSourceProvider`. `.dependency-cruiser.cjs`'s `ticket-source-core-imports-the-spi-only`
 * is the half a reviewer does not have to remember, and `boundary.spec.ts` is what proves that
 * rule still bites.
 *
 * ## A full sync and an incremental one differ by one thing: whether a cursor exists
 *
 * `backlog-sync.service.ts` has a table here describing how the two GitHub calls differ —
 * `state=open` against `state=all`, `since` present or absent — because that module *is* the
 * GitHub client. This one has nothing to say about it. A stored cursor means
 * {@link TicketSourceProvider.incrementalSync} and no stored cursor means
 * {@link TicketSourceProvider.fullSync}; what those two ask a tracker is the provider's
 * business, and V030's nullable `sync_cursor` is what makes the distinction a fact about a row
 * rather than a flag somebody has to maintain.
 *
 * ## Skipped, failed and synced are three outcomes, and only two of them touch the row
 *
 * A source whose kind has no provider in this build is **skipped**: reported, logged once, and
 * its row left exactly as it was. A source whose provider threw is **failed**: `status` and
 * V031's `status_reason` are written, and nothing else — not `synced_at`, which would claim a
 * poll that did not happen. A source that synced has its rows, its cursor, its stamp and its
 * status written in one transaction, and that transaction is also what clears a previous
 * failure. `sync.report.ts` carries the argument for the first distinction and
 * `ticket-sources.repository.ts` for the third.
 *
 * ## The credential is opened for one call and is never anywhere else
 *
 * Q.2's fifth acceptance criterion. {@link TicketSourcesService.withCredentials} is the whole
 * of it: the sealed column is read, `VaultService` opens it, and the plaintext goes into a
 * {@link TicketSyncContext} that exists for the length of one provider call. Nothing here logs
 * a context, a config or a credential — every log line below names a source by its
 * `display_name` and its id — and `ticket-sources.service.spec.ts` asserts that against a
 * captured transcript with a credential-shaped fixture rather than trusting it.
 *
 * A string cannot be zeroized; JavaScript strings are immutable and the runtime may have copied
 * one anywhere. `vault.service.ts` documents that weaker guarantee for `decryptText` and this
 * inherits it. What is available instead is *narrowness*, and it is structural rather than
 * performed: one local in one frame, one call, no field on this class to hold one, and no
 * cache. See {@link TicketSourcesService.withCredentials} on why there is deliberately no
 * clearing assignment pretending to be more.
 *
 * ## Nothing is ever a silent no-op
 *
 * The property `backlog-sync/sync.report.ts` insisted on, kept here with a smaller vocabulary
 * because the SPI absorbed most of it. Every active source appears in the cycle report with
 * exactly one of: numbers, a skip, or a failure class and the sentence a person will read.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../errors/failure";
import { chunked } from "../scheduling/cadence";
import { VaultService } from "../vault/vault.service";
import { SOURCE_CONCURRENCY } from "./cadence";
import {
  SOURCE_SKIPPED_UNSUPPORTED,
  SOURCE_SKIP_MESSAGES,
  type SourceSyncOutcome,
  type SyncCycleReport,
} from "./sync.report";
import {
  TICKET_SOURCE_ERROR_STATUS,
  TicketSourceError,
  statusReasonFor,
} from "./ticket-source.errors";
import type { TicketPage, TicketSyncContext } from "./ticket-source.provider";
import { TicketSourceRegistry } from "./ticket-source.registry";
import { TicketSourcesRepository, type SyncSource } from "./ticket-sources.repository";
import { TICKET_INTAKE, type TicketIntake } from "./ticket.intake";

/**
 * What a sync that was not attempted or did not survive produced.
 *
 * The empty counters every outcome starts from, so the three branches below differ by what they
 * *add* rather than by each spelling six zeroes.
 */
const NOTHING = {
  imported: 0,
  updated: 0,
  unchanged: 0,
  skippedClosed: 0,
  enqueued: 0,
  hasMore: false,
} as const;

@Injectable()
export class TicketSourcesService {
  /** Where a skipped source, a failed sync and a broken handoff are reported. */
  private readonly logger = new Logger(TicketSourcesService.name);

  /**
   * The most recent cycle, or `undefined` before the first one has run.
   *
   * Held so that Q.4's ([#141](https://github.com/NobuData/ouroboros/issues/141)) status
   * endpoint has something to answer *"what happened last time"* with. The durable half of the
   * answer is in the row — `synced_at`, `sync_cursor`, `status`, `status_reason` — and this is
   * the half that is about the *cycle* rather than about any source: what was skipped, and what
   * a page contained. `backlog-sync.service.ts` holds its last report for the same reason.
   */
  private lastReport?: SyncCycleReport;

  /**
   * @param sources - The statements. The only thing here that touches the database.
   * @param registry - Where a provider comes from, and the only thing here that knows a kind.
   * @param vault - What opens a sealed credential. Injected rather than reached through the
   *   repository, because the repository's job is rows and this one's is secrets — and because
   *   a repository that could decrypt would be a repository whose `select *` was dangerous.
   * @param intake - Where new and reopened tickets go next. A token, so Q.3 re-points it by
   *   changing one `provide` — see `ticket.intake.ts`.
   */
  constructor(
    private readonly sources: TicketSourcesRepository,
    private readonly registry: TicketSourceRegistry,
    private readonly vault: VaultService,
    @Inject(TICKET_INTAKE) private readonly intake: TicketIntake,
  ) {}

  /**
   * What the last cycle did.
   *
   * @returns The report, or `undefined` before the first cycle. Not a fabricated empty one: *no
   *   cycle has run yet* and *a cycle ran and found nothing* are different facts, and the
   *   surface that renders freshness has to be able to tell them apart.
   */
  lastCycle(): SyncCycleReport | undefined {
    return this.lastReport;
  }

  /**
   * One cycle: every active source in every workspace.
   *
   * @returns What each source did. Never rejects for anything a provider did — those are
   *   failures in the report — so what can reach a caller's `catch` is this deployment's own
   *   database being unavailable, which is the scheduler's to log and survive.
   */
  async cycle(): Promise<SyncCycleReport> {
    // One instant for the whole cycle. Every freshness stamp it writes is this, so *"synced 40s
    // ago"* means the same thing for every source a cycle touched rather than drifting by
    // however long the cycle took.
    const startedAt = new Date();
    const active = await this.sources.activeSources();
    const outcomes: SourceSyncOutcome[] = [];

    // Chunked rather than `Promise.all` over everything: `cadence.ts` argues the bound, and the
    // shape is `scheduling/cadence.ts`'s, shared with the two loops that came before.
    for (const run of chunked(active, SOURCE_CONCURRENCY)) {
      outcomes.push(
        ...(await Promise.all(run.map(async (source) => this.sync(source, startedAt)))),
      );
    }

    const report: SyncCycleReport = {
      startedAt,
      sources: outcomes,
      pending: outcomes.some((outcome) => outcome.hasMore),
    };

    this.lastReport = report;

    return report;
  }

  /**
   * Sync one source.
   *
   * @param source - The source, as the cross-workspace read found it.
   * @param syncedAt - The cycle's clock.
   * @returns What happened — numbers, a skip, or a failure. Never rejects: every branch below
   *   turns what it caught into one of the three.
   */
  private async sync(source: SyncSource, syncedAt: Date): Promise<SourceSyncOutcome> {
    const provider = this.registry.find(source.kind);

    if (provider === undefined) {
      // Logged at `debug` rather than `warn`, and once per source per cycle. It is not a
      // problem with this deployment — it is a release that has not happened — and a loop that
      // warned about it every interval would train an operator to ignore the channel that also
      // carries the failures below. See `sync.report.ts`.
      this.logger.debug(
        `${source.displayName}: ${SOURCE_SKIP_MESSAGES[SOURCE_SKIPPED_UNSUPPORTED]}`,
      );

      return { ...identityOf(source), ...NOTHING, skipped: SOURCE_SKIPPED_UNSUPPORTED };
    }

    let page: TicketPage;

    try {
      page = await this.withCredentials(source, async (context) =>
        source.cursor === null
          ? provider.fullSync(context)
          : provider.incrementalSync(context, source.cursor),
      );
    } catch (error) {
      return this.fail(source, error);
    }

    const written = await this.sources.applySync({
      source,
      tickets: page.tickets,
      cursor: page.nextCursor,
      syncedAt,
    });

    // **After** the commit, never inside it: a ticket announced to a queue and then rolled back
    // is a queue holding a row that does not exist. A handoff that throws costs the handoff and
    // not the sync — the rows are already stored, and the next cycle will not re-offer them, so
    // the honest thing is to say so loudly rather than to fail a cycle that succeeded.
    try {
      await this.intake.accept(written.estimable);
    } catch (error) {
      this.logger.error(
        `${source.displayName}: ${String(written.estimable.length)} ticket(s) were stored but ` +
          "could not be handed to the estimation pipeline.",
        describeForLog(error),
      );
    }

    return {
      ...identityOf(source),
      imported: written.imported,
      updated: written.updated,
      unchanged: written.unchanged,
      skippedClosed: written.skippedClosed,
      enqueued: written.estimable.length,
      hasMore: page.hasMore,
      syncedAt,
      ...(page.nextCursor === null ? {} : { cursor: page.nextCursor }),
    };
  }

  /**
   * Open a source's credential, run one provider call with it, and drop it.
   *
   * The mechanism behind *"credentials are decrypted only inside provider calls"*. The
   * plaintext exists as one local, inside one `try`, for the length of one `await`.
   *
   * The vault's record id is the **source id**, which is what `VaultService` binds into the
   * ciphertext's AAD together with the workspace — so a credential lifted from one source's row
   * and pasted into another's fails to open rather than decrypting into somebody else's
   * tracker. Q.4 has to seal with the same pair for that to hold, and it is the natural one: a
   * source's credential belongs to the source.
   *
   * **There is no `finally` that clears the variable, and that is deliberate.** A JavaScript
   * string cannot be zeroized — see this file's header — so an assignment here would clear one
   * reference out of however many the runtime has made and would read, to the next person, as a
   * guarantee that had been given. What is actually available is *narrowness*, and it is
   * structural: the plaintext exists as one local in one frame, it is handed to one call, and
   * nothing in this class has a field to put it in. A provider that keeps it past its own call
   * is a provider bug, which is why the SPI says so.
   *
   * @param source - The source.
   * @param run - What to do with the opened context.
   * @returns Whatever `run` returned.
   * @throws {TicketSourceError} `auth`, when the envelope will not open — a workspace whose key
   *   is gone, an envelope sealed under a version this deployment cannot reach. That is the
   *   honest class: from the outside it is indistinguishable from a credential that no longer
   *   works, and it is fixed in the same place.
   */
  private async withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T> {
    const sealed = await this.sources.sealedCredential(source.sourceId);
    const credentials = sealed === null ? null : await this.open(source, sealed);

    return run({
      sourceId: source.sourceId,
      organizationId: source.organizationId,
      config: source.config,
      credentials,
    });
  }

  /**
   * Open one sealed credential.
   *
   * @param source - Whose it is. The workspace and the source id are what `VaultService` binds
   *   into the ciphertext's additional authenticated data, so passing the wrong pair fails to
   *   decrypt rather than decrypting somebody else's value.
   * @param sealed - The envelope, as the column holds it.
   * @returns The plaintext.
   * @throws {TicketSourceError} `auth` — see {@link withCredentials}.
   */
  private async open(source: SyncSource, sealed: string): Promise<string> {
    try {
      return await this.vault.decryptText(source.organizationId, source.sourceId, sealed);
    } catch (error) {
      // `describeForLog` rather than the error itself, and nothing from `sealed`: a vault
      // failure's message can name a key version, and nothing about a ciphertext belongs in a
      // log line that an operator will paste into a ticket.
      this.logger.error(
        `${source.displayName}: the stored credential could not be opened.`,
        describeForLog(error),
      );

      throw new TicketSourceError("auth", "the stored credential could not be opened");
    }
  }

  /**
   * Turn whatever a provider threw into a failure, and record it on the source.
   *
   * @param source - The source that failed.
   * @param error - Whatever was caught.
   * @returns The outcome. Never rejects: a source whose status could not even be written is
   *   logged and reported as the failure it was, because a cycle that gave up here would lose
   *   the other sources in its chunk.
   */
  private async fail(source: SyncSource, error: unknown): Promise<SourceSyncOutcome> {
    // A provider that threw something else has a bug, and `upstream` is the honest reading of
    // it from here: something on the far side of the SPI did not work, and this side cannot say
    // more than that. Deliberately not swallowed into a skip — the sync really did fail, and a
    // row that said otherwise would be the silent no-op this loop is not allowed to have.
    const failure = TicketSourceError.is(error)
      ? error
      : new TicketSourceError("upstream", "the provider failed in a way it does not describe");

    const reason = statusReasonFor(failure);
    const status = TICKET_SOURCE_ERROR_STATUS[failure.errorClass];

    this.logger.warn(
      `${source.displayName}: sync failed — ${reason} (${failure.errorClass}).`,
      // The provider's own words, which are allowed to be specific because a log is not a
      // settings row. Only present when the value was really a `TicketSourceError`; for
      // anything else the runtime's shape is more use than a sentence this file invented.
      TicketSourceError.is(error) ? failure.detail : describeForLog(error),
    );

    try {
      await this.sources.markFailure(source.sourceId, status, reason);
    } catch (writeError) {
      this.logger.error(
        `${source.displayName}: the failure above could not be recorded on the source.`,
        describeForLog(writeError),
      );
    }

    return {
      ...identityOf(source),
      ...NOTHING,
      failure: { errorClass: failure.errorClass, reason },
    };
  }
}

/**
 * How a source appears in the cycle report.
 *
 * Four fields of the row, and deliberately not the row: `config` is a provider's business and
 * a report is a thing that gets logged, so a cycle that carried one would put somebody's base
 * URL and project keys into a log line the moment a report was stringified.
 *
 * @param source - The source.
 * @returns The identifying half of an outcome.
 */
function identityOf(
  source: SyncSource,
): Pick<SourceSyncOutcome, "organizationId" | "sourceId" | "kind" | "displayName"> {
  return {
    organizationId: source.organizationId,
    sourceId: source.sourceId,
    kind: source.kind,
    displayName: source.displayName,
  };
}
