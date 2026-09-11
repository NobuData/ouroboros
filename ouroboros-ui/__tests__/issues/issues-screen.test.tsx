import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTER, FILTER_BAR_LABEL, REPO_LABEL } from "@/app/issues/filter";
import { CLOSE_PANEL_LABEL, NO_ISSUE_OPEN, PANEL_TITLE, READING_ISSUE } from "@/app/issues/panel";
import { TABLE_CAPTION } from "@/app/issues/table";
import {
  COUNTS_UNREAD,
  ISSUES_EYEBROW,
  ISSUES_SUBLINE,
  QUEUE_NOTHING_SELECTED,
  QUEUE_ROLE_REASON,
  REESTIMATE_LABEL,
  REESTIMATE_UNCOUNTED,
  queueLabel,
} from "@/app/issues/view";

import { HELIOS, UNCOUNTED, UNCOUNTED_REASON, issueId, issuesReadings } from "../helpers/issues";
import { TENANT_ID } from "../helpers/login";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The intake screen's page head (#115), the filter bar under it (#116), the backlog table under
 * that (#117), the selection bar under the table (#118) and the detail panel beside them (#119),
 * as a component.
 *
 * The issue's criteria that are visible without a route are all here: the counts are the read's
 * rather than the mockup's, the head carries the mockup's eyebrow, subline and two actions, a
 * backlog that could not be counted says so rather than drawing zeros, the two actions gate by role,
 * the bar mounts under the head drawing what the address asked for, the table mounts under the bar
 * drawing the page that was read, the panel holds its seat beside the table and opens from a row's
 * keyboard, and the markup does not depend on the palette. What each action does when pressed,
 * what the bar writes, what the table does and what the panel draws are their own suites'; the
 * actions' server hops are replaced here, and both polls are left asking a `fetch` that never
 * answers.
 */

vi.mock("@/app/issues/head-actions", () => ({
  queueSelected: vi.fn(),
  queueUnder: vi.fn(),
  reestimateAll: vi.fn(),
  reestimateIssue: vi.fn(),
  syncBacklog: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));

const { IssuesScreen } = await import("@/app/issues/issues-screen");
const { resetFocusRepos } = await import("@/app/shell/focus-repo");

/** The head's action column. */
function actions(container: HTMLElement): HTMLElement {
  return container.querySelector(".issues__actions") as HTMLElement;
}

/**
 * The screen, for a reader holding the seeded readings unless told otherwise.
 *
 * @param over The props this case is about.
 * @returns The element to render.
 */
function screenFor(
  over: Partial<Parameters<typeof IssuesScreen>[0]> = {},
): ReturnType<typeof IssuesScreen> {
  return (
    <IssuesScreen
      filter={DEFAULT_FILTER}
      mayAdminister
      mayContribute
      organizationId={TENANT_ID}
      readings={issuesReadings()}
      {...over}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

afterEach(() => {
  window.localStorage.clear();
  resetFocusRepos();
});

describe("the page head, on seeded data", () => {
  it("counts what the service counted, in the mockup's sentence", () => {
    render(screenFor());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "9 open issues. 7 already sized.",
    );
  });

  it("carries the mockup's eyebrow and subline", () => {
    render(screenFor());

    expect(screen.getByText(ISSUES_EYEBROW)).toHaveClass("ou-eyebrow");
    expect(screen.getByText(ISSUES_SUBLINE)).toHaveClass("issues__sub");
  });

  it("mounts as the pane's main landmark, with exactly one h1", () => {
    render(screenFor());

    expect(screen.getByRole("main")).toHaveClass("issues");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("offers an administrator both of the mockup's actions, in its order", () => {
    const { container } = render(screenFor());

    expect(
      within(actions(container))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([REESTIMATE_LABEL, queueLabel(0)]);
  });

  it("starts with nothing selected, so the queue button is inert and says what it waits for", () => {
    render(screenFor());

    const queue = screen.getByRole("button", { name: queueLabel(0) });

    expect(queue).toHaveAttribute("aria-disabled", "true");
    expect(queue).toHaveAttribute("title", QUEUE_NOTHING_SELECTED);
  });
});

describe("the filter bar", () => {
  it("mounts under the head, inside the main landmark, as a named region", () => {
    const { container } = render(screenFor());

    const bar = screen.getByRole("region", { name: FILTER_BAR_LABEL });
    const head = container.querySelector(".issues__head") as HTMLElement;

    expect(screen.getByRole("main")).toContainElement(bar);
    expect(head.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the address the page was asked for", () => {
    render(
      screenFor({
        filter: { ...DEFAULT_FILTER, repo: HELIOS.id, labels: ["bug"], state: "closed" },
      }),
    );

    expect(screen.getByRole("combobox", { name: REPO_LABEL })).toHaveValue(HELIOS.id);
    expect(screen.getByRole("button", { name: "bug", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "State" })).toHaveValue("closed");
  });
});

describe("the backlog table (#117)", () => {
  it("mounts under the bar, inside the main landmark, drawing the page that was read", () => {
    const { container } = render(screenFor());

    const grid = screen.getByRole("grid", { name: TABLE_CAPTION });
    const bar = screen.getByRole("region", { name: FILTER_BAR_LABEL });

    expect(screen.getByRole("main")).toContainElement(grid);
    expect(bar.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(grid).getAllByRole("row")).toHaveLength(10);
    expect(container.querySelector("[data-swapped]")).toBeNull();
  });

  it("writes the selection the head reads", () => {
    render(screenFor());

    within(screen.getByRole("grid", { name: TABLE_CAPTION }))
      .getByRole("checkbox", { name: "Select #485" })
      .click();

    expect(screen.getByRole("button", { name: queueLabel(1) })).not.toHaveAttribute("aria-disabled");
  });

  it("inerts the freshness tag for a viewer, beside the queue button", () => {
    render(screenFor({ mayAdminister: false, mayContribute: false }));

    expect(screen.getByRole("button", { name: /synced/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the selection bar (#118)", () => {
  /** A row's checkbox, inside the grid. */
  function box(number: number): HTMLElement {
    return within(screen.getByRole("grid", { name: TABLE_CAPTION })).getByRole("checkbox", {
      name: `Select #${number}`,
    });
  }

  it("is not drawn until something is selected", () => {
    const { container } = render(screenFor());

    expect(container.querySelector(".issues-bar")).toBeNull();
  });

  it("mounts under the table with the first tick, summing the rows the table drew, and goes with the last", () => {
    const { container } = render(screenFor());

    box(485).click();
    box(484).click();

    const bar = container.querySelector(".issues-bar") as HTMLElement;
    const grid = screen.getByRole("grid", { name: TABLE_CAPTION });

    expect(screen.getByRole("main")).toContainElement(bar);
    expect(grid.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar).toHaveTextContent("2 issues selected · est. 1h 35m combined autonomous work");
    expect(within(bar).getByRole("button", { name: "Queue → standard-fix" })).toBeInTheDocument();

    box(485).click();
    box(484).click();

    expect(container.querySelector(".issues-bar")).toBeNull();
  });

  it("inerts a viewer's action for the role, as the head's is", () => {
    render(screenFor({ mayAdminister: false, mayContribute: false }));

    box(485).click();

    expect(screen.getByRole("button", { name: /^Queue → / })).toHaveAttribute("title", QUEUE_ROLE_REASON);
  });
});

describe("the detail panel (#119)", () => {
  /** A body row, by its issue number. */
  function row(number: number): HTMLElement {
    const grid = screen.getByRole("grid", { name: TABLE_CAPTION });
    const found = within(grid)
      .getAllByRole("row")
      .find((candidate) => candidate.dataset.rowKey === issueId(number));
    if (found === undefined) throw new Error(`no row for #${number}`);
    return found;
  }

  it("holds its seat beside the table, in the grid's other column, with nothing open", () => {
    const { container } = render(screenFor());

    const panel = screen.getByRole("region", { name: PANEL_TITLE });
    const grid = container.querySelector(".issues__grid") as HTMLElement;

    expect(grid).toContainElement(panel);
    expect(grid).toContainElement(screen.getByRole("grid", { name: TABLE_CAPTION }));
    expect(panel.closest(".issues__aside")).not.toBeNull();
    expect(screen.getByRole("grid", { name: TABLE_CAPTION }).closest(".issues__main")).not.toBeNull();
    expect(within(panel).getByText(NO_ISSUE_OPEN)).toBeInTheDocument();
  });

  it("opens from a row's Enter, drawing the row's own facts before the detail lands, and is reachable after it", () => {
    render(screenFor());

    fireEvent.keyDown(row(485), { key: "Enter" });

    const panel = screen.getByRole("region", { name: PANEL_TITLE });

    expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent("Watchdog reset on I²C bus lockup");
    expect(within(panel).getByText("#485")).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent(READING_ISSUE);
    expect(row(485)).toHaveClass("issues-table__row--inspected");

    // The panel follows the table in the document, so Tab from the row reaches it; its one control
    // before the detail lands is the close, which returns the seat to its empty state.
    expect(row(485).compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: CLOSE_PANEL_LABEL }));

    expect(within(panel).getByText(NO_ISSUE_OPEN)).toBeInTheDocument();
    expect(row(485)).not.toHaveClass("issues-table__row--inspected");
  });
});

describe("the roles", () => {
  it("draws no Re-estimate all for a reader who may not administer, rather than a dead one", () => {
    const { container } = render(screenFor({ mayAdminister: false }));

    expect(screen.queryByRole("button", { name: REESTIMATE_LABEL })).toBeNull();
    expect(within(actions(container)).getAllByRole("button")).toHaveLength(1);
  });

  it("draws a viewer's queue button inert for the role", () => {
    render(screenFor({ mayAdminister: false, mayContribute: false }));

    expect(screen.getByRole("button", { name: queueLabel(0) })).toHaveAttribute(
      "title",
      QUEUE_ROLE_REASON,
    );
  });
});

describe("a backlog that could not be counted", () => {
  it("says so, with the service's reason, and draws no figure in its place", () => {
    render(screenFor({ readings: issuesReadings({ counts: UNCOUNTED }) }));

    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading).toHaveTextContent(COUNTS_UNREAD);
    expect(heading.textContent).not.toMatch(/\d/);
    expect(screen.getByRole("status")).toHaveTextContent(UNCOUNTED_REASON);
  });

  it("keeps the subline, which is about the product rather than the read", () => {
    render(screenFor({ readings: issuesReadings({ counts: UNCOUNTED }) }));

    expect(screen.getByText(ISSUES_SUBLINE)).toBeInTheDocument();
  });

  it("offers no re-estimate it could not state the scope of", () => {
    render(screenFor({ readings: issuesReadings({ counts: UNCOUNTED }) }));

    expect(screen.getByRole("button", { name: REESTIMATE_LABEL })).toHaveAttribute(
      "title",
      REESTIMATE_UNCOUNTED,
    );
  });

  it("draws no reason line when the read succeeded", () => {
    const { container } = render(screenFor());

    expect(container.querySelector(".issues__unread")).toBeNull();
  });
});

describe("both palettes", () => {
  it("render the same markup, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(screenFor());

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
