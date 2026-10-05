/**
 * The audit plane's keyset cursor — where the next page starts (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * The page order is `occurred_at desc, id desc`, and the cursor is the last row's pair: the next
 * page is every row strictly *after* it in that order. That is what makes paging stable under
 * concurrent writes — a new event is newer than every row already shown, so it lands before the
 * cursor and can neither push a row onto two pages nor push one off all of them, which an
 * `offset` would do the moment an event arrived mid-scroll.
 *
 * **The instant is carried as PostgreSQL's own microsecond text, never a JavaScript `Date`.** A
 * `Date` holds milliseconds; `occurred_at` holds microseconds. A cursor rounded to the millisecond
 * would skip the rows in the same millisecond as the last one shown, or repeat them — so the
 * repository selects the column as text and the cursor hands it back verbatim.
 *
 * Opaque to clients (base64url of a small JSON object), and validated on the way in: a cursor
 * that does not decode is a `422`, never a silently restarted scroll.
 */

/** A position in the page order. */
export interface AuditCursor {
  /** `occurred_at` as UTC text with microseconds — `2026-10-05T14:31:07.123456Z`. */
  readonly at: string;
  /** The row's id — the tiebreaker inside one microsecond. */
  readonly id: string;
}

/** The text form of {@link AuditCursor.at}: UTC, microseconds, `Z`. */
const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** A uuid, the shape of `audit_events.id`. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode a position for a client to send back.
 *
 * @param cursor - The last row's instant text and id.
 * @returns An opaque base64url token.
 */
export function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.at, id: cursor.id }), "utf8").toString(
    "base64url",
  );
}

/**
 * Decode a client's token.
 *
 * @param token - What a previous page answered as `nextCursor`.
 * @returns The position, or `undefined` when the token is not one this service minted.
 */
export function decodeCursor(token: string): AuditCursor | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;

  const { at, id } = parsed as Record<string, unknown>;

  return typeof at === "string" &&
    AT_PATTERN.test(at) &&
    typeof id === "string" &&
    ID_PATTERN.test(id)
    ? { at, id }
    : undefined;
}
