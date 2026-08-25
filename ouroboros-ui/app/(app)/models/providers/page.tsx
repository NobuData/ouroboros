import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { readProviders } from "@/app/providers/data";
import { ProvidersScreen } from "@/app/providers/providers-screen";

/**
 * Providers & keys ([#227](https://github.com/NobuData/ouroboros/issues/227)) — mockup 07's
 * `/models/providers`, with its cards ([#228](https://github.com/NobuData/ouroboros/issues/228)).
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader composes what the screen draws,
 * and a component draws it. The reader is `app/providers/data.ts`'s and follows
 * `app/models/data.ts`'s rule — one failed read is one degraded region, never a blank page;
 * the two reads behind buttons, the credential trail and the catalog, happen when they are
 * pressed. The decisions are in `app/providers/cards.ts`, `catalog.ts` and `view.ts`, covered
 * directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. Here the
 * gate is also two of the page's **inputs**: the subline the security model approved names
 * the workspace, and whether this reader may connect a provider or press a card's switch is
 * answered once, here, from the same membership, the way `app/(app)/models/page.tsx` answers
 * it for the rules card. The screen is handed a boolean rather than a role, so there is one
 * place deciding what a role may do and it is `app/api/membership.ts`; the gate that
 * **enforces** is the service's.
 *
 * **Under `/models`, not beside it.** The sidebar highlights the entry whose route the URL
 * is under (`app/shell/nav.ts`), so this segment's placement is what keeps **Models** lit on
 * both pages of the section — the ticket's *both directions* criterion, met by the URL.
 *
 * @returns The providers page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readProviders(access);

  return (
    <ProvidersScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
      workspaceName={access.membership.name}
    />
  );
}
