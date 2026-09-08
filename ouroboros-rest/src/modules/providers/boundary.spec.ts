import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MODULE_ROOT, cruise, cruiseFixture } from "../../testing/depcruise.fixture";

/**
 * AC.1's second acceptance criterion: **the dependency-cruiser boundary fails the build on a
 * direct provider import outside `adapters/` — spot-verified by adding one.**
 *
 * "Spot-verified by adding one" is taken literally. Each case below builds a tiny source tree
 * containing exactly the violation it describes, cruises it with the service's *real*
 * `.dependency-cruiser.cjs`, and asserts the named rule reports it and the process exits
 * non-zero. A lint rule nobody has watched fail is a lint rule that passes everything — and a
 * rule whose regular expression has quietly stopped matching looks identical to a codebase with
 * no violations.
 *
 * The harness that builds and cruises those trees is `testing/depcruise.fixture.ts`, shared
 * with `github/boundary.spec.ts` (K.3, [#101](https://github.com/NobuData/ouroboros/issues/101))
 * since a second rule needed the same proof.
 *
 * The last case is the other half of the criterion: `yarn lint` has to actually run this, or the
 * rules are a file nobody executes.
 */

/** A stand-in adapter, for the trees whose violation is importing one. */
const AN_ADAPTER = "src/modules/providers/adapters/ollama.adapter.ts";

/** Its contents. Deliberately trivial — what is under test is who imports it. */
const AN_ADAPTER_SOURCE = "export class OllamaAdapter {}\n";

describe("the provider boundary", () => {
  it("is clean across the whole service", () => {
    const result = cruise(MODULE_ROOT);

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on a provider SDK imported outside adapters/", () => {
    // The violation the criterion names, added. Note the package is not installed — which is
    // exactly the state a first offending import arrives in, and the reason the rule's pattern
    // has to match a bare specifier as well as a resolved path.
    const result = cruiseFixture({
      "src/modules/credentials/credentials.service.ts":
        'import Anthropic from "@anthropic-ai/sdk";\n\nexport const client = Anthropic;\n',
    });

    expect(result.output).toContain("no-provider-sdk-outside-adapters");
    expect(result.exitCode).not.toBe(0);
  });

  it("catches every SDK the add-card promises, in one cruise", () => {
    // One tree rather than one per package: the rule is a single regular expression, and what is
    // worth checking is that its alternation really covers the five kinds that ship plus the
    // three the dashed card promises — OpenAI, Google, Bedrock.
    const promised = [
      "@anthropic-ai/sdk",
      "openai",
      "ollama",
      "@aws-sdk/client-bedrock-runtime",
      "@google/genai",
    ];
    const result = cruiseFixture(
      Object.fromEntries(
        promised.map((specifier, index) => [
          `src/modules/credentials/reach${index.toString()}.ts`,
          `import x from "${specifier}";\n\nexport const y = x;\n`,
        ]),
      ),
    );

    for (const specifier of promised) {
      expect(result.output).toContain(`no-provider-sdk-outside-adapters: src/modules/credentials/`);
      expect(result.output).toContain(specifier);
    }

    expect(result.exitCode).not.toBe(0);
  });

  it("allows a provider SDK inside adapters/, which is the whole point of the seam", () => {
    const result = cruiseFixture({
      "src/modules/providers/adapters/anthropic.adapter.ts":
        'import Anthropic from "@anthropic-ai/sdk";\n\nexport const client = Anthropic;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on a core service importing an adapter directly", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/discovery/discovery.service.ts":
        'import { OllamaAdapter } from "../providers/adapters/ollama.adapter";\n\nexport const a = OllamaAdapter;\n',
    });

    expect(result.output).toContain("core-imports-the-spi-only");
    expect(result.exitCode).not.toBe(0);
  });

  it("allows providers.module.ts to import one, because registration has to happen somewhere", () => {
    const result = cruiseFixture({
      [AN_ADAPTER]: AN_ADAPTER_SOURCE,
      "src/modules/providers/providers.module.ts":
        'import { OllamaAdapter } from "./adapters/ollama.adapter";\n\nexport const a = OllamaAdapter;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("allows a test to import the fake, which is what the fake is for", () => {
    // A suite that could not reach the in-memory adapter would have to reach a network instead.
    const result = cruiseFixture({
      "src/modules/providers/adapters/fake.adapter.fixture.ts": "export class Fake {}\n",
      "src/modules/discovery/discovery.service.spec.ts":
        'import { Fake } from "../providers/adapters/fake.adapter.fixture";\n\nexport const a = Fake;\n',
    });

    expect(result.output).toContain("no dependency violations found");
    expect(result.exitCode).toBe(0);
  });

  it("fails the build on a cycle", () => {
    const result = cruiseFixture({
      "src/modules/a/a.ts": 'import { b } from "../b/b";\n\nexport const a = b;\n',
      "src/modules/b/b.ts": 'import { a } from "../a/a";\n\nexport const b = a;\n',
    });

    expect(result.output).toContain("no-circular");
    expect(result.exitCode).not.toBe(0);
  });

  it("is what `yarn lint` runs, or none of the above is a build failure", () => {
    // The other half of the criterion. Rules that CI does not execute are a file, not a gate.
    const manifest = JSON.parse(readFileSync(join(MODULE_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts.lint).toContain("depcruise");
  });
});
