import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStepper } from "@/app/runs/run-stepper";
import { NO_STAGES, STEPPER_LABEL, STEPPER_TITLE, type StepperView, runStepper } from "@/app/runs/stepper";

import { SEEDED_NOTE, runConsole, seededStages, timelineStage } from "../helpers/runs";

/**
 * The stage timeline, rendered (#311): mockup parity, the note as stored, the failed-terminal
 * treatment, the filter's buttons in order, the pulse only while live, a poll that moves a node
 * in place, and the wrapper — not the pane — scrolled to the active node.
 */

/**
 * Draw the stepper.
 *
 * @param view The stepper.
 * @param selected The filter.
 * @returns The render result and the select spy.
 */
function draw(view: StepperView = runStepper(runConsole()), selected: string | null = null) {
  const onSelect = vi.fn();
  const result = render(<RunStepper onSelect={onSelect} selected={selected} view={view} />);
  return { ...result, onSelect };
}

/** The strip's steps. */
function steps(): HTMLElement[] {
  return within(screen.getByRole("list", { name: STEPPER_LABEL })).getAllByRole("listitem");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the seeded stepper", () => {
  it("is a card named Stage timeline, tagged with the pinned workflow", () => {
    draw();

    const card = screen.getByRole("region", { name: STEPPER_TITLE });
    expect(card).toHaveTextContent("workflow: standard-fix v14");
  });

  it("matches the mockup node for node", () => {
    draw();

    expect(steps().map((step) => step.className)).toEqual([
      "run-step run-step--done",
      "run-step run-step--done",
      "run-step run-step--done",
      "run-step run-step--active",
      "run-step run-step--pending",
      "run-step run-step--pending",
      "run-step run-step--pending",
      "run-step run-step--pending",
    ]);
    expect(steps().map((step) => step.querySelector(".run-step__button")?.textContent)).toEqual([
      "✓Queued0m 04s",
      "✓Analyze1m 12s",
      "✓Plan2m 05s",
      "●Implementattempt 2/3",
      "○Build",
      "○Test",
      "○Review",
      "○Open PR",
    ]);
  });

  it("glows the segments up to the active node, and none past it", () => {
    draw();

    const segments = steps().map((step) => step.querySelector(".run-step__seg")?.className ?? null);
    expect(segments).toEqual([
      null,
      "run-step__seg run-step__seg--done",
      "run-step__seg run-step__seg--done",
      "run-step__seg run-step__seg--done",
      "run-step__seg",
      "run-step__seg",
      "run-step__seg",
      "run-step__seg",
    ]);
    for (const segment of document.querySelectorAll(".run-step__seg")) {
      expect(segment).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("names every node for a screen reader, the glyph left out", () => {
    draw();

    expect(screen.getByRole("button", { name: "Implement, in progress, attempt 2/3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queued, done, 0m 04s" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open PR, pending" })).toBeInTheDocument();
  });

  it("says so when there are no stages yet", () => {
    draw(runStepper(runConsole({ stages: [] })));

    expect(screen.getByText(NO_STAGES)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: STEPPER_LABEL })).toBeNull();
  });
});

describe("the warn note", () => {
  it("renders beneath its node exactly as stored", () => {
    draw();

    const notes = document.querySelectorAll(".run-step__note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe(SEEDED_NOTE);
    expect(steps()[3]).toContainElement(notes[0] as HTMLElement);
  });

  it("composes no note of its own — a second attempt without a stored note shows none", () => {
    const stages = seededStages().map((stage) => ({ ...stage, note: null }));
    draw(runStepper(runConsole({ stages })));

    expect(document.querySelector(".run-step__note")).toBeNull();
    expect(screen.getByRole("list", { name: STEPPER_LABEL })).not.toHaveTextContent(/returned|failed tests|gate/);
  });

  it("prints a long note whole — nothing is cut to fit", () => {
    const note = "attempt 1 failed tests — ".repeat(12) + "loop returned from gate ↺";
    const stages = [timelineStage("implement", "Implement", 1, { status: "active", attempt: 2, maxAttempts: 3, note })];
    draw(runStepper(runConsole({ stages })));

    expect(document.querySelector(".run-step__note")!.textContent).toBe(note);
  });
});

describe("a run that died", () => {
  it("draws the aborted stage failed and stops pulsing", () => {
    draw(runStepper(runConsole({ run: { status: "canceled" }, head: { live: false } })));

    expect(steps()[3]).toHaveClass("run-step--failed");
    expect(steps()[3]).toHaveTextContent("✕Implementcanceled");
    expect(screen.getByRole("list", { name: STEPPER_LABEL })).not.toHaveClass("run-stepper--live");
  });

  it("pulses only while the run is live", () => {
    draw();

    expect(screen.getByRole("list", { name: STEPPER_LABEL })).toHaveClass("run-stepper--live");
  });
});

describe("the filter", () => {
  it("filters to a node when pressed, and clears when the pressed node is pressed again", () => {
    const { onSelect, rerender } = draw();

    fireEvent.click(screen.getByRole("button", { name: /^Implement/ }));
    expect(onSelect).toHaveBeenLastCalledWith("implement");

    rerender(<RunStepper onSelect={onSelect} selected="implement" view={runStepper(runConsole())} />);
    const implement = screen.getByRole("button", { name: /^Implement/ });
    expect(implement).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Plan/ })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(implement);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("puts the steps in the tab order in the pinned order", () => {
    draw();

    const buttons = within(screen.getByRole("list", { name: STEPPER_LABEL })).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Queued",
      "Analyze",
      "Plan",
      "Implement",
      "Build",
      "Test",
      "Review",
      "Open PR",
    ]);
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("tabindex");
    }
  });
});

describe("a poll that moves the run on", () => {
  it("changes the same node in place, so its treatment can cross-fade", () => {
    const { onSelect, rerender } = draw();
    const before = steps()[4]!;

    const stages = seededStages().map((stage) =>
      stage.stageKey === "implement"
        ? { ...stage, status: "succeeded" as const, durationSeconds: 300, note: null }
        : stage.stageKey === "build"
          ? { ...stage, status: "active" as const }
          : stage,
    );
    rerender(<RunStepper onSelect={onSelect} selected={null} view={runStepper(runConsole({ stages }))} />);

    const after = steps()[4]!;
    expect(after).toBe(before);
    expect(after).toHaveClass("run-step--active");
    expect(steps()[3]).toHaveClass("run-step--done");
    expect(after.querySelector(".run-step__seg")).toHaveClass("run-step__seg--done");
  });
});

describe("the narrow viewport", () => {
  it("scrolls its own wrapper to centre the active node on first paint", () => {
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("run-step--active") ? 600 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    const original = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      draw();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }

    const wrapper = document.querySelector(".run-timeline__scroll") as HTMLElement;
    expect(wrapper.scrollLeft).toBe(500);
    // The pane is never asked to move.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
