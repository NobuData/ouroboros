import Link from "next/link";

import type { Role } from "@/app/api/membership";
import { ModelsFrame } from "@/app/models/models-frame";
import { Card, CardHead, EmptyState, Tag } from "@/app/ui";

import { routeLookups } from "./chain";
import { ChainCard } from "./chain-card";
import { ImportMenu } from "./import-menu";
import { NewAlias } from "./new-alias";
import { RegistryFreshness } from "./registry-freshness";
import { RegistryGuidance } from "./registry-guidance";
import { InspectorSeat, RegistryTable } from "./registry-table";
import {
  TABLE_FAILED_NOTE,
  TABLE_FAILED_TITLE,
  TABLE_TITLE,
  aliasCount,
  selectedAlias,
} from "./table";
import {
  CONNECT_PROVIDER_HREF,
  CONNECT_PROVIDER_LABEL,
  REGISTRY_SUBLINE,
  REGISTRY_TITLE,
  type RegistryReadings,
  aliasNames,
  aliasSources,
  guidanceState,
  importState,
  registryFailure,
  registryReadOnlyNote,
  tableState,
} from "./view";
import { WhyCard } from "./why-card";

import "./registry.css";

/**
 * The `/models/registry` page ([#591](https://github.com/NobuData/ouroboros/issues/591)) —
 * `docs/mockups/21-model-registry.html`'s page head and tab set as a working page, and since
 * CI.2 ([#592](https://github.com/NobuData/ouroboros/issues/592)) its centre of gravity: the
 * eight-column **ALLOWED MODELS** table, with the inspector's seat beneath it.
 *
 * It renders **inside the app shell** and inside the Models section's own frame
 * (`app/models/models-frame.tsx`), so it starts at its page head, contributes no chrome of its
 * own, and draws the same tab row `/models` and `/models/providers` draw with the underline
 * moved. The mockup's `.topbar`/`.nav` markup is superseded: this surface is reached from the
 * sidebar's **Models** entry — which stays lit here because the route is under `/models`
 * (`app/paths.ts`) — and from the Model registry tab on either sibling page.
 *
 * It is a component rather than markup written in the route, for the reason every screen in
 * this module is: everything it draws can be rendered and asserted on without Next.js's
 * routing around it. The route gates and reads (`app/(app)/models/registry/page.tsx`,
 * `app/registry/data.ts`), two pure modules decide (`app/registry/view.ts` for the head and
 * the page's states, `app/registry/table.ts` for every cell), and this draws.
 *
 * ### The head is the product's argument, and it is verbatim
 *
 * *"Every model gets a name. Every route points at the name."* is not a heading, it is the
 * sentence the rest of the page defends — and the subline under it is why anyone should care:
 * an alias is an indirection, so the provider behind a name can be replaced without touching a
 * route or a workflow. Both are held as constants in `view.ts` and compared against the mockup
 * by `__tests__/registry/view.test.ts`, because copy that can be paraphrased in implementation
 * is copy that quietly weakens.
 *
 * ### The two actions, and the state the mockup does not draw
 *
 * **Import from provider ▾** is a real dropdown over the workspace's connected providers
 * (`app/registry/import-menu.tsx`). The mockup shows it with a caret and nothing else; a fresh
 * workspace has connected nothing, so the state that matters most is the one the drawing
 * omits — the control inert, saying so, and offering the one link that fixes it. That link is
 * rendered **only** for the blocked state a reader can act on: a member offered *"connect a
 * provider →"* would be pointed at a page that would also refuse them.
 *
 * **+ New alias** is the primary action and opens CI.4's create dialog
 * ([#594](https://github.com/NobuData/ouroboros/issues/594), `app/registry/new-alias.tsx`) —
 * the one place in the product where an alias can be made **before** its key exists, which is
 * the state the mockup's own `gpt5-experiments` row is in.
 *
 * Both actions take the same two facts from this screen: the workspace's connections
 * (`aliasSources`) and every alias name it already has (`aliasNames`), computed once here and
 * handed to the import menu, the create dialog, the guidance card *and* the inspector, so the
 * provider a reader may import from, bind to and rebind to is one list, and the names a create
 * refuses and a rename refuses are one set.
 *
 * ### The page's states and guards (CI.6, [#596](https://github.com/NobuData/ouroboros/issues/596))
 *
 * - **A member reads everything and changes nothing.** Every write affordance — both head
 *   actions, every switch, every inspector control and its foot — is in its place, inert with
 *   the same *owners and admins* explanation, and the page names the reader's role once under
 *   the tab set (`registryReadOnlyNote`). Nothing is hidden, so a member can still see and
 *   discuss the configuration.
 * - **An empty registry is guided, not blank.** *Name your first model*
 *   (`app/registry/registry-guidance.tsx`) teaches the two ways in and knows which is possible
 *   yet; a workspace with no connection is led to Providers & keys first.
 * - **A failed read does not blank the table.** The banner says why once, with the page's
 *   retry, and `app/registry/registry-freshness.tsx` keeps the last table this browser read
 *   under it. A failed pricing lookup degrades the one column instead (`readings.pricing`).
 * - **Loading is the page's own shape**: `app/registry/registry-skeleton.tsx`.
 *
 * A Server Component. Its interactive pieces — the import menu, the table with its switches,
 * the banner and the boundary that holds the last table — declare their own client boundaries.
 */

/** What the screen needs to draw itself. */
export interface RegistryScreenProps {
  /** Everything the reader was able to read, and why not for the rest. */
  readonly readings: RegistryReadings;
  /**
   * Whether this reader's role may create aliases and press switches — `app/api/membership.ts`'s
   * `mayAdminister`, decided at the gate.
   *
   * A boolean rather than the role itself, because the page asks one question of it and a
   * screen holding a role would be a second place deciding what a role may do.
   */
  readonly mayAdminister: boolean;
  /**
   * The reader's strongest role, **for one sentence**: the read-only note names it. Nothing on
   * the page is decided from it — that is `mayAdminister`'s. Defaults to `member`, the role the
   * note is written for.
   */
  readonly role?: Role;
  /**
   * The alias the URL asked for — `?alias=` as the route read it — or `null` when it carried
   * nothing. Validated against the rows before it selects anything (`selectedAlias`): a name
   * the workspace does not have selects nothing.
   */
  readonly alias?: string | string[] | null;
}

/**
 * The registry screen.
 *
 * @param props See {@link RegistryScreenProps}.
 * @returns The screen.
 */
export function RegistryScreen({
  readings,
  mayAdminister,
  role = "member",
  alias = null,
}: RegistryScreenProps) {
  const importing = importState(readings.providers, mayAdminister);
  const table = tableState(readings.aliases);
  const names = aliasNames(readings.aliases);
  const sources = aliasSources(readings.providers);
  const routes = routeLookups(readings.routes, names);

  return (
    <ModelsFrame
      active="registry"
      // No tone: mockup 21 draws the active tab in the accent, which is the primitive's base
      // hue and what `PageSubnav` renders when told nothing. Mockup 06's violet is the one
      // deliberate divergence and stays on that page alone.
      title={REGISTRY_TITLE}
      subline={REGISTRY_SUBLINE}
      actions={
        <>
          <ImportMenu aliasNames={names} state={importing} />
          <NewAlias
            aliasNames={names}
            mayAdminister={mayAdminister}
            sources={sources}
          />

          {/*
            The one blocked state with something to do about it. Rendered inside the action
            column so it sits under the buttons it explains, and as a `Link` rather than a
            `Button` because it navigates — the distinction `app/ui/button.tsx` draws between
            a control that acts and one that goes somewhere.
          */}
          {importing.kind === "blocked" && importing.connect ? (
            <p className="registry__hint">
              <Link className="registry__hint-link" href={CONNECT_PROVIDER_HREF}>
                {CONNECT_PROVIDER_LABEL}
              </Link>
            </p>
          ) : null}
        </>
      }
    >
      {!mayAdminister && <ReadOnlyNote role={role} />}

      <RegistryFreshness failure={registryFailure(readings.aliases)}>
        {table.kind === "populated" ? (
          <RegistryTable
            aliasNames={names}
            mayAdminister={mayAdminister}
            pricing={readings.pricing ?? null}
            routes={routes}
            rows={table.rows}
            selected={selectedAlias(table.rows, alias)}
            sources={sources}
          />
        ) : (
          <>
            {table.kind === "empty" ? (
              <RegistryGuidance
                aliasNames={names}
                importing={importing}
                mayAdminister={mayAdminister}
                sources={sources}
                state={guidanceState(readings.providers, mayAdminister)}
              />
            ) : (
              <FailedSeat />
            )}
            <div className="registry-aside">
              <InspectorSeat row={null} />
              <WhyCard />
              <ChainCard route={null} row={null} />
            </div>
          </>
        )}
      </RegistryFreshness>
    </ModelsFrame>
  );
}

/**
 * The sentence a reader who may look and not change is given — once, under the tab set.
 *
 * A `note` rather than a `status`: it is a fact about the reader that does not change while the
 * page is open. The routing page's arrangement (`app/models/models-screen.tsx`), so a member is
 * named the same way on both.
 *
 * @param props.role The reader's strongest role.
 * @returns The paragraph.
 */
function ReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = registryReadOnlyNote(role);

  return (
    <p className="registry-readonly" role="note">
      <span className="registry-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}

/** The id the table card's `aria-labelledby` points at while there is no table in it. */
const SEAT_TITLE_ID = "registry-table-title";

/**
 * The table's card when the read behind it was refused: the same head, with a true count of
 * zero, over a note pointing at the banner — which carries the service's reason and the retry,
 * said once (DASH-I.7).
 *
 * @returns The card.
 */
function FailedSeat() {
  return (
    <Card aria-labelledby={SEAT_TITLE_ID} as="section" className="models__next" fill>
      <CardHead beside={<Tag>{aliasCount(0)}</Tag>} title={TABLE_TITLE} titleId={SEAT_TITLE_ID} />
      <EmptyState fill note={TABLE_FAILED_NOTE} title={TABLE_FAILED_TITLE} />
    </Card>
  );
}
