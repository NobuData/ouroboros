/**
 * The web tool, through the conformance kit — once per provider.
 *
 * #615's provider criterion: *switching to a recorded-fixture Brave or Tavily configuration changes
 * configuration only — conformance-verified, no code path differences.* So the kit runs four times
 * over the **same** `WebResearchTool` class, built the same way, and only the configuration (and,
 * for a hosted provider, the key) differs between the runs.
 */

import {
  conformanceContext,
  describeToolConformance,
  type ToolConformance,
} from "../../conformance.fixture";
import { PageFetcher } from "./web.fetcher";
import {
  ARTICLE_URL,
  MISSING_URL,
  ManualClock,
  PDF_URL,
  PRIVATE_URL,
  PROVIDER_CONFIGS,
  RECORDED_KEY,
  RecordedProviders,
  RecordedSite,
  UNREACHABLE_URL,
} from "./web.recordings.fixture";
import { WebResearchTool } from "./web.tool";

const LIMITS = { timeoutMs: 15_000, maxBytes: 5_242_880, maxRedirects: 5, hostIntervalMs: 1000 };

/**
 * A harness for one provider configuration.
 *
 * @param provider - Which recorded configuration.
 * @returns The kit's harness.
 */
function harnessFor(provider: string): () => ToolConformance {
  return () => {
    const clock = new ManualClock();
    const providers = new RecordedProviders(clock);
    const tool = new WebResearchTool({
      fetcher: new PageFetcher(new RecordedSite(undefined, clock), LIMITS, clock),
      http: providers.http,
      defaultSearxngUrl: "http://searxng.test:8080",
      timeoutMs: 15_000,
      now: () => new Date(clock.now()),
    });
    const config = PROVIDER_CONFIGS[provider];
    const secret = provider === "searxng" ? null : RECORDED_KEY;
    const context = conformanceContext({ config, secret });
    const failing = (mode: RecordedProviders["mode"]) => () => {
      providers.mode = mode;
      return tool.search(context, "gust docking", { limit: 10 });
    };

    return {
      adapter: tool,
      config,
      secret,
      operations: {
        search: () => {
          providers.mode = "ok";
          return tool.search(context, "gust docking", { limit: 10 });
        },
        fetch: () => tool.fetch(context, ARTICLE_URL),
      },
      failures: {
        ...(provider === "searxng" ? {} : { auth: failing("unauthorized") }),
        network: () => tool.fetch(context, UNREACHABLE_URL),
        robots_denied: () => tool.fetch(context, PRIVATE_URL),
        rate_limited: failing("rate_limited"),
        upstream: () => tool.fetch(context, MISSING_URL),
        unsupported: () => tool.fetch(context, PDF_URL),
      },
      health: {
        healthy: () => {
          providers.mode = "ok";
          return tool.healthCheck(config, secret);
        },
        degraded: () => {
          providers.mode = "slow";
          return tool.healthCheck(config, secret);
        },
        down: () => {
          providers.mode = "down";
          return tool.healthCheck(config, secret);
        },
      },
    };
  };
}

for (const provider of Object.keys(PROVIDER_CONFIGS)) {
  describeToolConformance(`the web tool on ${provider}`, harnessFor(provider));
}
