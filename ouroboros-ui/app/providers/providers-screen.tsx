import { ModelsFrame } from "@/app/models/models-frame";
import { Card, EmptyState } from "@/app/ui";

import { AddProviderButton, AddProviderFlow, BrowseCatalogButton } from "./add-provider";
import { AuditTrail } from "./audit-trail";
import { ADD_CARD_NOTE } from "./catalog";
import {
  PROVIDERS_NEXT_NOTE,
  PROVIDERS_NEXT_TITLE,
  PROVIDERS_TITLE,
  providersSubline,
} from "./view";

import "./providers.css";

/**
 * The `/models/providers` frame ([#227](https://github.com/NobuData/ouroboros/issues/227)) —
 * `docs/mockups/07-providers.html`'s page head and tab set as a working page, with the
 * add-provider flow ([#231](https://github.com/NobuData/ouroboros/issues/231)) mounted on it.
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
 * routing around it. The route gates (`app/(app)/models/providers/page.tsx`), two pure modules
 * hold the decisions (`app/providers/view.ts` for the page and the trail,
 * `app/providers/catalog.ts` for the add flow), and this draws.
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
 * ### The two actions, and the dashed card
 *
 * **Audit log** is AD.4's (`app/providers/audit-trail.tsx`): the ghost action and its sheet
 * as one element, reading the workspace's credential trail when pressed. **+ Add provider**
 * is AE.5's, and so is the dashed card's **Browse catalog** below the tab set: two openers of
 * *one* dialog, which is why the whole frame sits inside `AddProviderFlow` — the dialog and
 * its state live there once, and each opener reaches it through the flow's context from
 * wherever the mockup draws it. For a reader who may not connect a provider, both openers
 * are inert with the reason (`Button`'s `reason`), and the flow never opens; the gate that
 * *enforces* is the service's.
 *
 * ### What this page does not pretend
 *
 * Below the tab set is where the five provider cards go, and they are AE.2's (#228). The
 * space carries an empty state naming the issues that fill it rather than a grid of invented
 * cards — § 3.5 applied to a frame: a surface that is not ready is **labelled**, never dead,
 * and never a mock-up of itself. The dashed card beside it is real, because what it opens is.
 *
 * A Server Component. It reads nothing: the two reads on this page — the trail, and the
 * catalog — are each behind a button and happen when somebody presses it
 * (`audit-actions.ts` and `add-actions.ts` say why then rather than on page load), and the
 * workspace's name and the reader's role arrive from the gate.
 */

/** What the screen takes. */
export interface ProvidersScreenProps {
  /** The active workspace's display name, for the subline's slot. */
  readonly workspaceName: string;
  /**
   * Whether this reader may connect a provider — `app/api/membership.ts`'s `mayAdminister`,
   * decided once by the route from the membership the gate resolved. A boolean rather than a
   * role, so there is one place deciding what a role may do.
   */
  readonly mayAdminister: boolean;
}

/**
 * The providers screen.
 *
 * @param props See {@link ProvidersScreenProps}.
 * @returns The screen.
 */
export function ProvidersScreen({ workspaceName, mayAdminister }: ProvidersScreenProps) {
  return (
    <AddProviderFlow mayAdminister={mayAdminister}>
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
            <AddProviderButton />
          </>
        }
      >
        <Card className="models__next" fill>
          <EmptyState fill note={PROVIDERS_NEXT_NOTE} title={PROVIDERS_NEXT_TITLE} />
        </Card>

        {/*
          Mockup 07's dashed add-provider card. A `div` rather than a region: it is one
          action with a line of prose over it, and a landmark for that would be a landmark
          for a button.
        */}
        <Card className="providers-add-card">
          <span aria-hidden="true" className="providers-add-card__plus">
            +
          </span>
          <p className="providers-add-card__note">{ADD_CARD_NOTE}</p>
          <BrowseCatalogButton />
        </Card>
      </ModelsFrame>
    </AddProviderFlow>
  );
}
