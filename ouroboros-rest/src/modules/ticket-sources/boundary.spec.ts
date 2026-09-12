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
 * **The directory under test does not exist yet**, and that is the point rather than a gap:
 * `src/modules/ticket-sources/providers/` arrives with Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)), and a boundary added after the
 * first thing crosses it is a boundary that has to be argued rather than enforced. The fixture
 * trees create the files the rule is about, so the rule is exercised against exactly the
 * layout Q.3 will land into.
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
    // the day it landed. `no-octokit-outside-the-seam` still owns `@octokit/*`, and Q.3 moves
    // its `pathNot` into `providers/` when the client becomes a provider.
    const result = cruiseFixture({
      "src/modules/github/github.octokit.ts":
        'import { Octokit } from "@octokit/rest";\n\nexport const client = Octokit;\n',
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
