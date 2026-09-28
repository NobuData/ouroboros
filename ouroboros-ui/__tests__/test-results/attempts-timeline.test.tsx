import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommitSource } from "@/app/runs/cards";
import { AttemptsTimeline } from "@/app/test-results/attempts-timeline";
import {
  NEXT_LABEL,
  PR_PLANE_NOTE,
  TIMELINE_LIST_LABEL,
  TIMELINE_TITLE,
  timelineView,
} from "@/app/test-results/timeline";
import type { TestRunTimeline } from "@/app/api/test-results";

import { attempt, mockupAttempts, timeline } from "../helpers/test-results";

/**
 * The build attempts timeline (#336), rendered: the seeded strip against mockup 11, the *Next*
 * card's honest variant, shas linked or plain by source, selection by click and keyboard, and the
 * strip scrolling inside its own wrapper to the attempt on screen.
 */

const GITHUB: CommitSource = { kind: "github", owner: "acme-robotics", name: "helios-firmware" };

/**
 * Draw the timeline.
 *
 * @param options The timeline, the selected ordinal and the commit source.
 * @returns The render result and the selection spy.
 */
function draw(
  options: { of?: TestRunTimeline; selected?: number; source?: CommitSource | null } = {},
) {
  const onSelect = vi.fn<(attemptSeq: number) => void>();
  const of = options.of ?? timeline({ attempts: mockupAttempts() });
  const source = options.source === undefined ? GITHUB : options.source;
  const result = render(
    <AttemptsTimeline onSelect={onSelect} view={timelineView(of, options.selected ?? 3, source)} />,
  );

  return { ...result, onSelect };
}

/** The strip's cards, in order. */
function cards(): HTMLElement[] {
  return within(screen.getByRole("list", { name: TIMELINE_LIST_LABEL })).getAllByRole("listitem");
}

/**
 * Give an element the layout jsdom does not compute.
 *
 * @param element The element.
 * @param box Its measurements — or a method it lacks.
 */
function measure(element: Element, box: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(box)) {
    Object.defineProperty(element, name, { configurable: true, value, writable: true });
  }
}

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("the seeded strip (mockup 11)", () => {
  it("draws three attempt cards and the dashed future card, each with its hue", () => {
    draw();

    expect(cards().map((card) => card.textContent)).toEqual([
      "Build 1 49/63 · 14 failed ✗13:52:41 · a3f19c2",
      "Build 2 61/63 · 2 failed14:21:07 · c81d4e7",
      "Build 3 running re-run of failed set14:38:19 · f42b9a0",
      "NextPublish to PR #514 when greenauto · gated on 63/63",
    ]);
    expect(cards().map((card) => card.className)).toEqual([
      "tests-timeline__card tests-timeline__card--err",
      "tests-timeline__card tests-timeline__card--warn",
      "tests-timeline__card tests-timeline__card--live",
      "tests-timeline__card tests-timeline__card--future",
    ]);
  });

  it("is a region named by its title, carrying the branch and the loop", () => {
    draw();

    const card = screen.getByRole("region", { name: TIMELINE_TITLE });
    expect(within(card).getByText("branch loop/482-canbus-flake")).toHaveClass("ou-tag");
    expect(within(card).getByText("loop #1847 · started 13:50 UTC")).toBeInTheDocument();
  });

  it("draws the pulse on the live card alone, hidden from the accessibility tree", () => {
    draw();

    const dots = document.querySelectorAll(".tests-timeline__pulse");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("aria-hidden", "true");
    expect(cards()[2]).toContainElement(dots[0] as HTMLElement);
    // The words carry the state; the movement carries none of it.
    expect(cards()[2]).toHaveTextContent("running re-run of failed set");
  });

  it("stamps each card's time with the moment it stands for", () => {
    draw();

    expect(screen.getByText("13:52:41")).toHaveAttribute("datetime", "2026-09-19T13:52:41.000Z");
  });
});

describe("the future card (T8)", () => {
  it("renders the honest variant, with its activation note, while no PR gate exists", () => {
    draw({ of: timeline({ next: { ...timeline().next, pullRequest: null, activation: "none", gate: null } }) });

    const next = cards().at(-1)!;
    expect(next).toHaveAttribute("data-variant", "honest");
    expect(next).toHaveClass("tests-timeline__card--future");
    expect(within(next).getByText(NEXT_LABEL)).toBeInTheDocument();
    expect(within(next).getByText("auto · gated on 63/63")).toBeInTheDocument();
    expect(within(next).getByText(PR_PLANE_NOTE)).toBeInTheDocument();
    expect(next).not.toHaveTextContent(/PR #\d+/);
  });

  it("renders the activated variant when a pull request is linked and its gate is armed", () => {
    draw();

    const next = cards().at(-1)!;
    expect(next).toHaveAttribute("data-variant", "activated");
    expect(next).toHaveTextContent("Publish to PR #514 when green");
    expect(next).not.toHaveTextContent(PR_PLANE_NOTE);
  });

  it("selects nothing — it has not happened", () => {
    draw();

    expect(within(cards().at(-1)!).queryByRole("button")).toBeNull();
  });
});

describe("commit shas", () => {
  it("link to the commit on GitHub, in a new tab", () => {
    draw();

    const link = screen.getByRole("link", { name: "a3f19c2" });
    expect(link).toHaveAttribute("href", "https://github.com/acme-robotics/helios-firmware/commit/a3f19c2");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("link correctly for a non-GitHub source", () => {
    draw({ source: { kind: "gitlab", path: "acme/firmware/helios", baseUrl: "https://git.acme.dev" } });

    expect(screen.getByRole("link", { name: "c81d4e7" })).toHaveAttribute(
      "href",
      "https://git.acme.dev/acme/firmware/helios/-/commit/c81d4e7",
    );
  });

  it("render unlinked when the source cannot produce a commit URL", () => {
    draw({ source: null });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("a3f19c2").tagName).toBe("SPAN");
  });

  it("are left out for an attempt that names no commit", () => {
    draw({ of: timeline({ attempts: [attempt(1, { commitSha: null })] }), selected: 1 });

    expect(cards()[0]).toHaveTextContent(/14:38:19$/);
  });

  it("are not inside the card's button, so both are reachable", () => {
    draw();

    expect(screen.getByRole("link", { name: "a3f19c2" }).closest("button")).toBeNull();
  });
});

describe("selecting an attempt", () => {
  it("marks the attempt the page reads as pressed, and no other", () => {
    draw({ selected: 2 });

    const pressed = screen.getAllByRole("button").map((button) => button.getAttribute("aria-pressed"));
    expect(pressed).toEqual(["false", "true", "false"]);
  });

  it("asks for the attempt a card names when it is clicked", () => {
    const { onSelect } = draw();

    fireEvent.click(screen.getByRole("button", { name: /^Build 1/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("is a button a keyboard reaches, named by its label and result", () => {
    draw();

    const button = screen.getByRole("button", { name: "Build 2 61/63 · 2 failed" });
    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("type", "button");
  });
});

describe("scrolling", () => {
  it("brings the current attempt into view by scrolling the strip's own wrapper, never the pane", () => {
    // jsdom has no scrollIntoView; were the component to call one, this is what it would reach.
    const scrolled = vi.fn();
    measure(Element.prototype, { scrollIntoView: scrolled });
    const view = timelineView(timeline({ attempts: mockupAttempts() }), 1, GITHUB);
    const { rerender } = render(<AttemptsTimeline onSelect={() => {}} view={view} />);

    const wrapper = document.querySelector(".tests-timeline__scroll")!;
    measure(wrapper, { clientWidth: 320, scrollLeft: 0 });
    cards().forEach((card, index) => measure(card, { offsetLeft: index * 240, offsetWidth: 220 }));

    rerender(
      <AttemptsTimeline
        onSelect={() => {}}
        view={timelineView(timeline({ attempts: mockupAttempts() }), 3, GITHUB)}
      />,
    );

    // Build 3 spans 480–700; a 320-wide view shows it whole from 380.
    expect(wrapper.scrollLeft).toBe(380);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("leaves the strip where the reader put it when the attempt is already in view", () => {
    const view = timelineView(timeline({ attempts: mockupAttempts() }), 1, GITHUB);
    const { rerender } = render(<AttemptsTimeline onSelect={() => {}} view={view} />);

    const wrapper = document.querySelector(".tests-timeline__scroll")!;
    measure(wrapper, { clientWidth: 1200, scrollLeft: 12 });
    cards().forEach((card, index) => measure(card, { offsetLeft: index * 240, offsetWidth: 220 }));

    rerender(
      <AttemptsTimeline
        onSelect={() => {}}
        view={timelineView(timeline({ attempts: mockupAttempts() }), 2, GITHUB)}
      />,
    );

    expect(wrapper.scrollLeft).toBe(12);
  });
});
