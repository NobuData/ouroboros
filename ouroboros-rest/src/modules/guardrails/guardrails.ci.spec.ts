import { CI_CONFIG_GLOBS, CI_REGISTRY_VERSION, ciConfigGlob } from "./guardrails.ci";

/** The CI-file registry — what `ci_config` treats as pipeline configuration. */

describe("the CI registry", () => {
  it.each([
    [".github/workflows/ci.yml", ".github/workflows/**"],
    [".github/actions/setup/action.yml", ".github/actions/**"],
    [".gitlab-ci.yml", ".gitlab-ci.yml"],
    ["Jenkinsfile", "**/Jenkinsfile"],
    ["services/api/Jenkinsfile", "**/Jenkinsfile"],
    [".circleci/config.yml", ".circleci/**"],
    ["azure-pipelines.yml", "azure-pipelines.yml"],
    [".buildkite/pipeline.yml", ".buildkite/**"],
  ])("recognises %s", (path, glob) => {
    expect(ciConfigGlob(path)).toBe(glob);
  });

  it.each([
    "src/ci.yml",
    "docs/github/workflows.md",
    "package.json",
    "Makefile",
    "Dockerfile",
    "drivers/can/telemetry_buf.c",
  ])("does not treat %s as CI configuration", (path) => {
    expect(ciConfigGlob(path)).toBeUndefined();
  });

  it("is versioned, and has no duplicate entries", () => {
    expect(CI_REGISTRY_VERSION).toBe("ci-v1");
    expect(new Set(CI_CONFIG_GLOBS).size).toBe(CI_CONFIG_GLOBS.length);
  });
});
