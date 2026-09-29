/** Rows → the detection contract ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import type { RepoDetection, RepoDetectionScan } from "../db/schema";
import { detectionResource, rowResource, scanResource } from "./detection.resources";

const AT = new Date("2026-09-29T12:00:00.000Z");

const SCAN: RepoDetectionScan = {
  id: "scan-1",
  organization_id: "org-1",
  repo_ref: "acme/helios",
  scan_seq: 3,
  scanned_at: AT,
  duration_ms: 38_000,
  pack_versions: { build: "1.0.0" },
  probe_budget_used: 9,
};

/**
 * A stored row.
 *
 * @param overrides - What to change.
 * @returns The row.
 */
function row(overrides: Partial<RepoDetection> = {}): RepoDetection {
  return {
    id: "row-1",
    organization_id: "org-1",
    repo_ref: "acme/helios",
    scan_seq: 3,
    row_key: "build",
    verdict: "ok",
    value: "west + twister (found west.yml)",
    evidence: { hit: "west.yml", confidence: "high" },
    label: "detected",
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

describe("the detection resource", () => {
  it("renders the scan, so `scanned in 38s` is data", () => {
    expect(scanResource(SCAN)).toEqual({
      scanSeq: 3,
      scannedAt: "2026-09-29T12:00:00.000Z",
      durationMs: 38_000,
      packVersions: { build: "1.0.0" },
      probeBudgetUsed: 9,
    });
  });

  it("renders a row with its confidence lifted out of the evidence", () => {
    expect(rowResource(row())).toEqual({
      rowKey: "build",
      verdict: "ok",
      value: "west + twister (found west.yml)",
      label: "detected",
      confidence: "high",
      determined: true,
      evidence: { hit: "west.yml", confidence: "high" },
    });
  });

  it("says a row was not determined, and tolerates evidence without a confidence", () => {
    expect(
      rowResource(row({ verdict: "warn", evidence: { undetermined: true, confidence: "nope" } })),
    ).toMatchObject({ determined: false, confidence: null });
    expect(rowResource(row({ evidence: null }))).toMatchObject({ evidence: {}, confidence: null });
  });

  it("renders a repository never scanned as no scan and no rows", () => {
    expect(detectionResource("acme/helios", undefined, [], null)).toEqual({
      repo: "acme/helios",
      scan: null,
      rows: [],
      protectedPaths: [],
      progress: null,
    });
  });

  it("carries the protected-path policies with their provenance", () => {
    expect(
      detectionResource(
        "acme/helios",
        { scan: SCAN, rows: [row()] },
        [{ path_glob: "boot/**", source: "edited" }],
        null,
      ).protectedPaths,
    ).toEqual([{ glob: "boot/**", source: "edited" }]);
  });
});
