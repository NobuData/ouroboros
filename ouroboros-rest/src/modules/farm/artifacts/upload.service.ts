/**
 * The job-scoped artifact upload (AT.2, [#330](https://github.com/NobuData/ouroboros/issues/330),
 * decision **T4**) — how a build's results get off the runner, and what they become.
 *
 * ```
 * dispatch ─▶ forOffer(job)   mint a single-use token, hash it into the ledger, put it in the offer
 *
 * agent ─▶ POST /api/v1/farm/jobs/:id/artifacts   (HTTPS, never the control WebSocket)
 *   accept ─▶ token ✓ (job-scoped, unexpired, open) ─▶ manifest ✓ ─▶ caps ✓ ─▶ quota plan
 *          ─▶ each file: inspect (sha256 · size · head) ─▶ ArtifactStore.put ─▶ checksum ✓
 *          ─▶ the attempt (test_runs) ─▶ parse the result files (AT.1, #329)
 *          ─▶ close: test_artifacts rows + receipt (manifest · warnings) + attempt complete
 * ```
 *
 * **Nothing is dropped silently.** A file the agent cut to the per-file cap is stored and marked
 * truncated; a file it left behind, and a file the workspace's quota had no room for, are in the
 * receipt as skipped, with the reason — and each is a job **warning** the page renders. A quota
 * breach is never a job failure: losing a build over an artifact quota is the wrong trade.
 *
 * **A corrupted upload keeps nothing.** A checksum mismatch, a malformed manifest or a store failure
 * removes every object this request wrote, and leaves the token open so the agent can retry.
 *
 * The quota is checked once, when the upload starts, against the workspace's live artifacts. Two
 * uploads of one workspace in the same instant can each fit and together pass it; the next upload
 * sees the total. That is a soft quota by design — the alternative is serialising every workspace's
 * uploads behind one lock, and a quota exists to bound a disk, not to be exact to the byte.
 */

import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DomainError } from "../../errors/error.envelope";
import { describeForLog } from "../../errors/failure";
import type { BuildJob } from "../../db/schema";
import { TestResultParserRegistry } from "../../test-results/parser.registry";
import type { ResultFile } from "../../test-results/parser.spi";
import { TestResultIngestService, type ParseReport } from "../../test-results/test-results.service";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import type { JobUpload } from "../protocol/protocol.messages";
import { artifactKey, type ArtifactStore } from "./artifact.store";
import { ARTIFACT_STORE } from "./artifact.store.factory";
import {
  checksumMismatch,
  jobUnattributed,
  manifestInvalid,
  tooLarge,
  uploadClosed,
  uploadRefused,
} from "./upload.errors";
import { UploadInspector } from "./upload.inspector";
import {
  parseManifest,
  type ManifestFile,
  type ReceiptEntry,
  type UploadManifest,
  type UploadWarning,
} from "./upload.manifest";
import {
  artifactKind,
  offerGlobs,
  UPLOAD_MAX_FILES,
  UPLOAD_TOKEN_GRACE_MS,
  uploadPath,
} from "./upload.policy";
import { readUpload } from "./upload.receiver";
import { UploadRepository, type ArtifactRow, type UploadLedger } from "./upload.repository";
import { bearerToken, mintUploadToken, uploadTokenMatches } from "./upload.token";

/** Milliseconds in a day, for retention. */
const DAY_MS = 86_400_000;

/** What dispatch needs from this service — the seam its unit suite stands in for. */
export interface OfferUploads {
  /**
   * The `upload` a job's offer carries, minting its token. Undefined for a job with nowhere to
   * upload to: one attributed to no run, or one whose upload has already closed.
   *
   * @param job - The placed job.
   * @param at - When it is offered.
   * @param validForMs - How long the job may take to answer and run — the token outlives it by
   *   {@link UPLOAD_TOKEN_GRACE_MS}.
   * @returns The offer's `upload`, or undefined.
   */
  forOffer(job: BuildJob, at: Date, validForMs: number): Promise<JobUpload | undefined>;
}

/** The injection token for {@link OfferUploads}. */
export const FARM_OFFER_UPLOADS = Symbol("FARM_OFFER_UPLOADS");

/** One upload request, as the controller hands it over. */
export interface UploadRequest {
  /** The build job's uuid, from the path. */
  readonly jobId: string;
  /** The `Authorization` header. */
  readonly authorization: unknown;
  /** The `Content-Type` header. */
  readonly contentType: string | undefined;
  /** The body, streamed. */
  readonly body: Readable;
}

/** What an accepted upload answers with. */
export interface UploadReceipt {
  readonly job: string;
  readonly testRun: string;
  /** Every collected file: stored, truncated or skipped. */
  readonly files: ReceiptEntry[];
  /** The job warnings the page renders. */
  readonly warnings: UploadWarning[];
  /** The parsed attempt's counts, or null when the upload carried no result file. */
  readonly results: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly flaky: number;
    readonly skipped: number;
    readonly parseWarnings: number;
  } | null;
}

/** A file this request stored. */
interface StoredFile {
  readonly entry: ManifestFile;
  readonly key: string;
  readonly head: Buffer;
}

/** Why a manifest file is not being kept. */
type Plan = Map<string, "store" | "quota">;

@Injectable()
export class ArtifactUploadService implements OfferUploads {
  private readonly logger = new Logger(ArtifactUploadService.name);

  /**
   * @param repository - The ledger, the quota and the closing transaction.
   * @param store - Where the bytes go.
   * @param registry - AT.1's parsers, for detecting which files are results.
   * @param ingest - AT.1's parse orchestration.
   * @param config - The caps, the quota and the retention.
   * @param now - The clock tokens are minted and expired by.
   */
  constructor(
    private readonly repository: UploadRepository,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
    private readonly registry: TestResultParserRegistry,
    private readonly ingest: TestResultIngestService,
    private readonly config: AppConfigService,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /** @inheritdoc */
  async forOffer(job: BuildJob, at: Date, validForMs: number): Promise<JobUpload | undefined> {
    if (job.run_id === null) return undefined;

    const { token, hash } = mintUploadToken();
    const expiresAt = new Date(at.getTime() + validForMs + UPLOAD_TOKEN_GRACE_MS);
    if (!(await this.repository.mint(job.organization_id, job.id, hash, at, expiresAt))) {
      return undefined;
    }

    const { maxFileBytes, maxJobBytes } = this.config.artifacts;
    return {
      path: uploadPath(job.id),
      token,
      expires_at: expiresAt.toISOString(),
      globs: offerGlobs(job.artifact_globs),
      max_file_bytes: maxFileBytes,
      max_job_bytes: maxJobBytes,
      max_files: UPLOAD_MAX_FILES,
    };
  }

  /**
   * Accept one upload — see this file's header.
   *
   * @param request - The job, the credential and the body.
   * @returns The receipt.
   * @throws {DomainError} Every refusal in `upload.errors.ts`.
   */
  async accept(request: UploadRequest): Promise<UploadReceipt> {
    const token = bearerToken(request.authorization);
    const ledger = await this.admit(request.jobId, token);
    const runId = ledger.runId;
    if (runId === null) throw jobUnattributed();

    const settings = this.config.artifacts;
    const uploadId = randomUUID();
    const written: string[] = [];
    const arrived = new Set<string>();
    const stored = new Map<string, StoredFile>();
    let manifest: UploadManifest | undefined;
    let plan: Plan = new Map();

    try {
      const usage = await this.repository.usage(ledger.organizationId);

      await readUpload(
        request.body,
        request.contentType,
        { maxFiles: UPLOAD_MAX_FILES, maxFileBytes: settings.maxFileBytes },
        {
          onManifest: (text) => {
            manifest = parseManifest(text);
            plan = this.plan(manifest, usage);
          },
          onFile: async (name, stream) => {
            const entry = manifest?.files.find((file) => file.name === name);
            if (!entry) {
              stream.resume();
              throw manifestInvalid(`${name} is not in the manifest.`, name);
            }
            if (arrived.has(name)) {
              stream.resume();
              throw manifestInvalid(`${name} was sent twice.`, name);
            }
            arrived.add(name);
            if (plan.get(name) === "quota") {
              stream.resume();
              stored.set(name, { entry, key: "", head: Buffer.alloc(0) });
              return;
            }

            const key = artifactKey(ledger.organizationId, ledger.jobId, uploadId, name);
            written.push(key);
            stored.set(name, await this.keep(entry, key, stream));
          },
        },
      );

      const complete = manifest;
      if (!complete) throw manifestInvalid("the manifest is missing.");
      for (const file of complete.files) {
        if (!stored.has(file.name))
          throw manifestInvalid(`${file.name} is listed but was not sent.`, file.name);
      }

      return await this.close(ledger, runId, complete, plan, stored);
    } catch (error) {
      await this.discard(written);
      if (!(error instanceof DomainError)) {
        this.logger.error(
          `An artifact upload for build job ${ledger.jobId} failed.`,
          describeForLog(error),
        );
      }
      throw error;
    }
  }

  /**
   * The ledger a token opens — or the refusal.
   *
   * @param jobId - The job from the path.
   * @param token - The presented token.
   * @returns The ledger.
   * @throws `farm_artifact_upload_refused` or `farm_artifact_upload_closed`.
   */
  private async admit(jobId: string, token: string | undefined): Promise<UploadLedger> {
    // No bearer credential at all is refused before the ledger is read: there is nothing to
    // compare, and a request carrying nothing costs this service nothing.
    if (token === undefined) throw uploadRefused();

    const ledger = await this.repository.ledger(jobId);

    if (ledger === undefined || !uploadTokenMatches(ledger.tokenHash, token)) throw uploadRefused();
    // The right token for a closed upload: single use, and the one refusal that says so.
    if (ledger.closedAt !== null) throw uploadClosed();
    if (ledger.expiresAt.getTime() <= this.now().getTime()) throw uploadRefused();

    return ledger;
  }

  /**
   * Hold the manifest to the caps, and decide what the workspace's quota has room for — in
   * manifest order, so the agent's own ordering decides which files are kept first.
   *
   * @param manifest - The manifest.
   * @param usage - The workspace's live bytes.
   * @returns Each sent file: stored, or skipped for the quota.
   * @throws `farm_artifact_too_large` past a cap.
   */
  private plan(manifest: UploadManifest, usage: number): Plan {
    const { maxFileBytes, maxJobBytes, quotaBytes } = this.config.artifacts;
    const plan: Plan = new Map();
    let total = 0;
    let room = quotaBytes - usage;

    for (const file of manifest.files) {
      if (file.size_bytes > maxFileBytes)
        throw tooLarge("the per-file cap", maxFileBytes, file.name);
      total += file.size_bytes;
      if (total > maxJobBytes) throw tooLarge("the per-job cap", maxJobBytes);

      if (file.size_bytes <= room) {
        plan.set(file.name, "store");
        room -= file.size_bytes;
      } else {
        plan.set(file.name, "quota");
      }
    }

    return plan;
  }

  /**
   * Stream one file into the store through the inspector, and hold it to its checksum.
   *
   * @param entry - Its manifest entry.
   * @param key - Where it goes.
   * @param stream - The bytes.
   * @returns What was stored.
   * @throws `farm_artifact_checksum_mismatch`, or the inspector's size refusal.
   */
  private async keep(entry: ManifestFile, key: string, stream: Readable): Promise<StoredFile> {
    const inspector = new UploadInspector(entry.name, entry.size_bytes);

    const [piped, put] = await Promise.allSettled([
      pipeline(stream, inspector),
      this.store.put(key, inspector, entry.size_bytes),
    ]);
    const failures = [piped, put].flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (failures.length > 0) {
      // A refusal the inspector raised is the caller's to see, wherever it surfaced; otherwise the
      // store's own failure says more than the premature close it caused upstream.
      throw (
        failures.map(domainCause).find((cause) => cause !== undefined) ??
        (put.status === "rejected" ? (put.reason as unknown) : failures[0])
      );
    }

    if (inspector.checksum !== entry.checksum) {
      throw checksumMismatch(entry.name, entry.checksum, inspector.checksum);
    }

    return { entry, key, head: inspector.head };
  }

  /**
   * Parse the result files into the attempt, and close the upload.
   *
   * @param ledger - The ledger.
   * @param runId - The job's run.
   * @param manifest - The manifest.
   * @param plan - What was stored and what the quota skipped.
   * @param stored - What arrived.
   * @returns The receipt.
   * @throws `farm_artifact_upload_closed` when another request closed it first.
   */
  private async close(
    ledger: UploadLedger,
    runId: string,
    manifest: UploadManifest,
    plan: Plan,
    stored: ReadonlyMap<string, StoredFile>,
  ): Promise<UploadReceipt> {
    const at = this.now();
    const kept = manifest.files.filter((file) => plan.get(file.name) === "store");
    const testRunId = await this.repository.attempt(
      ledger.organizationId,
      ledger.jobId,
      runId,
      ledger.commitSha,
    );

    const results: ResultFile[] = [];
    for (const file of kept) {
      const { key, head } = stored.get(file.name) as StoredFile;
      if (this.registry.detect({ name: file.name, bytes: head }) !== null) {
        results.push({ name: file.name, bytes: await this.store.get(key) });
      }
    }

    const report: ParseReport | undefined =
      results.length === 0
        ? undefined
        : await this.ingest.parseAttempt({
            organizationId: ledger.organizationId,
            testRunId,
            files: results,
          });
    const coverage = new Map(report?.coverage?.files.map((counts) => [counts.file, counts]));

    const retainedUntil = new Date(at.getTime() + this.config.artifacts.retentionDays * DAY_MS);
    const artifacts: ArtifactRow[] = kept.map((file) => {
      const counts = coverage.get(file.name);
      return {
        name: file.name,
        kind: artifactKind(file.name, report?.parsedBy[file.name] ?? null, counts !== undefined),
        sizeBytes: file.size_bytes,
        storageRef: { driver: this.store.driver, key: (stored.get(file.name) as StoredFile).key },
        checksum: file.checksum,
        retainedUntil,
        truncationNote: file.truncated?.note ?? null,
        coverage:
          counts === undefined
            ? null
            : { linesCovered: counts.linesCovered, linesTotal: counts.linesTotal },
      };
    });
    const kinds = new Map(artifacts.map((row) => [row.name, row.kind]));

    const closed = await this.repository.close({
      organizationId: ledger.organizationId,
      jobId: ledger.jobId,
      tokenHash: ledger.tokenHash,
      testRunId,
      at,
      artifacts,
      storedBytes: artifacts.reduce((sum, row) => sum + row.sizeBytes, 0),
      receipt: (ids) => receiptOf(manifest, plan, kinds, ids),
    });
    // Another request with this token closed it between admission and here: a replay.
    if (closed === undefined) throw uploadClosed();

    return {
      job: ledger.jobId,
      testRun: testRunId,
      files: closed.manifest,
      warnings: closed.warnings,
      results:
        report === undefined ? null : { ...report.totals, parseWarnings: report.warnings.length },
    };
  }

  /**
   * Remove what a failed request wrote. Best effort: a key that cannot be removed now is an orphan
   * no row points at, which the log names.
   *
   * @param keys - The keys.
   */
  private async discard(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.store.delete(key);
      } catch (error) {
        this.logger.warn(
          `An abandoned artifact at ${key} could not be removed.`,
          describeForLog(error),
        );
      }
    }
  }
}

/**
 * The receipt: every sent file in manifest order, then every file the agent left behind — each with
 * what happened to it, and a warning for each that was not kept whole.
 *
 * @param manifest - The manifest.
 * @param plan - What was stored and what the quota skipped.
 * @param kinds - Each stored file's kind.
 * @param ids - Each stored file's `test_artifacts` id.
 * @returns The manifest and the warnings.
 */
export function receiptOf(
  manifest: UploadManifest,
  plan: ReadonlyMap<string, "store" | "quota">,
  kinds: ReadonlyMap<string, string>,
  ids: ReadonlyMap<string, string>,
): { manifest: ReceiptEntry[]; warnings: UploadWarning[] } {
  const entries: ReceiptEntry[] = [];
  const warnings: UploadWarning[] = [];

  for (const file of manifest.files) {
    if (plan.get(file.name) === "quota") {
      entries.push({
        name: file.name,
        status: "skipped",
        size_bytes: file.size_bytes,
        reason: "quota",
        note: "the workspace's artifact quota had no room for it",
      });
      warnings.push({
        code: "artifact_quota_exceeded",
        file: file.name,
        message: `${file.name} was not kept: the workspace's artifact quota is full.`,
      });
      continue;
    }

    entries.push({
      name: file.name,
      status: file.truncated ? "truncated" : "stored",
      size_bytes: file.size_bytes,
      kind: kinds.get(file.name),
      checksum: file.checksum,
      artifact_id: ids.get(file.name),
      ...(file.truncated ? { note: file.truncated.note } : {}),
    });
    if (file.truncated) {
      warnings.push({
        code: "artifact_truncated",
        file: file.name,
        message: `${file.name} was cut short: ${file.truncated.note}.`,
      });
    }
  }

  for (const skipped of manifest.skipped) {
    entries.push({
      name: skipped.name,
      status: "skipped",
      size_bytes: skipped.size_bytes,
      reason: skipped.reason,
      note: skipped.detail,
    });
    warnings.push({
      code: "artifact_skipped",
      file: skipped.name,
      message: `${skipped.name} was not uploaded: ${skipped.detail}.`,
    });
  }

  return { manifest: entries, warnings };
}

/**
 * The refusal behind a store's wrapped failure, when a stream stage raised one.
 *
 * @param error - What a put rejected with.
 * @returns The `DomainError`, or undefined.
 */
function domainCause(error: unknown): DomainError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof DomainError) return current;
    current = current.cause;
  }
  return undefined;
}
