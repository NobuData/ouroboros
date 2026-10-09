/**
 * Hosted research-tool prices, read from the registered adapters — the binding #622's estimator
 * was waiting for (CL.2, #615).
 *
 * For each tool an estimate names, the workspace's stored configuration is read through
 * {@link ResearchToolSettings} and handed to the adapter's `operationPriceCents()`. A tool that
 * declares no price, an unregistered slug, and a configuration the adapter calls unpriced are all
 * left out — the estimate never guesses at somebody else's invoice.
 */

import { Injectable } from "@nestjs/common";

import { ResearchToolPricing } from "../tool-pricing";
import { ResearchToolRegistry } from "./research-tool.registry";
import { ResearchToolSettings } from "./research-tool.settings";

@Injectable()
export class RegistryToolPricing extends ResearchToolPricing {
  /**
   * @param registry - The registered adapters.
   * @param settings - Where a workspace's tool configuration is read.
   */
  constructor(
    private readonly registry: ResearchToolRegistry,
    private readonly settings: ResearchToolSettings,
  ) {
    super();
  }

  /**
   * The per-operation prices of this workspace's priced tools.
   *
   * @param organizationId - The workspace.
   * @param tools - The tool slugs the estimate is for.
   * @returns Cents per operation by slug, for tools whose configuration is priced above zero.
   */
  override async operationPrices(
    organizationId: string,
    tools: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    const prices = new Map<string, number>();

    for (const slug of new Set(tools)) {
      const adapter = this.registry.find(slug);
      if (adapter?.operationPriceCents === undefined) continue;

      const stored = await this.settings.settingsFor(organizationId, slug);
      const price = adapter.operationPriceCents(stored?.config ?? null);

      if (price !== null && Number.isFinite(price) && price > 0) prices.set(slug, price);
    }
    return prices;
  }
}
