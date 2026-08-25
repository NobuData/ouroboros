"use client";

import { Button, StickyBar } from "@/app/ui";

import { DISCARD, SAVE_ROUTES, SAVING, dirtyBarLabel } from "./chain";
import { useRouteEditor } from "./route-editor";

import "./models.css";

/**
 * The dirty-state bar ([#202](https://github.com/NobuData/ouroboros/issues/202)) —
 * `2 routes changed · [Save routes] [Discard]`, stuck under the tab set while the page scrolls.
 *
 * It is the CP.4 `StickyBar` in its *asking* manner, which is what the primitive was built
 * for: a bar that wants a decision before the reader leaves, sticking **within the content
 * pane** rather than the viewport (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3). The primitive
 * owns the sticking and the stacking under the subnav; this owns what the bar says.
 *
 * ### Present only while there is something to decide
 *
 * The bar is not a region that empties: it is drawn when the editor holds an edit and not
 * otherwise, so a clean page has no bar and a member — whose editor holds no edits by
 * construction — never sees one. What *is* always mounted is the live region the save's
 * notice is read from, because a live region added to the page at the same moment as its
 * content is not announced — and *Routes saved* is said at the exact moment the bar leaves.
 *
 * ### The count is a status, the failure is an alert
 *
 * *2 routes changed* is a fact about the page the reader is editing and joins the polite
 * queue; a save that did not land is an interruption, and says so at the level the ARIA
 * pattern reserves for one. Both sentences are `app/models/chain.ts`'s.
 */

/**
 * The bar.
 *
 * @returns The live region, and the bar while the editor holds an edit.
 */
export function DirtyBar() {
  const editor = useRouteEditor();

  return (
    <>
      <p className="sr-only" role="status">
        {editor.notice ?? ""}
      </p>

      {editor.pending > 0 && (
        <StickyBar className="models-dirty" tone="asking">
          <span className="models-dirty__label" role="status">
            {dirtyBarLabel(editor.pending)}
          </span>
          <span aria-hidden className="models-dirty__sep">
            ·
          </span>
          <span className="models-dirty__actions">
            <Button
              onClick={editor.save}
              reason={editor.saving ? SAVING : undefined}
              size="sm"
              tone="primary"
            >
              {editor.saving ? SAVING : SAVE_ROUTES}
            </Button>
            <Button
              onClick={editor.discard}
              reason={editor.saving ? SAVING : undefined}
              size="sm"
              tone="ghost"
            >
              {DISCARD}
            </Button>
          </span>

          {editor.failure !== null && (
            <p className="models-dirty__failure" role="alert">
              {editor.failure}
            </p>
          )}
        </StickyBar>
      )}
    </>
  );
}
