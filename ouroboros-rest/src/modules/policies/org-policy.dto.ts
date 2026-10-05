/**
 * The policy plane's request bodies — the dry-run flip (BA.3, [#382](https://github.com/NobuData/ouroboros/issues/382)),
 * the org policy document's preview and publish (BQ.2, #481), and the history's query string and
 * the glob editor's match preview (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * `dryRun` is required and must be a real boolean: a `"false"`, a `0` or a `null` is a `422`
 * naming the field, never a truthy accident that lets the loop merge without a person.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

import { POLICY_HISTORY_PAGE_MAX } from "./policy-history.service";

/** `PATCH /api/v1/policies/dry-run`. */
export class PatchDryRunPolicyDto {
  /** The new value — `false` lets the system merge without a human in the loop. */
  @IsBoolean()
  dryRun!: boolean;
}

/** The longest change note V092 stores (`org_policy_versions_change_note_present`). */
export const CHANGE_NOTE_MAX_LENGTH = 500;

/**
 * `POST /api/v1/policies/preview` (BQ.2, [#481](https://github.com/NobuData/ouroboros/issues/481)) —
 * the draft to classify. The grammar itself is the publish flow's to check, against
 * `schemas/org-policy/v1.json`; here the document only has to be an object.
 */
export class PreviewPolicyDto {
  /** The whole document — every rule. */
  @IsObject()
  document!: Record<string, unknown>;
}

/**
 * `POST /api/v1/policies` (BQ.2, #481) — publish the next version.
 *
 * `baseVersion` is required, and `null` only for a workspace that has published nothing: it is how
 * a publish that landed since the caller began editing is refused rather than overwritten.
 */
export class PublishPolicyDto extends PreviewPolicyDto {
  /** The version the caller edited, or null when none was published. */
  @ValidateIf((body: PublishPolicyDto) => body.baseVersion !== null)
  @IsInt()
  @Min(1)
  baseVersion!: number | null;

  /** Why — the history popover's line. Optional; blank is none. */
  @IsOptional()
  @IsString()
  @MaxLength(CHANGE_NOTE_MAX_LENGTH)
  changeNote?: string | null;
}

/** `GET /api/v1/policies/versions` (BS.4, #494) — the history's page. */
export class PolicyVersionsQuery {
  /** The most versions to return — 1 to 100, 20 when absent. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit must be a whole number" })
  @Min(1)
  @Max(POLICY_HISTORY_PAGE_MAX)
  limit?: number;

  /** Only versions strictly below this one — the previous page's `nextBefore`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "before must be a version number" })
  @Min(1)
  before?: number;
}

/** The most globs one preview takes — the grammar's own bound on `path_globs`. */
export const PATH_PREVIEW_MAX_GLOBS = 64;

/**
 * `POST /api/v1/policies/path-preview` (BS.4, #494) — the globs to match against each enabled
 * repository's tree. The glob grammar itself is the service's to check, against the committed
 * `path_glob` definition; here the body only has to be a non-empty list of distinct strings.
 */
export class PathPreviewDto {
  /** The globs, as the `protected_paths` rule would store them. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PATH_PREVIEW_MAX_GLOBS)
  @ArrayUnique()
  @IsString({ each: true })
  globs!: string[];
}
