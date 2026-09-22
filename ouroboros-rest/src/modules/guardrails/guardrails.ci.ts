/**
 * The CI-file registry — which paths are *pipeline configuration* rather than code.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)): the `ci_config` check flags a
 * change-set that touches any of these when the pinned stage's `touch_ci` permission is false.
 * A loop that can rewrite the pipeline judging it can make its own checks pass, which is why
 * the DSL carries `touch_ci` at all.
 *
 * **Versioned**, and the version is recorded on every `ci_config` verdict
 * (`guardrail_evaluations.ruleset_version`). Adding a CI system here changes what an old
 * change-set would have been judged as, and *"the registry grew"* is then a checkable
 * explanation for a verdict that changed while the code did not. Bump
 * {@link CI_REGISTRY_VERSION} with every edit to {@link CI_CONFIG_GLOBS}.
 *
 * Case-sensitive, as every glob here is (see `guardrails.glob.ts`).
 */

import { GlobSet } from "./guardrails.glob";

/** The registry's version, as `ruleset_version` records it. */
export const CI_REGISTRY_VERSION = "ci-v1";

/**
 * The registry: one entry per CI system, and the paths each one reads its pipeline from.
 *
 * Deliberately limited to files a CI system *executes*. `package.json` scripts, `Makefile`s and
 * `Dockerfile`s are run by pipelines too, but they are also the ordinary substance of a code
 * change, and a check that fired on every one of them would be a check people learn to ignore.
 */
export const CI_CONFIG_GLOBS: readonly string[] = [
  // GitHub Actions — workflows, and the composite actions they call.
  ".github/workflows/**",
  ".github/actions/**",
  // GitLab CI — the root file and the conventional include directory.
  ".gitlab-ci.yml",
  ".gitlab-ci.yaml",
  ".gitlab/ci/**",
  // Jenkins — `**/` admits the root file too.
  "**/Jenkinsfile",
  "jenkins/**",
  // CircleCI.
  ".circleci/**",
  // Travis CI.
  ".travis.yml",
  // Azure Pipelines.
  "azure-pipelines.yml",
  "azure-pipelines.yaml",
  ".azure-pipelines/**",
  // Bitbucket Pipelines.
  "bitbucket-pipelines.yml",
  // Buildkite.
  ".buildkite/**",
  // Drone.
  ".drone.yml",
  ".drone.yaml",
  // AppVeyor.
  "appveyor.yml",
  ".appveyor.yml",
  // Woodpecker.
  ".woodpecker.yml",
  ".woodpecker.yaml",
  ".woodpecker/**",
  // Google Cloud Build.
  "cloudbuild.yml",
  "cloudbuild.yaml",
  // AWS CodeBuild.
  "buildspec.yml",
  "buildspec.yaml",
  // Tekton.
  ".tekton/**",
  // Semaphore.
  ".semaphore/**",
  // Codefresh.
  "codefresh.yml",
  // Concourse, by its conventional directory.
  "ci/pipeline.yml",
  // Dependabot and Renovate open pull requests on a schedule the pipeline trusts.
  ".github/dependabot.yml",
  "renovate.json",
  ".github/renovate.json",
  // Pre-commit hooks run in most pipelines' lint stage.
  ".pre-commit-config.yaml",
];

/** The registry, compiled once. */
const REGISTRY = new GlobSet(CI_CONFIG_GLOBS);

/**
 * Is this path CI configuration?
 *
 * @param path - A repository-relative path.
 * @returns The registry glob that matched it, or `undefined` when it is not CI configuration.
 */
export function ciConfigGlob(path: string): string | undefined {
  return REGISTRY.match(path);
}
