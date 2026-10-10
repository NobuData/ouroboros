/**
 * What the gaps hand-off and the roadmap pipeline accept (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 */

import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";

import { isRepoDocPath, MAX_REPO_DOC_PATH } from "../../ticket-sources/ticket-source.repo-doc";

/** The longest suggestion V113 stores. */
export const MAX_SUGGESTION_LENGTH = 4_000;

/** The largest hint V113 stores, as JSON text. */
export const MAX_HINT_BYTES = 8_192;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** A relative repository path with no `.` or `..` segment. */
@ValidatorConstraint({ name: "repoDocPath", async: false })
class RepoDocPath implements ValidatorConstraintInterface {
  /**
   * @param value - The path.
   * @returns Whether a document may be written there.
   */
  validate(value: unknown): boolean {
    return typeof value === "string" && isRepoDocPath(value);
  }

  /** @returns The refusal. */
  defaultMessage(): string {
    return "path must be a relative repository path with no empty, `.` or `..` segment";
  }
}

/** A plain JSON object small enough for V113's hint column. */
@ValidatorConstraint({ name: "suggestionHint", async: false })
class SuggestionHint implements ValidatorConstraintInterface {
  /**
   * @param value - The hint.
   * @returns Whether it is a plain object of at most {@link MAX_HINT_BYTES} bytes.
   */
  validate(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_HINT_BYTES
    );
  }

  /** @returns The refusal. */
  defaultMessage(): string {
    return `hint must be an object of at most ${String(MAX_HINT_BYTES)} bytes`;
  }
}

/** `:investigationId`. */
export class RoadmapParams {
  @IsUUID()
  investigationId!: string;
}

/** `:investigationId` and `:suggestionId`. */
export class SuggestionParams extends RoadmapParams {
  @IsUUID()
  suggestionId!: string;
}

/** `POST …/draft-epic`. */
export class DraftEpicDto {
  /** The tracker the drafts are for. Omit when the workspace has exactly one ticket source. */
  @IsOptional()
  @IsUUID()
  targetSourceId?: string;
}

/** `POST …/roadmap`. */
export class GenerateRoadmapDto {
  /**
   * The ticket source whose repository holds the file and whose tracker the issues are filed
   * in. Omit when the workspace has exactly one.
   */
  @IsOptional()
  @IsUUID()
  targetSourceId?: string;

  /** Where the file goes. Default `docs/ROADMAP.md`. Fixed once the document exists. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPO_DOC_PATH)
  @Validate(RepoDocPath)
  path?: string;
}

/** `POST …/roadmap/suggestions`. */
export class SuggestDto {
  /** What should change, in words — the re-run reads it. */
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/, { message: "text must not be blank" })
  @MaxLength(MAX_SUGGESTION_LENGTH)
  text!: string;

  /** An optional structured hint for the re-run — `{"item": "dock-gust", "change": "mvp", "to": true}`. */
  @IsOptional()
  @IsObject()
  @Validate(SuggestionHint)
  hint?: Record<string, unknown>;
}

/** `POST …/roadmap/issues`. */
export class FileIssuesDto {
  /** Push even though the estimator has not sized every draft. Default false: the call waits. */
  @IsOptional()
  @IsBoolean()
  pushUnsized?: boolean;
}

/** `PUT /research/roadmap-settings`. */
export class SaveRoadmapSettingsDto {
  /** Whether `ROADMAP.md` may be committed to the default branch without a pull request. */
  @IsBoolean()
  directCommit!: boolean;
}
