import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import { UNCOUNTED, UNCOUNTED_REASON, issuesReadings } from "../helpers/issues";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The intake screen's page head (#115), as a component.
 *
 * The issue's criteria that are visible without a route are all here: the counts are the read's
 * rather than the mockup's, the head carries the mockup's eyebrow, subline and two actions, a
 * backlog that could not be counted says so rather than drawing zeros, the two actions gate by role,
 * and the markup does not depend on the palette. What each action does when pressed is its own
 * suite's; the actions' server hops are replaced here.
 */

vi.mock("@/app/issues/head-actions", () => ({ queueSelected: vi.fn(), reestimateAll: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { IssuesScreen } = await import("@/app/issues/issues-screen");

/** The head's action column. */
function actions(container: HTMLElement): HTMLElement {
  return container.querySelector(".issues__actions") as HTMLElement;
}

describe("the page head, on seeded data", () => {
  it("counts what the service counted, in the mockup's sentence", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "9 open issues. 7 already sized.",
    );
  });

  it("carries the mockup's eyebrow and subline", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />);

    expect(screen.getByText(ISSUES_EYEBROW)).toHaveClass("ou-eyebrow");
    expect(screen.getByText(ISSUES_SUBLINE)).toHaveClass("issues__sub");
  });

  it("mounts as the pane's main landmark, with exactly one h1", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />);

    expect(screen.getByRole("main")).toHaveClass("issues");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("offers an administrator both of the mockup's actions, in its order", () => {
    const { container } = render(
      <IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />,
    );

    expect(
      within(actions(container))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([REESTIMATE_LABEL, queueLabel(0)]);
  });

  it("starts with nothing selected, so the queue button is inert and says what it waits for", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />);

    const queue = screen.getByRole("button", { name: queueLabel(0) });

    expect(queue).toHaveAttribute("aria-disabled", "true");
    expect(queue).toHaveAttribute("title", QUEUE_NOTHING_SELECTED);
  });
});

describe("the roles", () => {
  it("draws no Re-estimate all for a reader who may not administer, rather than a dead one", () => {
    const { container } = render(
      <IssuesScreen mayAdminister={false} mayContribute readings={issuesReadings()} />,
    );

    expect(screen.queryByRole("button", { name: REESTIMATE_LABEL })).toBeNull();
    expect(within(actions(container)).getAllByRole("button")).toHaveLength(1);
  });

  it("draws a viewer's queue button inert for the role", () => {
    render(
      <IssuesScreen mayAdminister={false} mayContribute={false} readings={issuesReadings()} />,
    );

    expect(screen.getByRole("button", { name: queueLabel(0) })).toHaveAttribute(
      "title",
      QUEUE_ROLE_REASON,
    );
  });
});

describe("a backlog that could not be counted", () => {
  it("says so, with the service's reason, and draws no figure in its place", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings(UNCOUNTED)} />);

    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading).toHaveTextContent(COUNTS_UNREAD);
    expect(heading.textContent).not.toMatch(/\d/);
    expect(screen.getByRole("status")).toHaveTextContent(UNCOUNTED_REASON);
  });

  it("keeps the subline, which is about the product rather than the read", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings(UNCOUNTED)} />);

    expect(screen.getByText(ISSUES_SUBLINE)).toBeInTheDocument();
  });

  it("offers no re-estimate it could not state the scope of", () => {
    render(<IssuesScreen mayAdminister mayContribute readings={issuesReadings(UNCOUNTED)} />);

    expect(screen.getByRole("button", { name: REESTIMATE_LABEL })).toHaveAttribute(
      "title",
      REESTIMATE_UNCOUNTED,
    );
  });

  it("draws no reason line when the read succeeded", () => {
    const { container } = render(
      <IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />,
    );

    expect(container.querySelector(".issues__unread")).toBeNull();
  });
});

describe("both palettes", () => {
  it("render the same markup, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(
      <IssuesScreen mayAdminister mayContribute readings={issuesReadings()} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
