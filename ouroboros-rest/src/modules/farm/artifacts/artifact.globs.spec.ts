import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { COMMIT } from "../dispatch/dispatch.fixture";
import { SubmitBuildJobDto } from "../dispatch/jobs.dto";
import { UpdatePoolDto } from "../fleet/fleet.dto";
import {
  ARTIFACT_GLOB_MAX_LENGTH,
  ARTIFACT_GLOBS_MAX,
  isArtifactGlob,
  snapshotGlobs,
} from "./artifact.globs";

/**
 * Artifact globs (#330): V060's `artifact_globs_valid()` restated, on the pool and on the
 * submission, and the job's snapshot of the two.
 */

/**
 * The properties a DTO body fails on.
 *
 * @param type - The DTO.
 * @param body - The body.
 * @returns The failing properties.
 */
function failures<T extends object>(type: new () => T, body: object): string[] {
  return validateSync(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

describe("an artifact glob", () => {
  it.each([
    "junit*.xml",
    "**/junit*.xml",
    "captures/*.csv",
    "logs/serial-console.log",
    "..hidden/*.log",
    "a..b.xml",
    "build/[ab]?.info",
  ])("accepts %j — relative, and inside the workspace", (glob) => {
    expect(isArtifactGlob(glob)).toBe(true);
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a climb out", "../secrets/*"],
    ["a climb in the middle", "build/../../x"],
    ["a trailing climb", "build/.."],
    ["a backslash", "logs\\serial.log"],
    ["a control character", "logs/a\nb.log"],
    ["nothing", ""],
    ["too long", "a".repeat(ARTIFACT_GLOB_MAX_LENGTH + 1)],
    ["not a string", 42],
  ])("refuses %s", (_what, glob) => {
    expect(isArtifactGlob(glob)).toBe(false);
  });
});

describe("the job's snapshot", () => {
  it("is the pool's globs then the submission's, without repeats", () => {
    expect(snapshotGlobs(["captures/*.csv", "a.log"], ["a.log", "b.log"])).toEqual([
      "captures/*.csv",
      "a.log",
      "b.log",
    ]);
  });

  it("drops anything the pool's column holds that is not a glob, and survives a non-array", () => {
    expect(snapshotGlobs(["ok.log", 7, "../x"])).toEqual(["ok.log"]);
    expect(snapshotGlobs(null)).toEqual([]);
  });
});

describe("the submission's artifacts", () => {
  const valid = {
    pool: "pool-a",
    repository: "acme-robotics/helios-firmware",
    ref: "refs/heads/main",
    commit: COMMIT,
  };

  it("are optional, and accepted when relative", () => {
    expect(failures(SubmitBuildJobDto, valid)).toEqual([]);
    expect(
      failures(SubmitBuildJobDto, { ...valid, artifacts: ["logs/serial-console.log"] }),
    ).toEqual([]);
  });

  it.each([
    ["an unsafe glob", ["../x"]],
    ["a repeat", ["a.log", "a.log"]],
    [
      "too many",
      Array.from({ length: ARTIFACT_GLOBS_MAX + 1 }, (_, index) => `f${String(index)}.log`),
    ],
    ["not a list", "a.log"],
  ])("are refused with %s", (_what, artifacts) => {
    expect(failures(SubmitBuildJobDto, { ...valid, artifacts })).toEqual(["artifacts"]);
  });
});

describe("a pool's artifact globs", () => {
  it("are accepted when relative, and [] clears them", () => {
    expect(failures(UpdatePoolDto, { artifactGlobs: ["captures/*.csv"] })).toEqual([]);
    expect(failures(UpdatePoolDto, { artifactGlobs: [] })).toEqual([]);
  });

  it("are refused when one would leave the workspace", () => {
    expect(failures(UpdatePoolDto, { artifactGlobs: ["/var/log/*"] })).toEqual(["artifactGlobs"]);
  });
});
