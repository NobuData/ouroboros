import { Button, Card, EmptyState } from "@/app/ui";

import { savedRoutes } from "./chain";
import { DirtyBar } from "./dirty-bar";
import {
  MATRIX_FAILED_TITLE,
  NO_KINDS_NOTE,
  NO_KINDS_TITLE,
  matrixRows,
  selectedKind,
} from "./matrix";
import { ModelsFrame } from "./models-frame";
import { ModelsGrid } from "./models-grid";
import { ProviderStrip } from "./provider-strip";
import { RouteEditorProvider } from "./route-editor";
import { RoutingMatrix } from "./routing-matrix";
import { RulesCard } from "./rules-card";
import { SaveRoutesButton } from "./save-routes-button";
import { SpendCard } from "./spend-card";
import { type ModelsReadings, SIMULATE_REASON } from "./view";

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
 * violet underline, the health strip, and the space the routing matrix will fill.
 *
 * It is a component rather than markup written in the route, for the reason the dashboard
 * and login screens are: everything it draws can then be rendered and asserted on without
 * Next.js's routing around it. The route reads (`app/models/data.ts`), a pure module decides
 * (`app/models/view.ts`), and this draws.
 *
 * ### What this page does not pretend
 *
 * The frame is honest about being a frame. The one unbuilt sibling tab is labelled *soon*
 * rather than linked to a `404`, **Simulate routing** is inert and says why, and the route
 * card's foot names the issue that brings the policy switches rather than drawing switches
 * that persist nothing. That is § 3.5 applied to a page that is now mostly built: a surface
 * that is not ready is **labelled**, never dead, and never a mock-up of itself.
 *
 * Since AA.2 ([#201](https://github.com/NobuData/ouroboros/issues/201)) and AA.5
 * ([#204](https://github.com/NobuData/ouroboros/issues/204)) four of its regions draw real
 * data — the health strip, the matrix, the rules card and the spend card — and they are the
 * regions where being wrong would matter. `view.ts` carries the argument for every treatment
 * the strip takes, `matrix.ts` for every cell the table draws, `rules.ts` for every sentence
 * and switch the rules card holds and `spend.ts` for every figure the spend card prints;
 * between them, nothing on this page is a figure this component decided.
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
 * ### Two reads, two independent failures
 *
 * The strip and the matrix are separate reads and degrade separately: a workspace whose
 * health check is unreadable still gets its eight rows, and a workspace whose matrix is
 * refused still gets its chips. Neither takes the page's frame with it, which is the rule
 * `app/api/reading.ts` exists to keep. The rules and the spend card ride on the **matrix's**
 * read — `app/api/routing.ts` says why the three are one payload — so a refused matrix is
 * one failed region holding all three, and says so once rather than three times.
 */

/**
 * The subline, from the mockup verbatim.
 *
 * Held as a constant rather than typed into the JSX because it is *copy* — the promise the
 * product makes about routing — and copy that lives in one named place is copy a designer
 * can be pointed at. Its three sentences are the three things a route is: an ordered chain,
 * an indirection through the registry, and a floor.
 */
const SUBLINE =
  "Each task kind resolves to a primary model with ordered fallbacks and escalation " +
  "rules. Routes point at named registry aliases, never raw model ids — see the Model " +
  "registry tab. The loop degrades gracefully when a provider stumbles — and never " +
  "silently below the floor you set.";

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
   * Whether this reader's role may change escalation rules — `app/api/membership.ts`'s
   * `mayAdminister`, decided at the gate.
   *
   * A boolean rather than the role itself, because the page asks one question of it and a
   * screen holding a role would be a second place deciding what a role may do. It defaults
   * to `false` so that a caller which forgot it renders the page a member sees — the one
   * with nothing to press — rather than controls the service would refuse.
   */
  readonly mayAdminister?: boolean;
}

/**
 * The routing screen.
 *
 * @param props See {@link ModelsScreenProps}.
 * @returns The screen.
 */
export function ModelsScreen({ readings, route = null, mayAdminister = false }: ModelsScreenProps) {
  // The editor's baseline: every route the read produced, and nothing for a read that failed
  // — there is no chain to edit on a page whose matrix could not be read.
  const routes = readings.matrix.ok ? savedRoutes(readings.matrix.value.taskKinds) : [];

  return (
    <RouteEditorProvider editable={mayAdminister} routes={routes}>
      <ModelsFrame
        active="routing"
        // Mockup 06's violet `--model` underline, preserved as a tone rather than normalised
        // to the accent — the divergence from 07/21 is deliberate and `page-subnav.tsx` says
        // why.
        tone="model"
        title="Route every kind of work to the model that earns it."
        subline={SUBLINE}
        actions={
          <>
            <Button reason={SIMULATE_REASON} tone="ghost">
              Simulate routing
            </Button>
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

        <ProviderStrip providers={readings.providers} />

        <MatrixRegion matrix={readings.matrix} mayAdminister={mayAdminister} route={route} />
      </ModelsFrame>
    </RouteEditorProvider>
  );
}

/**
 * The matrix, the inspector's seat and the two cards beside them — or the one line that says
 * why there are none.
 *
 * Three states, and the two that draw no rows are deliberately different sentences. A
 * workspace whose routing foundations have not been seeded **has** an answer — an empty
 * one — and is a state the product guides out of (AA.6,
 * [#205](https://github.com/NobuData/ouroboros/issues/205)); a workspace whose matrix was
 * refused has no answer at all, and carries the service's own reason. Neither is a blank
 * region (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and neither looks like the other.
 *
 * The unseeded workspace still gets its right column. Its rules card is the empty state that
 * says what a rule is, and its spend card is the zero-state — which is the state the ticket
 * asks for by name, and one that only exists on a card that is drawn. The refused matrix
 * does not: the rules and the spend are the same read, and a refusal is one region, said once.
 *
 * The rows are decided **here, on the server**, and handed to the Client Component already
 * formed. That keeps `app/format.ts` and the contract's shapes out of the browser bundle, and
 * leaves the client with the one thing it is a client for: which row is selected. The two
 * cards are formed here for the same reason and handed across as the matrix's `aside`.
 *
 * @param props.matrix The read: the payload, or why it could not be made.
 * @param props.mayAdminister Whether the rules card draws its controls.
 * @param props.route What `?route=` carried, unchecked.
 * @returns The region.
 */
function MatrixRegion({
  matrix,
  mayAdminister,
  route,
}: Readonly<{
  matrix: ModelsReadings["matrix"];
  mayAdminister: boolean;
  route: string | string[] | null;
}>) {
  if (!matrix.ok) {
    return (
      <Card className="models__next" fill>
        <EmptyState fill note={matrix.reason} title={MATRIX_FAILED_TITLE} />
      </Card>
    );
  }

  const { taskKinds, rules, spend } = matrix.value;
  const rows = matrixRows(taskKinds, rules);

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

  if (rows.length === 0) {
    return (
      <ModelsGrid
        aside={aside}
        main={
          <Card className="models-col--8 models__next" fill>
            <EmptyState fill note={NO_KINDS_NOTE} title={NO_KINDS_TITLE} />
          </Card>
        }
      />
    );
  }

  return <RoutingMatrix aside={aside} rows={rows} selected={selectedKind(rows, route)} />;
}
