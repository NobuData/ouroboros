/**
 * The shapes the environment-recipe routes accept (BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * Bounds are V073's `env_recipe_commands_typed`, copied from the check they guard: 1–64 entries,
 * each command a non-blank single line of at most 2 000 characters, each comment optional,
 * non-blank and at most 300. The repository is the onboarding wizard's grammar, so `/knowledge`
 * and `/onboarding` name a repository the same way.
 */

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";

import { REPO_REF_MAX_LENGTH, REPO_REF_PATTERN } from "../onboarding/onboarding.dto";

/** V073: at most this many commands in one recipe. */
export const MAX_RECIPE_COMMANDS = 64;

/** V073: a command is at most this long. */
export const MAX_COMMAND_LENGTH = 2000;

/** V073: a comment is at most this long. */
export const MAX_COMMENT_LENGTH = 300;

/** One line: no control characters (a newline would split a command a consumer runs whole). */
const ONE_LINE = /^[^\p{Cc}]*$/u;

/** A value that is not only whitespace. */
const NON_BLANK = /\S/;

/** One entry of the ordered array. */
export class EnvRecipeCommandBody {
  /** The command, run in a shell at the repository root. */
  @IsString()
  @Length(1, MAX_COMMAND_LENGTH)
  @Matches(NON_BLANK, { message: "command must not be blank" })
  @Matches(ONE_LINE, { message: "command must be one line" })
  command!: string;

  /** For people, never executed. Omit rather than send an empty one. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_COMMENT_LENGTH)
  @Matches(NON_BLANK, { message: "comment must not be blank" })
  @Matches(ONE_LINE, { message: "comment must be one line" })
  comment?: string;
}

/** `PUT /api/v1/knowledge/env-recipe` — the whole block, saved as the next version. */
export class SaveEnvRecipeBody {
  /** `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo!: string;

  /** The commands, in run order. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPE_COMMANDS)
  @ValidateNested({ each: true })
  @Type(() => EnvRecipeCommandBody)
  commands!: EnvRecipeCommandBody[];
}

/** `GET /api/v1/knowledge/env-recipe?repo=` — the recipe in force. */
export class EnvRecipeQuery {
  /** `owner/name`. */
  @IsString()
  @Length(3, REPO_REF_MAX_LENGTH)
  @Matches(REPO_REF_PATTERN, { message: "repo must be owner/name, with no . or .. segment" })
  repo!: string;
}
