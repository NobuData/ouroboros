/**
 * The body of `POST /research/estimates` — what the composer has chosen so far.
 *
 * [#622](https://github.com/NobuData/ouroboros/issues/622). Shapes are checked here and
 * registrations by the service: whether `gap_analysis` is a kind of *this* workspace, or
 * `telemetry` a tool of this installation, is a lookup, and the answer is a `404` or a `422`
 * naming the slug rather than a pattern message.
 */

import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Matches,
  ValidateIf,
} from "class-validator";

import { INVESTIGATION_DEPTHS, type InvestigationDepth } from "../db/schema";
import { present } from "../routing/routing.dto";

/** V106's `investigation_kinds_slug_format`. */
export const KIND_SLUG_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

/** V106's `research_tools_slug_format`. */
export const TOOL_SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** More tools than any installation registers is not a selection; it is a mistake. */
export const MAX_TOOLS = 32;

export class EstimateInvestigationDto {
  /** The kind's slug — `gap_analysis`. */
  @IsString()
  @Matches(KIND_SLUG_PATTERN, {
    message: "kind must be a lower-case slug of letters, digits and underscores",
  })
  kind!: string;

  /** The Depth menu. */
  @IsIn(INVESTIGATION_DEPTHS, {
    message: `depth must be one of ${INVESTIGATION_DEPTHS.join(", ")}`,
  })
  depth!: InvestigationDepth;

  /** The enabled tool chips; omitted means the kind's playbook defaults. Never empty when given. */
  @ValidateIf(present)
  @IsArray()
  @ArrayNotEmpty({
    message: "tools must name at least one tool when given — omit it for the kind's defaults",
  })
  @ArrayMaxSize(MAX_TOOLS)
  @ArrayUnique({ message: "tools must not repeat a tool" })
  @IsString({ each: true })
  @Matches(TOOL_SLUG_PATTERN, { each: true, message: "each tool must be a research tool slug" })
  tools?: string[];
}
