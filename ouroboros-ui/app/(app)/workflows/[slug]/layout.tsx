import type { ReactNode } from "react";

import { StudioModeGuard } from "@/app/workflows/mode-guard";

/**
 * The layout one workflow's two editors share (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)) — `/workflows/<slug>` (Visual) and
 * `/workflows/<slug>/code` (Code).
 *
 * It holds exactly one thing, and it is not the draft. Decision **C3** puts the draft in one
 * place, the service's draft slot, and each editor's page reads it when it renders — which is
 * what makes switching modes loss-free without any client state to keep in step. What does
 * need to outlive a single page is the **guard** (`app/workflows/mode-guard.tsx`): the code
 * editor tells it when it holds a buffer that has not parsed (**C4**), and the segmented control
 * asks it before a switch would discard one. A layout is where that belongs, because a layout
 * stays mounted while navigation swaps the page beneath it — the guard is still there when the
 * press that leaves the page happens.
 *
 * It reads nothing and gates nothing: each page calls `requireWorkspace()` itself, for the
 * reason `app/(app)/layout.tsx` gives.
 *
 * @param props.children The editor's page.
 * @returns The page, inside the guard.
 */
export default function WorkflowLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <StudioModeGuard>{children}</StudioModeGuard>;
}
