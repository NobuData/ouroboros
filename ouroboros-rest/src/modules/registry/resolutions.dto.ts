/**
 * `GET /registry/resolutions/latest?alias=` — the one input, validated as an alias name
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)).
 *
 * The name's shape is V015's, restated through `aliases.dto.ts`'s constants rather than a second
 * pattern, so the query refuses exactly what an alias could never be called — a `422
 * validation_failed` before any statement runs. A well-formed name no alias carries is **not** a
 * refusal: a snapshot names aliases by name and outlives them, so *nothing stored* is an answer.
 */

import { IsString, Matches, MaxLength } from "class-validator";

import { ALIAS_NAME_MESSAGE, ALIAS_NAME_PATTERN, MAX_ALIAS_LENGTH } from "./aliases.dto";

/** The query. */
export class LatestResolutionQuery {
  /** The alias whose latest resolution to read — `coder-max`. */
  @IsString()
  @MaxLength(MAX_ALIAS_LENGTH)
  @Matches(ALIAS_NAME_PATTERN, { message: ALIAS_NAME_MESSAGE })
  alias!: string;
}
