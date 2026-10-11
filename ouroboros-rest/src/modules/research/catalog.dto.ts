/**
 * The enable flow's request (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)).
 *
 * The body is the tool's form as submitted. Its grammar is the tool's own `configSchema()`,
 * which the service judges; this only bounds it — the same bounds, and the same validator, a
 * ticket source's configuration is held to, because the two forms share one dialect.
 */

import { IsString, Matches, Validate } from "class-validator";

import { IsTicketSourceConfig } from "../ticket-sources/sources.dto";
import type { ResearchToolConfigValue } from "./tools/research-tool.config";
import { TOOL_SLUG } from "./tools/research-tool.registry";

/** The `:slug` of `PUT /research/tools/:slug`. */
export class ToolParams {
  /** The tool — a `research_tools` slug. */
  @IsString()
  @Matches(TOOL_SLUG, { message: "slug must be a research tool slug" })
  slug!: string;
}

/** The body of `PUT /research/tools/:slug`. */
export class EnableToolDto {
  /**
   * The tool's settings, whole — the credential field included when one is being set. A
   * credential left out keeps the stored one.
   */
  @Validate(IsTicketSourceConfig)
  config!: Record<string, ResearchToolConfigValue>;
}
