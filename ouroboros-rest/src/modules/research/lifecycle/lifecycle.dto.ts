/**
 * What the investigation lifecycle routes accept (CM.6,
 * [#625](https://github.com/NobuData/ouroboros/issues/625)).
 */

import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

import {
  INVESTIGATION_DEPTHS,
  type InvestigationDepth,
  type InvestigationStatus,
  type ResearchStartRole,
} from "../../db/schema";
import { present } from "../../routing/routing.dto";
import { PageQuery } from "../../tenancy/pagination";
import { KIND_SLUG_PATTERN, MAX_TOOLS, TOOL_SLUG_PATTERN } from "../estimate.dto";
import { QUARTER_PATTERN } from "./quarter";

/** The longest question the composer may send. */
export const MAX_QUESTION_LENGTH = 2000;

/** Every investigation status, in lifecycle order. */
export const INVESTIGATION_STATUSES: readonly InvestigationStatus[] = [
  "queued",
  "running",
  "brief_ready",
  "issues_filed",
  "failed",
  "cancelled",
];

/** The `status` value that means "everything the card counts as active". */
export const ACTIVE_FILTER = "active";

/** What a list's `status` may be. */
export const STATUS_FILTERS: readonly string[] = [ACTIVE_FILTER, ...INVESTIGATION_STATUSES];

/** The roles a workspace may set as the lowest that starts an investigation. */
export const START_ROLES: readonly ResearchStartRole[] = ["member", "admin"];

/** The body of `POST /api/v1/research/investigations` — the composer's payload. */
export class StartInvestigationDto {
  /** The question to investigate; surrounding white space is dropped. */
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/\S/, { message: "question must not be blank" })
  @MaxLength(MAX_QUESTION_LENGTH)
  question!: string;

  /** The investigation kind's slug — `gap_analysis`. */
  @IsString()
  @Matches(KIND_SLUG_PATTERN, {
    message: "kind must be a lower-case slug of letters, digits and underscores",
  })
  kind!: string;

  /** The depth preset. */
  @IsIn(INVESTIGATION_DEPTHS, {
    message: `depth must be one of ${INVESTIGATION_DEPTHS.join(", ")}`,
  })
  depth!: InvestigationDepth;

  /** The enabled tools; omit for the kind's playbook defaults. */
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

/** The query of `GET /api/v1/research/investigations`. Every filter given must hold. */
export class ListInvestigationsQuery extends PageQuery {
  /** A kind's slug. */
  @IsOptional()
  @IsString()
  @Matches(KIND_SLUG_PATTERN, {
    message: "kind must be a lower-case slug of letters, digits and underscores",
  })
  kind?: string;

  /** One status, or `active` for everything that did not fail or get cancelled. */
  @IsOptional()
  @IsIn(STATUS_FILTERS, { message: `status must be one of ${STATUS_FILTERS.join(", ")}` })
  status?: string;

  /** `current`, or a quarter like `2026-Q4` (UTC). */
  @IsOptional()
  @IsString()
  @Matches(QUARTER_PATTERN, { message: "quarter must be `current` or a quarter like 2026-Q4" })
  quarter?: string;
}

/** The body of `PATCH /api/v1/research/settings`. A body carrying nothing changes nothing. */
export class PatchResearchSettingsDto {
  /** The lowest role that may start an investigation. */
  @ValidateIf((body: PatchResearchSettingsDto) => body.startRole !== undefined)
  @IsIn(START_ROLES, { message: `startRole must be one of ${START_ROLES.join(", ")}` })
  startRole?: ResearchStartRole;
}
