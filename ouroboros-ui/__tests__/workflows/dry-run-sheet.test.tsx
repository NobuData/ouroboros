import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { stageEntry } from "@/app/workflows/canvas/graph";
import { DryRunSheet } from "@/app/workflows/dry-run-sheet";
import { CLEARS_NOTE, CLOSE_DRY_RUN, DRY_RUN_FINDINGS_MESSAGE, STEPS_LABEL } from "@/app/workflows/dry-run";
import { FINDINGS_LABEL } from "@/app/workflows/publish";

import {
  ASSUMED_EXPLANATION,
  NOT_TAKEN_EXPLANATION,
  TAKEN_EXPLANATION,
  dryRunWalk,
} from "../helpers/dry-run";
import { standardFixDefinition } from "../helpers/workflows";

/**
 * The dry run's side sheet (#152). The criterion it exists for: **the step side-sheet explains both branches
 * of each decision and states loop retry bounds** — every edge out of a stage is a row, taken or not, with the
 * engine's own explanation, and a loop row says how many times it may repeat.
 */

/** Render the sheet over the seeded walk. */
function open(result = dryRunWalk()) {
  const onClose = vi.fn();
  const onFocus = vi.fn();
  const onSelect = vi.fn();
  const view = render(
    <DryRunSheet onClose={onClose} onFocus={onFocus} onSelect={onSelect} result={result} walked={standardFixDefinition()} />,
  );

  return { ...view, onClose, onFocus, onSelect };
}

describe("the walk", () => {
  it("is titled for the ticket, with the facts it tested", () => {
    open();

    const sheet = screen.getByRole("complementary", { name: "Dry run with issue #485" });
    expect(sheet).toHaveTextContent("effort M · labels bug, i2c · GitHub");
    expect(sheet).toHaveTextContent(CLEARS_NOTE);
  });

  it("lists every stage it reached, in order, with its verdict", () => {
    open();

    const steps = within(screen.getByRole("list", { name: STEPS_LABEL })).getAllByRole("listitem").filter(
      (item) => item.classList.contains("studio-dryrun__step"),
    );

    expect(steps.map((step) => within(step).getAllByRole("button")[0].textContent)).toEqual([
      "Issue queued",
      "Effort re-check",
      "Checks green?",
    ]);
    expect(steps[0]).toHaveTextContent("Trigger fires");
    expect(steps[1]).toHaveTextContent("Reached");
  });

  it("explains both branches of the decision — the road taken and the road not", () => {
    const { container } = open();
    const plan = stageEntry(standardFixDefinition(), "plan")?.title ?? "plan";
    const split = stageEntry(standardFixDefinition(), "split")?.title ?? "split";

    const taken = container.querySelector(".studio-dryrun__edge--taken:has(+ .studio-dryrun__edge--skipped)");
    const skipped = container.querySelector(".studio-dryrun__edge--skipped");

    expect(taken).toHaveTextContent(`Taken → ${plan} (≤ M ↓)`);
    expect(taken).toHaveTextContent(TAKEN_EXPLANATION);
    expect(skipped).toHaveTextContent(`Not taken → ${split} (> M ↘)`);
    expect(skipped).toHaveTextContent(NOT_TAKEN_EXPLANATION);
  });

  it("states the loop's retry bound, and marks the predicate the simulator could only assume", () => {
    const { container } = open();

    const loop = container.querySelector(".studio-dryrun__edge--loop");
    expect(loop).toHaveTextContent("Loop");
    expect(loop).toHaveTextContent(/at most 2 times/);

    expect(screen.getByText(ASSUMED_EXPLANATION, { exact: false })).toHaveTextContent(/assumed/);
    // Only the gate is assumed: the trigger and the decision read the ticket.
    expect(container.querySelectorAll(".studio-dryrun__assumed")).toHaveLength(1);
  });

  it("selects a step's stage without closing, and closes when asked", () => {
    const { onFocus, onClose, onSelect } = open();

    fireEvent.click(screen.getByRole("button", { name: "Effort re-check" }));
    expect(onFocus).toHaveBeenCalledExactlyOnceWith("effort-recheck");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: CLOSE_DRY_RUN }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("a draft that does not validate", () => {
  it("lists the findings instead of a walk, and a finding goes to its stage", () => {
    const { onSelect } = open({
      ...dryRunWalk(),
      steps: [],
      highlightPath: [],
      findings: [{ source: "engine", code: "unreachable_node", message: "Nothing reaches this stage.", node: "implement" }],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(DRY_RUN_FINDINGS_MESSAGE);
    expect(screen.queryByRole("list", { name: STEPS_LABEL })).toBeNull();

    fireEvent.click(within(screen.getByRole("list", { name: FINDINGS_LABEL })).getByRole("button"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("implement");
  });
});
