/**
 * The lint boundary AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)) asks for,
 * as a build step rather than as a review habit.
 *
 * Decision **P1** says core code depends on the `ModelProviderAdapter` interface only and that
 * provider-specific knowledge lives behind the registry. Two rules below are that sentence,
 * made mechanical. `yarn lint` runs them, so a pull request that reaches for
 * `@anthropic-ai/sdk` inside a service — or imports `adapters/ollama` to get at a detail the
 * SPI does not expose — is a red check rather than something a reviewer has to notice.
 *
 * The third rule is the same sentence about a different SDK. The amendment posted on K.3
 * (#101) on 2026-08-09 requires that Octokit not be imported outside the module that owns the
 * GitHub provider, *"and that boundary is lint-enforced in CI"* — so it is a rule here rather
 * than a paragraph in a README. `src/modules/github/github.octokit.ts` is the seam; when Q.3
 * (#140) turns the GitHub client into the first `TicketSourceProvider`, the seam moves and
 * this rule's `pathNot` moves with it.
 *
 * `providers/boundary.spec.ts` and `github/boundary.spec.ts` prove the rules bite: each
 * builds a tree containing exactly the violation its rule describes, cruises it with *this*
 * configuration, and asserts the violation is reported. A lint rule nobody has watched fail is
 * a lint rule that passes everything.
 *
 * ---------------------------------------------------------------------------
 * **Why a package list rather than "anything that looks like an SDK".**
 *
 * There is no property of a module name that means *this is a provider SDK*. So the list is
 * explicit, it covers the five kinds that ship plus the three the add-card promises — OpenAI,
 * Google, Bedrock — and adding a provider means adding its package here. That is the intended
 * cost: an adapter's dependency is a decision, and this is where the decision is recorded.
 *
 * The pattern matches both a resolved path (`node_modules/openai/index.js`) and a bare
 * specifier, because a package that is not installed still has to be caught — which is exactly
 * the state a first offending import arrives in.
 *
 * ---------------------------------------------------------------------------
 * **What is deliberately not enforced.** Nothing here says a *test* may not import an adapter.
 * The in-memory fake exists to power core tests, so `provider-health`'s suite reaching for
 * `adapters/fake.adapter.fixture` is the framework working. Production code doing it is not,
 * and that is the distinction the second rule's `pathNot` draws.
 *
 * @type {import("dependency-cruiser").IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-provider-sdk-outside-adapters",
      severity: "error",
      comment:
        "A provider SDK belongs behind the ModelProviderAdapter SPI (decision P1, #216). " +
        "Import it from src/modules/providers/adapters/ and expose what core code needs " +
        "through the interface.",
      from: { path: "^src/", pathNot: "^src/modules/providers/adapters/" },
      to: {
        path:
          "(^|node_modules/)(@anthropic-ai|@aws-sdk/client-bedrock(-runtime)?|@azure/openai|" +
          "@google-cloud/aiplatform|@google/genai|@google/generative-ai|@mistralai|" +
          "cohere-ai|ollama|openai)(/|$)",
      },
    },
    {
      name: "core-imports-the-spi-only",
      severity: "error",
      comment:
        "Core services reach an adapter through ModelProviderRegistry, never by importing " +
        "one (decision P1, #216). providers.module.ts is the single registration point; " +
        "tests are exempt, because the in-memory fake exists to power them.",
      from: {
        path: "^src/",
        pathNot:
          "^src/modules/providers/(providers\\.module\\.ts|adapters/)|spec\\.ts$|\\.fixture\\.ts$",
      },
      to: { path: "^src/modules/providers/adapters/" },
    },
    {
      name: "no-octokit-outside-the-seam",
      severity: "error",
      comment:
        "The GitHub SDK belongs behind one seam (K.3, #101, and the 2026-08-09 amendment " +
        "on it). src/modules/github/github.octokit.ts is the only file that may import " +
        "@octokit/*; everything else is written against OctokitLike in github.client.ts. " +
        "When Q.3 (#140) moves this behind the ticket-source SPI, move the pathNot with it.",
      from: { path: "^src/", pathNot: "^src/modules/github/github\\.octokit\\.ts$" },
      to: { path: "(^|node_modules/)@octokit(/|$)" },
    },

    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle through the SPI would let an adapter reach back into the core that is " +
        "supposed to depend only on the interface — and cycles break Nest's provider " +
        "resolution in ways that surface as an undefined injection at run time.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Everything under node_modules is somebody else's graph. It is still *resolved*, which is
    // what the first rule needs, but it is not walked into.
    doNotFollow: { path: "node_modules" },
    // The same strict configuration `yarn typecheck` and ts-jest read, so a path this service
    // can compile is a path this can resolve.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["main", "types"],
    },
  },
};
