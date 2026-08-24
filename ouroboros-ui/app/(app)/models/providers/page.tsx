import { requireWorkspace } from "@/app/api/access";
import { ProvidersScreen } from "@/app/providers/providers-screen";

/**
 * Providers & keys ([#227](https://github.com/NobuData/ouroboros/issues/227)) — mockup 07's
 * `/models/providers`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, and a component draws it. There is no reader
 * between them, unlike `/models`, because nothing on this page is read at render time — the
 * provider cards are AE.2's (#228) and the one read that exists, the credential trail, is
 * behind the **Audit log** button and happens when it is pressed
 * (`app/providers/audit-actions.ts` says why then rather than on page load). The decisions are
 * in [`app/providers/view.ts`](../../../providers/view.ts), covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. Here the
 * gate is also the page's one **input**: the subline the security model approved names the
 * workspace, and the workspace's display name is what the gate returns — the session/role
 * context the ticket lists as its BA-D.5 dependency, arriving through the same call every
 * other signed-in screen makes.
 *
 * **Under `/models`, not beside it.** The sidebar highlights the entry whose route the URL
 * is under (`app/shell/nav.ts`), so this segment's placement is what keeps **Models** lit on
 * both pages of the section — the ticket's *both directions* criterion, met by the URL.
 *
 * @returns The providers page, for the workspace this request is operating in.
 */
export default async function Page() {
  const { membership } = await requireWorkspace();

  return <ProvidersScreen workspaceName={membership.name} />;
}
