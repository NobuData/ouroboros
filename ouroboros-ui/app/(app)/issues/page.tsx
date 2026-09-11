import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { readIssues } from "@/app/issues/data";
import { IssuesScreen } from "@/app/issues/issues-screen";

/**
 * Issue intake ([#115](https://github.com/NobuData/ouroboros/issues/115)) — mockup 03's `/issues`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate returns
 * the workspace this request may render, a reader turns that into what the screen draws, and a
 * component draws it. The decisions are in [`app/issues/view.ts`](../../issues/view.ts) and the read
 * in [`app/issues/data.ts`](../../issues/data.ts), both covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out: a layout does not re-render on a client-side navigation and does
 * not control whether the segment beneath it renders anyway. It returns the workspace, so the page
 * that skipped the check is also the page with nothing to draw.
 *
 * **This retires the `/issues` placeholder** #49 was to build — an amendment recorded when the
 * intake roadmap was filed, and one that turned out to need no deletion, because the placeholder
 * was never built. The sidebar's **Issues** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`, amending #41's nav state), because a route that exists and a
 * navigation that still refuses to point at it is the same dead end from the other side.
 *
 * ### Why the roles are decided here
 *
 * Two of the head's controls depend on who is looking — **Re-estimate all** is drawn for an `owner`
 * or an `admin` and nobody else, and **Queue N selected ⟳** is inert for a `viewer` — and both
 * answers come from the membership the gate resolved, once, here. The screen is handed booleans
 * rather than a role, so the one place deciding what a role may do is `app/api/membership.ts`. The
 * gate that **enforces** is the service's; `app/issues/head-actions.ts` says what a press that went
 * around the presentation is answered with.
 *
 * @returns The intake page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readIssues(access);
  const { roles } = access.membership;

  return (
    <IssuesScreen
      mayAdminister={mayAdminister(roles)}
      mayContribute={mayContribute(roles)}
      readings={readings}
    />
  );
}
