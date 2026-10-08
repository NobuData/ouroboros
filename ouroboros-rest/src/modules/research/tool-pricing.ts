/**
 * What hosted research-tool providers charge per operation — the estimator's second price input.
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622): *planned synthesis calls × alias
 * pricing **+ priced tool operations** where a hosted provider charges*. The prices themselves
 * are declared by a tool's provider configuration — CL.2's web search adapter
 * ([#615](https://github.com/NobuData/ouroboros/issues/615)) is the first that can be pointed at
 * a paid API — and none of those configurations exists yet. So this is the seam rather than the
 * source: an injectable class the estimator asks, whose default answers *no hosted provider is
 * configured*, and which #615 replaces with one reading its provider configs.
 *
 * The default answers *nothing* rather than a guessed per-search price. A tool with no declared
 * price is either self-hosted or not configured, and in neither case does the estimate get to
 * invent what somebody else's invoice would say.
 */

import { Injectable } from "@nestjs/common";

@Injectable()
export class ResearchToolPricing {
  /**
   * The per-operation prices of this workspace's hosted research-tool providers.
   *
   * @param organizationId - The workspace.
   * @param tools - The tool slugs the estimate is for; a provider for another tool is irrelevant.
   * @returns Cents per operation by tool slug, for tools whose provider charges. The default
   *   implementation returns an empty map: no hosted provider is configured.
   */
  operationPrices(
    organizationId: string,
    tools: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    void organizationId;
    void tools;
    return Promise.resolve(new Map());
  }
}
