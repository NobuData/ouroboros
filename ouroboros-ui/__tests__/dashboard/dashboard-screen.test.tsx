import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/app/dashboard/dashboard-screen";
import {
  ACTIVITY_NOT_READ,
  NOT_READ,
  NO_VALUE,
  PULSE_UNMEASURED,
  QUIET_SUBLINE,
} from "@/app/dashboard/view";

import {
  dashboardPayload,
  emptyDashboard,
  engineStatus,
  failed,
  healthReport,
  read,
  readings,
} from "../helpers/dashboard";
import { membership, sessionUser } from "../helpers/login";

/**
 * The dashboard as a screen: mockup 02's frame drawn from what was actually read.
 *
 * The issue's three acceptance criteria are all here — seeded data renders, the status
 * pills reflect reality, and the empty states are designed rather than blank — and each is
 * a case below. What the screen must *not* do has as many cases: no invented run, no zero
 * standing in for a number nobody could read, no action that appears to work.
 *
 * The arithmetic behind every figure is `__tests__/dashboard/view.test.ts`'s. This suite is
 * about what reaches the DOM, the landmarks and names it reaches it under, and the classes
 * that carry the layout.
 */

// The pulse card's switch is a Client Component over a Server Action, and both halves reach
// for something a jsdom render has not got: the action module sits on the server-only client,
// and `useRouter()` wants the App Router mounted. Replacing both is what lets the whole screen
// be rendered here at all — the same reason `__tests__/ui/screens.test.tsx` replaces the login
// screen's actions. What the switch does with them is `auto-merge-switch.test.tsx`.
vi.mock("@/app/dashboard/pulse-actions", () => ({ setAutoMerge: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** The four tiles of the stat row, by the name each is announced under. */
const STAT_LABELS = [
  "Loops live",
  "Queued issues",
  "PRs merged · 7d",
  "Token spend · today",
] as const;

/**
 * The seeded aggregate, with one week's merges fewer than the week before it.
 *
 * @returns The payload.
 */
function fewerMerges() {
  return dashboardPayload({
    stats: { ...dashboardPayload().stats, merged7d: { count: 19, deltaVsPrior: -8 } },
  });
}

/**
 * The seeded aggregate, with a week that matched the one before it exactly.
 *
 * @returns The payload.
 */
function levelWeek() {
  return dashboardPayload({
    stats: { ...dashboardPayload().stats, merged7d: { count: 27, deltaVsPrior: 0 } },
  });
}

/**
 * The seeded aggregate on a day where nothing that was recorded carries a price.
 *
 * @returns The payload.
 */
function unpricedDay() {
  return dashboardPayload({
    stats: {
      ...dashboardPayload().stats,
      tokensToday: { tokens: 4_200_000, costCents: 0, providers: 1, unpricedEvents: 12 },
    },
  });
}

/** The system card, by its heading. */
function systemCard(): HTMLElement {
  return screen.getByRole("region", { name: "System" });
}

/**
 * One dependency row of the system card.
 *
 * @param label The dependency's name, as the row prints it.
 * @returns The row's whole text, pill and note included.
 */
function systemRow(label: string): string {
  const term = within(systemCard()).getByText(label);
  return term.parentElement?.textContent ?? "";
}

describe("the page head", () => {
  it("greets the signed-in person as the page's one top-level heading", () => {
    // The daypart is the browser's, so the case names the person rather than the hour —
    // `greeting.test.tsx` is where the clock is pinned.
    render(<DashboardScreen readings={readings()} />);

    const title = screen.getByRole("heading", { level: 1 });

    expect(title).toHaveTextContent(/, Ken — the loop is turning\.$/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("carries the mockup's eyebrow", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(screen.getByText("Mission Control")).toBeInTheDocument();
  });

  it("greets whoever the gate resolved, rather than a name from a guess", () => {
    render(
      <DashboardScreen
        readings={readings({ user: sessionUser({ displayName: "Maya Chen" }) })}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, Maya —/);
  });

  it("says what the loop is doing right now, from the aggregate", () => {
    // The subline is the page's other piece of page-level truth (#70's `activity`), and on
    // the seeded workspace it is the mockup's own sentence.
    render(<DashboardScreen readings={readings()} />);

    expect(
      screen.getByText(/^3 issues in flight, 12 queued behind them\./),
    ).toBeInTheDocument();
  });

  it("reads quietly for a workspace with nothing in it", () => {
    render(
      <DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />,
    );

    expect(screen.getByText(QUIET_SUBLINE)).toBeInTheDocument();
  });

  it("marks the subline as a failure when the aggregate could not be read", () => {
    // Never a workspace that looks empty: an unread aggregate and an idle loop must not
    // render the same, which is the rule the stat row's em dash is written under.
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: failed("Choose a workspace first.") })} />,
    );

    const subline = container.querySelectorAll(".dash__sub--failed");

    expect(subline).toHaveLength(1);
    expect(subline[0]).toHaveTextContent(ACTIVITY_NOT_READ);
    expect(container.textContent).not.toContain(QUIET_SUBLINE);
  });

  it("makes no claim about the loop in the heading when nothing could be read", () => {
    render(<DashboardScreen readings={readings({ aggregate: failed("Nope.") })} />);

    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent(/loop/);
  });

  it("is a main landmark, so the shell (#41) has something to wrap", () => {
    // The shell contributes header, navigation and the content pane; `main` is the page's
    // own landmark inside that pane.
    render(<DashboardScreen readings={readings()} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});

describe("the page head's actions", () => {
  it("offers the mockup's two, and neither of them acts", () => {
    // Both destinations are screens nobody has built. A control that appeared to pull an
    // issue would be the one dishonest thing on a screen built to be honest.
    const { container } = render(<DashboardScreen readings={readings()} />);

    const head = container.querySelector(".dash__actions");
    const actions = within(head as HTMLElement).getAllByRole("button");

    expect(actions.map((action) => action.textContent)).toEqual([
      "Edit workflows",
      "⟳ Pull next issue",
    ]);
    for (const action of actions) expect(action).toHaveAttribute("aria-disabled", "true");
  });

  it("says why each cannot act, in a tooltip the keyboard can still reach", () => {
    // `aria-disabled` rather than `disabled`: a disabled button leaves the tab order and
    // takes its own explanation with it. Every inert control on the page is held to it, the
    // cards' as much as the head's.
    render(<DashboardScreen readings={readings()} />);

    for (const action of screen.getAllByRole("button")) {
      expect(action.getAttribute("title")).toMatch(/not built yet/);
      expect(action).not.toBeDisabled();
    }
  });

  it("links nowhere at all, rather than to a 404", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the stat row, on seeded data", () => {
  it("draws the mockup's four figures", () => {
    // The acceptance criterion, in one case: the seeded organization reproduces the
    // mockup's values. The arithmetic behind each is `view.test.ts`'s.
    render(<DashboardScreen readings={readings()} />);

    for (const [label, value] of [
      ["Loops live", "3"],
      ["Queued issues", "12"],
      ["PRs merged · 7d", "27"],
      ["Token spend · today", "4.2M"],
    ]) {
      const card = screen.getByRole("region", { name: label });
      expect(within(card).getByText(value!)).toBeInTheDocument();
    }
  });

  it("draws the line under each of them", () => {
    render(<DashboardScreen readings={readings()} />);

    for (const [label, delta] of [
      ["Loops live", "1 coding · 1 building · 1 in review"],
      ["Queued issues", "est. 9h 40m of autonomous work"],
      ["PRs merged · 7d", "▲ 8 vs last week"],
      ["Token spend · today", "≈ $18.60 across 4 providers"],
    ]) {
      const card = screen.getByRole("region", { name: label });
      expect(within(card).getByText(delta!)).toBeInTheDocument();
    }
  });

  it("names each tile, so four figures are not four unlabelled numbers", () => {
    render(<DashboardScreen readings={readings()} />);

    for (const label of STAT_LABELS) {
      expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
    }
  });

  it("accents the one figure the mockup accents", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    const accented = container.querySelectorAll(".dash-stat__value--accent");
    expect(accented).toHaveLength(1);
    expect(accented[0]).toHaveTextContent("3");
  });

  it("colours the merged delta by its sign, and marks it in shape as well as in hue", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    const up = container.querySelector(".dash-stat__delta--up");
    expect(up).toHaveTextContent("▲ 8 vs last week");
    expect(container.querySelectorAll(".dash-stat__delta--down")).toHaveLength(0);
  });

  it("turns that colour over for a week that merged less than the last", () => {
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: read(fewerMerges()) })} />,
    );

    const down = container.querySelector(".dash-stat__delta--down");
    expect(down).toHaveTextContent("▼ 8 vs last week");
    expect(container.querySelectorAll(".dash-stat__delta--up")).toHaveLength(0);
  });

  it("leaves a level week uncoloured, rather than calling it good news", () => {
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: read(levelWeek()) })} />,
    );

    expect(container.querySelectorAll(".dash-stat__delta--up")).toHaveLength(0);
    expect(container.querySelectorAll(".dash-stat__delta--down")).toHaveLength(0);
    expect(screen.getByText("Level with last week")).toBeInTheDocument();
  });

  it("draws no cost line at all when nothing recorded today has a price", () => {
    // Never `$0.00`: a day of unpriced usage cost something nobody can name. The card keeps
    // its caption and its figure and says nothing further.
    render(<DashboardScreen readings={readings({ aggregate: read(unpricedDay()) })} />);

    const card = screen.getByRole("region", { name: "Token spend · today" });

    expect(within(card).getByText("4.2M")).toBeInTheDocument();
    expect(card.textContent).not.toContain("$");
    expect(within(card).queryByText(/across/)).not.toBeInTheDocument();
  });

  it("reads a workspace with nothing in it as zeros and sentences, not em dashes", () => {
    render(<DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />);

    const loops = screen.getByRole("region", { name: "Loops live" });

    expect(within(loops).getByText("0")).toBeInTheDocument();
    expect(within(loops).getByText("Nothing is running right now.")).toBeInTheDocument();
    expect(screen.queryAllByText(NO_VALUE)).toHaveLength(0);
  });

  it("degrades the whole row to em dashes when the aggregate could not be read", () => {
    // The row is one read, so it fails as one — and every card says it could not be read
    // rather than reporting a zero.
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: failed("Choose a workspace first.") })} />,
    );

    for (const label of STAT_LABELS) {
      const card = screen.getByRole("region", { name: label });
      expect(within(card).getByText(NO_VALUE)).toBeInTheDocument();
      expect(within(card).getByText(NOT_READ)).toBeInTheDocument();
    }
    expect(container.querySelectorAll(".dash-stat__delta--failed")).toHaveLength(4);
    expect(container.querySelectorAll(".dash-stat__value--accent")).toHaveLength(0);
  });
});

describe("the system card", () => {
  it("reports the service and both dependencies", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(systemRow("REST API")).toContain("up");
    expect(systemRow("Database")).toContain("up");
    expect(systemRow("Engine")).toContain("up");
  });

  it("summarises the whole card as operational when every row is up", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(within(systemCard()).getByText("operational")).toBeInTheDocument();
  });

  it("degrades the engine's pill when the engine stops answering", () => {
    // The issue's second acceptance criterion, drawn: stop the engine and the probe stops
    // finding it. The database's row is untouched.
    render(
      <DashboardScreen
        readings={readings({
          readiness: healthReport({
            database: { status: "up" },
            engine: { status: "down", message: "GET /healthz responded 503" },
          }),
          engine: failed("The engine is not available right now."),
        })}
      />,
    );

    expect(systemRow("Engine")).toContain("down");
    expect(systemRow("Engine")).toContain("GET /healthz responded 503");
    expect(systemRow("Database")).toContain("up");
    expect(within(systemCard()).getByText("degraded")).toBeInTheDocument();
  });

  it("shows the engine's build when it is answering", () => {
    render(
      <DashboardScreen readings={readings({ engine: read(engineStatus("0.4.2")) })} />,
    );

    expect(systemRow("Engine")).toContain("Build 0.4.2.");
  });

  it("reports what it cannot ask about as unknown, never as up", () => {
    render(<DashboardScreen readings={readings({ readiness: null })} />);

    expect(systemRow("REST API")).toContain("down");
    expect(systemRow("Database")).toContain("unknown");
    expect(within(systemCard()).getByText("degraded")).toBeInTheDocument();
  });

  it("distinguishes its states in shape as well as in hue", () => {
    // Colour alone would leave a reader who cannot separate two hues with three identical
    // pills. Each state carries its own class, and the dot changes with it.
    render(<DashboardScreen readings={readings({ readiness: null })} />);

    const card = systemCard();

    expect(card.querySelectorAll(".ou-chip--err").length).toBeGreaterThan(0);
    expect(card.querySelectorAll(".ou-chip--warn").length).toBeGreaterThan(0);
    expect(card.querySelectorAll(".ou-chip__dot").length).toBe(
      card.querySelectorAll(".ou-chip").length,
    );
    // The unknown state is the one that differs in shape rather than only in hue.
    expect(card.querySelectorAll(".ou-chip__dot--ring").length).toBeGreaterThan(0);
  });

  it("pairs every pill with the dependency it belongs to", () => {
    // A description list, so a pill is announced with its term rather than as a loose word.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll(".dash-system__row")).toHaveLength(3);
    expect(within(systemCard()).getAllByRole("term")).toHaveLength(3);
  });
});

describe("the active loops card, on the page", () => {
  it("draws the aggregate's runs as the mockup's `c-8` table", () => {
    // The card's own columns, treatments and states are
    // `__tests__/dashboard/active-loops-card.test.tsx`'s. What is here is that the page
    // hands it the aggregate it already fetched, in the place the grid keeps for it.
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Active loops" });

    expect(within(card).getAllByRole("row").slice(1)).toHaveLength(3);
    expect(within(card).getByText("Fix flaky CAN-bus telemetry test")).toBeInTheDocument();
  });

  it("is one of the page's two tables, the queue card being a list", () => {
    // A queue row has no columns to head, so #85 draws a `ul` rather than a third table.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll("table")).toHaveLength(2);
  });

  it("degrades with the rest of the page when the aggregate could not be read", () => {
    // One failed read is one degraded card — and this one is the same read as the stat row's,
    // so they report the same reason rather than one of them reporting an empty workspace.
    render(<DashboardScreen readings={readings({ aggregate: failed("Nope.") })} />);

    const card = screen.getByRole("region", { name: "Active loops" });

    expect(within(card).getByText("The loops could not be read")).toBeInTheDocument();
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("the loop pulse card, on the page", () => {
  it("draws the aggregate's pulse as the mockup's `c-4` card", () => {
    // The card's meters, glyph and switch are `__tests__/dashboard/pulse-card.test.tsx`'s.
    // What is here is that the page hands it the aggregate it already fetched.
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Loop pulse" });

    expect(within(card).getByText("92%")).toBeInTheDocument();
    expect(within(card).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("hands it the workspace, so the switch answers to the reader's own role", () => {
    // The page is where the two halves meet: the gate resolved the membership and the
    // aggregate carries the setting, and a card given only the second would offer every
    // reader a control the service would refuse.
    render(
      <DashboardScreen readings={readings({ workspace: membership({ roles: ["member"] }) })} />,
    );

    const card = screen.getByRole("region", { name: "Loop pulse" });

    expect(within(card).getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  });

  it("is the page's one control that changes anything", () => {
    // Everything else on this screen is inert and says why (#80, #82). A second switch here
    // would be a second thing this page can do without the roadmap having said so.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll("[role='switch']")).toHaveLength(1);
  });

  it("degrades with the rest of the page when the aggregate could not be read", () => {
    render(<DashboardScreen readings={readings({ aggregate: failed("Nope.") })} />);

    const card = screen.getByRole("region", { name: "Loop pulse" });

    expect(within(card).getByText("The pulse could not be read.")).toBeInTheDocument();
    expect(within(card).queryByRole("switch")).toBeNull();
  });
});

describe("the completions card, on the page", () => {
  it("draws the aggregate's closed runs as the mockup's `c-7` table", () => {
    // The card's own columns, treatments and states are
    // `__tests__/dashboard/recently-closed-card.test.tsx`'s. What is here is that the page
    // hands it the aggregate it already fetched, in the place the grid keeps for it.
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Recently closed by the loop" });

    expect(within(card).getAllByRole("row").slice(1)).toHaveLength(4);
    expect(within(card).getByText("Debounce e-stop interrupt handler")).toBeInTheDocument();
  });

  it("degrades with the rest of the page when the aggregate could not be read", () => {
    // The same read as the stat row's and the loops table's, so all three report the same
    // reason rather than one of them reporting a workspace that has closed nothing.
    render(<DashboardScreen readings={readings({ aggregate: failed("Nope.") })} />);

    const card = screen.getByRole("region", { name: "Recently closed by the loop" });

    expect(within(card).getByText("The completions could not be read")).toBeInTheDocument();
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("the queue card, on the page", () => {
  it("draws the aggregate's queue head as the mockup's `c-5` card", () => {
    // The card's own rows, chips and footer are `__tests__/dashboard/queue-card.test.tsx`'s.
    // What is here is that the page hands it the aggregate it already fetched, in the place
    // the grid keeps for it.
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Up next in queue" });

    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
    expect(within(card).getByText("Watchdog reset on I²C bus lockup")).toBeInTheDocument();
  });

  it("reports the rest of the queue from the count the stat row is drawn from", () => {
    // Two figures of one payload, so the card cannot say `+7 queued` under a stat row that
    // says anything but `12`.
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Up next in queue" });

    expect(within(card).getByRole("button", { name: "+7 queued →" })).toBeInTheDocument();
  });

  it("invents no queued issue for a workspace whose queue is empty", () => {
    // The mockup fills this card with five plausible rows. Copying them would make the screen
    // a picture of a product rather than a view of one.
    render(<DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />);

    const card = screen.getByRole("region", { name: "Up next in queue" });

    expect(within(card).getByText("Nothing is queued")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/#\d{3}/);
  });

  it("degrades with the rest of the page when the aggregate could not be read", () => {
    render(<DashboardScreen readings={readings({ aggregate: failed("Nope.") })} />);

    const card = screen.getByRole("region", { name: "Up next in queue" });

    expect(within(card).getByText("The queue could not be read")).toBeInTheDocument();
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("the grid", () => {
  it("lays the cards out on the mockup's twelve columns, in its order", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    const spans = [...container.querySelectorAll(".dash-grid > *")].map(
      (card) => [...card.classList].find((name) => name.startsWith("dash-col--")),
    );

    expect(spans).toEqual([
      "dash-col--3",
      "dash-col--3",
      "dash-col--3",
      "dash-col--3",
      "dash-col--8",
      // The mockup's own first row: the loops table and the pulse card, twelve columns
      // between them. The system card is the one card on this grid the mockup does not
      // draw (#45), so it follows the pair it shares a width with rather than splitting it.
      "dash-col--4",
      "dash-col--4",
      "dash-col--7",
      "dash-col--5",
    ]);
  });

  it("styles itself through classes only, except for the one length that is data", () => {
    // The mockup carries a dozen `style=` attributes. Every one of them is a colour or a
    // length that belongs in the sheet, where the theme can reach it — and every one of them
    // is gone.
    //
    // A meter's fill is the exception and it is not a style at all: how far through its
    // workflow a run is cannot be known until a run says, so it arrives as a custom property
    // the sheet reads (`app/ui/meter.tsx`). The case is written as *only that* rather than
    // deleted, because the rule it protects — no colour, no size, no spacing inline — is
    // what keeps the theme able to reach every surface on this page.
    //
    // The pulse card's glyph (#83) adds the second exception, and it is the framework's
    // rather than this page's: `next/image` writes `color: transparent` onto every image it
    // renders, so that the alt text of one that has not loaded is not drawn over the box it
    // reserved. It is allowed on an `img` and nowhere else.
    const { container } = render(<DashboardScreen readings={readings()} />);

    for (const styled of container.querySelectorAll("[style]")) {
      const allowed =
        styled.tagName === "IMG" ? /^color:\s*transparent;?$/ : /^--ou-meter-fill:\s*[\d.]+%;?$/;

      expect(styled.getAttribute("style")).toMatch(allowed);
    }
  });

  it("gives every card a heading or a name, so the grid is navigable", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    const cards = [...container.querySelectorAll(".dash-grid > .ou-card")];
    expect(cards).toHaveLength(9);
    for (const card of cards) {
      expect(
        card.hasAttribute("aria-label") || card.hasAttribute("aria-labelledby"),
      ).toBe(true);
    }
  });
});

describe("a workspace that is not the seeded one", () => {
  it("reads sensibly on the first minute of a new workspace", () => {
    // Every figure is real and every caption points somewhere; no card is blank, none of
    // them is an error, and nothing is drawn as an em dash — these zeros were read.
    render(<DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />);

    for (const label of STAT_LABELS) {
      const card = screen.getByRole("region", { name: label });
      expect(within(card).getByText("0")).toBeInTheDocument();
      expect(card.textContent).not.toContain(NO_VALUE);
    }
  });

  it("designs every one of the nine cards at zero (#86)", () => {
    // The `kensuenobu` criterion, as a test rather than a screenshot: a fresh workspace has
    // no runs, no queue and no usage, and **every** card has to be designed for that — not
    // four of them, which is what "each card grew its own zero state as it landed" leaves
    // behind. A card with nothing in it and nothing to say is a blank region, which the
    // design system's § 3.5 forbids by name.
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />,
    );

    const cards = [...container.querySelectorAll<HTMLElement>(".dash-grid > .ou-card")];

    expect(cards).toHaveLength(9);
    for (const card of cards) {
      // Something to read on every one of them, beyond the heading.
      expect(card.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("fabricates nothing for a workspace with nothing in it (#86)", () => {
    // The honesty rule at zero: no em dash (these zeros were *read*), no invented row, and no
    // figure interpolated to make a card look busy. The mockup's own numbers are the specific
    // thing that must not appear.
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />,
    );

    expect(screen.queryAllByText(NO_VALUE)).toHaveLength(0);
    expect(container.textContent).not.toMatch(/#\d{3}/);
    expect(container.textContent).not.toMatch(/\bundefined\b|\bNaN\b|\[object/);
    // No table row survives an empty payload, in either table.
    expect(container.querySelectorAll("table")).toHaveLength(0);
  });

  it("says what would fill each empty card rather than apologising for it", () => {
    // The EmptyState language, in one voice across the four cards that have one: what is not
    // there, and what puts something there.
    render(<DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />);

    for (const [card, headline] of [
      ["Active loops", "Nothing is running right now"],
      ["Recently closed by the loop", "Nothing closed yet"],
      ["Up next in queue", "Nothing is queued"],
    ] as const) {
      const region = screen.getByRole("region", { name: card });
      expect(within(region).getByText(headline)).toBeInTheDocument();
    }

    // The pulse card's meters stay, at zero, with the note that says why they have nothing
    // to report — three bars at 0% and no sentence would read as a merge rate of nought.
    const pulse = screen.getByRole("region", { name: "Loop pulse" });
    expect(within(pulse).getAllByRole("progressbar")).toHaveLength(3);
    expect(within(pulse).getByText(PULSE_UNMEASURED)).toBeInTheDocument();
  });

  // *Says a workspace is suspended* was here. `OrgRow` publishes no lifecycle since
  // [#719](https://github.com/NobuData/ouroboros/issues/719), so the state cannot be
  // reported and the subline no longer has a branch for it — see `view.test.ts`.

  it("says why once on the whole page, not once per card (#86)", () => {
    // The failure this ticket exists for. One refused aggregate used to print the service's
    // sentence **nine** times — on four stat tiles, in four cards and in the page head's
    // subline — which reads as nine problems rather than one and buries the single retry.
    // The screen now says *what* could not be read, card by card; *why* is the banner's, and
    // the banner is `app/dashboard/freshness.tsx`'s to render.
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: failed("Choose a workspace first.") })} />,
    );

    const said = container.textContent?.split("Choose a workspace first.").length ?? 1;

    expect(said - 1).toBe(0);
  });

  it("still names what each card could not read", () => {
    // Dropping the repeated reason must not leave a page of blank cards: each one still says
    // which question went unanswered, which is the half of the fact the card owns.
    render(<DashboardScreen readings={readings({ aggregate: failed("Nope.") })} />);

    for (const [card, headline] of [
      ["Active loops", "The loops could not be read"],
      ["Recently closed by the loop", "The completions could not be read"],
      ["Up next in queue", "The queue could not be read"],
      ["Loop pulse", "The pulse could not be read."],
    ] as const) {
      const region = screen.getByRole("region", { name: card });
      expect(within(region).getByText(headline)).toBeInTheDocument();
    }
  });

  it("renders every card even when every read failed", () => {
    // One failed read is one degraded card, and three are the whole page — never a blank one.
    const { container } = render(
      <DashboardScreen
        readings={readings({
          aggregate: failed("Something went wrong."),
          readiness: null,
          engine: failed("The engine is not available right now."),
        })}
      />,
    );

    expect(container.querySelectorAll(".dash-grid > .ou-card")).toHaveLength(9);
    // The greeting survives every failed read: it is the session's, which the gate resolved.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, Ken/);
    expect(screen.getAllByText(NO_VALUE).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bundefined\b|\bNaN\b|\[object/);
  });
});

describe("the composition, and what it is protected from", () => {
  it("renders the seeded world without the reader, so the screen depends on no server module", () => {
    // The screen takes data and draws it. That is what lets this whole suite run with no
    // environment, no cookies and no `server-only` mock in sight.
    render(<DashboardScreen readings={readings()} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
