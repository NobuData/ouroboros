/**
 * The request shapes of the chat routes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537); BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)).
 */

import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

/** The longest text completions are read from — a slash command's own bound. */
export const COMPLETION_TEXT_LIMIT = 4000;

/** The longest text the console sends, trimmed — prefix included when it was typed. */
export const COMMAND_TEXT_LIMIT = 2000;

/** What a console command is refused with when its text is blank or too long. */
export const COMMAND_TEXT_MESSAGE = `text must be 1 to ${String(COMMAND_TEXT_LIMIT)} characters`;

/** What a console command is refused with when its `channelId` is not a UUID. */
export const CHANNEL_ID_MESSAGE = "channelId must be a channel's id (a UUID)";

/** `/ouro` at the start of what was typed, whatever its case, with the space after it. */
const TYPED_PREFIX = /^\/ouro(?:\s+|$)/i;

/**
 * What was typed, as the dispatcher is handed it: without a leading `/ouro`.
 *
 * The console's field holds either form — the palette shows the prefix, a try-it button may not
 * — and the dispatcher takes the text after it, as Slack delivers a slash command's. A bare
 * `/ouro` is therefore empty text, which the dispatcher answers with help, as in Slack.
 *
 * @param typed - The body's `text`.
 * @returns The text after the prefix.
 */
export function commandText(typed: string): string {
  return typed.trim().replace(TYPED_PREFIX, "").trim();
}

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

/** The body of `POST /api/v1/chat/commands`. */
export class ChatCommandRequest {
  /**
   * What was typed — `queue #485`, or `/ouro queue #485`. Trimmed before it is judged; a value
   * that is not a string is left for `@IsString()` to report.
   */
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: COMMAND_TEXT_MESSAGE })
  @MaxLength(COMMAND_TEXT_LIMIT, { message: COMMAND_TEXT_MESSAGE })
  text!: string;

  /**
   * The bound channel whose mirror the command was typed under (#542) — a `chat_channels` id.
   * Left out — or null — by the palette, whose commands belong to no channel. A UUID that names
   * no bound channel of the workspace is the route's `404 chat_channel_not_found`.
   */
  @IsOptional()
  @IsUUID(undefined, { message: CHANNEL_ID_MESSAGE })
  channelId?: string | null;
}
