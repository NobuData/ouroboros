/**
 * The one request shape sign-in accepts from a client, declared the way every other DTO in
 * this service is.
 *
 * `class-validator` classes, checked by the global pipe `src/application.ts` registers —
 * which also *whitelists*, so a query parameter no field here declares is refused rather
 * than passed through. That matters more on this route than on most: the callback's query
 * string is composed by GitHub and then handed to a browser, and anything extra in it is
 * something somebody else put there.
 *
 * The values are checked for shape and length only. What a `code` or a `state` *means* is
 * not knowable here — the code is opaque to everyone but GitHub, and the state is compared
 * against the handshake cookie in `auth.service.ts`, which is the only comparison that
 * decides anything.
 */

import { IsString, Length, Matches } from "class-validator";

/**
 * The alphabet an opaque OAuth parameter may use.
 *
 * base64url plus the characters GitHub's own codes carry. Anchored, so nothing with a
 * quote, an angle bracket, a newline or a percent sequence reaches the exchange — none of
 * which any legitimate value contains, and all of which are what an injected value looks
 * like.
 */
const OPAQUE_PATTERN = /^[A-Za-z0-9._~-]+$/;

/** The longest either parameter may be. Generous against GitHub, and still a bound. */
export const MAX_OPAQUE_LENGTH = 512;

/** `GET /api/v1/auth/github/callback` — what GitHub puts in the query string. */
export class GithubCallbackQuery {
  /**
   * The authorization code, redeemable once and only by this service.
   *
   * Required: a callback with no code is not a callback, and answering `422` for it is
   * better than spending a round trip on GitHub to be told the same thing.
   */
  @IsString()
  @Length(1, MAX_OPAQUE_LENGTH)
  @Matches(OPAQUE_PATTERN, { message: "state and code must be opaque URL-safe values" })
  code!: string;

  /**
   * The value this service generated before the browser left, echoed back unchanged.
   *
   * Compared against the handshake cookie, and the comparison is the CSRF defence — see
   * `oauth.ts`.
   */
  @IsString()
  @Length(1, MAX_OPAQUE_LENGTH)
  @Matches(OPAQUE_PATTERN, { message: "state and code must be opaque URL-safe values" })
  state!: string;
}
