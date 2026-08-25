import Link from "next/link";

import { ModelsFrame } from "@/app/models/models-frame";
import { Card, CardHead, EmptyState, Tag } from "@/app/ui";

import { ImportMenu } from "./import-menu";
import { NewAlias } from "./new-alias";
import { InspectorSeat, RegistryTable } from "./registry-table";
import {
  TABLE_EMPTY_NOTE,
  TABLE_EMPTY_TITLE,
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
  type TableState,
  aliasNames,
  aliasSources,
  importState,
  tableState,
} from "./view";

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
 * (`aliasSources`, which flattens the import control's three blocked reasons into the one thing
 * a create dialog needs — a list, possibly empty) and every alias name it already has
 * (`aliasNames`, for the live uniqueness check, off the same read the table draws so the two
 * cannot disagree).
 *
 * Both are inert for a member or a viewer. The full gating pass is CI.6
 * ([#596](https://github.com/NobuData/ouroboros/issues/596)); what this ticket owes is that the
 * two controls it builds are already honest about who may press them, and that the writes
 * behind them are the service's to refuse.
 *
 * ### The table, and the two states in which there is not one
 *
 * With rows, the seat below the tab set is `app/registry/registry-table.tsx`'s: the table,
 * its selection, and the inspector's seat that selection drives. Without — a refused read, or
 * a workspace that has created nothing — the seat is the same card with a captioned empty
 * state in it, and the two are kept apart (`tableState`): *could not be read* names the
 * service's own sentence, *no aliases yet* names the two ways to get one. Neither is a blank
 * region, and the head and the tab set above them work in every case (§ 3.5).
 *
 * A Server Component. Its interactive pieces — the import menu, the table with its switches —
 * declare their own client boundaries.
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
export function RegistryScreen({ readings, mayAdminister, alias = null }: RegistryScreenProps) {
  const importing = importState(readings.providers, mayAdminister);
  const table = tableState(readings.aliases);
  const names = aliasNames(readings.aliases);

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
            sources={aliasSources(readings.providers)}
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
      {table.kind === "populated" ? (
        <RegistryTable
          mayAdminister={mayAdminister}
          rows={table.rows}
          selected={selectedAlias(table.rows, alias)}
        />
      ) : (
        <>
          <TableSeat state={table} />
          <div className="registry-aside">
            <InspectorSeat row={null} />
          </div>
        </>
      )}
    </ModelsFrame>
  );
}

/** The id the table card's `aria-labelledby` points at while there is no table in it. */
const SEAT_TITLE_ID = "registry-table-title";

/**
 * The table's card when there is no table to draw: the same head, with a true count of zero,
 * over the sentence that says why.
 *
 * @param props.state Which of the two reasons.
 * @returns The card.
 */
function TableSeat({ state }: Readonly<{ state: Exclude<TableState, { kind: "populated" }> }>) {
  return (
    <Card aria-labelledby={SEAT_TITLE_ID} as="section" className="models__next" fill>
      <CardHead beside={<Tag>{aliasCount(0)}</Tag>} title={TABLE_TITLE} titleId={SEAT_TITLE_ID} />
      {state.kind === "failed" ? (
        // The service's own sentence, then what to do: a refused read must not look like a
        // workspace that has created nothing.
        <EmptyState fill note={`${state.reason} ${TABLE_FAILED_NOTE}`} title={TABLE_FAILED_TITLE} />
      ) : (
        <EmptyState fill note={TABLE_EMPTY_NOTE} title={TABLE_EMPTY_TITLE} />
      )}
    </Card>
  );
}
