"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { copyWhenReady } from "@/app/farm/clipboard";

import { COPIED_BRANCH, COPY_BRANCH_FAILED, COPY_BRANCH_LABEL } from "./view";

/** How long the control says *copied* before it goes back to offering to copy. */
export const COPY_FEEDBACK_MS = 2000;

/** Where the last press left the control. */
type CopyState = "idle" | "copied" | "failed";

/**
 * The branch name, in mono, with a copy control beside it
 * ([#309](https://github.com/NobuData/ouroboros/issues/309)) — because the first thing anyone
 * does with a branch name is paste it.
 *
 * The outcome is announced through a polite live region rather than only by swapping the icon:
 * a check mark is a sighted reader's confirmation, and a keyboard reader pressing the control
 * needs the same answer in words. The region is always rendered, so screen readers are already
 * listening when it changes.
 *
 * @param props.branch The branch the loop works on.
 * @returns The branch and its control.
 */
export function CopyBranch({ branch }: Readonly<{ branch: string }>) {
  const [state, setState] = useState<CopyState>("idle");

  // The *copied* answer fades back to the control's resting state; a new press restarts it.
  useEffect(() => {
    if (state === "idle") return;

    const timer = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  /** Put the branch on the clipboard, inside the press so the browser counts the gesture. */
  function copy(): void {
    copyWhenReady(Promise.resolve(branch)).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }

  return (
    <span className="run-head__branch">
      <span className="run-head__mono">
        branch <span className="run-head__branch-name">{branch}</span>
      </span>
      <button
        aria-label={COPY_BRANCH_LABEL}
        className="run-head__copy"
        onClick={copy}
        title={COPY_BRANCH_LABEL}
        type="button"
      >
        {state === "copied" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
      </button>
      <span aria-live="polite" className="run-head__copy-status" role="status">
        {state === "copied" ? COPIED_BRANCH : state === "failed" ? COPY_BRANCH_FAILED : ""}
      </span>
    </span>
  );
}
