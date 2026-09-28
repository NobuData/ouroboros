import { describe, expect, it, vi } from "vitest";

import {
  ARTIFACT_ENDPOINT,
  COVERAGE_LABEL,
  FILE_SIGNED_OUT,
  FILE_UNREACHABLE,
  FILE_UNREADABLE,
  KIND_LABEL,
  NOTABLE_BYTES,
  NO_ARTIFACTS,
  PREVIEW_LIMIT_BYTES,
  artifactUrl,
  artifactsView,
  clippedNote,
  coverageLine,
  formatBytes,
  openOf,
  readArtifactText,
  retentionTag,
  sizeLabel,
  truncationLine,
} from "@/app/test-results/artifacts";

import {
  CAPTURE_ARTIFACT_ID,
  COVERAGE_ARTIFACT_ID,
  JUNIT_ARTIFACT_ID,
  LOG_ARTIFACT_ID,
  artifact,
  coverage,
  firstCoverage,
  mockupArtifacts,
  page,
} from "../helpers/test-results";

/**
 * The artifacts card's rules (#341): the retention tag from the payload, the size when notable,
 * the coverage delta absent rather than zero, the tombstone, the truncation reason, how a row
 * opens, and the viewer's bounded read.
 */

/**
 * A fetch answering one response.
 *
 * @param response What to answer.
 * @returns The stub.
 */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

describe("artifactUrl", () => {
  it("is this origin's route, the id encoded", () => {
    expect(ARTIFACT_ENDPOINT).toBe("/api/artifacts");
    expect(artifactUrl(JUNIT_ARTIFACT_ID)).toBe(`/api/artifacts/${JUNIT_ARTIFACT_ID}`);
    expect(artifactUrl("../x")).toBe("/api/artifacts/..%2Fx");
  });
});

describe("sizes", () => {
  it("are printed in binary units, to one decimal", () => {
    expect(formatBytes(2_202_010)).toBe("2.1 MB");
    expect(formatBytes(184_320)).toBe("180.0 KB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(formatBytes(2 * 1024 ** 5)).toBe("2048.0 TB");
  });

  it("are refused when they are not a size", () => {
    for (const bytes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatBytes(bytes)).toBeNull();
  });

  it("are on the row only when notable — the mockup's 2.1 MB, and no 48 KB", () => {
    expect(sizeLabel(2_202_010)).toBe("2.1 MB");
    expect(sizeLabel(NOTABLE_BYTES)).toBe("1.0 MB");
    expect(sizeLabel(NOTABLE_BYTES - 1)).toBeNull();
    expect(sizeLabel(48_213)).toBeNull();
    expect(sizeLabel(Number.NaN)).toBeNull();
  });
});

describe("the retention tag", () => {
  it("is the payload's policy, not a constant", () => {
    expect(retentionTag(mockupArtifacts())).toBe("retained 30d");
    expect(retentionTag(mockupArtifacts().map((each) => ({ ...each, retentionDays: 7 })))).toBe("retained 7d");
    expect(retentionTag([artifact({ retentionDays: 90 })])).toBe("retained 90d");
  });

  it("is a range when the policy changed between uploads", () => {
    expect(retentionTag([artifact({ retentionDays: 30 }), artifact({ retentionDays: 7 })])).toBe("retained 7–30d");
  });

  it("is absent when no live file is on the card — an expired one is not retained", () => {
    expect(retentionTag([])).toBeNull();
    expect(retentionTag([artifact({ state: "expired" })])).toBeNull();
    expect(retentionTag([artifact({ state: "expired", retentionDays: 30 }), artifact({ retentionDays: 7 })])).toBe(
      "retained 7d",
    );
  });

  it("is absent rather than invented when the days cannot be read", () => {
    expect(retentionTag([artifact({ retentionDays: Number.NaN })])).toBeNull();
    expect(retentionTag([artifact({ retentionDays: 0 })])).toBeNull();
  });
});

describe("the coverage line", () => {
  it("is the mockup's `coverage 87.4% (+0.6%)`, the rise in the ok hue", () => {
    expect(coverageLine(coverage())).toEqual({
      percent: "87.4%",
      delta: { text: "(+0.6%)", tone: "ok" },
      text: "coverage 87.4% (+0.6%)",
    });
  });

  it("draws a fall in the err hue", () => {
    expect(coverageLine(coverage({ percent: 85, delta: -1.25 }))).toEqual({
      percent: "85.0%",
      delta: { text: "(−1.3%)", tone: "err" },
      text: "coverage 85.0% (−1.3%)",
    });
  });

  it("has no delta for a first attempt — absent, never +0.0%", () => {
    const line = coverageLine(firstCoverage());

    expect(line.delta).toBeNull();
    expect(line.text).toBe("coverage 86.8%");
    expect(line.text).not.toMatch(/0\.0/);
  });

  it("has no delta for one that is not a number", () => {
    expect(coverageLine(coverage({ delta: Number.NaN })).delta).toBeNull();
    expect(coverageLine({ ...coverage(), delta: null as unknown as number }).delta).toBeNull();
  });

  it("says a measured *no change* without a sign that claims a direction", () => {
    expect(coverageLine(coverage({ delta: 0 })).delta).toEqual({ text: "(±0.0%)", tone: "neutral" });
    expect(coverageLine(coverage({ delta: 0.04 })).delta).toEqual({ text: "(±0.0%)", tone: "neutral" });
  });
});

describe("the truncation line", () => {
  it("carries the upload's own reason", () => {
    expect(
      truncationLine({ truncated: true, truncationNote: "exceeded the 25 MB per-file cap; kept the first 25 MB" }),
    ).toBe("Cut short on upload — exceeded the 25 MB per-file cap; kept the first 25 MB");
  });

  it("still says so when the upload left no reason", () => {
    expect(truncationLine({ truncated: true, truncationNote: null })).toBe("Cut short on upload");
    expect(truncationLine({ truncated: true, truncationNote: "  " })).toBe("Cut short on upload");
  });

  it("is absent for a file stored whole", () => {
    expect(truncationLine({ truncated: false, truncationNote: null })).toBeNull();
  });
});

describe("how a row opens", () => {
  it("reads a text artifact in place, and saves anything else", () => {
    expect(openOf(artifact())).toEqual({
      mode: "inline",
      url: `/api/artifacts/${JUNIT_ARTIFACT_ID}`,
      label: "Open junit-build3.xml",
    });
    expect(openOf(mockupArtifacts()[1]!)).toEqual({
      mode: "download",
      url: `/api/artifacts/${CAPTURE_ARTIFACT_ID}`,
      label: "Download rig-capture-estop.csv",
    });
  });

  it("downloads a preview this client does not know", () => {
    expect(openOf(artifact({ preview: "hologram" as never }))?.mode).toBe("download");
  });

  it("gives a tombstone nothing to open, whatever else the payload says", () => {
    expect(openOf(artifact({ state: "expired" }))).toBeNull();
    expect(openOf(artifact({ state: "expired", href: "/api/v1/artifacts/x" }))).toBeNull();
    expect(openOf(artifact({ href: null }))).toBeNull();
  });
});

describe("artifactsView", () => {
  it("draws the mockup's four rows, the coverage row last", () => {
    const view = artifactsView(page({ artifacts: mockupArtifacts(), coverage: coverage() }));

    expect(view.tag).toBe("retained 30d");
    expect(view.note).toBeNull();
    expect(view.rows.map((row) => [row.coverage?.text ?? row.name, row.size, row.open?.mode ?? null])).toEqual([
      ["junit-build3.xml", null, "inline"],
      ["rig-capture-estop.csv", "2.1 MB", "download"],
      ["serial-console.log", null, "inline"],
      ["coverage 87.4% (+0.6%)", null, "inline"],
    ]);
    expect(view.rows.map((row) => row.artifactId)).toEqual([
      JUNIT_ARTIFACT_ID,
      CAPTURE_ARTIFACT_ID,
      LOG_ARTIFACT_ID,
      COVERAGE_ARTIFACT_ID,
    ]);
    expect(view.rows.map((row) => row.kindLabel)).toEqual([
      KIND_LABEL.junit,
      KIND_LABEL.capture,
      KIND_LABEL.log,
      KIND_LABEL.coverage,
    ]);
  });

  it("puts the coverage row last wherever the report sits in the payload", () => {
    const [junit, capture, log, report] = mockupArtifacts();
    const view = artifactsView(page({ artifacts: [report!, junit!, capture!, log!], coverage: coverage() }));

    expect(view.rows.map((row) => row.name)).toEqual([
      "junit-build3.xml",
      "rig-capture-estop.csv",
      "serial-console.log",
      "coverage.info",
    ]);
    expect(view.rows.at(-1)?.coverage?.text).toBe("coverage 87.4% (+0.6%)");
  });

  it("keeps an expired artifact as a tombstone: its name, no size, nothing to open", () => {
    const view = artifactsView(
      page({
        artifacts: [artifact(), artifact({ id: LOG_ARTIFACT_ID, name: "serial-console.log", kind: "log", state: "expired" })],
      }),
    );

    expect(view.rows).toHaveLength(2);
    expect(view.rows[1]).toMatchObject({
      name: "serial-console.log",
      expired: true,
      size: null,
      open: null,
    });
  });

  it("keeps an expired tombstone's size off the row even when it was notable", () => {
    const [row] = artifactsView(page({ artifacts: [artifact({ state: "expired", sizeBytes: 5_000_000 })] })).rows;

    expect(row?.size).toBeNull();
  });

  it("says why a truncated upload was cut short, and still opens it", () => {
    const [row] = artifactsView(
      page({
        artifacts: [artifact({ truncated: true, truncationNote: "exceeded the 25 MB per-file cap" })],
      }),
    ).rows;

    expect(row?.truncation).toBe("Cut short on upload — exceeded the 25 MB per-file cap");
    expect(row?.open?.mode).toBe("inline");
  });

  it("draws coverage with nothing to open when no report stands behind it", () => {
    const view = artifactsView(page({ artifacts: [artifact()], coverage: firstCoverage() }));

    expect(view.rows.at(-1)).toMatchObject({
      key: COVERAGE_LABEL,
      artifactId: null,
      open: null,
      expired: false,
      coverage: { text: "coverage 86.8%", delta: null },
    });
  });

  it("keeps an expired report's tombstone, and the figures on a row of their own", () => {
    const view = artifactsView(
      page({
        artifacts: [artifact({ id: COVERAGE_ARTIFACT_ID, name: "coverage.info", kind: "coverage", state: "expired" })],
        coverage: coverage(),
      }),
    );

    expect(view.rows.map((row) => [row.name, row.expired, row.coverage?.text ?? null, row.open])).toEqual([
      ["coverage.info", true, null, null],
      ["coverage", false, "coverage 87.4% (+0.6%)", null],
    ]);
    expect(view.tag).toBeNull();
  });

  it("draws a coverage report without figures as the file it is", () => {
    const view = artifactsView(
      page({ artifacts: [artifact({ id: COVERAGE_ARTIFACT_ID, name: "coverage.info", kind: "coverage" })] }),
    );

    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ name: "coverage.info", coverage: null });
  });

  it("draws one coverage row when a build uploaded two reports", () => {
    const view = artifactsView(
      page({
        artifacts: [
          artifact({ id: COVERAGE_ARTIFACT_ID, name: "coverage.info", kind: "coverage", coverage: coverage() }),
          artifact({ id: LOG_ARTIFACT_ID, name: "coverage.json", kind: "coverage", coverage: coverage() }),
        ],
        coverage: coverage(),
      }),
    );

    expect(view.rows.map((row) => row.coverage?.text ?? row.name)).toEqual(["coverage.json", "coverage 87.4% (+0.6%)"]);
  });

  it("says so when the build uploaded nothing", () => {
    expect(artifactsView(page())).toEqual({ tag: null, rows: [], note: NO_ARTIFACTS });
  });

  it("draws nothing rather than failing for a page that carries no artifacts at all", () => {
    expect(artifactsView({ artifacts: undefined as never, coverage: null }).rows).toEqual([]);
  });

  it("names a kind this client does not know as a file", () => {
    const [row] = artifactsView(page({ artifacts: [artifact({ kind: "hologram" as never })] })).rows;

    expect(row?.kindLabel).toBe(KIND_LABEL.other);
  });

  it("carries nothing about where a file is kept", () => {
    const view = artifactsView(page({ artifacts: mockupArtifacts(), coverage: coverage() }));

    expect(JSON.stringify(view)).not.toMatch(/storage|driver|s3:|\/api\/v1\//i);
  });
});

describe("readArtifactText", () => {
  it("asks this origin, with the session, and reads the text", async () => {
    const fetcher = answering(new Response("<testsuite/>\n", { status: 200 }));

    expect(await readArtifactText(artifactUrl(JUNIT_ARTIFACT_ID), { fetcher })).toEqual({
      state: "read",
      text: "<testsuite/>\n",
      clipped: false,
    });
    expect(fetcher.mock.calls[0]![0]).toBe(`/api/artifacts/${JUNIT_ARTIFACT_ID}`);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("reads no more than its limit, and says the file is longer", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcd"));
        controller.enqueue(new TextEncoder().encode("efgh"));
        controller.enqueue(new TextEncoder().encode("ijkl"));
        controller.close();
      },
    });

    expect(
      await readArtifactText("/api/artifacts/x", { fetcher: answering(new Response(body)), limitBytes: 6 }),
    ).toEqual({ state: "read", text: "abcdef", clipped: true });
  });

  it("reads a file of exactly its limit whole", async () => {
    expect(
      await readArtifactText("/api/artifacts/x", { fetcher: answering(new Response("abcdef")), limitBytes: 6 }),
    ).toEqual({ state: "read", text: "abcdef", clipped: false });
  });

  it("keeps a character that spans two chunks, and drops one the limit cuts", async () => {
    const bytes = new TextEncoder().encode("é");
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        controller.enqueue(bytes.subarray(1));
        controller.close();
      },
    });

    expect(await readArtifactText("/x", { fetcher: answering(new Response(split)) })).toMatchObject({ text: "é" });
    expect(await readArtifactText("/x", { fetcher: answering(new Response("aé")), limitBytes: 2 })).toEqual({
      state: "read",
      text: "a",
      clipped: true,
    });
  });

  it("reads an empty file as empty", async () => {
    expect(await readArtifactText("/x", { fetcher: answering(new Response(null, { status: 200 })) })).toEqual({
      state: "read",
      text: "",
      clipped: false,
    });
  });

  it("reads a 410 as expired", async () => {
    const gone = Response.json({ code: "artifact_expired", message: "Expired." }, { status: 410 });

    expect(await readArtifactText("/x", { fetcher: answering(gone) })).toEqual({ state: "expired" });
  });

  it("says the session ended for a 401", async () => {
    expect(await readArtifactText("/x", { fetcher: answering(new Response("", { status: 401 })) })).toEqual({
      state: "failed",
      reason: FILE_SIGNED_OUT,
    });
  });

  it("says what the service said for any other refusal, or its own words when it said nothing", async () => {
    const missing = Response.json({ code: "artifact_not_found", message: "No such artifact." }, { status: 404 });

    expect(await readArtifactText("/x", { fetcher: answering(missing) })).toEqual({
      state: "failed",
      reason: "No such artifact.",
    });
    expect(await readArtifactText("/x", { fetcher: answering(new Response("<html>", { status: 502 })) })).toEqual({
      state: "failed",
      reason: FILE_UNREADABLE,
    });
  });

  it("says the file could not be reached when nothing answered", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));

    expect(await readArtifactText("/x", { fetcher })).toEqual({ state: "failed", reason: FILE_UNREACHABLE });
  });

  it("rethrows an abort the caller asked for, which is not a failure to report", async () => {
    const stop = new AbortController();
    stop.abort();
    const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new DOMException("Aborted", "AbortError")));

    await expect(readArtifactText("/x", { fetcher, signal: stop.signal })).rejects.toThrow("Aborted");
  });
});

describe("clippedNote", () => {
  it("names how much was read", () => {
    expect(PREVIEW_LIMIT_BYTES).toBe(512 * 1024);
    expect(clippedNote()).toBe("Showing the first 512.0 KB — download the file for the rest.");
  });
});
