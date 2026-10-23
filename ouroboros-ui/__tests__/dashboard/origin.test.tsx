import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/app/dashboard/dashboard-screen";
import { dashboardHref } from "@/app/dashboard/origin-control";
import { NO_LIVE_LOOPS } from "@/app/dashboard/active-loops-card";
import { NO_LIVE_CLOSED } from "@/app/dashboard/recently-closed-card";
import { NO_LIVE_MERGES, NO_VALUE, PULSE_NO_LIVE } from "@/app/dashboard/view";
import { GET_STARTED_PATH } from "@/app/get-started/view";
import { NO_LIVE_LOOP, ORIGIN_COOKIE, ORIGIN_GROUP_LABEL } from "@/app/origin/origin";

import {
  activeRun,
  closedRun,
  dashboardPayload,
  emptyDashboard,
  read,
  readings,
  seededDashboard,
  seededOnlyLiveDashboard,
} from "../helpers/dashboard";

/**
 * The dashboard's data origin (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)):
 * the filter, the page strip, the row and figure badges, and the honest empty cards.
 */

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/get-started/actions", () => ({ dismissWizard: vi.fn() }));
vi.mock("@/app/dashboard/pulse-actions", () => ({ setAutoMerge: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  document.cookie = `${ORIGIN_COOKIE}=; Max-Age=0; Path=/`;
  window.history.replaceState(null, "", "/dashboard");
});

/** The filter's group. */
function filter(): HTMLElement {
  return screen.getByRole("group", { name: ORIGIN_GROUP_LABEL });
}

describe("the origin filter", () => {
  it("shows live pressed by default", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(within(filter()).getByRole("button", { name: "Live" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("moves the address and remembers the choice when another origin is pressed", () => {
    render(<DashboardScreen readings={readings()} />);

    fireEvent.click(within(filter()).getByRole("button", { name: "Demo data" }));

    expect(replace).toHaveBeenCalledWith("/dashboard?origin=seeded", { scroll: false });
    expect(document.cookie).toContain(`${ORIGIN_COOKIE}=seeded`);
    expect(within(filter()).getByRole("button", { name: "Demo data" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("re-reads in place for live when the address already names none", () => {
    render(<DashboardScreen readings={readings({ origin: "seeded" })} />);

    fireEvent.click(within(filter()).getByRole("button", { name: "Live" }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(document.cookie).toContain(`${ORIGIN_COOKIE}=live`);
  });

  it("names no origin in the address for live, and the origin for anything else", () => {
    expect(dashboardHref("live")).toBe("/dashboard");
    expect(dashboardHref("all")).toBe("/dashboard?origin=all");
  });
});

describe("the page strip", () => {
  it("says no real loop has run, and that the demo data is hidden, under the live filter", () => {
    render(<DashboardScreen readings={readings({ aggregate: read(seededOnlyLiveDashboard()) })} />);

    const strip = screen.getByRole("note");
    expect(strip).toHaveTextContent(NO_LIVE_LOOP);
    expect(strip).toHaveTextContent(/Demo data is hidden/);
    expect(within(strip).getByRole("link", { name: "Check readiness →" })).toHaveAttribute(
      "href",
      GET_STARTED_PATH,
    );
  });

  it("says the page is showing demo data when the demo data is what was asked for", () => {
    render(
      <DashboardScreen
        readings={readings({ origin: "seeded", aggregate: read(seededDashboard()) })}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      `This page is showing demo data. ${NO_LIVE_LOOP}`,
    );
  });

  it("is absent once any live data exists", () => {
    render(<DashboardScreen readings={readings()} />);

    expect(screen.queryByText(NO_LIVE_LOOP, { exact: false })).toBeNull();
  });

  it("is absent for a workspace with nothing in it — its empty cards speak instead", () => {
    render(<DashboardScreen readings={readings({ aggregate: read(emptyDashboard()) })} />);

    expect(screen.queryByText(NO_LIVE_LOOP, { exact: false })).toBeNull();
  });
});

describe("the badges", () => {
  it("marks every demo row of both run cards, in words", () => {
    render(
      <DashboardScreen
        readings={readings({ origin: "seeded", aggregate: read(seededDashboard()) })}
      />,
    );

    for (const card of ["Active loops", "Recently closed by the loop"]) {
      const region = screen.getByRole("region", { name: card });
      const rows = within(region).getAllByRole("row").slice(1);

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(within(row).getByText("Demo data")).toBeInTheDocument();
      }
    }
  });

  it("leaves a live row beside demo rows unmarked, so it reads as distinct", () => {
    render(
      <DashboardScreen
        readings={readings({
          origin: "all",
          aggregate: read(
            dashboardPayload({
              origin: "all",
              originsPresent: ["live", "seeded"],
              activeRuns: [
                activeRun({ id: "run-live", issueNumber: 488, issueTitle: "Fix typo in README" }),
                activeRun({ origin: "seeded" }),
              ],
            }),
          ),
        })}
      />,
    );

    const region = screen.getByRole("region", { name: "Active loops" });
    const live = within(region).getByRole("row", { name: /#488/ });
    const demo = within(region).getByRole("row", { name: /#482/ });

    expect(within(live).queryByText("Demo data")).toBeNull();
    expect(within(demo).getByText("Demo data")).toBeInTheDocument();
  });

  it("marks a simulated row as simulated", () => {
    render(
      <DashboardScreen
        readings={readings({
          origin: "simulated",
          aggregate: read(
            dashboardPayload({
              origin: "simulated",
              originsPresent: ["simulated"],
              recentRuns: [closedRun({ origin: "simulated" })],
            }),
          ),
        })}
      />,
    );

    const region = screen.getByRole("region", { name: "Recently closed by the loop" });
    expect(within(region).getByText("Simulated")).toBeInTheDocument();
  });

  it("marks the run figures and the pulse when they count demo data, and never the queue", () => {
    render(
      <DashboardScreen
        readings={readings({ origin: "seeded", aggregate: read(seededDashboard()) })}
      />,
    );

    for (const card of ["Loops live", "PRs merged · 7d", "Token spend · today", "Loop pulse"]) {
      expect(
        within(screen.getByRole("region", { name: card })).getByText("Demo data"),
      ).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole("region", { name: "Queued issues" })).queryByText("Demo data"),
    ).toBeNull();
  });

  it("marks nothing on a live page", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    // The filter's own options say "Demo data" and "Simulated"; no badge does.
    expect(container.querySelectorAll(".origin-badge")).toHaveLength(0);
  });
});

describe("a workspace with no live data, read live", () => {
  it("draws every live figure as no data and every run card as empty, never a zero or a demo row", () => {
    const { container } = render(
      <DashboardScreen readings={readings({ aggregate: read(seededOnlyLiveDashboard()) })} />,
    );

    const merged = screen.getByRole("region", { name: "PRs merged · 7d" });
    expect(within(merged).getByText(NO_VALUE)).toBeInTheDocument();
    expect(within(merged).getByText(NO_LIVE_MERGES)).toBeInTheDocument();

    expect(
      within(screen.getByRole("region", { name: "Active loops" })).getByText(NO_LIVE_LOOPS),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Recently closed by the loop" })).getByText(
        NO_LIVE_CLOSED,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Loop pulse" })).getByText(PULSE_NO_LIVE),
    ).toBeInTheDocument();

    // Nothing of the demo tenant: no issue number, no demo badge, no percentage.
    expect(container.textContent).not.toMatch(/#\d{3}/);
    expect(screen.queryByText("0%")).toBeNull();
  });
});
