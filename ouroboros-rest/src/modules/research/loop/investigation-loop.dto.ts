/**
 * The request bodies of the investigation loop's internal routes (CM.1,
 * [#620](https://github.com/NobuData/ouroboros/issues/620)).
 *
 * Shapes are validated here. What only the service can judge — that a brief's spans and claims
 * agree, that every cited source is in the investigation's ledger — is `investigation-loop.service.ts`'s.
 * The `checkpoint` is the engine's own state and deliberately opaque: an object, bounded by the
 * request body limit and by V120's 2 MiB check.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import type {
  BriefClaimType,
  InvestigationFailureReason,
  InvestigationUsageStage,
} from "../../db/schema";

/** The most usage rows one write may carry — far above what a step produces. */
export const MAX_USAGE_ROWS = 500;

/** The most claims one brief may state. */
export const MAX_CLAIMS = 500;

/** The most sources one claim may cite. */
export const MAX_CLAIM_SOURCES = 64;

/** Working time, in milliseconds, is bounded at thirty days — anything above is a clock bug. */
export const MAX_DURATION_MS = 2_592_000_000;

const STAGES: readonly InvestigationUsageStage[] = ["plan", "select", "digest", "synthesize"];
const REASONS: readonly InvestigationFailureReason[] = [
  "tool_exhaustion",
  "budget_breach",
  "synthesis_failure",
  "engine_error",
];
const CLAIM_TYPES: readonly BriefClaimType[] = ["finding", "open_question"];

/** One model call's usage, as the invocation gateway reported it. */
export class UsageDto {
  /** The call's number within the investigation. */
  @IsInt()
  @Min(1)
  seq!: number;

  @IsIn(STAGES)
  stage!: InvestigationUsageStage;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  alias!: string;

  @IsInt()
  @Min(0)
  hop!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  connection!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsInt()
  @Min(0)
  inputTokens!: number;

  @IsInt()
  @Min(0)
  outputTokens!: number;

  /** Cents, or null when nothing prices the model. */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1_000_000_000)
  costCents!: number | null;
}

/** `POST …/investigations/:id/start`. */
export class StartDto {
  /** The researcher — `loop-v1`. */
  @Matches(/^loop-v[1-9][0-9]{0,3}$/)
  loopVersion!: string;

  /** The alias synthesis runs on. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  alias!: string;

  /** The resolution the alias came from. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  resolutionRef!: string | null;

  /** The engine task — `investigations.engine_task_ref`. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  task!: string;
}

/** `PUT …/investigations/:id/checkpoint`. */
export class CheckpointDto {
  @IsInt()
  @Min(1)
  attempt!: number;

  /** This checkpoint's number — higher than the last. */
  @IsInt()
  @Min(1)
  seq!: number;

  /** The engine's resume state. */
  @IsObject()
  checkpoint!: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_MS)
  durationMs!: number;

  @IsArray()
  @ArrayMaxSize(MAX_USAGE_ROWS)
  @ValidateNested({ each: true })
  @Type(() => UsageDto)
  usage!: UsageDto[];
}

/** One claim of a brief. */
export class ClaimDto {
  /** The span that states it. */
  @Matches(/^[a-z0-9][a-z0-9_-]{0,31}$/)
  ref!: string;

  @IsIn(CLAIM_TYPES)
  type!: BriefClaimType;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  /** `source_records` ids. */
  @IsArray()
  @ArrayMaxSize(MAX_CLAIM_SOURCES)
  @IsString({ each: true })
  @Matches(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, { each: true })
  sources!: string[];

  /** Offered as a finding, cited nothing. */
  @IsOptional()
  @IsBoolean()
  demoted!: boolean | undefined;
}

/** `POST …/investigations/:id/brief`. */
export class BriefDto {
  @IsInt()
  @Min(1)
  attempt!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_MS)
  durationMs!: number;

  @IsArray()
  @ArrayMaxSize(MAX_USAGE_ROWS)
  @ValidateNested({ each: true })
  @Type(() => UsageDto)
  usage!: UsageDto[];

  /** `{paragraphs: [{spans: [{text, claim?}]}]}` — judged by the service. */
  @IsObject()
  body!: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(MAX_CLAIMS)
  @ValidateNested({ each: true })
  @Type(() => ClaimDto)
  claims!: ClaimDto[];

  /** The playbook's other deliverable inputs, by deliverable. */
  @IsObject()
  deliverables!: Record<string, unknown>;
}

/** `POST …/investigations/:id/finish`. */
export class FinishDto {
  @IsInt()
  @Min(1)
  attempt!: number;

  @IsIn(["failed", "cancelled"])
  outcome!: "failed" | "cancelled";

  /** Why — required when `failed`. */
  @IsOptional()
  @IsIn(REASONS)
  reason!: InvestigationFailureReason | undefined;

  /** A sentence for a person — required when `failed`. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  detail!: string | undefined;

  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_MS)
  durationMs!: number;

  @IsArray()
  @ArrayMaxSize(MAX_USAGE_ROWS)
  @ValidateNested({ each: true })
  @Type(() => UsageDto)
  usage!: UsageDto[];

  /** The final checkpoint's number. */
  @IsInt()
  @Min(1)
  seq!: number;

  /** The state at the end — the partial that is kept. */
  @IsObject()
  checkpoint!: Record<string, unknown>;
}
