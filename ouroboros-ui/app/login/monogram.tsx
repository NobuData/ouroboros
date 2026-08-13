/**
 * The square initials that stand in for a workspace or a person.
 *
 * The mockup draws one beside every row, and the initials there are a person's
 * (`kensuenobu` → "KS").
 *
 * **A workspace's letters are the service's now**
 * ([#719](https://github.com/NobuData/ouroboros/issues/719)). `OrgRow.monogram` is a field of
 * the contract, derived where the name is: *"computed by the service rather than by the
 * client on purpose — a browser that derived them would be a second place the rule lives,
 * and the two would disagree the first time either changed"* (`openapi.yaml` § `OrgRow`).
 * Nothing on this side may re-derive them, so this component takes **letters** and draws
 * them, and {@link initials} is what the one surface with no service-derived monogram — the
 * signed-in person on step 1 — uses to make its own.
 *
 * That split is why the tile takes letters rather than a name. A component that accepted
 * both would be a component with two rules inside it, and the whole point of the field is
 * that there is one rule and the service keeps it.
 *
 * It is decoration: the row names the workspace in text beside it, so the monogram is
 * hidden from the accessibility tree rather than read out as two stray letters.
 */

/** The letters shown when a *derived* name carries none — an em dash, not an empty box. */
const NO_INITIALS = "—";

/**
 * Derive a monogram from a slug, login or display name.
 *
 * The rule the service keeps for a workspace, kept here for the one thing it does not
 * describe: the signed-in person. The first letter of each hyphen- or underscore-separated
 * part (`acme-robotics` → "AR"), and the first two letters when there is only one part
 * (`nobudata` → "NO"). A name that yields no letters at all falls back to a dash, because an
 * empty box reads as a broken image.
 *
 * @param name The person's display name, or their address when they have none.
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
 * @param props.letters What to draw — `OrgRow.monogram` for a workspace, {@link initials}
 *   for a person. **An empty string is drawn as an empty tile rather than as a fallback**,
 *   which is what the contract asks of a client for a name carrying no letters or digits at
 *   all: "an empty circle rather than a failure".
 * @returns The tile, hidden from assistive technology.
 */
export function Monogram({ letters }: Readonly<{ letters: string }>) {
  return (
    <span className="login-monogram" aria-hidden>
      {letters}
    </span>
  );
}
