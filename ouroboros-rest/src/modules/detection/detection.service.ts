/**
 * `DetectionService` — `RepoDetectionService` of the issue: scan a repository through the provider
 * SPI, store the card's rows, and keep the tests row honest
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1).
 *
 * ```
 * start(org, repo)
 *   ├─ running already?        → join it                         (progress observable)
 *   ├─ started < 30 s ago?     → 409 detection_rescan_too_soon   (debounced, #101's discipline)
 *   ├─ a source that covers it → registry.find(kind) · supportsRepoProbes · coversRepo
 *   └─ background: withCredentials ─▶ runScan(packs, prober, budget)
 *                  ─▶ reconcile tests with the test plane ─▶ recordScan (scan_seq n+1)
 *
 * read(org, repo)  → newest scan + rows (tests row relabelled measured when #324 has data)
 * ```
 *
 * **A scan runs in the background and the request returns at once**, with the progress the card
 * polls. Progress and the debounce clock are in memory, per process, as the source sync's are: what
 * survives a restart is the stored scan, and a restart is a reason a re-scan may go ahead early —
 * which costs a few requests, not correctness.
 *
 * **The credential is opened once for the scan** by `TicketSourcesService.withCredentials`, exactly
 * as the intake loop and the PR sync open it, and dropped when the scan's probes are done.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { retryAfterSeconds } from "../backlog/debounce";
import { describeForLog } from "../errors/failure";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { RepoFile, RepoTree } from "../ticket-sources/ticket-source.probe";
import {
  supportsRepoProbes,
  type ProbeCapableProvider,
  type TicketSyncContext,
} from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import { rescanTooSoon, scanNotFound, sourceMissing } from "./detection.errors";
import type { ProbeSpec, ProbeValue } from "./detection.pack";
import { reconcileRows, measuredTestsRow } from "./detection.reconcile";
import { RulePackRegistry } from "./detection.registry";
import { DetectionRepository, type DetectionStore, type StoredScan } from "./detection.repository";
import {
  detectionResource,
  type DetectionResource,
  type RescanResource,
  type ScanProgressResource,
} from "./detection.resources";
import {
  DEFAULT_SCAN_BUDGET,
  runScan,
  type DetectionRow,
  type Prober,
  type ScanBudget,
} from "./detection.scan";

/** The injection token for the scan budget — `DEFAULT_SCAN_BUDGET` unless a module says otherwise. */
export const SCAN_BUDGET = "DETECTION_SCAN_BUDGET";

/**
 * The shortest gap between two scans of one repository a person may cause — thirty seconds,
 * measured from the last scan's start. A scan is a burst of up to `maxProbes` requests on the
 * connection the backlog sync depends on, and the button is one somebody clicks out of impatience.
 */
export const RESCAN_INTERVAL_SECONDS = 30;

/** What opens a source's credential for one call — `TicketSourcesService.withCredentials`. */
export interface DetectionSourceOpener {
  /**
   * @param source - The source.
   * @param run - What to do with the opened context.
   * @returns What `run` returned.
   */
  withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T>;
}

/** A scan of this process: its progress, and the promise that settles with it. */
interface ScanEntry {
  progress: ScanProgressResource;
  settled: Promise<void>;
}

@Injectable()
export class DetectionService {
  /** Where a failed scan is reported. Never a credential. */
  private readonly logger = new Logger(DetectionService.name);

  /** The newest scan of each `(workspace, repository)` this process started. */
  private readonly scans = new Map<string, ScanEntry>();

  /**
   * @param store - The statements.
   * @param registry - The ticket-source providers, by kind.
   * @param sources - What opens a source's credential for the scan.
   * @param packs - The rule packs.
   * @param budget - The scan's bounds.
   */
  constructor(
    @Inject(DetectionRepository) private readonly store: DetectionStore,
    private readonly registry: TicketSourceRegistry,
    @Inject(TicketSourcesService) private readonly sources: DetectionSourceOpener,
    private readonly packs: RulePackRegistry,
    @Inject(SCAN_BUDGET) private readonly budget: ScanBudget = DEFAULT_SCAN_BUDGET,
  ) {}

  /**
   * Start a scan of a repository — or join the one already running.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared lower-case.
   * @param now - The clock.
   * @returns The progress, and whether this request joined a running scan.
   * @throws {ConflictError} `detection_rescan_too_soon` inside the debounce window;
   *   `detection_source_missing` when no source can probe the repository.
   */
  async start(
    organizationId: string,
    repo: string,
    now: Date = new Date(),
  ): Promise<RescanResource> {
    const ref = repo.toLowerCase();
    const key = scanKey(organizationId, ref);
    const existing = this.scans.get(key);

    if (existing?.progress.state === "running") {
      return { progress: existing.progress, joined: true };
    }

    const wait =
      existing === undefined
        ? undefined
        : retryAfterSeconds(new Date(existing.progress.startedAt), now, RESCAN_INTERVAL_SECONDS);

    if (wait !== undefined) {
      throw rescanTooSoon(wait);
    }

    const { source, provider } = await this.prober(organizationId, ref);
    const raced = this.scans.get(key);

    // Another request started this repository's scan while the source was being looked up.
    if (raced !== existing && raced?.progress.state === "running") {
      return { progress: raced.progress, joined: true };
    }

    const progress: ScanProgressResource = {
      state: "running",
      startedAt: now.toISOString(),
      finishedAt: null,
      probesPlanned: 0,
      probesSettled: 0,
      scanSeq: null,
      error: null,
    };
    const entry: ScanEntry = { progress, settled: Promise.resolve() };

    // Registered before the scan begins, so a read or a second click sees it running at once.
    this.scans.set(key, entry);
    entry.settled = this.execute(organizationId, ref, source, provider, (next) => {
      entry.progress = { ...entry.progress, ...next };
    });

    return { progress, joined: false };
  }

  /**
   * The newest scan of a repository, its rows, its policies and the in-process progress.
   *
   * The tests row is reconciled on the way out: when the test plane has a completed run for the
   * repository and the stored row is still `detected`, it is relabelled `measured` — stored, so
   * every later read agrees.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @returns The resource. Never a 404: a repository never scanned reads as no scan.
   */
  async read(organizationId: string, repo: string): Promise<DetectionResource> {
    const ref = repo.toLowerCase();
    const stored = await this.reconciled(
      organizationId,
      ref,
      await this.store.scan(organizationId, ref),
    );

    return detectionResource(
      ref,
      stored,
      await this.store.policies(organizationId, ref),
      this.scans.get(scanKey(organizationId, ref))?.progress ?? null,
    );
  }

  /**
   * One earlier scan, as it was stored — the prior scan stays readable after a re-scan.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param scanSeq - The scan.
   * @returns The resource.
   * @throws {NotFoundError} `detection_scan_not_found`.
   */
  async readScan(
    organizationId: string,
    repo: string,
    scanSeq: number,
  ): Promise<DetectionResource> {
    const ref = repo.toLowerCase();
    const stored = await this.store.scan(organizationId, ref, scanSeq);

    if (stored === undefined) {
      throw scanNotFound(ref, scanSeq);
    }

    return detectionResource(ref, stored, await this.store.policies(organizationId, ref), null);
  }

  /**
   * Wait for the scan this process last started for a repository to settle. For tests and for a
   * caller that wants the rows rather than the progress.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @returns When it has settled; at once when none was started.
   */
  async settled(organizationId: string, repo: string): Promise<void> {
    await this.scans.get(scanKey(organizationId, repo.toLowerCase()))?.settled;
  }

  /**
   * Read a few files of a repository through the source a scan would ride — the probe machinery
   * other features reuse (BF.4's rule-file import,
   * [#413](https://github.com/NobuData/ouroboros/issues/413)). One credential opening, one host
   * request per path, in order; no debounce, because it writes nothing.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared lower-case.
   * @param paths - The files, each one `isProbePath` admits.
   * @returns Each path's file, or `null` where the repository has none.
   * @throws {ConflictError} `detection_source_missing` when nothing connected can probe it.
   * @throws {TicketSourceError} When the host refuses a request — `rate_limit` above all.
   */
  async readFiles(
    organizationId: string,
    repo: string,
    paths: readonly string[],
  ): Promise<Map<string, RepoFile | null>> {
    const ref = repo.toLowerCase();
    const { source, provider } = await this.prober(organizationId, ref);

    return this.sources.withCredentials(source, async (context) => {
      const files = new Map<string, RepoFile | null>();

      for (const path of paths) {
        files.set(path, await provider.repoFile(context, ref, path));
      }

      return files;
    });
  }

  /**
   * List a repository's tree, then read the few files a caller picks from it — one credential
   * opening, one tree request, one request per picked path (BF.6's repo-map generator,
   * [#415](https://github.com/NobuData/ouroboros/issues/415)). No debounce, because it writes
   * nothing; the caller bounds how often it asks.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared lower-case.
   * @param pick - Which paths to read, given the tree — each one `isProbePath` admits.
   * @returns The tree, and each picked path's file (`null` where the host has none).
   * @throws {ConflictError} `detection_source_missing` when nothing connected can probe it.
   * @throws {TicketSourceError} When the host refuses a request — `rate_limit` above all. Nothing
   *   after the refusal is sent.
   */
  async readTree(
    organizationId: string,
    repo: string,
    pick: (tree: RepoTree) => readonly string[],
  ): Promise<{ tree: RepoTree; files: Map<string, RepoFile | null> }> {
    const ref = repo.toLowerCase();
    const { source, provider } = await this.prober(organizationId, ref);

    return this.sources.withCredentials(source, async (context) => {
      const tree = await provider.repoTree(context, ref);
      const files = new Map<string, RepoFile | null>();

      for (const path of pick(tree)) {
        files.set(path, await provider.repoFile(context, ref, path));
      }

      return { tree, files };
    });
  }

  /**
   * The source a scan rides, and its provider — the first that can probe and covers the
   * repository.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The source and its provider.
   * @throws {ConflictError} `detection_source_missing`.
   */
  private async prober(
    organizationId: string,
    repo: string,
  ): Promise<{ source: SyncSource; provider: ProbeCapableProvider }> {
    for (const source of await this.store.candidateSources(organizationId)) {
      const provider = this.registry.find(source.kind);

      if (
        provider !== undefined &&
        supportsRepoProbes(provider) &&
        provider.coversRepo(source.config, repo)
      ) {
        return { source, provider };
      }
    }

    throw sourceMissing(repo);
  }

  /**
   * The scan itself: probe, reconcile, store. Never rejects — a failure is the progress's.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param source - The source it rides.
   * @param provider - The source's provider.
   * @param update - Where progress goes.
   */
  private async execute(
    organizationId: string,
    repo: string,
    source: SyncSource,
    provider: ProbeCapableProvider,
    update: (progress: Partial<ScanProgressResource>) => void,
  ): Promise<void> {
    try {
      const outcome = await this.sources.withCredentials(source, (context) =>
        runScan(this.packs.all(), proberFor(provider, context, repo), {
          budget: this.budget,
          onProgress: ({ planned, settled }) => {
            update({ probesPlanned: planned, probesSettled: settled });
          },
        }),
      );
      const rows = reconcileRows(
        outcome.rows,
        await this.store.measuredTests(organizationId, repo),
      );
      const scanSeq = await this.store.recordScan({
        organizationId,
        repo,
        durationMs: outcome.durationMs,
        packVersions: outcome.packVersions,
        probesUsed: outcome.probesUsed,
        rows,
        protectedPaths: outcome.protectedPaths,
      });

      update({ state: "done", scanSeq, finishedAt: new Date().toISOString() });
    } catch (error) {
      const reason = TicketSourceError.is(error)
        ? `the source refused (${error.errorClass})`
        : "the scan could not be stored";

      this.logger.warn(`Scan of ${repo} failed: ${reason}.`, describeForLog(error));
      update({ state: "failed", error: reason, finishedAt: new Date().toISOString() });
    }
  }

  /**
   * A stored scan with its tests row relabelled `measured` when the test plane now has results.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param stored - The scan, or undefined.
   * @returns The scan, with the relabel applied (and stored) when one was due.
   */
  private async reconciled(
    organizationId: string,
    repo: string,
    stored: StoredScan | undefined,
  ): Promise<StoredScan | undefined> {
    const tests = stored?.rows.find((row) => row.row_key === "tests");

    if (stored === undefined || tests === undefined || tests.label !== "detected") {
      return stored;
    }

    const measured = await this.store.measuredTests(organizationId, repo);

    if (measured === undefined) {
      return stored;
    }

    const detected: DetectionRow = {
      rowKey: "tests",
      verdict: tests.verdict,
      value: tests.value,
      evidence: (tests.evidence ?? {}) as Record<string, unknown>,
      confidence: "medium",
      label: "detected",
    };
    const row = measuredTestsRow(measured, detected);

    await this.store.relabelTests(organizationId, repo, stored.scan.scan_seq, row);

    return {
      scan: stored.scan,
      rows: stored.rows.map((candidate) =>
        candidate === tests
          ? {
              ...tests,
              verdict: row.verdict,
              value: row.value,
              evidence: row.evidence,
              label: row.label,
            }
          : candidate,
      ),
    };
  }
}

/**
 * The prober a scan uses: each probe spec, as the provider's member for it.
 *
 * @param provider - The source's provider.
 * @param context - The source, opened.
 * @param repo - `owner/name`.
 * @returns The prober.
 */
export function proberFor(
  provider: ProbeCapableProvider,
  context: TicketSyncContext,
  repo: string,
): Prober {
  return (probe: ProbeSpec): Promise<ProbeValue> => {
    switch (probe.kind) {
      case "languages":
        return provider.repoLanguages(context, repo);
      case "tree":
        return provider.repoTree(context, repo);
      case "file":
        return provider.repoFile(context, repo, probe.path);
    }
  };
}

/**
 * The in-memory key of a repository's scans.
 *
 * @param organizationId - The workspace.
 * @param repo - `owner/name`, lower-case.
 * @returns The key.
 */
function scanKey(organizationId: string, repo: string): string {
  return `${organizationId}\u001f${repo}`;
}
