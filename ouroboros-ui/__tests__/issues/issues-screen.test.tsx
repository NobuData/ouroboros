import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTER, FILTER_BAR_LABEL, REPO_LABEL } from "@/app/issues/filter";
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

import { HELIOS, UNCOUNTED, UNCOUNTED_REASON, issuesReadings } from "../helpers/issues";
import { TENANT_ID } from "../helpers/login";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The intake screen's page head (#115) and the filter bar under it (#116), as a component.
 *
 * The issue's criteria that are visible without a route are all here: the counts are the read's
 * rather than the mockup's, the head carries the mockup's eyebrow, subline and two actions, a
 * backlog that could not be counted says so rather than drawing zeros, the two actions gate by role,
 * the bar mounts under the head drawing what the address asked for, and the markup does not depend
 * on the palette. What each action does when pressed, and what the bar writes, are their own
 * suites'; the actions' server hops are replaced here.
 */

vi.mock("@/app/issues/head-actions", () => ({ queueSelected: vi.fn(), reestimateAll: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

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
