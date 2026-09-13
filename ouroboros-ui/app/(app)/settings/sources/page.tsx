import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { readSources } from "@/app/sources/data";
import { SourcesScreen } from "@/app/sources/sources-screen";

/**
 * Ticket sources ([#141](https://github.com/NobuData/ouroboros/issues/141)) — the settings
 * section's first tab, at `/settings/sources`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader composes what the screen draws,
 * and a component draws it. The reader is `app/sources/data.ts`'s and keeps the module's
 * rule — one failed read is one degraded region, never a blank page. The decisions are in
 * `app/sources/view.ts`, `catalog.ts` and `states.ts`, covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out. Here the gate is also two of the page's **inputs**: the
 * eyebrow names the workspace, and whether this reader may add or change a source is
 * answered once, here, from the same membership. The screen is handed a boolean rather than
 * a role, so there is one place deciding what a role may do and it is `app/api/membership.ts`;
 * the gate that **enforces** is the service's. The role travels beside the boolean for one
 * purpose — to be *named* in the read-only note.
 *
 * **Under `/settings`, not beside it.** The sidebar highlights the entry whose route the URL
 * is under, so this segment's placement is what keeps **Settings** lit here — and what makes
 * BS.1's ([#491](https://github.com/NobuData/ouroboros/issues/491)) mounting of this surface
 * as a settings tab a change to the frame rather than to the URL.
 *
 * @returns The sources page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readSources(access);

  return (
    <SourcesScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
      role={primaryRole(access.membership.roles)}
      workspaceName={access.membership.name}
    />
  );
}
