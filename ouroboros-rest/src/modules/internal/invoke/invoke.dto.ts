/**
 * The body of `POST /internal/llm/invoke`, as `class-validator` classes — AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * The shapes are `invoke.contract.ts`'s {@link InvokeRequest} and {@link RunContext}. A body
 * the pipe refuses is a `422` naming the field, before any stream starts; "exactly one of
 * `connection` and `alias`" is a rule across two fields, so the service states it
 * (`invoke_target_invalid`). `payload` is checked to be an object and nothing more: it is the
 * worker's call, and this service brokers it without reading it (decision 2).
 */

import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from "class-validator";

import type { InvokeRequest, RunContext } from "../invoke.contract";

/** `runCtx`. */
export class RunContextDto implements RunContext {
  /** The run, Copilot session, dry run or investigation the call is attributed to. */
  @IsUUID()
  run!: string;

  /** A hop the worker is retrying; informational — the executor walks the chain itself. */
  @IsOptional()
  @IsInt()
  @Min(0)
  hop?: number;

  /** The stage or routed task kind — which route an alias is walked under. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  stage?: string;

  /** A floor position that may only tighten routing's (G4). */
  @IsOptional()
  @IsInt()
  @Min(0)
  floorHopIndex?: number;

  /** A per-run cap that may only lower routing's, in cents. */
  @IsOptional()
  @IsInt()
  @Min(0)
  costCapCents?: number;

  /** The resolution the call was planned against. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  resolutionVersion?: string;

  /** A vote's own invocation (R5). */
  @IsOptional()
  @IsBoolean()
  vote?: boolean;
}

/** The request. */
export class InvokeRequestDto implements InvokeRequest {
  /** A provider connection — `provider_connections.id`. */
  @IsOptional()
  @IsUUID()
  connection?: string;

  /** A routing alias — `model_aliases.alias`. */
  @IsOptional()
  @IsString()
  @Length(1, 128)
  alias?: string;

  /** The model call, opaque. */
  @IsObject()
  payload!: Record<string, unknown>;

  /** The run context. */
  @ValidateNested()
  @Type(() => RunContextDto)
  runCtx!: RunContextDto;
}
