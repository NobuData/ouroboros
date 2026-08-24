import { Button, Card, EmptyState } from "@/app/ui";

import { ModelsFrame } from "./models-frame";
import { ProviderStrip } from "./provider-strip";
import { type ModelsReadings, SIMULATE_REASON, saveRoutesReason } from "./view";

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
 * The frame is honest about being a frame. Two of its four tabs point at surfaces other
 * roadmaps have not built and are labelled *soon* rather than linked to a `404`; both head
 * actions are inert and say why; and the space the routing matrix will occupy carries an
 * empty state naming the issues that fill it, rather than a placeholder table of numbers
 * nobody computed. That is § 3.5 applied to a page that is mostly not built yet: a surface
 * that is not ready is **labelled**, never dead, and never a mock-up of itself.
 *
 * The one region drawing real data is the health strip, and it is the one region on the page
 * where being wrong would matter — which is why `view.ts` carries the argument for every
 * treatment it takes.
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

/**
 * The routing screen.
 *
 * @param props.readings Everything the reader was able to read, and why not for the rest.
 * @returns The screen.
 */
export function ModelsScreen({ readings }: Readonly<{ readings: ModelsReadings }>) {
  return (
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
            Disabled while clean, which is the acceptance criterion and also the only honest
            state this button has today: `reason` is what makes it inert, so it cannot be
            switched off without saying what is missing. `saveRoutesReason` is the rule —
            AA.3 (#202) supplies a `pending` above zero and the control enables itself.
          */}
          <Button reason={saveRoutesReason(readings.pending)} tone="primary">
            Save routes
          </Button>
        </>
      }
    >
      <ProviderStrip providers={readings.providers} />

      {/*
        The rest of the mockup, named rather than mocked. A placeholder matrix of invented
        rows would be the one dishonest thing on a page built to be honest — and would be
        indistinguishable, in a screenshot, from the real one AA.2 ships.
      */}
      <Card className="models__next" fill>
        <EmptyState
          fill
          note="The eight-kind matrix and its route inspector arrive with #201 and #203; chain editing with #202, and the escalation rules and spend cards with #204. Provider health above is live."
          title="The routing matrix arrives next"
        />
      </Card>
    </ModelsFrame>
  );
}
