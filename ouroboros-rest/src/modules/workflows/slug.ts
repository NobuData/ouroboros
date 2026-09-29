/**
 * The slug a workflow is known by, and how a title becomes one — P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * The slug is not decoration. `runs.workflow_tag` and `queue_items.workflow_tag` are opaque
 * text by decision **F8**, and V029's own note is that **the bridge between a stored tag and a
 * workflow row is the slug**: a lookup on `(organization_id, slug)`, which is unique. So the
 * string this file produces is the string a closed run will still be rendered under in
 * December, and `workflows_slug_format` — `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters —
 * is the shape it has to have.
 *
 * **Deriving one from the title is a convenience, and it is not the authority.** A client may
 * always send `slug` and get exactly what it sent; {@link slugify} is what *New workflow*
 * does when somebody has typed a name and nothing else. The two paths converge on the same
 * pattern, which `slug.spec.ts` asserts by running every derived slug through it.
 */

/**
 * `workflows_slug_format` (V029), restated for the DTO.
 *
 * The database is the authority — a DTO that admitted something the constraint refuses would
 * produce a `500` where the caller deserved a `422` — and this is that constraint written in
 * the one place a request can be refused before a connection is taken from the pool.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `workflows_slug_format`'s length bound, which is also what a `workflow_tag` can hold. */
export const SLUG_MAX_LENGTH = 64;

/** `workflows_name_present`'s bound (V029). */
export const NAME_MAX_LENGTH = 120;

/** `workflow_versions_change_note_present`'s bound (V029). */
export const CHANGE_NOTE_MAX_LENGTH = 500;

/**
 * Derive a slug from a workflow's title.
 *
 * Lower-cased, every run of characters the pattern does not admit collapsed to one hyphen, and
 * the result trimmed of the hyphens that leaves at either end. Truncation happens **before**
 * the final trim, so a title cut at the 64th character never ends in the hyphen that would
 * make it unstorable.
 *
 * @param name - The title, as the request sent it.
 * @returns The slug, guaranteed to satisfy {@link SLUG_PATTERN} — or `undefined` when the
 *   title holds no ASCII letter or digit to build one from. A name written entirely in a
 *   script this pattern cannot represent is not a mistake, and inventing `workflow-1` for it
 *   would give somebody an identifier with no relationship to what they typed; the caller is
 *   asked for a slug instead.
 */
export function slugify(name: string): string | undefined {
  const collapsed = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, "");

  return collapsed === "" ? undefined : collapsed;
}

/** A slug the suffix flow chose, and the ordinal it carries (`1` for the unsuffixed base). */
export interface FreeSlug {
  /** The slug — the base itself, or `base-2`, `base-3`, … */
  readonly slug: string;
  /** `1` for the base, otherwise the number the suffix carries. */
  readonly ordinal: number;
}

/**
 * How far the suffix flow counts before it gives up — `base-2` through `base-100`. A workspace
 * holding a hundred workflows from one base is one that should be asked, not numbered further.
 */
export const MAX_SLUG_ORDINAL = 100;

/**
 * The suffix flow (BB.3, [#386](https://github.com/NobuData/ouroboros/issues/386)): the first
 * slug of `base`, `base-2`, `base-3`, … that `taken` does not hold.
 *
 * A suffixed slug stays inside {@link SLUG_MAX_LENGTH}: the base is cut to make room for the
 * suffix and any hyphen the cut leaves at its end is trimmed, so every answer satisfies
 * {@link SLUG_PATTERN}.
 *
 * @param base - A slug already satisfying {@link SLUG_PATTERN} — a template's, for instance.
 * @param taken - The slugs the workspace already uses.
 * @returns The first free slug and its ordinal, or `undefined` when every candidate up to
 *   {@link MAX_SLUG_ORDINAL} is taken.
 */
export function nextFreeSlug(base: string, taken: ReadonlySet<string>): FreeSlug | undefined {
  for (let ordinal = 1; ordinal <= MAX_SLUG_ORDINAL; ordinal += 1) {
    const slug = ordinal === 1 ? base : suffixed(base, ordinal);

    if (!taken.has(slug)) return { slug, ordinal };
  }

  return undefined;
}

/**
 * `base-<ordinal>`, cut to {@link SLUG_MAX_LENGTH}.
 *
 * @param base - The slug being suffixed.
 * @param ordinal - The number to append, 2 or more.
 * @returns The suffixed slug.
 */
function suffixed(base: string, ordinal: number): string {
  const suffix = `-${ordinal}`;

  return base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, "") + suffix;
}
