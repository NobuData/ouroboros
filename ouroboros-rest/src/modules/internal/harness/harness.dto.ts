/**
 * The bodies of the harness credential routes, as `class-validator` classes — DH.2
 * ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 */

import { IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";

import { InvalidRequestError } from "../../errors/error.envelope";
import type { ReportedModelUsage } from "./harness.credentials.service";

/** `POST /internal/harness/credentials`. */
export class MintCredentialDto {
  /** The run — `runs.id`. Only a live run gets a credential. */
  @IsUUID()
  run!: string;

  /** The stage or routed task kind the harness runs — what an alias is walked under. */
  @IsString()
  @Length(1, 64)
  stage!: string;

  /** The routing alias the credential may call, and no other. */
  @IsString()
  @Length(1, 128)
  alias!: string;

  /** The stage attempt, 1-based. Defaults to 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  attempt?: number;
}

/** `POST /internal/harness/credentials/{id}/reconcile`. */
export class ReconcileDto {
  /**
   * The harness's per-model totals at session end — the Claude Agent SDK's `modelUsage`,
   * keyed as the SDK keys it.
   */
  @IsObject()
  models!: Record<string, ReportedModelUsage>;
}

/** The fields one reported model may carry, and which are required. */
const COUNT_FIELDS = [
  ["inputTokens", true],
  ["outputTokens", true],
  ["cacheReadInputTokens", false],
  ["cacheCreationInputTokens", false],
] as const;

/**
 * Check the harness's totals field by field — the shape a decorator cannot express on a map.
 *
 * Other fields the SDK sends (cost, context window) are ignored, not refused: the totals are
 * an open list and only the counts are compared.
 *
 * @param models - The `models` map.
 * @returns The map, typed.
 * @throws {InvalidRequestError} `validation_failed`, naming every bad field.
 */
export function reportedModels(
  models: Record<string, unknown>,
): Record<string, ReportedModelUsage> {
  const violations: string[] = [];

  for (const [model, usage] of Object.entries(models)) {
    for (const [name, required] of COUNT_FIELDS) {
      const value = (usage as Record<string, unknown> | null)?.[name];

      if (value === undefined && !required) {
        continue;
      }

      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        violations.push(`models.${model}.${name} must be a non-negative integer`);
      }
    }
  }

  if (violations.length > 0) {
    throw new InvalidRequestError("validation_failed", "The reported usage is not valid.", {
      violations,
    });
  }

  return models as Record<string, ReportedModelUsage>;
}
