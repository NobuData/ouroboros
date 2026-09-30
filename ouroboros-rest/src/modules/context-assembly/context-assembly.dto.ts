/**
 * The shapes the context-assembly routes accept (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414)).
 *
 * Bounds are copied from the migrations they guard: V072's override sets (at most 64 ids each),
 * V071's manifest hash and id arrays, V029's workflow slug. Whether an id is this workspace's is
 * the resolver's (an override) or V071's trigger (an injection) — never this file's.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../onboarding/onboarding.dto";
import { MAX_BUDGET_TOKENS } from "./context-assembly.profiles";
import { CONTEXT_CONSUMERS, type ContextConsumer } from "./context-assembly.resources";

/** V072's `playbook_skill_overrides_typed` — the most ids either half may hold. */
export const MAX_OVERRIDE_IDS = 64;

/** The most ids one injection record may name, per array. */
export const MAX_INJECTED_IDS = 512;

/** V029's `workflows_slug_format`. */
const WORKFLOW_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** V072's `{enable, disable}` delta of skill ids. */
export class SkillOverridesBody {
  /** Skills to re-admit — each one that won its name but is switched off. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OVERRIDE_IDS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  enable?: string[];

  /** Skills to leave out. A required skill cannot be — the refusal is recorded. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OVERRIDE_IDS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  disable?: string[];
}

/** `POST /api/v1/knowledge/context/preview` — what would be injected. */
export class PreviewContextBody {
  /** Who the manifest is for. */
  @IsIn(CONTEXT_CONSUMERS)
  consumer!: ContextConsumer;

  /** `owner/name`; omit for a workspace-wide manifest. */
  @IsOptional()
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo?: string;

  /** A workflow's slug; omit when no workflow is in scope. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(WORKFLOW_SLUG_PATTERN, { message: "workflow must be a workflow slug" })
  workflow?: string;

  /** The skill-id delta, applied after resolution. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SkillOverridesBody)
  overrides?: SkillOverridesBody;

  /** A budget lower than the consumer's. A higher one is not granted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BUDGET_TOKENS)
  budgetTokens?: number;
}

/** `POST /api/v1/knowledge/context/injections` — what a consumer actually injected. */
export class RecordInjectionBody {
  @IsIn(CONTEXT_CONSUMERS)
  consumer!: ContextConsumer;

  /** The estimate an `estimator` manifest sized. */
  @IsOptional()
  @IsUUID()
  estimateId?: string | null;

  /** The stage a `run_stage` manifest was injected into. */
  @IsOptional()
  @IsUUID()
  runStageId?: string | null;

  /** The stage's run, or the run a `playbook` launched. */
  @IsOptional()
  @IsUUID()
  runId?: string | null;

  /** The skill versions injected — `skillVersions[].versionId`, or a subset. */
  @IsArray()
  @ArrayMaxSize(MAX_INJECTED_IDS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  skillVersionIds!: string[];

  /** The facts injected — `facts[].id`, or a subset. */
  @IsArray()
  @ArrayMaxSize(MAX_INJECTED_IDS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  factIds!: string[];

  /** The manifest's `manifestHash`. */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: "manifestHash must be a sha256, lower-case hex" })
  manifestHash!: string;
}
