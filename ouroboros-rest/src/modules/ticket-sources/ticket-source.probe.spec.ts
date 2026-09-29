/** The probe family's declaration and path grammar ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import {
  NO_PROBE_CAPABILITIES,
  PROBE_REPO_REF,
  isProbePath,
  probeCapabilityViolations,
} from "./ticket-source.probe";

describe("isProbePath", () => {
  it.each([
    "west.yml",
    ".devcontainer/devcontainer.json",
    "tests/kernel/timer/src/main.c",
    "a..b/c",
  ])("accepts %s", (path) => {
    expect(isProbePath(path)).toBe(true);
  });

  it.each([
    "",
    "/etc/passwd",
    "../secret",
    "a/../b",
    "a/..",
    "a\\b",
    "tests/*.c",
    "a?b",
    "a[1]",
    "a\u0000b",
    "x".repeat(513),
  ])("refuses %j", (path) => {
    expect(isProbePath(path)).toBe(false);
  });
});

describe("PROBE_REPO_REF", () => {
  it("is V067's repo_ref grammar", () => {
    expect(PROBE_REPO_REF.test("acme-robotics/helios-firmware")).toBe(true);
    expect(PROBE_REPO_REF.test("group/sub/project")).toBe(true);
    expect(PROBE_REPO_REF.test("solo")).toBe(false);
    expect(PROBE_REPO_REF.test("acme/..")).toBe(false);
  });
});

describe("probeCapabilityViolations", () => {
  it("accepts the tracker's declaration", () => {
    expect(probeCapabilityViolations(NO_PROBE_CAPABILITIES)).toEqual([]);
    expect(probeCapabilityViolations({ repoProbes: true })).toEqual([]);
  });

  it("names what is malformed", () => {
    expect(probeCapabilityViolations(undefined)).toEqual(["probe must be an object"]);
    expect(probeCapabilityViolations({ repoProbes: 1 })).toEqual([
      "probe.repoProbes must be a boolean",
    ]);
  });

  it("is frozen, so no provider can flip the shared declaration", () => {
    expect(Object.isFrozen(NO_PROBE_CAPABILITIES)).toBe(true);
  });
});
