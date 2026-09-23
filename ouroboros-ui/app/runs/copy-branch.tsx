"use client";

import { Check, Copy } from "lucide-react";

import { useCopy } from "./use-copy";
import { COPIED_BRANCH, COPY_BRANCH_FAILED, COPY_BRANCH_LABEL } from "./view";

export { COPY_FEEDBACK_MS } from "./use-copy";

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
  const { state, copy } = useCopy();

  return (
    <span className="run-head__branch">
      <span className="run-head__mono">
        branch <span className="run-head__branch-name">{branch}</span>
      </span>
      <button
        aria-label={COPY_BRANCH_LABEL}
        className="run-head__copy"
        onClick={() => copy(branch)}
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
