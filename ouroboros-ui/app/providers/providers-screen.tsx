import type { Role } from "@/app/api/membership";
import { ModelsFrame } from "@/app/models/models-frame";
import { Card, EmptyState } from "@/app/ui";

import { AddProviderButton, AddProviderFlow, BrowseCatalogButton } from "./add-provider";
import { AuditTrail } from "./audit-trail";
import { GRID_LABEL, cardModel } from "./cards";
import { ADD_CARD_NOTE } from "./catalog";
import type { ModelPull } from "@/app/api/providers";
import type { Reading } from "@/app/api/reading";

import type { ProvidersReadings } from "./data";
import { ProviderCard } from "./provider-card";
import { ProvidersBanner } from "./providers-banner";
import { SecurityStrip } from "./security-strip";
import {
  DEGRADED_HEADLINE,
  EMPTY_MEMBER_NOTE,
  EMPTY_NOTE,
  EMPTY_TITLE,
  GRID_FAILED_NOTE,
  GRID_FAILED_TITLE,
  PROVIDERS_FAILED_HEADLINE,
  type ProvidersState,
  degradedReads,
  degradedReason,
  providersState,
  readOnlyNote,
} from "./states";
import { PROVIDERS_TITLE, providersSubline } from "./view";

import "./providers.css";

/**
 * The `/models/providers` screen ([#227](https://github.com/NobuData/ouroboros/issues/227)):
 * `docs/mockups/07-providers.html`'s page head and tab set, the add-provider flow
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)) mounted on it, the card grid
 * below (AE.2, [#228](https://github.com/NobuData/ouroboros/issues/228)), and — since AE.6
 * ([#232](https://github.com/NobuData/ouroboros/issues/232)) — the security strip under the
 * grid and every state the page can be in that is not *five cards*.
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
 * `app/providers/data.ts`), four pure modules hold the decisions (`view.ts` for the page's
 * copy and the trail, `catalog.ts` for the add flow, `cards.ts` for the cards, `states.ts`
 * for the page's states), and this draws.
 *
 * ### The head, and the two sentences that are not this page's
 *
 * The head's subline is the sentence that makes the security claim, and its wording is
 * **not this page's to choose** — `providersSubline` renders `docs/SECURITY_MODEL.md` § 7.2
 * with the workspace's name in it. The strip at the foot of the page is the same document's
 * § 7.1, and `security-strip.tsx` says what was removed from the mockup's version and why.
 *
 * ### The grid is one component, drawn per connection
 *
 * `ProviderCard` is composed by `cards.ts`'s `cardModel` from five readings joined here: the
 * connection, its catalog entry (by kind), its row on the health strip (by id), its month's
 * spend (by kind), and its models (by id). Each join is a lookup that answers `null` when the
 * reading failed or has no row, and the card draws every null as a state — which is how one
 * failed read degrades one region of every card rather than the page.
 *
 * ### The states, and where each is explained once
 *
 * `states.ts` decides them; this draws them, and the rule is DASH-I.7's
 * ([#86](https://github.com/NobuData/ouroboros/issues/86)): a *reason* is said once, in a
 * banner with the retry, and what sits below says what is missing without repeating it.
 *
 * - **The listing refused** is the one read the grid cannot survive. The banner carries the
 *   service's sentence; the grid's seat says nothing here could be read and points up; the
 *   dashed card stays, because connecting a provider still works.
 * - **A grid-wide read refused** — the catalog, the strip, the month, the aliases — degrades
 *   a region of every card, so it is one banner naming what failed rather than five cards
 *   each printing the same sentence.
 * - **An empty workspace** is the state every new tenant sees first, and it guides: one
 *   card, full width, saying *Connect your first provider* — with the primary action on it
 *   for a role that may, and an explanation for a role that may not. The dashed card is not
 *   drawn beside it, because two doors to one dialog in one view is clutter rather than
 *   guidance; it returns with the first card.
 * - **A member** sees every card and may change none of them. The controls that would write
 *   are drawn switched off with their reason; the note under the tab set names the role
 *   once and says what that means here, so a page with quieter controls reads as scoped
 *   rather than broken.
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
  /**
   * The reader's strongest role, for the read-only note to **name** — never to decide from.
   * Defaults to the least the contract grants, so a screen rendered without one reads as
   * a viewer's rather than as an owner's.
   */
  readonly role?: Role;
  /** Everything the cards are drawn from — see `app/providers/data.ts`. */
  readonly readings: ProvidersReadings;
}

/**
 * The providers screen.
 *
 * @param props See {@link ProvidersScreenProps}.
 * @returns The screen.
 */
export function ProvidersScreen({
  workspaceName,
  mayAdminister,
  role = "viewer",
  readings,
}: ProvidersScreenProps) {
  const state = providersState(readings);
  // With the listing refused there are no cards for a degraded read to degrade, and two
  // banners would say one thing twice.
  const degraded = state.kind === "failed" ? [] : degradedReads(readings);

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
        {/* The role, explained once, under the tab set — for a reader who may not change anything. */}
        {!mayAdminister && <ReadOnlyNote role={role} />}

        {/* The one place a refused read is explained, above everything it took with it. */}
        {state.kind === "failed" && (
          <ProvidersBanner headline={PROVIDERS_FAILED_HEADLINE} reason={state.reason} />
        )}
        {degraded.length > 0 && (
          <ProvidersBanner headline={DEGRADED_HEADLINE} reason={degradedReason(degraded)} />
        )}

        <ProviderGrid mayAdminister={mayAdminister} readings={readings} state={state} />

        <SecurityStrip />
      </ModelsFrame>
    </AddProviderFlow>
  );
}

/**
 * The sentence a reader who may look and not change is given.
 *
 * A `note` rather than a `status`, as the routing page draws its own: a fact about the
 * reader that does not change while the page is open, and announcing it as a live region
 * would read it out again on every render for no reason.
 *
 * @param props.role The reader's strongest role.
 * @returns The paragraph.
 */
function ReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = readOnlyNote(role);

  return (
    <p className="providers-readonly" role="note">
      <span className="providers-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}

/**
 * The grid: one card per connection, then the dashed add card — or what stands where the
 * cards would be.
 *
 * @param props.readings The readings.
 * @param props.mayAdminister Whether this reader may press a switch, or connect the first
 *   provider.
 * @param props.state Which state the listing put the page in.
 * @returns The grid.
 */
function ProviderGrid({
  readings,
  mayAdminister,
  state,
}: Readonly<{ readings: ProvidersReadings; mayAdminister: boolean; state: ProvidersState }>) {
  const { connections } = readings;

  // `state` is decided from `connections`, so the second test is for the type checker's
  // benefit: it narrows the listing to its value below.
  if (state.kind === "failed" || !connections.ok) {
    return (
      <div aria-label={GRID_LABEL} className="providers-grid" role="region">
        <Card className="providers-grid__seat" fill>
          <EmptyState fill note={GRID_FAILED_NOTE} title={GRID_FAILED_TITLE} />
        </Card>
        <AddCard />
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div aria-label={GRID_LABEL} className="providers-grid" role="region">
        <Card className="providers-grid__guidance" fill>
          <EmptyState fill note={EMPTY_NOTE} title={EMPTY_TITLE}>
            {mayAdminister ? (
              <AddProviderButton />
            ) : (
              <p className="providers-grid__guidance-note">{EMPTY_MEMBER_NOTE}</p>
            )}
          </EmptyState>
        </Card>
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
            pulls: pullsOf(readings.pulls.get(connection.id)),
            aliases: readings.aliases,
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

/**
 * A pulling card's records, as read — or none, which is what a failed read and an absent one
 * both mean to a list whose rows are the catalog's and whose poll re-reads progress the moment
 * a pull starts.
 *
 * @param reading What the reader produced for the connection, if it read pulls for it at all.
 * @returns The records.
 */
function pullsOf(reading: Reading<readonly ModelPull[]> | undefined): readonly ModelPull[] {
  return reading?.ok === true ? reading.value : [];
}
