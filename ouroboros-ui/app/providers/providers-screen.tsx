import { ModelsFrame } from "@/app/models/models-frame";
import { Button, Card, EmptyState } from "@/app/ui";

import { AuditTrail } from "./audit-trail";
import {
  ADD_PROVIDER_LABEL,
  ADD_PROVIDER_REASON,
  PROVIDERS_NEXT_NOTE,
  PROVIDERS_NEXT_TITLE,
  PROVIDERS_TITLE,
  providersSubline,
} from "./view";

/**
 * The `/models/providers` frame ([#227](https://github.com/NobuData/ouroboros/issues/227)) —
 * `docs/mockups/07-providers.html`'s page head and tab set as a working page.
 *
 * It renders **inside the app shell** and inside the Models section's own frame
 * (`app/models/models-frame.tsx`), so it starts at its page head, contributes no chrome of its
 * own, and draws the same tab row `/models` draws with the underline moved. The mockup's
 * `.topbar`/`.nav` markup is superseded: this surface is reached from the sidebar's **Models**
 * entry — which stays lit here because the route is under `/models` (`app/paths.ts`) — and
 * from the Providers & keys tab on the routing page.
 *
 * It is a component rather than markup written in the route, for the reason every screen in
 * this module is: everything it draws can be rendered and asserted on without Next.js's
 * routing around it. The route gates (`app/(app)/models/providers/page.tsx`), a pure module
 * holds the copy (`app/providers/view.ts`), and this draws.
 *
 * ### Two small things and one that matters
 *
 * The small things are the route and the head. The head's subline is the exception: it is the
 * sentence that makes the security claim, and its wording is **not this page's to choose** —
 * `providersSubline` renders `docs/SECURITY_MODEL.md` § 7.2 with the workspace's name in it,
 * and nothing here paraphrases it. The mockup's own line, about workers seeing short-lived
 * tokens, describes a system this is not.
 *
 * The thing that matters is the tab set, and it is not this file's at all: the frame draws
 * it from the one list both pages share, so *Providers & keys* being live here is the same
 * fact as it being live on `/models` — the amendment AA.1 (#200) was filed expecting.
 *
 * ### The two actions
 *
 * **Audit log** is AD.4's (`app/providers/audit-trail.tsx`): the ghost action and its sheet
 * as one element, reading the workspace's credential trail when pressed. It was built to be
 * mounted here and nothing about it changed when it was. **+ Add provider** is the mockup's
 * primary action and leads to AE.5's catalog (#231), which does not exist yet — so it is inert
 * through `Button`'s `reason` and says so, rather than sitting dead or being left off a head
 * whose whole arrangement is one action beside the other.
 *
 * ### What this page does not pretend
 *
 * Below the tab set is where the five provider cards go, and they are AE.2's (#228). The
 * space carries an empty state naming the issues that fill it rather than a grid of invented
 * cards — § 3.5 applied to a frame: a surface that is not ready is **labelled**, never dead,
 * and never a mock-up of itself.
 *
 * A Server Component. It reads nothing: the one read on this page — the trail — is behind the
 * sheet's own button and happens when somebody opens it (`audit-actions.ts` says why then
 * rather than on page load), and the workspace's name arrives from the gate.
 */

/**
 * The providers screen.
 *
 * @param props.workspaceName The active workspace's display name, for the subline's slot.
 * @returns The screen.
 */
export function ProvidersScreen({ workspaceName }: Readonly<{ workspaceName: string }>) {
  return (
    <ModelsFrame
      active="providers"
      title={PROVIDERS_TITLE}
      subline={providersSubline(workspaceName)}
      actions={
        <>
          {/*
            The ghost action and its sheet. `AuditTrail` is the whole of AD.4's UI half and
            was written to be mounted exactly here, beside the primary action it must not
            compete with.
          */}
          <AuditTrail />
          <Button reason={ADD_PROVIDER_REASON} tone="primary">
            {ADD_PROVIDER_LABEL}
          </Button>
        </>
      }
    >
      <Card className="models__next" fill>
        <EmptyState fill note={PROVIDERS_NEXT_NOTE} title={PROVIDERS_NEXT_TITLE} />
      </Card>
    </ModelsFrame>
  );
}
