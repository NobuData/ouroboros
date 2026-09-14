import type { Role } from "@/app/api/membership";

import { readOnlyNote } from "./states";

import "./workflows.css";

/**
 * The sentence a reader who may look and not change is given, on every studio surface (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147); shared with the code view since V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)).
 *
 * One component for both editors because the role gate is one gate: the ticket's *role gates
 * match the visual editor* is true by construction when the explanation, and the
 * `mayAdminister` decision the screens draw it from, are the same code on both surfaces.
 *
 * A `note` rather than a `status`: it is a fact about the reader that does not change while
 * the page is open, and announcing it as a live region would read it out again on every
 * render for no reason. The head names the role and the body says what it means here — two
 * spans on one line, so the role is the first thing read.
 *
 * @param props.role The reader's strongest role.
 * @returns The paragraph.
 */
export function StudioReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = readOnlyNote(role);

  return (
    <p className="studio-readonly" role="note">
      <span className="studio-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}
