"use client";

import { Button } from "@/app/ui";

import { SAVE_ROUTES, SAVING } from "./chain";
import { useRouteEditor } from "./route-editor";
import { saveRoutesReason } from "./view";

/**
 * The page head's **Save routes** ([#202](https://github.com/NobuData/ouroboros/issues/202))
 * — the mockup's primary action, enabled by the editor's count.
 *
 * AA.1 ([#200](https://github.com/NobuData/ouroboros/issues/200)) drew this control inert with
 * `saveRoutesReason(0)` and left the rule in `app/models/view.ts` for this ticket to supply a
 * number to. The number is the editor's `pending`, which is client state, so the control is
 * the one Client Component in the head — and the rule is still the rule: nothing here decides
 * when the button is inert, it asks.
 *
 * Drawn for a role that may change routes and for nobody else. A member sees no editing
 * affordance at all — read-only as a rendering mode, not as a disabled control — and
 * `app/models/models-screen.tsx` is where that decision is made.
 */

/**
 * The button.
 *
 * @returns The primary action, inert with its reason while there is nothing to save or a save
 *   is in flight.
 */
export function SaveRoutesButton() {
  const editor = useRouteEditor();

  return (
    <Button
      onClick={editor.save}
      reason={editor.saving ? SAVING : saveRoutesReason(editor.pending)}
      tone="primary"
    >
      {editor.saving ? SAVING : SAVE_ROUTES}
    </Button>
  );
}
