import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardScreen } from "@/app/dashboard/dashboard-screen";
import { NO_VALUE } from "@/app/dashboard/view";

import { engineStatus, failed, healthReport, memberPage, read, readings } from "../helpers/dashboard";
import { enablement, membership, org, repo, sessionUser } from "../helpers/login";

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

/** The seeded world's enablement list: one organisation, one repository, both on. */
const SEEDED = enablement([[org(), [repo()]]]);

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
  it("names the workspace as the page's one top-level heading", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Robotics" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("carries the mockup's eyebrow", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(screen.getByText("Mission Control")).toBeInTheDocument();
  });

  it("says who is looking and what they hold, from the gate rather than from a guess", () => {
    render(
      <DashboardScreen
        readings={readings({
          workspace: membership({ role: "viewer", slug: "acme-labs" }),
          user: sessionUser({ displayName: "Maya Chen" }),
        })}
      />,
    );

    expect(screen.getByText("Maya Chen · viewer of acme-labs")).toBeInTheDocument();
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
    render(<DashboardScreen readings={readings()} />);

    const actions = screen.getAllByRole("button");
    expect(actions.map((action) => action.textContent)).toEqual([
      "Edit workflows",
      "⟳ Pull next issue",
    ]);
    for (const action of actions) expect(action).toHaveAttribute("aria-disabled", "true");
  });

  it("says why each cannot act, in a tooltip the keyboard can still reach", () => {
    // `aria-disabled` rather than `disabled`: a disabled button leaves the tab order and
    // takes its own explanation with it.
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
  it("renders the seed's three members and the roles behind them", () => {
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Members" });
    expect(within(card).getByText("3")).toBeInTheDocument();
    expect(within(card).getByText("1 owner · 1 admin · 1 member")).toBeInTheDocument();
  });

  it("renders the seed's one organisation and one repository", () => {
    render(<DashboardScreen readings={readings()} />);

    const orgs = screen.getByRole("region", { name: "Organisations" });
    const repos = screen.getByRole("region", { name: "Repositories" });

    expect(within(orgs).getByText("1")).toBeInTheDocument();
    expect(within(orgs).getByText("of 1 recorded")).toBeInTheDocument();
    expect(within(repos).getByText("1")).toBeInTheDocument();
  });

  it("draws the loop count as an em dash, because nothing can answer it yet", () => {
    render(<DashboardScreen readings={readings()} />);

    const card = screen.getByRole("region", { name: "Loops live" });
    expect(within(card).getByText(NO_VALUE)).toBeInTheDocument();
    expect(within(card).getByText(/No run data yet/)).toBeInTheDocument();
  });

  it("names each tile, so four figures are not four unlabelled numbers", () => {
    render(<DashboardScreen readings={readings()} />);

    for (const label of ["Loops live", "Members", "Organisations", "Repositories"]) {
      expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
    }
  });

  it("degrades one tile to an em dash and the reason, leaving the others reading", () => {
    render(
      <DashboardScreen readings={readings({ members: failed("No such tenant.") })} />,
    );

    const members = screen.getByRole("region", { name: "Members" });
    expect(within(members).getByText(NO_VALUE)).toBeInTheDocument();
    expect(within(members).getByText("No such tenant.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Organisations" })).getByText("1"),
    ).toBeInTheDocument();
  });

  it("marks a failed caption as one, so it is not read as a description of a figure", () => {
    const { container } = render(
      <DashboardScreen readings={readings({ members: failed("No such tenant.") })} />,
    );

    expect(container.querySelectorAll(".dash-stat__delta--failed")).toHaveLength(1);
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
    const { container } = render(
      <DashboardScreen readings={readings({ readiness: null })} />,
    );

    expect(container.querySelectorAll(".dash-pill--down").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".dash-pill--unknown").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".dash-pill__dot").length).toBe(
      container.querySelectorAll(".dash-pill").length,
    );
  });

  it("pairs every pill with the dependency it belongs to", () => {
    // A description list, so a pill is announced with its term rather than as a loose word.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll(".dash-system__row")).toHaveLength(3);
    expect(within(systemCard()).getAllByRole("term")).toHaveLength(3);
  });
});

describe("the panels with no data source yet", () => {
  it("draws the mockup's three loop panels as designed empty states", () => {
    render(<DashboardScreen readings={readings()} />);

    for (const title of [
      "Active loops",
      "Recently closed by the loop",
      "Up next in queue",
    ]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
  });

  it("says 'No loops yet' rather than leaving the card blank", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(screen.getByText("No loops yet")).toBeInTheDocument();
  });

  it("names what will fill each one and what has to land first", () => {
    // The honesty rule applied to a whole card: a surface that is not ready is labelled,
    // never dead, and never a blank region.
    render(<DashboardScreen readings={readings()} />);

    for (const title of [
      "Active loops",
      "Recently closed by the loop",
      "Up next in queue",
    ]) {
      const card = screen.getByRole("region", { name: title });
      expect(within(card).getByText(/mockup|once the loop has run/)).toBeInTheDocument();
    }
  });

  it("invents no run, no pull request and no queued issue", () => {
    // The mockup fills these three cards with fifteen plausible rows. Copying them would
    // make this screen a picture of a product rather than a view of one.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll("table")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/claude-|PR\s*#|#4\d\d/);
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
      "dash-col--4",
      "dash-col--7",
      "dash-col--5",
    ]);
  });

  it("styles itself through classes only — no inline style survives review", () => {
    // The mockup carries a dozen `style=` attributes. Every one of them is a colour or a
    // length that belongs in the sheet, where the theme can reach it.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("gives every card a heading or a name, so the grid is navigable", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    const cards = [...container.querySelectorAll(".dash-grid > .dash-card")];
    expect(cards).toHaveLength(8);
    for (const card of cards) {
      expect(
        card.hasAttribute("aria-label") || card.hasAttribute("aria-labelledby"),
      ).toBe(true);
    }
  });
});

describe("a workspace that is not the seeded one", () => {
  it("reads sensibly with nothing enabled and nobody but the owner", () => {
    // The first minute of a new workspace. Every figure is real and every caption points
    // somewhere; no card is blank and none of them is an error.
    render(
      <DashboardScreen
        readings={readings({
          members: read(memberPage([{ ...memberPage().items[0]!, role: "owner" }])),
          enablement: read(enablement([])),
        })}
      />,
    );

    expect(
      within(screen.getByRole("region", { name: "Members" })).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Organisations" })).getByText(
        "None recorded — enable one on the sign-in screen.",
      ),
    ).toBeInTheDocument();
  });

  it("says a workspace is suspended, because that is the case somebody must be told", () => {
    render(
      <DashboardScreen
        readings={readings({ workspace: membership({ status: "suspended" }) })}
      />,
    );

    expect(screen.getByText(/workspace suspended/)).toBeInTheDocument();
  });

  it("renders every card even when every read failed", () => {
    // One failed read is one degraded card, and four are four — never a blank page.
    const { container } = render(
      <DashboardScreen
        readings={readings({
          members: failed("Something went wrong."),
          enablement: failed("Something went wrong."),
          readiness: null,
          engine: failed("The engine is not available right now."),
        })}
      />,
    );

    expect(container.querySelectorAll(".dash-grid > .dash-card")).toHaveLength(8);
    expect(screen.getByRole("heading", { level: 1, name: "Acme Robotics" })).toBeInTheDocument();
    expect(screen.getAllByText(NO_VALUE).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bundefined\b|\bNaN\b|\[object/);
  });
});

describe("the composition, and what it is protected from", () => {
  it("renders SEEDED without the reader, so the screen depends on no server module", () => {
    // The screen takes data and draws it. That is what lets this whole suite run with no
    // environment, no cookies and no `server-only` mock in sight.
    render(<DashboardScreen readings={readings({ enablement: read(SEEDED) })} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
