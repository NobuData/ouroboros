/**
 * The request shapes of the chat routes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 */

import { IsOptional, IsString, MaxLength } from "class-validator";

/** The longest text completions are read from — a slash command's own bound. */
export const COMPLETION_TEXT_LIMIT = 4000;

/** The query string of `GET /api/v1/chat/completions`. */
export class ChatCompletionsQuery {
  /**
   * What has been typed after `/ouro`, as typed — trailing space included, because it is what
   * says the last word is finished. Absent or empty asks for the commands.
   */
  @IsOptional()
  @IsString()
  @MaxLength(COMPLETION_TEXT_LIMIT)
  text?: string;
}
