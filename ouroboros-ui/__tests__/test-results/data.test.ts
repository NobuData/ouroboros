import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { TestsReaders } from "@/app/test-results/data";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { BUILD_2_ID, BUILD_3_ID, gate, timeline } from "../helpers/test-results";

/**
 * The test-results page's first read (#335): the timeline decides found, missing or failed; the
 * tracker link, the selected attempt's gate and the run's pull request (#363) ride along
 * best-effort.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readTests } = await import("@/app/test-results/data");

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
    repository: vi.fn().mockResolvedValue({ owner: "acme-robotics", name: "helios-firmware" }),
    gate: vi.fn((id: string) => Promise.resolve(gate({ testRunId: id }))),
    pullRequest: vi.fn().mockResolvedValue(PULL_REQUEST),
    ...over,
  };
}

describe("readTests", () => {
  it("finds the timeline, builds the tracker link, and reads the latest attempt's gate", async () => {
    const read = readers();

    expect(await readTests(SEEDED_RUN_ID, null, read)).toEqual({
      state: "found",
      value: {
        timeline: timeline(),
        trackerUrl: "https://github.com/acme-robotics/helios-firmware/issues/482",
        gate: gate(),
        pullRequest: PULL_REQUEST,
      },
    });
    expect(read.gate).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID);
    expect(read.pullRequest).toHaveBeenCalledExactlyOnceWith(SEEDED_RUN_ID);
  });

  it("reads the gate of the attempt the address names", async () => {
    const read = readers();

    await readTests(SEEDED_RUN_ID, 2, read);

    expect(read.gate).toHaveBeenCalledExactlyOnceWith(BUILD_2_ID);
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
        repository: vi.fn().mockRejectedValue(refused),
        gate: vi.fn().mockRejectedValue(refused),
        pullRequest: vi.fn().mockRejectedValue(refused),
      }),
    );

    expect(reading).toEqual({
      state: "found",
      value: { timeline: timeline(), trackerUrl: null, gate: null, pullRequest: null },
    });
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

  it("asks for no gate before any attempt has reported", async () => {
    const read = readers({ timeline: vi.fn().mockResolvedValue(timeline({ attempts: [] })) });

    expect(await readTests(SEEDED_RUN_ID, null, read)).toEqual(
      expect.objectContaining({ value: expect.objectContaining({ gate: null }) }),
    );
    expect(read.gate).not.toHaveBeenCalled();
  });
});
