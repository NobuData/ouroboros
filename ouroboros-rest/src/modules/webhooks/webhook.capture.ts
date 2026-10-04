/**
 * What the delivery log keeps of a receiver's answer, and of a failure (BR.3,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * **Bounded.** At most {@link EXCERPT_LIMIT} characters of the body are kept (V094's CHECK says
 * the same), and the transport stops reading after {@link READ_LIMIT_BYTES} — a receiver that
 * answers with a gigabyte costs a few kilobytes.
 *
 * **Never a credential.** A collector's error page is exactly where a misconfigured receiver
 * echoes the `Authorization` header it expected, or a token from its own config. Anything shaped
 * like one is replaced with `[redacted]` before the text is stored: bearer and basic credentials,
 * `key=value` / `"key": "value"` pairs whose key names a secret, JWTs, well-known token prefixes,
 * and long unbroken hex or base64 runs. Over-redacting a debug excerpt costs nothing; storing a
 * live token in a table every administrator can read is the incident.
 */

/** The most characters of a response body the log keeps — V094's `response_excerpt` bound. */
export const EXCERPT_LIMIT = 1024;

/** The most characters of a failure reason the log keeps — V098's `error` bound. */
export const ERROR_LIMIT = 512;

/** The most bytes the transport reads from a response before it stops listening. */
export const READ_LIMIT_BYTES = 4096;

/** What a redacted span becomes. */
export const REDACTED = "[redacted]";

/** Key names whose values are secrets, wherever they appear. */
const SECRET_KEYS =
  "(?:api[_-]?key|access[_-]?key|secret|client[_-]?secret|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|auth|authorization|signature|private[_-]?key|session|cookie|credential)";

/** The redaction passes, in order. Each pattern's match is replaced by its replacer. */
const PASSES: readonly [RegExp, string][] = [
  // `"password": "hunter2"` — JSON pairs.
  [new RegExp(`("${SECRET_KEYS}"\\s*:\\s*)"[^"]*"`, "gi"), `$1"${REDACTED}"`],
  // `token=abc&…`, `Authorization: Bearer abc` — query strings and header-like lines.
  [
    new RegExp(`\\b(${SECRET_KEYS}\\s*[=:]\\s*)(?:(?:bearer|basic|token)\\s+)?[^\\s&,;"']+`, "gi"),
    `$1${REDACTED}`,
  ],
  // A bare `Bearer abc` / `Basic abc` anywhere.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED],
  // Well-known token prefixes: GitHub, OpenAI/Anthropic, Slack, Stripe, AWS, ours.
  [
    /\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|sk_live_|rk_live_|AKIA|ASIA|whsec_|orb_)[A-Za-z0-9_-]{8,}/g,
    REDACTED,
  ],
  // Long unbroken hex or base64 runs — a key with no label is still a key.
  [/\b[A-Fa-f0-9]{32,}\b/g, REDACTED],
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, REDACTED],
];

/**
 * Text with anything credential-shaped replaced.
 *
 * @param text - A response body or a failure message.
 * @returns The text, redacted.
 */
export function redactCredentials(text: string): string {
  return PASSES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

/**
 * The excerpt the log stores for a response body.
 *
 * @param body - What was read (already capped at {@link READ_LIMIT_BYTES}).
 * @returns `null` for an empty body; otherwise the redacted text, truncated to
 *   {@link EXCERPT_LIMIT} characters with a trailing `…` when it was cut.
 */
export function responseExcerpt(body: string): string | null {
  const trimmed = body.trim();

  if (trimmed === "") {
    return null;
  }

  return bounded(redactCredentials(trimmed), EXCERPT_LIMIT);
}

/**
 * The failure reason the log stores.
 *
 * @param message - What went wrong, in words.
 * @returns The redacted message, at most {@link ERROR_LIMIT} characters.
 */
export function failureReason(message: string): string {
  return bounded(redactCredentials(message), ERROR_LIMIT);
}

/**
 * Text cut to a length, marking the cut.
 *
 * @param text - The text.
 * @param limit - The most characters to keep, the mark included.
 * @returns The text, or its first `limit - 1` characters and `…`.
 */
function bounded(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
