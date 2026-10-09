/**
 * Build the web tool from the deployment's configuration — the one place the `OURO_RESEARCH_*`
 * variables meet the adapter, called by `research-tools.module.ts`, the registration point.
 */

import type { AppConfigService } from "../../../../config/config.service";
import { InternalAllowlist } from "../../../../webhooks/webhook.ssrf";
import { PageFetcher } from "./web.fetcher";
import { WebResearchTool, fetchSearchHttp } from "./web.tool";
import { GuardedPageTransport } from "./web.transport";

/**
 * The production web tool.
 *
 * @param config - The deployment's configuration.
 * @returns The tool, with its page reader, provider client and bounds.
 */
export function buildWebTool(config: AppConfigService): WebResearchTool {
  const fetcher = new PageFetcher(
    new GuardedPageTransport(new InternalAllowlist(config.researchFetchInternalAllowlist)),
    {
      timeoutMs: config.researchFetchTimeoutMs,
      maxBytes: config.researchFetchMaxBytes,
      maxRedirects: config.researchFetchMaxRedirects,
      hostIntervalMs: config.researchHostIntervalMs,
    },
  );

  return new WebResearchTool({
    fetcher,
    http: fetchSearchHttp,
    defaultSearxngUrl: config.researchSearxngUrl,
    timeoutMs: config.researchFetchTimeoutMs,
  });
}
