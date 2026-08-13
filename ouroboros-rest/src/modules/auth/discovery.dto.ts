/**
 * What `POST /api/v1/auth/discover` accepts — one field, and the normalisation that runs
 * before it is validated.
 *
 * The field is typed by a person into mockup 01's *Company domain* box, which is the whole
 * reason this file normalises at all. Everywhere else in this service a DTO **rejects**
 * rather than folds — `tenancy.dto.ts` says why, and the reason is good: what is stored
 * should be what was sent, or a client cannot predict what a `GET` returns. Nothing is
 * stored here. This value is a lookup key that never outlives the request, and the person
 * supplying it has just copied `https://Acme.Ouroboros.dev/` out of their address bar. So
 * this is the other case, and the issue asks for it in as many words: *normalise (lower-case,
 * trim, strip protocol)*.
 *
 * **Normalise first, then validate.** `@Transform` runs during `plainToInstance`, which
 * Nest's `ValidationPipe` calls before `validate` — so the value the decorators below judge
 * is the value the lookup will use, and a `422` is never about characters the service was
 * about to remove anyway.
 *
 * **The pattern is `tenancy.dto.ts`'s, imported rather than restated.** It is the shape
 * `tenant_domains_domain_format` (V001) admits, which is the shape of every row this
 * endpoint can match — so a second copy here could only ever be a copy that drifts, and
 * drifting *looser* would mean accepting input no row could satisfy while drifting
 * *stricter* would mean refusing a domain a tenant really holds. It is a regular expression
 * and not a provider: importing it couples nothing but the rule.
 */

import { Transform } from "class-transformer";
import { IsString, Matches, MaxLength } from "class-validator";

import { DOMAIN_PATTERN } from "../tenancy/tenancy.dto";

/**
 * The longest a domain name can be, in bytes, and what `tenant_domains.domain` is bounded
 * to. Checked *after* normalisation, so a scheme and a path do not count against it.
 */
export const DOMAIN_MAX_LENGTH = 253;

/**
 * A URI scheme and its separator: `https://`, `http://`, and anything else shaped like one.
 *
 * Written as RFC 3986's `scheme` rule rather than as `https?://` because the point is to
 * remove whatever the browser put in front of the host, and a person who pastes
 * `ftp://acme.example` has made the same mistake as one who pastes `https://acme.example`.
 * Applied after the value is lower-cased, which is what lets it be written in one case.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//;

/** Everything from the first `/`, `?` or `#` — the path, query and fragment of a pasted URL. */
const AUTHORITY_END = /[/?#].*$/;

/**
 * A single trailing dot: `acme.example.` is the same name as `acme.example`, fully
 * qualified. Stored rows never carry one, so a lookup with one would miss.
 */
const TRAILING_DOT = /\.$/;

/**
 * The domain a person typed, as the column stores it.
 *
 * Four steps, in this order and for these reasons:
 *
 *   1. **Trim**, because a value pasted from a browser or an email signature carries the
 *      whitespace around it.
 *   2. **Lower-case**, because `tenant_domains.domain` is lower-case by constraint and the
 *      unique index that answers this lookup compares bytes.
 *   3. **Strip the scheme**, which is what the person's address bar added and what the
 *      issue names. It is after the lower-casing so `HTTPS://` is the same case as `https://`.
 *   4. **Strip the path, query and fragment**, which is the rest of what a pasted URL
 *      carries. Removing `https://` from `https://acme.example/login` and stopping there
 *      would leave a value no row can match and no error message can usefully explain.
 *
 * Then the trailing dot, which is not a fifth step so much as the same name written two ways.
 *
 * **What it deliberately does not do** is guess. A port, an `@`, a space in the middle, an
 * email address instead of a domain — none of them are folded into something plausible.
 * They fail {@link DOMAIN_PATTERN} and the caller is told what a company domain looks like,
 * which is a better answer than silently looking up something they did not ask for.
 *
 * @param value - The raw field, as it arrived.
 * @returns It, as `tenant_domains.domain` would hold it. Not guaranteed to be a valid
 *   domain — that is the decorators' judgement, on this function's output.
 */
export function normaliseDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(SCHEME, "")
    .replace(AUTHORITY_END, "")
    .replace(TRAILING_DOT, "");
}

/** `POST /api/v1/auth/discover`. */
export class DiscoverBody {
  /**
   * The company domain — `acme.ouroboros.dev`, the mockup's own placeholder.
   *
   * Normalised before it is judged, so `  HTTPS://Acme.Ouroboros.dev/login  ` is the same
   * request as `acme.ouroboros.dev`. The `@Transform` leaves a non-string alone rather than
   * calling `.trim()` on it: `@IsString()` below is what reports that, and a transformer
   * that threw would produce a `500` for a request whose only fault is a number where a
   * string belongs.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? normaliseDomain(value) : value,
  )
  @IsString()
  @MaxLength(DOMAIN_MAX_LENGTH)
  @Matches(DOMAIN_PATTERN, {
    message: "domain must be a company domain, such as acme.ouroboros.dev",
  })
  domain!: string;
}
