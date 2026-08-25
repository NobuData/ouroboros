import type { Role } from "@/app/api/membership";
import { Card, EmptyState } from "@/app/ui";

import { savedRoutes } from "./chain";
import { FoundationsCard } from "./foundations-card";
import { type HopHealthIndex, hopHealthIndex } from "./inspector";
import { MATRIX_FAILED_TITLE, matrixRows, selectedKind } from "./matrix";
import { ModelsFrame } from "./models-frame";
import { ModelsGrid } from "./models-grid";
import { ProviderStrip } from "./provider-strip";
import { DirtyBar } from "./dirty-bar";
import { RouteEditorProvider } from "./route-editor";
import { RoutingFailedBanner } from "./routing-banner";
import { RoutingMatrix } from "./routing-matrix";
import { RulesCard } from "./rules-card";
import { SaveRoutesButton } from "./save-routes-button";
import { SimulateButton } from "./simulate-sheet";
import { SpendCard } from "./spend-card";
import { MATRIX_FAILED_NOTE, type RoutingState, readOnlyNote, routingState } from "./states";
import { type ModelsReadings, ROUTING_SUBLINE, ROUTING_TITLE } from "./view";

import "./models.css";

/**
 * The `/models` frame ([#200](https://github.com/NobuData/ouroboros/issues/200)) —
 * `docs/mockups/06-model-routing.html`'s page head, tab set and provider health strip as a
 * working page.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no
 * chrome of its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2). The mockup's `.topbar`/`.nav`
 * markup is superseded: this surface is reached from the sidebar's **Models** entry, and the
 * tab set that would have been a second row of top-bar links is the CP.4 `PageSubnav`
 * primitive, sticky inside the pane's own scroll.
 *
 * The head and the tab set are the section's rather than this page's since AE.1
 * ([#227](https://github.com/NobuData/ouroboros/issues/227)) gave the section a second page:
 * `app/models/models-frame.tsx` draws both, and this page supplies its title, its promise,
 * its two actions and the tab it is. What it keeps for itself is what is only true here — the
 * violet underline, the health strip, and the space the routing matrix fills.
 *
 * It is a component rather than markup written in the route, for the reason the dashboard
 * and login screens are: everything it draws can then be rendered and asserted on without
 * Next.js's routing around it. The route reads (`app/models/data.ts`), a pure module decides
 * (`app/models/view.ts`, `app/models/states.ts`), and this draws.
 *
 * ### What this page does not pretend
 *
 * The frame is honest about being a frame. The one unbuilt sibling tab is labelled *soon*
 * rather than linked to a `404`, and **Simulate routing** is inert with its reason for the
 * one workspace that has nothing to simulate. That is § 3.5 applied to a page that is now
 * built: a surface that is not ready is **labelled**, never dead, and never a mock-up of
 * itself.
 *
 * Since AA.2 ([#201](https://github.com/NobuData/ouroboros/issues/201)), AA.4
 * ([#203](https://github.com/NobuData/ouroboros/issues/203)) and AA.5
 * ([#204](https://github.com/NobuData/ouroboros/issues/204)) every region draws real data —
 * the health strip, the matrix, the inspector, the rules card and the spend card — and they
 * are the regions where being wrong would matter. `view.ts` carries the argument for every
 * treatment the strip takes, `matrix.ts` for every cell the table draws, `inspector.ts` for
 * every dot and line the route card holds, `rules.ts` for every sentence and switch the rules
 * card holds and `spend.ts` for every figure the spend card prints; between them, nothing on
 * this page is a figure this component decided.
 *
 * ### The states, since AA.6
 *
 * Mockup 06 draws the busy state and nothing else; a real workspace spends its first week in
 * the others, and AA.6 ([#205](https://github.com/NobuData/ouroboros/issues/205)) is where
 * each is designed. `app/models/states.ts`'s `routingState` decides which the page is in from
 * its two reads, and the screen draws one thing for each:
 *
 * - **failed** — the matrix read was refused. The DASH-I.7 banner says why, once, with the
 *   page's one retry (`app/models/routing-banner.tsx`); the matrix's seat says what is
 *   missing and points up. *Could not be read* and *empty* wear different clothes.
 * - **no-providers** / **no-routes** — nothing to draw. The guidance card
 *   (`app/models/foundations-card.tsx`) stands in the matrix's seat with the two-step path
 *   out and the reader's place on it; the right column keeps its rules and spend cards in
 *   their zero-states, so the populated page is approached rather than jumped to.
 * - **populated** — the matrix and everything beside it.
 * - **loading** is not a state of the reads but of the route, and is
 *   `app/models/models-skeleton.tsx`'s, drawn by `app/(app)/models/(routing)/loading.tsx`.
 *
 * ### The inspector's dots are the strip's read, indexed
 *
 * The route card's health dots are drawn from the same `GET /api/v1/routing/providers` the
 * strip is, indexed by connection here on the server (`hopHealthIndex`) and handed down as a
 * plain object — so the chip above the matrix and the dot beside the hop are one decision,
 * and a strip that could not be read is a ring with that reason rather than a dot that
 * guessed.
 *
 * ### The editor is above the frame, and the role decides what it draws
 *
 * Since AA.3 ([#202](https://github.com/NobuData/ouroboros/issues/202)) the page can change a
 * route, and the four surfaces that take part — the head's **Save routes**, the dirty-state
 * bar under the tab set, the matrix's marks and the route card's chain — read one editor
 * (`app/models/route-editor.tsx`), which is why the provider wraps the frame rather than
 * sitting inside the matrix. Its baseline is formed here on the server (`savedRoutes`), so
 * the provider is handed exactly what it holds and the contract's shapes stay out of the
 * bundle. `mayAdminister` is what makes it editable: a member's editor serves the same
 * chains and refuses every edit, and the head draws no **Save routes** for them at all —
 * read-only as a rendering mode, not as a disabled control.
 *
 * **The role is explained, not silently applied.** A member's page has no handles, no
 * switches, no builder and no bar, and a page that quietly draws less reads as broken rather
 * than as scoped — so a reader who may not edit is told so once, near the top, as what they
 * are (`readOnlyNote`). The page decides nothing from the role's name; `mayAdminister` is
 * still the one decision, made at the gate.
 *
 * ### Two reads, two independent failures
 *
 * The strip and the matrix are separate reads and degrade separately: a workspace whose
 * health check is unreadable still gets its eight rows, and a workspace whose matrix is
 * refused still gets its chips. Neither takes the page's frame with it, which is the rule
 * `app/api/reading.ts` exists to keep. The rules and the spend card ride on the **matrix's**
 * read — `app/api/routing.ts` says why the three are one payload — so a refused matrix is
 * one failed region holding all three, and says so once rather than three times.
 */

/** What the screen takes. */
export interface ModelsScreenProps {
  /** Everything the reader was able to read, and why not for the rest. */
  readonly readings: ModelsReadings;
  /**
   * Which row the URL asks for, as it arrived — unchecked, because checking it needs the rows
   * and the rows are decided below. `null` when the URL named none.
   */
  readonly route?: string | string[] | null;
  /**
   * Whether this reader's role may change routes and rules — `app/api/membership.ts`'s
   * `mayAdminister`, decided at the gate.
   *
   * A boolean rather than the role itself, because the page asks one question of it and a
   * screen holding a role would be a second place deciding what a role may do. It defaults
   * to `false` so that a caller which forgot it renders the page a member sees — the one
   * with nothing to press — rather than controls the service would refuse.
   */
  readonly mayAdminister?: boolean;
  /**
   * The reader's strongest role, **for one sentence**: the read-only note names it. Nothing
   * is decided from it — {@link ModelsScreenProps.mayAdminister} is the decision — and it
   * defaults to `viewer`, the least the API grants, so a caller which forgot it names the
   * role the page is already drawn for.
   */
  readonly role?: Role;
}

/**
 * The routing screen.
 *
 * @param props See {@link ModelsScreenProps}.
 * @returns The screen.
 */
export function ModelsScreen({
  readings,
  route = null,
  mayAdminister = false,
  role = "viewer",
}: ModelsScreenProps) {
  const state = routingState(readings);
  // The editor's baseline: every route the read produced, and nothing for a read that failed
  // — there is no chain to edit on a page whose matrix could not be read.
  const routes = readings.matrix.ok ? savedRoutes(readings.matrix.value.taskKinds) : [];
  // What the simulate panel may ask about, and what decides whether its button acts at all.
  const kinds = readings.matrix.ok ? readings.matrix.value.taskKinds.map((kind) => kind.name) : [];
  // The strip, indexed for the inspector's dots.
  const health = hopHealthIndex(readings.providers);

  return (
    <RouteEditorProvider editable={mayAdminister} routes={routes}>
      <ModelsFrame
        active="routing"
        // Mockup 06's violet `--model` underline, preserved as a tone rather than normalised
        // to the accent — the divergence from 07/21 is deliberate and `page-subnav.tsx` says
        // why.
        tone="model"
        title={ROUTING_TITLE}
        subline={ROUTING_SUBLINE}
        actions={
          <>
            {/*
              The mockup's ghost action, opening AA.4's sheet on the matrix's first kind —
              inert with its reason for a workspace that has no kinds to ask about.
            */}
            <SimulateButton taskKinds={kinds} />
            {/*
              Inert while clean, which is AA.1's acceptance criterion: `saveRoutesReason` is
              still the rule, and the editor's count is what it now decides from. Drawn for a
              role that may change routes and for nobody else — a member sees no editing
              affordance, and a disabled save button is one.
            */}
            {mayAdminister && <SaveRoutesButton />}
          </>
        }
      >
        <DirtyBar />

        {/*
          The role, explained, in the slot the dirty bar takes for a role that may edit: a
          member's editor holds no edits by construction, so the two never share the page.
        */}
        {!mayAdminister && <ReadOnlyNote role={role} />}

        {/* The one place a refused matrix is explained, above everything it took with it. */}
        {state.kind === "failed" && <RoutingFailedBanner reason={state.reason} />}

        <ProviderStrip providers={readings.providers} />

        <MatrixRegion
          health={health}
          matrix={readings.matrix}
          mayAdminister={mayAdminister}
          route={route}
          state={state}
        />
      </ModelsFrame>
    </RouteEditorProvider>
  );
}

/**
 * The sentence a reader who may look and not change is given.
 *
 * A `note` rather than a `status`: it is a fact about the reader that does not change while
 * the page is open, and announcing it as a live region would read it out again on every
 * render for no reason. The head names the role and the body says what it means here — two
 * spans on one line, so the role is the first thing read.
 *
 * @param props.role The reader's strongest role.
 * @returns The paragraph.
 */
function ReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = readOnlyNote(role);

  return (
    <p className="models-readonly" role="note">
      <span className="models-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}

/**
 * The matrix, the inspector's seat and the two cards beside them — or what stands where they
 * would, in the states that have none.
 *
 * Four states and four different things, because they are four different facts. A refused
 * matrix has no answer at all and carries the service's own reason — said once, in the banner
 * above, with the seat here pointing up rather than repeating it. A workspace with nothing to
 * draw **has** an answer, an empty one, and is a state the product guides out of: the guidance
 * card stands in the matrix's seat, and which step is next is the strip's to decide. Neither
 * is a blank region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and neither looks like the
 * other.
 *
 * The guided workspace still gets its right column. Its rules card is the empty state that
 * says what a rule is, and its spend card is the zero-state — which is the state the ticket
 * asks for by name, and one that only exists on a card that is drawn. The refused matrix
 * does not: the rules and the spend are the same read, and a refusal is one region, said once.
 *
 * The rows are decided **here, on the server**, and handed to the Client Component already
 * formed. That keeps `app/format.ts` and the contract's shapes out of the browser bundle, and
 * leaves the client with the one thing it is a client for: which row is selected. The two
 * cards are formed here for the same reason and handed across as the matrix's `aside`.
 *
 * @param props.state Which state the page is in, decided once by the screen.
 * @param props.matrix The read: the payload, or why it could not be made.
 * @param props.mayAdminister Whether the rules card draws its controls.
 * @param props.route What `?route=` carried, unchecked.
 * @param props.health The strip, indexed, for the inspector's dots.
 * @returns The region.
 */
function MatrixRegion({
  state,
  matrix,
  mayAdminister,
  route,
  health,
}: Readonly<{
  state: RoutingState;
  matrix: ModelsReadings["matrix"];
  mayAdminister: boolean;
  route: string | string[] | null;
  health: HopHealthIndex;
}>) {
  if (state.kind === "failed" || !matrix.ok) {
    return (
      <Card className="models__next" fill>
        <EmptyState fill note={MATRIX_FAILED_NOTE} title={MATRIX_FAILED_TITLE} />
      </Card>
    );
  }

  const { taskKinds, rules, spend } = matrix.value;

  const aside = (
    <>
      <RulesCard
        mayAdminister={mayAdminister}
        rules={rules}
        taskKinds={taskKinds.map((kind) => kind.name)}
      />
      <SpendCard spend={spend} />
    </>
  );

  if (state.kind !== "populated") {
    return <ModelsGrid aside={aside} main={<FoundationsCard state={state} />} />;
  }

  const rows = matrixRows(taskKinds, rules);

  return (
    <RoutingMatrix aside={aside} health={health} rows={rows} selected={selectedKind(rows, route)} />
  );
}
