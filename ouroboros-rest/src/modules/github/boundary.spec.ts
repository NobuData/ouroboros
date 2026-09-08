import { cruiseFixture } from "../../testing/depcruise.fixture";

/**
 * The amendment posted on K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)) on
 * 2026-08-09, as a test: *"Octokit may not be imported outside the provider module, and that
 * boundary is lint-enforced in CI."*
 *
 * Spot-verified by adding the violation, the way `providers/boundary.spec.ts` verifies its
 * own rules and for its reason: a rule whose regular expression has quietly stopped matching
 * looks exactly like a codebase with no violations. The harness is
 * `testing/depcruise.fixture.ts`, and the rules are the service's real
 * `.dependency-cruiser.cjs` rather than a copy.
 *
 * The clean-tree case and the *"`yarn lint` runs this"* case are asserted once, in
 * `providers/boundary.spec.ts`; both are about the configuration as a whole rather than about
 * either rule, and asserting them twice would be two suites failing for one reason.
 */

describe("the Octokit boundary", () => {
  it("fails the build on Octokit imported outside the seam", () => {
    // The violation the amendment names, added. The specifier resolves — the package *is*
    // installed here — which is the other half of the rule's pattern working.
    const result = cruiseFixture({
      "src/modules/queue/queue.service.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
    });

    expect(result.output).toContain("no-octokit-outside-the-seam");
    expect(result.exitCode).not.toBe(0);
  });

  it("catches a reach for a sub-package, not only the umbrella one", () => {
    // `@octokit/rest` is a façade over `@octokit/core`, `@octokit/request` and the plugins.
    // A rule that named only the façade would be a seam with a door beside it.
    const result = cruiseFixture({
      "src/modules/sync/sync.service.ts":
        'import { request } from "@octokit/request";\n\nexport const send = request;\n',
    });

    expect(result.output).toContain("no-octokit-outside-the-seam");
    expect(result.exitCode).not.toBe(0);
  });

  it("catches it in a spec too, unlike the adapter rule", () => {
    // Deliberately different from `core-imports-the-spi-only`, which exempts tests because the
    // in-memory fake exists to power them. There is no such fake here: `github.octokit.spec.ts`
    // *is* the one suite that loads the library, and it does so through the seam. A second
    // spec importing the library directly would be a second place the ES-module transform has
    // to be kept working.
    const result = cruiseFixture({
      "src/modules/sync/sync.service.spec.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
    });

    expect(result.output).toContain("no-octokit-outside-the-seam");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows it in github.octokit.ts, which is the whole point of the seam", () => {
    const result = cruiseFixture({
      "src/modules/github/github.octokit.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("allows the client to import the seam, because that is not importing the library", () => {
    const result = cruiseFixture({
      "src/modules/github/github.octokit.ts": "export const createOctokit = () => ({});\n",
      "src/modules/github/github.module.ts":
        'import { createOctokit } from "./github.octokit";\n\nexport const bound = createOctokit;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });
});
