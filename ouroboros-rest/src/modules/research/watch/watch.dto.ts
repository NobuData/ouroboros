/**
 * What the regression watch's routes accept (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623)).
 *
 * Shape only: whether a metric id is in the insights catalogue, or a ticket source exists, is
 * the service's and the database's to say.
 */

import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

import { METRIC_CLASSES, type MetricClass, type ThresholdRule } from "./watch.drift";
import type { MetricSource } from "./watch.repository";

/** `owner/name`. */
export const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** A release tag or a git ref: no white space. */
export const REF_PATTERN = /^\S{1,128}$/;

/** A metric key: an insights metric id, or `<64-hex case key>:<measurement>`. */
export const METRIC_KEY_PATTERN = /^(?:[a-z][a-z0-9_]{0,62}|[0-9a-f]{64}:[a-z][a-z0-9_]{0,62})$/;

/** The most metrics a workspace may watch — V124's bound. */
export const MAX_WATCHED_METRICS = 64;

const DIRECTIONS: readonly ThresholdRule["direction"][] = [
  "higher_is_worse",
  "lower_is_worse",
  "either",
];
const SOURCES: readonly MetricSource[] = ["bi_metric", "case_metric"];

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** A metric's replayable test. */
export class ReplayTestDto {
  /** The farm pool every bisect step builds in. */
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/, { message: "pool must not be blank" })
  @MaxLength(100)
  pool!: string;

  /** The argv a step runs; null or omitted for the pool's default. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @Matches(/\S/, { each: true, message: "each command word must not be blank" })
  @MaxLength(2000, { each: true })
  command?: string[] | null;
}

/** One watched metric. */
export class WatchedMetricDto {
  /** `owner/name`. */
  @IsString()
  @Matches(REPOSITORY_PATTERN, { message: "repository must be owner/name" })
  @MaxLength(255)
  repository!: string;

  /** Where its samples come from. */
  @IsIn(SOURCES)
  source!: MetricSource;

  /** The metric: an insights metric id, or `<case key>:<measurement>`. */
  @IsString()
  @Matches(METRIC_KEY_PATTERN, {
    message: "key must be an insights metric id or <64-hex case key>:<measurement>",
  })
  key!: string;

  /** Which threshold defaults apply. */
  @IsIn(METRIC_CLASSES)
  class!: MetricClass;

  /** The window a baseline and a nightly reading cover, in days. 7 when omitted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  windowDays?: number;

  /** The replayable test; null or omitted for a metric that cannot be bisected. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReplayTestDto)
  replay?: ReplayTestDto | null;

  /** The ref a bisect treats as bad. `HEAD` when omitted. */
  @IsOptional()
  @IsString()
  @Matches(REF_PATTERN, { message: "nightlyRef must be a ref with no white space" })
  nightlyRef?: string;
}

/** A threshold override. Send only what differs from the default. */
export class ThresholdDto {
  @IsOptional()
  @IsIn(DIRECTIONS)
  direction?: ThresholdRule["direction"];

  /** The percentage from which a drift is a warning. Sent together with `errPct`. */
  @ValidateIf((rule: ThresholdDto) => rule.warnPct !== undefined || rule.errPct !== undefined)
  @IsNumber()
  @Min(0.0001)
  @Max(100000)
  warnPct?: number;

  /** The percentage from which it is an error; at least `warnPct`. */
  @ValidateIf((rule: ThresholdDto) => rule.warnPct !== undefined || rule.errPct !== undefined)
  @IsNumber()
  @Min(0.0001)
  @Max(100000)
  errPct?: number;

  /** How many of the baseline's spreads a move must clear. 0 turns the noise gate off. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  minSpreadMultiple?: number;

  /** How many nightly samples a comparison needs. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  minSamples?: number;
}

/** The thresholds a workspace overrides. */
export class ThresholdsDto {
  /** Overrides per metric class — `timing`, `accuracy`, `resource`, `rate`. */
  @IsOptional()
  @IsObject()
  classes?: Record<string, ThresholdDto>;

  /** Overrides per metric key. */
  @IsOptional()
  @IsObject()
  metrics?: Record<string, ThresholdDto>;
}

/** The body of `PUT /api/v1/research/regression-watch/settings`. An absent field is kept. */
export class SaveWatchSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WATCHED_METRICS)
  @ValidateNested({ each: true })
  @Type(() => WatchedMetricDto)
  metrics?: WatchedMetricDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ThresholdsDto)
  thresholds?: ThresholdsDto;

  /** Whether a detected drift is bisected without asking. */
  @IsOptional()
  @IsBoolean()
  autoBisect?: boolean;

  /** Whether a drafted fix is filed and queued without asking — the opt-in. */
  @IsOptional()
  @IsBoolean()
  autoFile?: boolean;

  /** The ticket source fix drafts go to; null for the workspace's only one. */
  @ValidateIf((body: SaveWatchSettingsDto) => body.fixSourceId != null)
  @IsUUID()
  fixSourceId?: string | null;
}

/** The body of `POST /api/v1/research/regression-watch/baselines`. */
export class CaptureBaselinesDto {
  /** `owner/name`. */
  @IsString()
  @Matches(REPOSITORY_PATTERN, { message: "repository must be owner/name" })
  @MaxLength(255)
  repository!: string;

  /** The release the baselines are captured for — `v2.0.4`. */
  @IsString()
  @Matches(REF_PATTERN, { message: "releaseTag must be a tag with no white space" })
  releaseTag!: string;
}

/** The body of `POST …/items/{itemId}/dismiss`. */
export class DismissItemDto {
  /** Why the drift is dismissed. */
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/, { message: "reason must not be blank" })
  @MaxLength(1000)
  reason!: string;
}

/** The item a route addresses. */
export class WatchItemParams {
  @IsUUID()
  itemId!: string;
}
