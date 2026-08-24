import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { readRegistry } from "@/app/registry/data";
import { RegistryScreen } from "@/app/registry/registry-screen";

/**
 * The model registry ([#591](https://github.com/NobuData/ouroboros/issues/591)) — mockup 21's
 * `/models/registry`, replacing the `#49` placeholder this route was.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader composes what it can read, and a
 * component draws it. The decisions are in
 * [`app/registry/view.ts`](../../../registry/view.ts), covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. Here the gate
 * is also one of the page's two **inputs**: both head actions are gated on the reader's role,
 * and the roles come from the membership the gate resolved — the session/role context the
 * ticket lists as its BA-D.5 dependency, arriving through the same call every other signed-in
 * screen makes.
 *
 * **Under `/models`, not beside it.** The sidebar highlights the entry whose route the URL is
 * under (`app/shell/nav.ts`), so this segment's placement is what keeps **Models** lit on all
 * three pages of the section — the ticket's *all three directions* criterion (06 ⇄ 21 ⇄ 07),
 * met by the URL rather than by a special case in the sidebar.
 *
 * @returns The registry page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();

  return (
    <RegistryScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={await readRegistry(access)}
    />
  );
}
