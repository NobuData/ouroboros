/**
 * The request body of `POST /internal/research/tools/:slug/:op` (CL.1,
 * [#614](https://github.com/NobuData/ouroboros/issues/614)).
 *
 * The shape is validated here; what the `input` must hold depends on the operation and is judged
 * by `research-tool.invoker.ts`'s `inputViolation`, which knows which operation was asked for.
 */

import { Type } from "class-transformer";
import { IsInt, IsObject, IsOptional, IsUUID, Min, ValidateNested } from "class-validator";

import type { ToolBudget, ToolInvocation } from "./research-tool.invoker";

/** What the investigation has left, as the loop counts it. */
export class ToolBudgetDto implements ToolBudget {
  /** Operations left — a call needs one. */
  @IsInt()
  @Min(0)
  operations!: number;

  /** Tokens left; omit or send null when the investigation sets no token budget. */
  @IsOptional()
  @IsInt()
  @Min(0)
  tokens!: number | null;
}

/** One tool operation request. */
export class ToolInvocationDto implements ToolInvocation {
  /**
   * The investigation — `investigations.id`. The workspace every setting, credential and ledger
   * write is scoped to is resolved from it, never named by the caller.
   */
  @IsUUID()
  investigation!: string;

  /** `{query, limit?}` for search, `{locator}` for fetch, the structured query for query. */
  @IsObject()
  input!: Record<string, unknown>;

  /** The remaining budget. */
  @IsObject()
  @ValidateNested()
  @Type(() => ToolBudgetDto)
  budget!: ToolBudgetDto;
}
