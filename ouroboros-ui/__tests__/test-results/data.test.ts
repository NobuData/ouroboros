import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { TestsReaders } from "@/app/test-results/data";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { BUILD_2_ID, BUILD_3_ID, gate, page, timeline } from "../helpers/test-results";

/**
 * The test-results page's first read (#335): the timeline decides found, missing or failed; the
 * tracker link, the commit source (#336), the selected attempt's gate and the run's pull request (#363) ride along
 * best-effort, and so does the selected attempt's page, for the suites card (#337).
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readTests } = await import("@/app/test-results/data");

/** When the read is made, in the cases that pin the clock. */
const READ_AT = Date.parse("2026-09-19T14:45:00.000Z");

/** The run's pull request. */
const PULL_REQUEST = { id: "5eed003a-0000-4000-8000-000000000514", number: 514 };

/**
 * Readers answering the seed.
 *
 * @param over What to replace.
 * @returns The readers.
 */
function readers(over: Partial<TestsReaders> = {}): TestsReaders {
  return {
    timeline: vi.fn().mockResolvedValue(timeline()),
    context: vi.fn().mockResolvedValue({
      repository: { owner: "acme-robotics", name: "helios-firmware" },
      stageKeys: ["plan", "implement", "build", "test", "pr"],
    }),
    gate: vi.fn((id: string) => Promise.resolve(gate({ testRunId: id }))),
    page: vi.fn().mockResolvedValue(page()),
    pullRequest: vi.fn().mockResolvedValue(PULL_REQUEST),
    ...over,
  };
}

describe("readTests", () => {
  it("finds the timeline, builds the tracker link, and reads the latest attempt's gate", async () => {
    const read = readers();

    expect(await readTests(SEEDED_RUN_ID, null, read, () => READ_AT)).toEqual({
      state: "found",
      value: {
        timeline: timeline(),
        trackerUrl: "https://github.com/acme-robotics/helios-firmware/issues/482",
        commitSource: { kind: "github", owner: "acme-robotics", name: "helios-firmware" },
        gate: gate(),
        page: page(),
        pullRequest: PULL_REQUEST,
        hasTestStage: true,
        readAt: READ_AT,
      },
    });
    expect(read.gate).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID);
    expect(read.page).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID);
    expect(read.pullRequest).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID);
  });

  it("reads the gate of the attempt the address names", async () => {
    const read = readers();

    await readTests(SEEDED_RUN_ID, 2, read);

    expect(read.gate).toHaveBeenCalledExactlyOnceWith(BUILD_2_ID);
    expect(read.page).toHaveBeenCalledExactlyOnceWith(BUILD_2_ID);
  });

  it("reads another workspace's run, and an id that is not one, as missing", async () => {
    for (const refusal of [new ApiError(404, "run_not_found", "No."), new ApiError(400, "validation_failed", "No.")]) {
      expect(await readTests("x", null, readers({ timeline: vi.fn().mockRejectedValue(refusal) }))).toEqual({
        state: "missing",
      });
    }
  });

  it("reads any other refusal as a failure, in the service's words, and rethrows a bug", async () => {
    const down = new ApiError(503, "unavailable", "The database is down.");
    expect(await readTests("x", null, readers({ timeline: vi.fn().mockRejectedValue(down) }))).toEqual({
      state: "failed",
      reason: "The database is down.",
    });

    const bug = new TypeError("x is undefined");
    await expect(readTests("x", null, readers({ timeline: vi.fn().mockRejectedValue(bug) }))).rejects.toBe(bug);
  });

  it("leaves the headline unlinked and the gate unread when those reads are refused", async () => {
    const refused = new ApiError(503, "unavailable", "Down.");
    const reading = await readTests(
      SEEDED_RUN_ID,
      null,
      readers({
        context: vi.fn().mockRejectedValue(refused),
        gate: vi.fn().mockRejectedValue(refused),
        page: vi.fn().mockRejectedValue(refused),
        pullRequest: vi.fn().mockRejectedValue(refused),
      }),
      () => READ_AT,
    );

    expect(reading).toEqual({
      state: "found",
      value: {
        timeline: timeline(),
        trackerUrl: null,
        commitSource: null,
        gate: null,
        page: null,
        pullRequest: null,
        hasTestStage: null,
        readAt: READ_AT,
      },
    });
  });

  it("says a workflow whose stages name no test stage has none (#342)", async () => {
    const reading = await readTests(
      SEEDED_RUN_ID,
      null,
      readers({
        timeline: vi.fn().mockResolvedValue(timeline({ attempts: [] })),
        context: vi.fn().mockResolvedValue({
          repository: { owner: "acme-robotics", name: "helios-firmware" },
          stageKeys: ["plan", "implement", "pr"],
        }),
      }),
    );

    expect(reading).toEqual(
      expect.objectContaining({ value: expect.objectContaining({ hasTestStage: false }) }),
    );
  });

  it("does not say a run that has reported no stage lacks a test stage (#342)", async () => {
    const reading = await readTests(
      SEEDED_RUN_ID,
      null,
      readers({
        context: vi.fn().mockResolvedValue({
          repository: { owner: "acme-robotics", name: "helios-firmware" },
          stageKeys: [],
        }),
      }),
    );

    expect(reading).toEqual(
      expect.objectContaining({ value: expect.objectContaining({ hasTestStage: null }) }),
    );
  });

  it("stamps the read with the clock's own instant (#342)", async () => {
    const before = Date.now();
    const reading = await readTests(SEEDED_RUN_ID, null, readers());

    expect(reading.state).toBe("found");
    if (reading.state === "found") expect(reading.value.readAt).toBeGreaterThanOrEqual(before);
  });

  it("names no pull request for a run that opened none (#363)", async () => {
    const reading = await readTests(
      SEEDED_RUN_ID,
      null,
      readers({ pullRequest: vi.fn().mockResolvedValue(null) }),
    );

    expect(reading).toEqual(
      expect.objectContaining({ value: expect.objectContaining({ pullRequest: null }) }),
    );
  });

  it("asks for no gate and no page before any attempt has reported", async () => {
    const read = readers({ timeline: vi.fn().mockResolvedValue(timeline({ attempts: [] })) });

    expect(await readTests(SEEDED_RUN_ID, null, read)).toEqual(
      expect.objectContaining({ value: expect.objectContaining({ gate: null, page: null }) }),
    );
    expect(read.gate).not.toHaveBeenCalled();
    expect(read.page).not.toHaveBeenCalled();
  });
});
