import {
  conformanceContext,
  describeToolConformance,
  type ToolConformance,
} from "../conformance.fixture";
import { FAKE_CONFIG, FAKE_CORPUS, FAKE_SECRET, FakeResearchTool } from "./fake.tool.fixture";

/**
 * CL.1's first acceptance criterion: **the conformance kit is green for the fake tool.**
 *
 * A kit no implementation satisfies is a kit nobody can adopt; this is the one adapter proving
 * the rules are satisfiable. That the kit also refuses a non-conforming adapter is
 * `conformance.fixture.spec.ts`'s question.
 */

/**
 * A harness over a freshly built fake — its "recordings" are the results its corpus produces.
 *
 * @returns The harness.
 */
function harness(): ToolConformance {
  const tool = new FakeResearchTool();
  const context = conformanceContext({ config: FAKE_CONFIG, secret: FAKE_SECRET });

  return {
    adapter: tool,
    config: FAKE_CONFIG,
    secret: FAKE_SECRET,
    operations: {
      search: () => tool.search(context, "gust", { limit: 10 }),
      fetch: () => tool.fetch(context, FAKE_CORPUS[0].locator),
      query: () => tool.query(context, { locatorPrefix: "https://skylink" }),
    },
    failures: {
      auth: () => tool.willFail("auth").search(context, "gust", { limit: 10 }),
      network: () => tool.willFail("network").fetch(context, FAKE_CORPUS[0].locator),
      robots_denied: () => tool.willFail("robots_denied").fetch(context, FAKE_CORPUS[1].locator),
      rate_limited: () => tool.willFail("rate_limited").search(context, "gust", { limit: 10 }),
      upstream: () => tool.fetch(context, "https://nowhere.example.com/missing"),
      unsupported: () => tool.willFail("unsupported").fetch(context, FAKE_CORPUS[1].locator),
    },
    health: {
      healthy: () => tool.healthCheck(FAKE_CONFIG),
      degraded: () => tool.willReport("degraded").healthCheck(FAKE_CONFIG),
      down: () => tool.willReport("down").healthCheck(FAKE_CONFIG),
    },
  };
}

describeToolConformance("the in-memory fake", harness);
