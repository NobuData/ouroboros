/**
 * Rows → the detection contract ([#384](https://github.com/NobuData/ouroboros/issues/384)), exactly
 * as `openapi.yaml`'s `RepoDetection*` schemas promise it.
 */

import type { RepoDetection, RepoDetectionScan } from "../db/schema";
import type { DetectionConfidence } from "./detection.pack";
import type { PolicyRow, StoredScan } from "./detection.repository";
import { recordOf } from "./packs/pack.helpers";

/** One card row. */
export interface DetectionRowResource {
  readonly rowKey: string;
  readonly verdict: RepoDetection["verdict"];
  /** The line the card prints. */
  readonly value: string;
  readonly label: RepoDetection["label"];
  /** How sure the conclusion is; null for a row stored without one. */
  readonly confidence: DetectionConfidence | null;
  /** False when the scan could not determine the row — the value says why. */
  readonly determined: boolean;
  /** Which probes produced the row. The rule packs own its shape. */
  readonly evidence: Readonly<Record<string, unknown>>;
}

/** A scan's metadata. */
export interface DetectionScanResource {
  readonly scanSeq: number;
  readonly scannedAt: string;
  /** The card's `scanned in 38s`, as data. */
  readonly durationMs: number;
  readonly packVersions: Readonly<Record<string, unknown>>;
  readonly probeBudgetUsed: number | null;
}

/** A protected-path policy of the repository. */
export interface ProtectedPathResource {
  readonly glob: string;
  /** `suggested` (a scan proposed it) or `edited` (a person owns it). */
  readonly source: PolicyRow["source"];
}

/** Where a scan started in this process stands. */
export interface ScanProgressResource {
  readonly state: "running" | "done" | "failed";
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** Probes asked for so far. */
  readonly probesPlanned: number;
  /** Probes that finished, were skipped or failed. */
  readonly probesSettled: number;
  /** The stored scan, once done. */
  readonly scanSeq: number | null;
  /** Why the scan failed, when it did — never a credential. */
  readonly error: string | null;
}

/** `GET /api/v1/onboarding/detection` and `GET …/scans/{scanSeq}`. */
export interface DetectionResource {
  readonly repo: string;
  /** The scan, or null when the repository was never scanned. */
  readonly scan: DetectionScanResource | null;
  readonly rows: readonly DetectionRowResource[];
  /** The repository's protected-path policies, suggested and edited. */
  readonly protectedPaths: readonly ProtectedPathResource[];
  /** The scan running or last run in this process, or null. */
  readonly progress: ScanProgressResource | null;
}

/** `POST /api/v1/onboarding/detection/scan`. */
export interface RescanResource {
  readonly progress: ScanProgressResource;
  /** True when a scan was already running and this request joined it rather than starting one. */
  readonly joined: boolean;
}

/** The confidences a stored row's evidence may carry. */
const CONFIDENCES: readonly DetectionConfidence[] = ["high", "medium", "low"];

/**
 * One stored row as the contract's row.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function rowResource(row: RepoDetection): DetectionRowResource {
  const evidence = recordOf(row.evidence);
  const confidence = evidence.confidence;

  return {
    rowKey: row.row_key,
    verdict: row.verdict,
    value: row.value,
    label: row.label,
    confidence: CONFIDENCES.includes(confidence as DetectionConfidence)
      ? (confidence as DetectionConfidence)
      : null,
    determined: evidence.undetermined !== true,
    evidence,
  };
}

/**
 * A stored scan's metadata.
 *
 * @param scan - The scan row.
 * @returns The resource.
 */
export function scanResource(scan: RepoDetectionScan): DetectionScanResource {
  return {
    scanSeq: scan.scan_seq,
    scannedAt: scan.scanned_at.toISOString(),
    durationMs: scan.duration_ms,
    packVersions: recordOf(scan.pack_versions),
    probeBudgetUsed: scan.probe_budget_used,
  };
}

/**
 * The whole surface.
 *
 * @param repo - `owner/name`, lower-case.
 * @param stored - The scan and its rows, or undefined.
 * @param policies - The repository's protected-path policies.
 * @param progress - The in-process progress, or null.
 * @returns The resource.
 */
export function detectionResource(
  repo: string,
  stored: StoredScan | undefined,
  policies: readonly PolicyRow[],
  progress: ScanProgressResource | null,
): DetectionResource {
  return {
    repo,
    scan: stored === undefined ? null : scanResource(stored.scan),
    rows: stored?.rows.map(rowResource) ?? [],
    protectedPaths: policies.map((policy) => ({ glob: policy.path_glob, source: policy.source })),
    progress,
  };
}
