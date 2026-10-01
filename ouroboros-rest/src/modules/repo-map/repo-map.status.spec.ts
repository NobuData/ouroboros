import type { RepoMapReport } from "./repo-map.resources";
import {
  reportOf,
  stateOf,
  statusesOf,
  type MapSkill,
  type RecordedGeneration,
} from "./repo-map.status";

/**
 * Where a repository's map stands (#422): generated, pending its first generation, or failed at
 * it — decided from the map skill and the newest recorded generation, and never from the absence
 * of a row alone, which is what pending and failed have in common.
 */

const FIRMWARE = "acme-robotics/helios-firmware";
const CONSOLE = "acme-robotics/helios-console";
const TELEMETRY = "acme-robotics/helios-telemetry";
const NIGHT = new Date("2026-09-30T05:12:00.000Z");

/**
 * A recorded generation.
 *
 * @param repo - The repository.
 * @param detail - The fields to change.
 * @returns The audit row.
 */
function recorded(
  repo: string,
  detail: Partial<RecordedGeneration["detail"]> = {},
): RecordedGeneration {
  return {
    repo,
    occurredAt: NIGHT,
    detail: {
      repo,
      trigger: "nightly",
      outcome: "skipped",
      skill: null,
      version: null,
      reason: "host_error",
      modules: 0,
      truncated: false,
      ...detail,
    },
  };
}

/** A skipped generation's report, as `reportOf` rebuilds it. */
const SKIPPED: RepoMapReport = {
  repo: CONSOLE,
  outcome: "skipped",
  skill: null,
  version: null,
  generatedAt: NIGHT.toISOString(),
  trigger: "nightly",
  reason: "host_error",
  modules: 0,
  truncated: false,
};

describe("a recorded generation, read back as its report", () => {
  it("rebuilds every field the generation answered with, stamped with when it ran", () => {
    expect(reportOf(recorded(CONSOLE))).toEqual(SKIPPED);
    expect(
      reportOf(
        recorded(FIRMWARE, {
          trigger: "manual",
          outcome: "published",
          skill: "repo-map",
          version: 61,
          reason: null,
          modules: 4,
          truncated: true,
        }),
      ),
    ).toEqual({
      repo: FIRMWARE,
      outcome: "published",
      skill: "repo-map",
      version: 61,
      generatedAt: NIGHT.toISOString(),
      trigger: "manual",
      reason: null,
      modules: 4,
      truncated: true,
    });
  });

  it("leaves out a row whose outcome or trigger is not one the generator writes", () => {
    expect(reportOf(recorded(CONSOLE, { outcome: "exploded" }))).toBeNull();
    expect(reportOf(recorded(CONSOLE, { trigger: "cron" }))).toBeNull();
    expect(reportOf({ repo: CONSOLE, occurredAt: NIGHT, detail: {} })).toBeNull();
  });

  it("reads a reason outside the vocabulary, and fields of the wrong kind, as absent", () => {
    expect(
      reportOf(
        recorded(CONSOLE, {
          reason: "gremlins",
          skill: 7,
          version: "3",
          modules: "many",
          truncated: 1,
        }),
      ),
    ).toEqual({ ...SKIPPED, reason: null });
  });
});

describe("where a map stands", () => {
  const map: MapSkill = { repo: FIRMWARE, slug: "repo-map", currentVersion: 60 };

  it("is generated while a version is in force — whatever the newest generation did", () => {
    expect(stateOf(map, null)).toBe("generated");
    expect(stateOf(map, SKIPPED)).toBe("generated");
  });

  it("is pending with no skill and nothing on the record: the first generation has not run", () => {
    expect(stateOf(undefined, null)).toBe("pending");
  });

  it("is failed with no skill and a skipped generation: the first one ran and was refused", () => {
    expect(stateOf(undefined, SKIPPED)).toBe("failed");
  });

  it("is pending again when a published map was deleted — nothing failed, and nothing is in force", () => {
    expect(stateOf(undefined, { ...SKIPPED, outcome: "published", reason: null })).toBe("pending");
  });

  it("does not count a skill with no version in force as a map", () => {
    expect(stateOf({ ...map, currentVersion: null }, null)).toBe("pending");
    expect(stateOf({ ...map, currentVersion: null }, SKIPPED)).toBe("failed");
  });
});

describe("one status per enabled repository", () => {
  it("answers in the repositories' order, each with its own skill and its own record", () => {
    const statuses = statusesOf(
      [CONSOLE, FIRMWARE, TELEMETRY],
      [{ repo: FIRMWARE, slug: "repo-map", currentVersion: 60 }],
      [recorded(CONSOLE), recorded(FIRMWARE, { outcome: "unchanged", reason: null, version: 60 })],
    );

    expect(statuses.map((status) => [status.repo, status.state])).toEqual([
      [CONSOLE, "failed"],
      [FIRMWARE, "generated"],
      [TELEMETRY, "pending"],
    ]);
    expect(statuses[0]).toEqual({
      repo: CONSOLE,
      state: "failed",
      skill: null,
      version: null,
      lastReport: SKIPPED,
    });
    expect(statuses[1]).toMatchObject({ skill: "repo-map", version: 60 });
    expect(statuses[2].lastReport).toBeNull();
  });

  it("takes a repository's first map skill by slug, as the generator does", () => {
    const [status] = statusesOf(
      [FIRMWARE],
      [
        { repo: FIRMWARE, slug: "repo-map", currentVersion: 60 },
        { repo: FIRMWARE, slug: "repo-map-helios-firmware", currentVersion: 2 },
      ],
      [],
    );

    expect(status).toMatchObject({ skill: "repo-map", version: 60 });
  });

  it("answers nothing for a workspace with no enabled repository", () => {
    expect(statusesOf([], [], [recorded(CONSOLE)])).toEqual([]);
  });
});
