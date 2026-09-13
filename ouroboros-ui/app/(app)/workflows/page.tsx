import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { readStudio } from "@/app/workflows/data";
import { StudioScreen } from "@/app/workflows/studio-screen";

/**
 * The workflow studio's landing (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)) — mockup 04's `/workflows`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader turns that into everything the
 * screen draws, and a component draws it. Nothing is decided here, so there is nothing here
 * that has to be tested by driving a route — the decisions are in
 * [`app/workflows/view.ts`](../../workflows/view.ts) and
 * [`app/workflows/states.ts`](../../workflows/states.ts), and the read in
 * [`app/workflows/data.ts`](../../workflows/data.ts), all covered directly.
 *
 * **It opens on the rail's first workflow**, the way the mockup opens on `standard-fix`: the
 * sidebar's **Workflows** entry leads here, and a landing that answered with nothing selected
 * would make every visit two presses. The rail's own links go to
 * [`[slug]/page.tsx`](./%5Bslug%5D/page.tsx), which is the same screen opened on a named
 * workflow — a redirect from here to that URL was considered and costs a second round of
 * reads on the product's most-pressed sidebar entry for a URL the rail already offers.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. It returns
 * the workspace, so the page that skipped the check is also the page with nothing to draw.
 *
 * **This retires the `/workflows` placeholder** #49 held for it — the amendment recorded when
 * mockup 04's roadmap was filed. The sidebar's **Workflows** entry stops being a *soon* row
 * and becomes a link on the same commit (`app/shell/nav-modules.ts`), because a route that
 * exists and a navigation that still refuses to point at it is the same dead end from the
 * other side; the dashboard's *Edit workflows* becomes a link for the same reason.
 *
 * ### Why the role is decided here
 *
 * **Publish vN+1** and the rail's **+ New workflow** are for an `owner` or an `admin` and for
 * nobody else, and *whether this reader is one* is answered once, here, from the membership
 * the gate resolved — the shape every gated screen in this group takes. The screen is handed
 * a boolean rather than a role, so there is one place deciding what a role may do and it is
 * `app/api/membership.ts`. The gate that **enforces** is the service's;
 * `app/workflows/create-actions.ts` says what a member who reaches a write anyway is told.
 * The role's **name** travels beside the boolean for one sentence: a reader who may not edit
 * is told so, and told as what.
 *
 * @returns The studio, open on the workspace's first workflow.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readStudio(access, null);

  return (
    <StudioScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
      role={primaryRole(access.membership.roles)}
    />
  );
}
