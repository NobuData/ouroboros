import type { Role } from "@/app/api/membership";

import { farmReadOnlyNote } from "./states";

/**
 * The sentence a reader who may look and not change is given
 * (AI.7, [#262](https://github.com/NobuData/ouroboros/issues/262)).
 *
 * The issue asks that a member session be read-only *with the role explained rather than controls
 * silently missing*. AI.5 (#260) made a member's write affordances absent — a runner's menu holds
 * **View details** alone, and there is no **Submit build** — so without this a member's page is
 * simply a shorter page, with nothing saying why. The note names the role and the rule each
 * region keeps; the sentences are `app/farm/states.ts`'s.
 *
 * A `note` rather than a `status`, as the providers and routing pages draw their own: a fact about
 * the reader that does not change while the page is open, and announcing it as a live region would
 * read it out again on every poll for no reason.
 *
 * @param props.role The reader's strongest role, from `primaryRole`.
 * @returns The paragraph.
 */
export function FarmReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = farmReadOnlyNote(role);

  return (
    <p className="farm-readonly" role="note">
      <span className="farm-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}
