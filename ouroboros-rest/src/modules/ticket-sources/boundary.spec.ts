import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MODULE_ROOT, cruise, cruiseFixture } from "../../testing/depcruise.fixture";

/**
 * Q.2's **first** acceptance criterion: *"the core sync loop compiles against the SPI only — a
 * provider-specific import in core code fails CI (dependency-cruiser or equivalent lint
 * rule)"* ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * Each case below builds a tiny source tree containing exactly the violation it describes,
 * cruises it with the service's *real* `.dependency-cruiser.cjs`, and asserts the named rule
 * reports it and the process exits non-zero. A lint rule nobody has watched fail is a lint
 * rule that passes everything — and a rule whose regular expression has quietly stopped
 * matching looks identical to a codebase with no violations.
 *
 * `src/modules/ticket-sources/providers/` arrived with Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)) and holds the GitHub provider. The
 * rules below were written before it existed — a boundary added after the first thing crosses
 * it is a boundary that has to be argued rather than enforced — and the fixture trees still
 * build their own files, so each case is a violation in isolation rather than a claim about
 * whatever happens to be in the directory today.
 *
 * The harness is `testing/depcruise.fixture.ts`, shared with `providers/boundary.spec.ts`
 * (AC.1) and `github/boundary.spec.ts` (K.3) — a third copy would be a third thing that can
 * drift, and the copy that drifts is the one that quietly stops finding the executable and
 * reports a clean tree.
 */

/** A stand-in provider, for the trees whose violation is importing one. */
const A_PROVIDER = "src/modules/ticket-sources/providers/github.provider.ts";

/** Its contents. Deliberately trivial — what is under test is who imports it. */
const A_PROVIDER_SOURCE = "export class GithubTicketSourceProvider {}\n";

describe("the ticket source boundary", () => {
  it("is clean across the whole service", () => {
    const result = cruise(MODULE_ROOT);

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on the sync loop importing a provider directly", () => {
    // The criterion's own sentence, as a tree. This is the import the line
    // `if (source.kind === "github")` needs before it can be written, which is why the
    // boundary is here rather than in a review checklist.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/ticket-sources/ticket-sources.service.ts":
        'import { GithubTicketSourceProvider } from "./providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("ticket-source-core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails the build on any other module reaching for one", () => {
    // Not only the loop: Q.4's management API and R.1's trigger evaluation are the next two
    // things that will want a provider's specifics, and both go through the registry.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/backlog/listing.repository.ts":
        'import { GithubTicketSourceProvider } from "../ticket-sources/providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("ticket-source-core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows ticket-sources.module.ts to import one, because registration has to happen somewhere", () => {
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/ticket-sources/ticket-sources.module.ts":
        'import { GithubTicketSourceProvider } from "./providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("allows one provider to import another's file, because that is inside the seam", () => {
    // A shared HTTP helper between two providers is their business. The boundary is about what
    // *core* knows, not about how the providers are organised among themselves.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/ticket-sources/providers/gitlab.provider.ts":
        'import { GithubTicketSourceProvider } from "./github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("allows a test and a fixture to import one, which is what Q.5's fake is for", () => {
    // A suite that could not reach the in-memory provider would have to reach a network
    // instead. `providers/boundary.spec.ts` draws the same distinction for model adapters.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/ticket-sources/providers/fake.provider.fixture.ts":
        'import { GithubTicketSourceProvider } from "./github.provider";\n\n' +
        "export class Fake extends GithubTicketSourceProvider {}\n",
      "src/modules/backlog/listing.repository.spec.ts":
        'import { Fake } from "../ticket-sources/providers/fake.provider.fixture";\n\n' +
        "export const a = Fake;\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on a tracker SDK imported outside the providers directory", () => {
    // Note the packages are not installed — which is exactly the state a first offending
    // import arrives in, and the reason the rule's pattern has to match a bare specifier as
    // well as a resolved path.
    const promised = ["jira-client", "@linear/sdk", "@gitbeaker/rest"];
    const result = cruiseFixture(
      Object.fromEntries(
        promised.map((specifier, index) => [
          `src/modules/ticket-sources/reach${index.toString()}.ts`,
          `import x from "${specifier}";\n\nexport const y = x;\n`,
        ]),
      ),
    );

    for (const specifier of promised) {
      expect(result.output).toContain(specifier);
    }

    expect(result.output).toContain("no-tracker-sdk-outside-ticket-source-providers");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows a tracker SDK inside providers/, which is the whole point of the seam", () => {
    const result = cruiseFixture({
      "src/modules/ticket-sources/providers/jira.provider.ts":
        'import JiraApi from "jira-client";\n\nexport const client = JiraApi;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("leaves Octokit to the seam K.3 already gave it", () => {
    // Two rules naming one package would make the shipped GitHub client violate the new one
    // the day it landed, so `no-octokit-outside-the-seam` still owns `@octokit/*` on its own.
    //
    // Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)) was expected to move that
    // rule's `pathNot` into `providers/`, and **did not**, because the premise changed: K.3 and
    // K.4 had shipped by the time it was built, so `GithubTicketSourceProvider` *reuses*
    // `GithubClient` rather than cutting a second client. One seam, one file, one rule — which
    // is a stronger reading of this ticket's third criterion than moving the file would have
    // been, and the next case is what makes that true rather than asserted.
    const result = cruiseFixture({
      "src/modules/github/github.octokit.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on Octokit imported inside providers/, because the seam is one file", () => {
    // Q.3's third acceptance criterion — *"no Octokit import exists outside the provider
    // module (CI-enforced)"* — read the strict way: `providers/` is not an exemption either.
    // A provider that reached for the library would be a second place the ES-module transform
    // has to be kept working, and a second place a token could be handed to a constructor.
    const result = cruiseFixture({
      "src/modules/ticket-sources/providers/github.provider.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
    });

    expect(result.output).toContain("no-octokit-outside-the-seam");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails the build on a core intake suite, the kit or a shared fixture reaching for GitHub", () => {
    // Q.5's third acceptance criterion — *"the core intake harness runs entirely on the fake: no
    // Octokit import in those tests"* ([#142](https://github.com/NobuData/ouroboros/issues/142)) —
    // as a tree. Three ways of reaching for GitHub, from the three kinds of file the rule covers.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/github/github.fixture.ts": "export const httpError = 1;\n",
      "src/modules/ticket-sources/ticket-sources.integration-spec.ts":
        'import { GithubTicketSourceProvider } from "./providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
      "src/modules/ticket-sources/conformance.fixture.ts":
        'import { httpError } from "../github/github.fixture";\n\nexport const a = httpError;\n',
      "src/modules/ticket-sources/ticket-sync.integration.fixture.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const a = Octokit;\n',
    });

    for (const file of [
      "ticket-sources.integration-spec.ts",
      "conformance.fixture.ts",
      "ticket-sync.integration.fixture.ts",
    ]) {
      expect(result.output).toMatch(
        new RegExp(
          `ticket-source-core-tests-run-on-the-fake: src/modules/ticket-sources/${file.replaceAll(".", "\\.")}`,
        ),
      );
    }

    expect(result.exitCode).not.toBe(0);
  });

  it("allows GitHub's own suites, beside the provider, to reach for GitHub", () => {
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/github/github.fixture.ts": "export const httpError = 1;\n",
      "src/modules/ticket-sources/providers/github.provider.integration-spec.ts":
        'import { httpError } from "../../github/github.fixture";\n' +
        'import { GithubTicketSourceProvider } from "./github.provider";\n\n' +
        "export const a = [httpError, GithubTicketSourceProvider];\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("allows the management API's suites and the module's wiring spec to name GitHub, as Q.4 does", () => {
    // Q.4's criterion is *"add GitHub source → test → sync → tickets appear"*, and the module spec
    // asserts what the registration point registers. Both are about GitHub by name.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/github/github.fixture.ts": "export const httpError = 1;\n",
      "src/modules/ticket-sources/sources.integration-spec.ts":
        'import { httpError } from "../github/github.fixture";\n' +
        'import { GithubTicketSourceProvider } from "./providers/github.provider";\n\n' +
        "export const a = [httpError, GithubTicketSourceProvider];\n",
      "src/modules/ticket-sources/ticket-sources.module.spec.ts":
        'import { GithubTicketSourceProvider } from "./providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on the push service importing a provider, because it writes through the SPI only", () => {
    // AL.2's (#278) criterion — *"the push service imports the interface only"* — as a tree. The
    // write path is where a `switch` over tracker kinds would do the most damage, so the same rule
    // that holds the sync loop holds whichever module AL.3 (#279) puts the push service in.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/planning/push.service.ts":
        'import { GithubTicketSourceProvider } from "../ticket-sources/providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("ticket-source-core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails the build on the push service importing a tracker SDK directly", () => {
    const result = cruiseFixture({
      "src/modules/planning/push.service.ts":
        'import { LinearClient } from "@linear/sdk";\n\nexport const a = LinearClient;\n',
    });

    expect(result.output).toContain("no-tracker-sdk-outside-ticket-source-providers");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows the push service to import the SPI's write interface", () => {
    // The other half: a boundary that also refused the interface would be one nobody could build
    // against, and would be switched off the first afternoon somebody tried.
    const result = cruiseFixture({
      "src/modules/ticket-sources/ticket-source.write.ts": "export const READ_ONLY = {};\n",
      "src/modules/ticket-sources/ticket-source.provider.ts":
        'import { READ_ONLY } from "./ticket-source.write";\n\n' +
        "export function supportsWrites() {\n  return READ_ONLY;\n}\n",
      "src/modules/planning/push.service.ts":
        'import { supportsWrites } from "../ticket-sources/ticket-source.provider";\n' +
        'import { READ_ONLY } from "../ticket-sources/ticket-source.write";\n\n' +
        "export const a = [supportsWrites, READ_ONLY];\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on the PR sync importing the GitHub provider, because it syncs through the SPI only", () => {
    // AX.1's (#357) boundary, as a tree: the PR plane is core, and core reaches a host through the
    // registry. The gate engine and merge executor land in the same module and inherit it.
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/pull-requests/pr-sync.service.ts":
        'import { GithubTicketSourceProvider } from "../ticket-sources/providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
    });

    expect(result.output).toContain("ticket-source-core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails the build on Octokit imported by the GitHub PR implementation, because the seam is one file", () => {
    // AX.1's criterion — *"no Octokit import outside the provider package"* — read the strict way
    // Q.3 read it: `github.pr.ts` reaches GitHub through K.3's client like the rest of the provider.
    const result = cruiseFixture({
      "src/modules/ticket-sources/providers/github.pr.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
    });

    expect(result.output).toContain("no-octokit-outside-the-seam");
    expect(result.exitCode).not.toBe(0);
  });

  it("fails the build on a PR-plane suite reaching for GitHub, because it runs on the fake host", () => {
    const result = cruiseFixture({
      [A_PROVIDER]: A_PROVIDER_SOURCE,
      "src/modules/github/github.fixture.ts": "export const httpError = 1;\n",
      "src/modules/pull-requests/pr-sync.service.spec.ts":
        'import { GithubTicketSourceProvider } from "../ticket-sources/providers/github.provider";\n\n' +
        "export const a = GithubTicketSourceProvider;\n",
      "src/modules/pull-requests/pr-sync.integration-spec.ts":
        'import { httpError } from "../github/github.fixture";\n\nexport const a = httpError;\n',
    });

    for (const file of ["pr-sync.service.spec.ts", "pr-sync.integration-spec.ts"]) {
      expect(result.output).toMatch(
        new RegExp(
          `ticket-source-core-tests-run-on-the-fake: src/modules/pull-requests/${file.replaceAll(".", "\\.")}`,
        ),
      );
    }

    expect(result.exitCode).not.toBe(0);
  });

  it("allows the PR plane's suites to run on the in-memory host", () => {
    const result = cruiseFixture({
      "src/modules/ticket-sources/providers/in-memory.pr.fixture.ts": "export const Host = 1;\n",
      "src/modules/pull-requests/pr-sync.service.spec.ts":
        'import { Host } from "../ticket-sources/providers/in-memory.pr.fixture";\n\n' +
        "export const a = Host;\n",
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("is what `yarn lint` runs, or none of the above is a build failure", () => {
    // The other half of the criterion — *"fails CI"*. Rules that CI does not execute are a
    // file, not a gate.
    const manifest = JSON.parse(readFileSync(join(MODULE_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts.lint).toContain("depcruise");
  });
});
