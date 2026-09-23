"use client";

import { useEffect, useState } from "react";

import { copyWhenReady } from "@/app/farm/clipboard";

/** How long a copy control says *copied* before it goes back to offering to copy. */
export const COPY_FEEDBACK_MS = 2000;

/** Where the last press left a copy control. */
export type CopyState = "idle" | "copied" | "failed";

/**
 * A copy control's state — the branch in the head (#309) and the take-over commands (#310).
 *
 * The *copied* answer fades back to the resting state after {@link COPY_FEEDBACK_MS}; a new
 * press restarts it. The write happens inside the press, so the browser counts the gesture.
 *
 * @returns The state, and the press.
 */
export function useCopy(): { readonly state: CopyState; readonly copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;

    const timer = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  /**
   * Put a text on the clipboard.
   *
   * @param text What to copy.
   */
  function copy(text: string): void {
    copyWhenReady(Promise.resolve(text)).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }

  return { state, copy };
}
