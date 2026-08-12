/**
 * The square initials that stand in for a workspace or an organisation.
 *
 * The mockup draws one beside every row, and the initials there are a person's
 * (`kensuenobu` → "KS"). Nothing in the contract carries that: an organisation is a GitHub
 * login and a workspace is a slug and a display name, so the letters are **derived**, and
 * derived visibly rather than guessed — the first letter of each hyphen- or
 * underscore-separated part (`acme-robotics` → "AR"), and the first two letters when there
 * is only one part (`nobudata` → "NO"). A name that yields no letters at all falls back to
 * a dash, because an empty box reads as a broken image.
 *
 * It is decoration: the row names the workspace in text beside it, so the monogram is
 * hidden from the accessibility tree rather than read out as two stray letters.
 */

/** The letters shown when a name carries none — an em dash, not an empty box. */
const NO_INITIALS = "—";

/**
 * Derive a monogram from a slug, login or display name.
 *
 * @param name The workspace slug, organisation login or display name.
 * @returns One or two upper-case characters.
 */
export function initials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length > 0);

  if (parts.length === 0) return NO_INITIALS;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * The monogram tile.
 *
 * @param props.name The name to derive the letters from.
 * @returns The tile, hidden from assistive technology.
 */
export function Monogram({ name }: Readonly<{ name: string }>) {
  return (
    <span className="login-monogram" aria-hidden>
      {initials(name)}
    </span>
  );
}
