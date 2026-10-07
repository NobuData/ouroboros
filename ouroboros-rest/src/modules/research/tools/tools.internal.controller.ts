/**
 * `POST /internal/research/tools/:slug/:op` — the only way the engine reaches a research tool.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). The decorators are the internal
 * surface's, as on every engine-facing route: `@InternalOnly()` puts it behind
 * `X-Ouro-Internal-Key` (`InternalKeyGuard`), and `@AllowAnonymous()` keeps the browser session
 * guard from answering first. What the answer may carry is the adapter's payload and the sources —
 * never a setting or a credential, which the `no-secret-in-internal-response` lint holds this
 * file to.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../../internal/internal.decorators";
import { RESEARCH_TOOL_OPERATION_ROUTE, RESEARCH_TOOLS_PATH } from "../../internal/internal.paths";
import { ResearchToolInvoker, type ToolInvocationResult } from "./research-tool.invoker";
import { ToolInvocationDto } from "./tools.internal.dto";

@InternalOnly()
@AllowAnonymous()
@Controller({ path: RESEARCH_TOOLS_PATH, version: VERSION_NEUTRAL })
export class ResearchToolsInternalController {
  /** @param invoker - The operation pipeline. */
  constructor(private readonly invoker: ResearchToolInvoker) {}

  /**
   * Run one tool operation for an investigation and archive its sources.
   *
   * @param slug - The tool — `web`, `competitor`, ….
   * @param operation - `search`, `fetch` or `query`.
   * @param request - The investigation, the input and the remaining budget.
   * @returns The payload, the archived sources with their cite numbers, and the budget left.
   */
  @Post(RESEARCH_TOOL_OPERATION_ROUTE)
  @HttpCode(HttpStatus.OK)
  operate(
    @Param("slug") slug: string,
    @Param("op") operation: string,
    @Body() request: ToolInvocationDto,
  ): Promise<ToolInvocationResult> {
    return this.invoker.invoke(slug, operation, {
      investigation: request.investigation,
      input: request.input,
      budget: { operations: request.budget.operations, tokens: request.budget.tokens ?? null },
    });
  }
}
