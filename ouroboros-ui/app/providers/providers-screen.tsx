import { ModelsFrame } from "@/app/models/models-frame";
import { Card, EmptyState } from "@/app/ui";

import { AddProviderButton, AddProviderFlow, BrowseCatalogButton } from "./add-provider";
import { AuditTrail } from "./audit-trail";
import {
  GRID_LABEL,
  NO_PROVIDERS_NOTE,
  NO_PROVIDERS_TITLE,
  PROVIDERS_UNAVAILABLE,
  cardModel,
} from "./cards";
import { ADD_CARD_NOTE } from "./catalog";
import type { ProvidersReadings } from "./data";
import { ProviderCard } from "./provider-card";
import { PROVIDERS_TITLE, providersSubline } from "./view";

import "./providers.css";

/**
 * The `/models/providers` screen ([#227](https://github.com/NobuData/ouroboros/issues/227)):
 * `docs/mockups/07-providers.html`'s page head and tab set, the add-provider flow
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) mounted on it, and — since AE.2
 * ([#228](https://github.com/NobuData/ouroboros/issues/228)) — the card grid below.
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
 * routing around it. The route gates and reads (`app/(app)/models/providers/page.tsx`,
 * `app/providers/data.ts`), three pure modules hold the decisions (`view.ts` for the page and
 * the trail, `catalog.ts` for the add flow, `cards.ts` for the cards), and this draws.
 *
 * ### The head, and the sentence that is not this page's
 *
 * The head's subline is the exception to everything being the page's: it is the sentence that
 * makes the security claim, and its wording is **not this page's to choose** —
 * `providersSubline` renders `docs/SECURITY_MODEL.md` § 7.2 with the workspace's name in it.
 *
 * ### The grid is one component, drawn per connection
 *
 * `ProviderCard` is composed by `cards.ts`'s `cardModel` from five readings joined here: the
 * connection, its catalog entry (by kind), its row on the health strip (by id), its month's
 * spend (by kind), and its models (by id). Each join is a lookup that answers `null` when the
 * reading failed or has no row, and the card draws every null as a state — which is how one
 * failed read degrades one region of every card rather than the page. The listing failing is
 * the one read the grid cannot survive, and it says so where the grid would be.
 *
 * The dashed add card is the grid's last item, as the mockup draws it, and it is real
 * because what it opens is. A workspace that has connected nothing draws the empty state
 * beside it rather than a grid of nothing.
 *
 * A Server Component. The reads are the route's (`readProviders`); the two behind buttons —
 * the trail, the catalog — happen when somebody presses them.
 */

/** What the screen takes. */
export interface ProvidersScreenProps {
  /** The active workspace's display name, for the subline's slot. */
  readonly workspaceName: string;
  /**
   * Whether this reader may connect a provider or press a card's switch —
   * `app/api/membership.ts`'s `mayAdminister`, decided once by the route from the membership
   * the gate resolved. A boolean rather than a role, so there is one place deciding what a
   * role may do.
   */
  readonly mayAdminister: boolean;
  /** Everything the cards are drawn from — see `app/providers/data.ts`. */
  readonly readings: ProvidersReadings;
}

/**
 * The providers screen.
 *
 * @param props See {@link ProvidersScreenProps}.
 * @returns The screen.
 */
export function ProvidersScreen({ workspaceName, mayAdminister, readings }: ProvidersScreenProps) {
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
        <ProviderGrid mayAdminister={mayAdminister} readings={readings} />
      </ModelsFrame>
    </AddProviderFlow>
  );
}

/**
 * The grid: one card per connection, then the dashed add card — or what stands where the
 * cards would be.
 *
 * @param props.readings The readings.
 * @param props.mayAdminister Whether this reader may press a switch.
 * @returns The grid.
 */
function ProviderGrid({
  readings,
  mayAdminister,
}: Readonly<{ readings: ProvidersReadings; mayAdminister: boolean }>) {
  const { connections } = readings;

  if (!connections.ok) {
    return (
      <div aria-label={GRID_LABEL} className="providers-grid" role="region">
        <p className="providers-grid__state providers-grid__state--failed" role="status">
          <span className="providers-grid__state-head">{PROVIDERS_UNAVAILABLE}</span>{" "}
          {connections.reason}
        </p>
        <AddCard />
      </div>
    );
  }

  const now = new Date(readings.now);
  const entries = new Map(
    readings.catalog.ok ? readings.catalog.value.map((entry) => [entry.kind, entry]) : [],
  );
  const health = new Map(
    readings.health.ok ? readings.health.value.map((row) => [row.id, row]) : [],
  );
  const spend = new Map(
    readings.spend.ok ? readings.spend.value.providers.map((row) => [row.kind, row]) : [],
  );

  return (
    <div aria-label={GRID_LABEL} className="providers-grid" role="region">
      {connections.value.length === 0 && (
        <Card className="providers-grid__empty" fill>
          <EmptyState fill note={NO_PROVIDERS_NOTE} title={NO_PROVIDERS_TITLE} />
        </Card>
      )}
      {connections.value.map((connection) => (
        <ProviderCard
          key={connection.id}
          mayAdminister={mayAdminister}
          model={cardModel({
            connection,
            entry: entries.get(connection.kind) ?? null,
            health: health.get(connection.id) ?? null,
            spend: spend.get(connection.kind) ?? null,
            models: readings.models.get(connection.id) ?? null,
            now,
          })}
        />
      ))}
      <AddCard />
    </div>
  );
}

/**
 * Mockup 07's dashed add-provider card. A `div` rather than a region: it is one action with a
 * line of prose over it, and a landmark for that would be a landmark for a button.
 *
 * @returns The card.
 */
function AddCard() {
  return (
    <Card className="providers-add-card">
      <span aria-hidden="true" className="providers-add-card__plus">
        +
      </span>
      <p className="providers-add-card__note">{ADD_CARD_NOTE}</p>
      <BrowseCatalogButton />
    </Card>
  );
}
