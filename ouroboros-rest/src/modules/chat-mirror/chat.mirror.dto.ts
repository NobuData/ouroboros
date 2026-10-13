/**
 * The request shape of the channel mirror (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)).
 */

import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

import { MIRROR_PAGE_MAX } from "./chat.mirror.service";

/** The longest cursor accepted — the encoded JSON of a timestamp and a uuid, with room. */
const MAX_CURSOR_LENGTH = 256;

/** The query string of `GET /api/v1/chat/channels/{id}/mirror`. */
export class ChatMirrorQuery {
  /**
   * A previous page's `olderCursor`: answer the page before it. Opaque; a token this service
   * did not issue is the service's `422 chat_cursor_invalid`.
   */
  @IsOptional()
  @IsString({ message: "before must be text" })
  @Length(1, MAX_CURSOR_LENGTH, { message: "before is not a cursor this service issued" })
  before?: string;

  /** Page size, 1–100; 50 by default. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit must be a whole number" })
  @Min(1, { message: "limit must be at least 1" })
  @Max(MIRROR_PAGE_MAX, { message: `limit must be at most ${String(MIRROR_PAGE_MAX)}` })
  limit?: number;
}
