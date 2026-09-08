/**
 * What a token request may contain — the body of `PUT /api/v1/settings/github-token`, as a
 * `class-validator` class.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)). One field, and required
 * rather than optional: `PUT` means *this is the value now*, and a body carrying nothing
 * would be a request to set a token to nothing — which is `DELETE`, and is a different
 * decision an administrator should have to make on purpose.
 *
 * **The shape check is here rather than in the service**, so the answer is the pipe's `422`
 * naming the field. `github.token.ts`'s header argues at length why the shape is checked at
 * all; the short version is that the failure it catches is a paste error, and a paste error
 * that is *stored* becomes indistinguishable from a revoked token an hour later.
 *
 * **The message names no value.** A validation failure normally echoes what was rejected,
 * which is helpful and is exactly wrong here: the rejected value is a credential — possibly a
 * real one, pasted into the wrong workspace — and echoing it would put it in the response
 * body, the browser's console and whatever collects client errors. So the message describes
 * the *shape* expected and never the string received.
 */

import { IsString, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";

import { MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH, TOKEN_PREFIXES } from "./github.token";

/**
 * What the field must look like, as one anchored expression.
 *
 * Built from {@link TOKEN_PREFIXES} rather than written out, so the list stays the one place
 * the answer lives — a prefix added there is accepted here with no second edit. The trailing
 * class is deliberately broad (`[A-Za-z0-9_]`): GitHub's alphabet inside a token is its own
 * business and pinning it would be this file guessing, where the prefix and the length are
 * facts it can actually stand behind. The legacy alternative is the pre-2021 forty-character
 * hex token, admitted for the reason `github.token.ts` gives.
 */
export const TOKEN_PATTERN = new RegExp(
  `^(?:(?:${TOKEN_PREFIXES.join("|")})[A-Za-z0-9_]+|[0-9a-f]{40})$`,
);

/** What a client is told when the value is not shaped like a token. */
export const TOKEN_SHAPE_MESSAGE =
  "token must be a GitHub personal access token — a value beginning " +
  `${TOKEN_PREFIXES.join(", ")} or a legacy 40-character hexadecimal token`;

/** The body of `PUT /api/v1/settings/github-token`. */
export class PutGithubTokenDto {
  /**
   * The token to store.
   *
   * Trimmed before validation, because the most common way a good token arrives broken is
   * with the newline a terminal copy put on the end — and refusing that would be refusing a
   * correct paste for a reason the person cannot see. Anything *inside* the value is not
   * whitespace this trims, and {@link TOKEN_PATTERN} refuses it.
   *
   * `!`-asserted rather than initialised, as everywhere in this service: `class-transformer`
   * assigns to these objects, and a default written here would be a value the pipe kept for
   * a field the client never sent.
   */
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(MIN_TOKEN_LENGTH, { message: TOKEN_SHAPE_MESSAGE })
  @MaxLength(MAX_TOKEN_LENGTH, { message: TOKEN_SHAPE_MESSAGE })
  @Matches(TOKEN_PATTERN, { message: TOKEN_SHAPE_MESSAGE })
  token!: string;
}
