/**
 * Keeping the bytes Slack signed (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * Slack signs the **raw, unparsed** request body. The classic way a signature check breaks is a
 * body parser that runs first: the handler re-serialises what it was given, the bytes differ,
 * the signature no longer matches, and somebody "fixes" it by loosening the check. So the bytes
 * are captured here, in the parser's own `verify` hook — before anything is parsed — and the
 * guard verifies against exactly those.
 *
 * The hook is given to **both** parsers (`auth/auth.module.ts`): events arrive as JSON, slash
 * commands and interactivity as `application/x-www-form-urlencoded`. It is scoped to the Slack
 * paths, so no other request has its body retained twice.
 */

import { SLACK_PATH_PREFIX } from "./slack.app";

/** A request that may carry the bytes it arrived with. */
export interface RawBodyRequest {
  /** The request path, as the platform reports it. */
  readonly originalUrl?: string;
  readonly url?: string;
  /** The body exactly as it arrived — set for the Slack paths only. */
  rawBody?: Buffer;
}

/**
 * A body parser's `verify` hook: keep the raw bytes of a request to the Slack family.
 *
 * @param request - The incoming request.
 * @param _response - Unused; the hook's signature is the parser's.
 * @param buffer - The body as it arrived, before parsing.
 */
export function captureSlackRawBody(
  request: RawBodyRequest,
  _response: unknown,
  buffer: Buffer,
): void {
  const path = request.originalUrl ?? request.url ?? "";

  if (path.startsWith(SLACK_PATH_PREFIX) && Buffer.isBuffer(buffer)) {
    request.rawBody = buffer;
  }
}
