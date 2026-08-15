import Link from "next/link";

import { Button, Eyebrow, PageSubnav, StickyBar, Table, type Column } from "@/app/ui";

import "./workshop.css";

/**
 * The in-pane chrome story ([#646](https://github.com/NobuData/ouroboros/issues/646)) —
 * the first page of the component workshop
 * ([#48](https://github.com/NobuData/ouroboros/issues/48)).
 *
 * The workshop proper — Ladle or Storybook, stories per primitive per theme — is a v2
 * issue, but CP.4's contracts need their demonstration *now*: every subnav-owning roadmap
 * builds against them, and a contract nobody can look at is a contract everyone
 * re-derives. So this screen is the story #48 will absorb, written as an ordinary page:
 * one long fixture with every piece of sticky chrome mounted at once, over enough rows
 * that all of it actually sticks.
 *
 * What it demonstrates is the acceptance list, one section per criterion:
 *
 * - the **stacking contract** — subnav above dirty-state bar above table header, none
 *   covering another, all against the pane rather than the viewport;
 * - the **anchor offset** — the subnav's own tabs are anchor links, landing their targets
 *   below the stuck chrome;
 * - **scroll restoration** — a push link to walk away with, and back/forward to return;
 * - the **preserved treatments** — the model-hue subnav beside the accent one, in a
 *   scrollport of its own to show the primitives bind to whatever container holds them
 *   (which is how #48's isolated stories will host them too).
 *
 * Both themes and every font scale come free, the way they do for every screen: the
 * chrome is drawn from tokens and measures itself, and the profile menu switches both
 * live.
 *
 * ### The fixture is honest about being one
 *
 * Synthetic rows, and controls whose `reason` says the draft they would save does not
 * exist (§ 3.5: a control that cannot act explains itself). The one live control is the
 * navigation, because navigation is one of the contracts under demonstration.
 */

/** One synthetic routing row — the shape the issue's own diagram sketches. */
interface FixtureRow {
  /** The route alias, e.g. `route-07`. */
  readonly alias: string;
  /** The provider the alias resolves through. */
  readonly provider: string;
  /** The model it lands on. */
  readonly model: string;
  /** The parameters, as the dense mono string the mockups draw. */
  readonly params: string;
  /** The route's standing. */
  readonly health: string;
}

/** The providers the fixture cycles through. */
const PROVIDERS = ["anthropic", "openai", "google", "mistral"] as const;

/**
 * Enough rows that every layer of chrome is stuck long before the table ends, at every
 * font scale the profile menu offers. Deterministic — a fixture that changed between
 * renders would make the restoration demonstration unrepeatable.
 */
const ROWS: readonly FixtureRow[] = Array.from({ length: 48 }, (_, index) => ({
  alias: `route-${String(index + 1).padStart(2, "0")}`,
  provider: PROVIDERS[index % PROVIDERS.length],
  model: `model-${(index % 7) + 1}`,
  params: `t=0.${index % 10} · retries=${(index % 4) + 1}`,
  health: index % 9 === 4 ? "degraded" : "healthy",
}));

/** The fixture table's columns: mono identifiers, one end-aligned figure column. */
const COLUMNS: readonly Column<FixtureRow>[] = [
  { key: "alias", header: "Alias", mono: true, cell: (row) => row.alias },
  { key: "provider", header: "Provider", cell: (row) => row.provider },
  { key: "model", header: "Model", mono: true, cell: (row) => row.model },
  { key: "params", header: "Params", mono: true, cell: (row) => row.params },
  { key: "health", header: "Health", align: "end", cell: (row) => row.health },
];

/** Why the dirty-state bar's controls cannot act, stated where the pointer will ask. */
const FIXTURE_REASON = "A workshop fixture — there is no draft behind this bar to save";

/**
 * The story: every in-pane chrome contract, live over one long fixture.
 *
 * @returns The page, rendered inside the shell's content pane.
 */
export function ChromeStory() {
  return (
    <div className="wk-page">
      <header className="wk-head">
        <Eyebrow>Component workshop</Eyebrow>
        <h1 className="wk-title">In-pane chrome</h1>
        <p className="wk-sub">
          The CP.4 contracts, stacked over a long fixture: scroll, and everything above the
          rows holds its place against the pane.
        </p>
      </header>

      {/* Layer 1: the subnav. Anchor tabs, so the tab row also demonstrates the anchor
          offset it participates in. */}
      <PageSubnav label="In-pane chrome story">
        <a aria-current="location" href="#stacking">
          Stacking
        </a>
        <a href="#anchors">Anchors</a>
        <a href="#restoration">Restoration</a>
        <a href="#treatments">Treatments</a>
      </PageSubnav>

      {/* Layer 2: the dirty-state bar, in the asking treatment. */}
      <StickyBar tone="asking">
        <p className="wk-bar-note">
          <strong>Unsaved changes</strong> — the dirty-state bar, holding under the subnav.
        </p>
        <span className="wk-bar-actions">
          <Button size="sm" tone="ghost" reason={FIXTURE_REASON}>
            Discard
          </Button>
          <Button size="sm" tone="primary" reason={FIXTURE_REASON}>
            Save
          </Button>
        </span>
      </StickyBar>

      <section aria-labelledby="stacking" className="wk-section">
        <h2 className="wk-heading" id="stacking">
          The stacking contract
        </h2>
        <p className="wk-prose">
          Three layers, one documented order: the page subnav, then the dirty-state bar,
          then the table header — <code>app/ui/chrome.ts</code> is the contract. Each layer
          publishes its measured height and the next offsets by it, so none can cover
          another at any font scale. The table below is layer 3: its header sticks against
          the pane and stays clear of both bars.
        </p>
        <Table
          caption="Forty-eight synthetic routing rows — long enough that every layer is stuck"
          columns={COLUMNS}
          rowKey={(row) => row.alias}
          rows={ROWS}
          stickyHeader
        />
      </section>

      <section aria-labelledby="anchors" className="wk-section">
        <h2 className="wk-heading" id="anchors">
          Anchors land below the chrome
        </h2>
        <p className="wk-prose">
          The tabs above are anchor links. Follow one and the pane — never the body —
          scrolls its target here, offset by <code>scroll-padding-top</code> on the pane:
          the same published heights the sticky layers read, plus a step of daylight. This
          heading arrived below the stuck chrome, not underneath it.
        </p>
      </section>

      <section aria-labelledby="restoration" className="wk-section">
        <h2 className="wk-heading" id="restoration">
          Scroll restoration
        </h2>
        <p className="wk-prose">
          Scroll partway down the fixture, then{" "}
          <Link className="wk-link" href="/dashboard">
            push to the dashboard
          </Link>
          : it starts at the top, as every push does. Come back with the browser and this
          page is where you left it; go forward again and the dashboard is where you left
          that. The memory is the shell&apos;s (<code>app/shell/pane-restoration.tsx</code>),
          so every route gets it without writing anything.
        </p>
      </section>

      <section aria-labelledby="treatments" className="wk-section">
        <h2 className="wk-heading" id="treatments">
          Preserved treatments
        </h2>
        <p className="wk-prose">
          Mockup 06 underlines its Models tabs in the model purple where 07 and 21 use the
          accent — a choice, so the primitive keeps it as one (<code>tone</code>). The
          sample sits in a scrollport of its own, which is also the demonstration that the
          chrome binds to whatever container holds it — the pane here, an isolated story in
          the #48 workshop later.
        </p>
        <div className="wk-sample">
          <PageSubnav label="Model routing (sample)" tone="model">
            <a aria-current="location" href="#treatments">
              Routing
            </a>
            <a href="#treatments">Model registry</a>
            <a href="#treatments">Providers &amp; keys</a>
            <a href="#treatments">Spend</a>
          </PageSubnav>
          <p className="wk-prose wk-sample__filler">
            Scroll this well: the sample subnav sticks to its own container&apos;s top
            edge, publishing its height there rather than to the pane.
          </p>
        </div>
      </section>
    </div>
  );
}
