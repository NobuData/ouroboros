import {
  artifactKind,
  BUILT_IN_ARTIFACT_GLOBS,
  isArtifactName,
  OFFER_GLOBS_MAX,
  offerGlobs,
  uploadPath,
} from "./upload.policy";

/** The upload's fixed shape (#330): the offer's globs, the path, the kinds and the names. */

describe("an offer's globs", () => {
  it("always carry the built-in result set first", () => {
    expect(offerGlobs([])).toEqual(BUILT_IN_ARTIFACT_GLOBS);
  });

  it("add the job's snapshot, without repeating a built-in", () => {
    expect(offerGlobs(["**/junit*.xml", "captures/*.csv"])).toEqual([
      ...BUILT_IN_ARTIFACT_GLOBS,
      "captures/*.csv",
    ]);
  });

  it("stay within the protocol's ceiling, and survive a column that is not a list", () => {
    const many = Array.from({ length: 200 }, (_, index) => `f${String(index)}.log`);

    expect(offerGlobs(many)).toHaveLength(OFFER_GLOBS_MAX);
    expect(offerGlobs("junit.xml")).toEqual(BUILT_IN_ARTIFACT_GLOBS);
  });
});

describe("the upload path", () => {
  it("is the job's artifacts route below /api/v1", () => {
    expect(uploadPath("0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6")).toBe(
      "/api/v1/farm/jobs/0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6/artifacts",
    );
  });
});

describe("an artifact's kind", () => {
  it.each([
    ["junit-build3.xml", "junit", false, "junit"],
    ["ouro-hil-results.json", "hil", false, "hil"],
    ["lcov.info", "coverage", true, "coverage"],
    // V059 registers a coverage row only with its counts; an unreadable report is kept as other.
    ["lcov.info", "coverage", false, "other"],
    ["serial-console.log", null, false, "log"],
    ["build/output.TXT", null, false, "log"],
    ["rig-capture-estop.csv", null, false, "capture"],
    ["can-bus.pcapng", null, false, "capture"],
    ["zephyr.map", null, false, "other"],
    ["Makefile", null, false, "other"],
  ] as const)("%s read by %s is %s", (name, parser, counts, kind) => {
    expect(artifactKind(name, parser, counts)).toBe(kind);
  });
});

describe("an artifact name", () => {
  it.each(["junit.xml", "build/zephyr/junit-build3.xml", "serial console · ü.log", "..a/b"])(
    "accepts %j",
    (name) => {
      expect(isArtifactName(name)).toBe(true);
    },
  );

  it.each([
    "",
    "/abs.xml",
    "a/../b",
    "../a",
    "a/./b",
    "a//b",
    "a\\b",
    " padded",
    "a\tb",
    "x".repeat(256),
  ])("refuses %j", (name) => {
    expect(isArtifactName(name)).toBe(false);
  });
});
