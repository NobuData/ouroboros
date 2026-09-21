import { ENROLL_COPY_ID, ENROLL_POOL_FIELD_ID } from "./enroll";

/**
 * Move the reader to the enroll card (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)):
 * its pool selector, or — in a workspace with no pools, where there is no selector — its copy
 * control, which is where the reason is said.
 *
 * **Focus, not a fragment link**, because the shell's pane — not the window — is the scroll
 * container, and focus is the one mechanism that scrolls it natively. Two doors lead here: the
 * head's **+ Enroll runner** (`app/farm/farm-head.tsx`) and the first-run guidance's call to
 * action (`app/farm/farm-first-run.tsx`, AI.7,
 * [#262](https://github.com/NobuData/ouroboros/issues/262)), which is why it is a module of its
 * own rather than a function inside either.
 *
 * It does nothing when the card is not on screen — a reader who may not mint has no selector and
 * no copy control, and is offered neither door.
 */
export function focusEnrollCard(): void {
  const target =
    document.getElementById(ENROLL_POOL_FIELD_ID) ?? document.getElementById(ENROLL_COPY_ID);

  target?.focus();
}
