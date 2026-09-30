/**
 * The shapes the skills routes accept (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * Only what `class-validator` can say is said here: types, lengths and closed vocabularies. The
 * document's frontmatter is checked by `skills.frontmatter.ts`, where the issues can name a line,
 * and whether a scope's referent agrees with the scope is the service's (`skill_scope_invalid`),
 * because it needs the workspace's workflows to answer.
 */

import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from "class-validator";

import { SKILL_SCOPES, type SkillScope } from "../db/schema";
import { REPO_REF_PATTERN } from "../onboarding/onboarding.dto";
import { CHANGE_NOTE_MAX_LENGTH, SLUG_MAX_LENGTH, SLUG_PATTERN } from "../workflows/slug";

/** The longest a skill document may be — a skill is guidance, not a manual. */
export const SKILL_TEXT_MAX_LENGTH = 200_000;

/** The default stats window, in days — the workflows rail's usage window. */
export const DEFAULT_STATS_DAYS = 30;

/** The longest stats window a caller may ask for. */
export const MAX_STATS_DAYS = 365;

/** The one explicit resolution a clashing scope move accepts. */
export const SCOPE_RESOLUTIONS = ["keep_both"] as const;

/** `:slug` of every `/api/v1/skills/{slug}…` route. */
export class SkillSlugParams {
  @IsString()
  @Length(1, SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: "slug must be lower-case words separated by single hyphens" })
  slug!: string;
}

/** `?version=` — a published version to read instead of the draft or the one in force. */
export class ReadSkillQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** `POST /api/v1/skills` — **+ New skill**. */
export class CreateSkillBody {
  /** The whole document — frontmatter and markdown. Its `name` names the skill. */
  @IsString()
  @Length(1, SKILL_TEXT_MAX_LENGTH)
  text!: string;

  /** The slug, when the caller chose one; otherwise it is built from the name. */
  @IsOptional()
  @IsString()
  @Length(1, SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: "slug must be lower-case words separated by single hyphens" })
  slug?: string;

  /** Where it applies. `org` when absent. */
  @IsOptional()
  @IsIn(SKILL_SCOPES)
  scope?: SkillScope;

  /** `owner/name` — required exactly for `repo` scope. */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Matches(REPO_REF_PATTERN, { message: "repoRef must be owner/name, with no . or .. segment" })
  repoRef?: string;

  /** The workflow — required exactly for `workflow` scope. */
  @IsOptional()
  @IsUUID()
  workflowId?: string;
}

/** `PUT /api/v1/skills/{slug}/draft` and `PUT …/code` — the whole document. */
export class SaveSkillDocumentBody {
  @IsString()
  @Length(1, SKILL_TEXT_MAX_LENGTH)
  text!: string;
}

/** `POST /api/v1/skills/{slug}/publish`. */
export class PublishSkillBody {
  @IsOptional()
  @IsString()
  @Length(1, CHANGE_NOTE_MAX_LENGTH)
  changeNote?: string;
}

/**
 * Validate a PATCH field only when it was sent.
 *
 * `@IsOptional()` would also let an explicit `null` through, and `null` is not a switch position:
 * it would reach the database's `not null` as a `500`. Present means validated, `null` included.
 */
const WhenSent = (): PropertyDecorator =>
  ValidateIf((_body: unknown, value: unknown) => value !== undefined);

/** `PATCH /api/v1/skills/{slug}` — the switch, the lock and the draft flag. */
export class UpdateSkillBody {
  /** The switch. Off on a required skill is the designed `403`. */
  @WhenSent()
  @IsBoolean()
  enabled?: boolean;

  /** The lock. Owner-only, whichever way it is set. */
  @WhenSent()
  @IsBoolean()
  required?: boolean;

  /** `false` promotes a draft skill; `true` returns one to draft. */
  @WhenSent()
  @IsBoolean()
  draft?: boolean;
}

/** `POST /api/v1/skills/{slug}/scope/preview` — where the skill would move. */
export class ScopeTargetBody {
  @IsIn(SKILL_SCOPES)
  scope!: SkillScope;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Matches(REPO_REF_PATTERN, { message: "repoRef must be owner/name, with no . or .. segment" })
  repoRef?: string;

  @IsOptional()
  @IsUUID()
  workflowId?: string;
}

/** `POST /api/v1/skills/{slug}/scope` — the move, as previewed. */
export class MoveSkillScopeBody extends ScopeTargetBody {
  /** The preview's token. */
  @IsString()
  @Length(64, 64)
  previewToken!: string;

  /** `keep_both` moves despite a name clash; required when the preview showed any. */
  @IsOptional()
  @IsIn(SCOPE_RESOLUTIONS)
  resolve?: (typeof SCOPE_RESOLUTIONS)[number];
}

/** `GET /api/v1/skills/stats?days=`. */
export class SkillStatsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_STATS_DAYS)
  days?: number;
}
