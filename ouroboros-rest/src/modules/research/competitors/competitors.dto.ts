/**
 * The competitor registry's request shapes (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * Shapes are checked here; what depends on the kind — whether a selector is allowed, whether the
 * URL names a GitHub repository, whether the selector parses — is the service's, so it can answer
 * with a code naming the field.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

import type { CompetitorCadence, CompetitorSourceKind } from "../../db/schema";
import { present } from "../../routing/routing.dto";
import { COMPETITOR_CADENCES, COMPETITOR_SOURCE_KINDS } from "./competitor.kinds";

/** Non-blank: at least one character that is not whitespace. */
const NON_BLANK = /\S/;

/** An absolute http(s) URL without whitespace — V108's `web` locator rule, approximately. */
const HTTP_URL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

/** The change feed's default and largest page. */
export const DEFAULT_CHANGE_LIMIT = 50;
export const MAX_CHANGE_LIMIT = 100;

/** Present and not null — for a field `null` clears. */
function given(_body: object, value: unknown): boolean {
  return value !== undefined && value !== null;
}

export class CompetitorParams {
  @IsUUID()
  competitorId!: string;
}

export class WatchParams extends CompetitorParams {
  @IsUUID()
  watchId!: string;
}

export class CreateCompetitorDto {
  /** The column header — `Skylink`. */
  @IsString()
  @Matches(NON_BLANK, { message: "name must not be blank" })
  @MaxLength(120)
  name!: string;

  /** The rival's site. */
  @ValidateIf(present)
  @IsString()
  @MaxLength(2048)
  @Matches(HTTP_URL, { message: "site must be an absolute http(s) URL" })
  site?: string;

  /** Other names the rival goes by — what the research loop may call it. */
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(NON_BLANK, { each: true, message: "each alias must not be blank" })
  aliases?: string[];

  /** Anything worth knowing about it. */
  @ValidateIf(present)
  @IsString()
  @Matches(NON_BLANK, { message: "notes must not be blank" })
  @MaxLength(2000)
  notes?: string;
}

export class UpdateCompetitorDto {
  @ValidateIf(present)
  @IsString()
  @Matches(NON_BLANK, { message: "name must not be blank" })
  @MaxLength(120)
  name?: string;

  /** `null` removes it. */
  @ValidateIf(given)
  @IsString()
  @MaxLength(2048)
  @Matches(HTTP_URL, { message: "site must be an absolute http(s) URL" })
  site?: string | null;

  /** Replaces the list; `[]` clears it. */
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(NON_BLANK, { each: true, message: "each alias must not be blank" })
  aliases?: string[];

  /** `null` removes them. */
  @ValidateIf(given)
  @IsString()
  @Matches(NON_BLANK, { message: "notes must not be blank" })
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateWatchDto {
  @IsIn(COMPETITOR_SOURCE_KINDS, {
    message: `sourceKind must be one of ${COMPETITOR_SOURCE_KINDS.join(", ")}`,
  })
  sourceKind!: CompetitorSourceKind;

  /** The page, feed or repository. */
  @IsString()
  @MaxLength(2048)
  @Matches(HTTP_URL, { message: "url must be an absolute http(s) URL" })
  url!: string;

  /** The CSS region the diff is scoped to — page kinds only. Omitted or null: the main content. */
  @ValidateIf(given)
  @IsString()
  @MaxLength(500)
  selector?: string | null;

  @ValidateIf(present)
  @IsIn(COMPETITOR_CADENCES, {
    message: `cadence must be one of ${COMPETITOR_CADENCES.join(", ")}`,
  })
  cadence?: CompetitorCadence;

  @ValidateIf(present)
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateWatchDto {
  @ValidateIf(present)
  @IsIn(COMPETITOR_CADENCES, {
    message: `cadence must be one of ${COMPETITOR_CADENCES.join(", ")}`,
  })
  cadence?: CompetitorCadence;

  @ValidateIf(present)
  @IsBoolean()
  enabled?: boolean;

  /** `false` asks for a page marked JS-rendered to be tried again. */
  @ValidateIf(present)
  @IsIn([false], { message: "renderRequired can only be set to false — the tracker marks it" })
  renderRequired?: false;
}

export class ChangeFeedQuery {
  /** One rival. */
  @IsOptional()
  @IsUUID()
  competitor?: string;

  /** One source kind. */
  @IsOptional()
  @IsIn(COMPETITOR_SOURCE_KINDS, {
    message: `sourceKind must be one of ${COMPETITOR_SOURCE_KINDS.join(", ")}`,
  })
  sourceKind?: CompetitorSourceKind;

  /** Changes taken at or after this instant. */
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;

  /** Changes taken before this instant — the previous page's `nextBefore`. */
  @IsOptional()
  @IsISO8601({ strict: true })
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CHANGE_LIMIT)
  limit?: number;
}
