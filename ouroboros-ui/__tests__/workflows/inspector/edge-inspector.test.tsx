import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { readConnections, readStages } from "@/app/workflows/canvas/graph";
import { RULE_REASONS, insertMenuLabel } from "@/app/workflows/canvas/view";
import { EdgeInspector, type EdgeInspectorProps } from "@/app/workflows/inspector/edge-inspector";
import {
  CLEAN_REASON,
  CONDITION_UNREAD,
  DEFAULT_EDGE_NOTE,
  DIRTY_NOTE,
  EDGE_KIND_WORDS,
  INVALID_REASON,
  MEMBER_REASON,
  NO_CONDITION,
} from "@/app/workflows/inspector/inspector";

import { inspectorReadings, stageCatalog, standardFixDefinition } from "../../helpers/workflows";

/**
 * One edge's panel (#151) — the ticket's **edge kind and label editing, including branch conditions in
 * the P8 structured shape**, over the seeded `standard-fix`: what it opens with, the rule each illegal
 * draft breaks said at its field, Apply, Delete edge, and Insert stage.
 */

/**
 * Open the panel on one seeded edge.
 *
 * @param from The edge's source.
 * @param to Its target.
 * @param over What this case changes.
 * @returns The three callbacks.
 */
function open(from: string, to: string, over: Partial<EdgeInspectorProps> = {}) {
  const definition: WorkflowDefinition = over.definition ?? standardFixDefinition();
  const connection = readConnections(definition, readStages(definition)).find((edge) => edge.from === from && edge.to === to);
  if (connection === undefined) throw new Error(`no edge ${from}→${to}`);

  const handlers = { onApplyEdge: vi.fn(), onDeleteEdge: vi.fn(), onInsert: vi.fn() };
  render(
    <EdgeInspector
      connection={connection}
      definition={definition}
      mayAdminister
      readings={inspectorReadings()}
      {...handlers}
      {...over}
    />,
  );

  return handlers;
}

/** A labelled control. */
function control(role: "combobox" | "textbox", name: string): HTMLElement {
  return screen.getByRole(role, { name });
}

/** The Apply button. */
function applyButton(): HTMLElement {
  return screen.getByRole("button", { name: "Apply" });
}

describe("what the panel opens with", () => {
  it("heads the panel with the edge's type line and its two stages' titles", () => {
    open("checks-green", "implement");

    expect(screen.getByText("Edge").closest(".studio-inspector__type")).toHaveTextContent("→ Edge");
    expect(screen.getByRole("heading", { level: 2, name: "Checks green? → Code the change" })).toBeInTheDocument();
  });

  it("opens the seeded loop on its kind, its label and its condition — which a loop may leave out", () => {
    open("checks-green", "implement");

    expect(control("combobox", "Kind")).toHaveValue("loop");
    expect(control("textbox", "Label")).toHaveValue("fail ↺");
    expect(control("combobox", "Tests")).toHaveValue("checks");
    expect(control("combobox", "Operator")).toHaveValue("any_failed");
    expect(within(control("combobox", "Tests")).getByRole("option", { name: NO_CONDITION })).toBeInTheDocument();
    expect(applyButton()).toHaveAttribute("title", CLEAN_REASON);
  });

  it("says a default edge has no condition, and offers the three kinds in the DSL's words", () => {
    open("plan", "implement");

    expect(screen.getByText(DEFAULT_EDGE_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Tests" })).toBeNull();
    expect(within(control("combobox", "Kind")).getAllByRole("option").map((option) => option.textContent)).toEqual([
      EDGE_KIND_WORDS.default,
      EDGE_KIND_WORDS.branch,
      EDGE_KIND_WORDS.loop,
    ]);
  });
});

describe("an illegal draft is refused at its field, with the rule's reason", () => {
  it("refuses a loop that does not return upstream", () => {
    const { onApplyEdge } = open("analyze", "effort-recheck");

    fireEvent.change(control("combobox", "Kind"), { target: { value: "loop" } });

    expect(screen.getByText(RULE_REASONS["edge.loop_not_upstream"])).toBeInTheDocument();
    expect(applyButton()).toHaveAttribute("title", INVALID_REASON);
    fireEvent.click(applyButton());
    expect(onApplyEdge).not.toHaveBeenCalled();
  });

  it("refuses a branch with no condition, then applies it once the P8 condition is built", () => {
    const { onApplyEdge } = open("plan", "implement");

    fireEvent.change(control("combobox", "Kind"), { target: { value: "branch" } });
    expect(screen.getByText(RULE_REASONS["edge.branch_without_condition"])).toBeInTheDocument();
    expect(applyButton()).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(control("combobox", "Tests"), { target: { value: "effort" } });
    fireEvent.change(control("combobox", "Value"), { target: { value: "m" } });
    fireEvent.change(control("textbox", "Label"), { target: { value: "≤ M" } });
    expect(screen.getByText(DIRTY_NOTE)).toBeInTheDocument();
    fireEvent.click(applyButton());

    // The round trip into the draft and back — and the panel's *applied* note with it — is
    // `studio-editor-editing.test.tsx`'s; here nothing hands the applied edge back.
    expect(onApplyEdge).toHaveBeenCalledExactlyOnceWith(
      { from: "plan", to: "implement" },
      { kind: "branch", label: "≤ M", condition: { kind: "effort", op: "lt", value: "m" } },
    );
  });

  it("clears a loop's condition with No condition, which the DSL allows", () => {
    const { onApplyEdge } = open("checks-green", "implement");

    fireEvent.change(control("combobox", "Tests"), { target: { value: "" } });
    fireEvent.click(applyButton());

    expect(onApplyEdge).toHaveBeenCalledExactlyOnceWith(
      { from: "checks-green", to: "implement" },
      { kind: "loop", label: "fail ↺" },
    );
  });
});

describe("Delete edge and Insert stage", () => {
  it("asks to delete the edge", () => {
    const { onDeleteEdge } = open("checks-green", "implement");

    fireEvent.click(screen.getByRole("button", { name: "Delete edge" }));

    expect(onDeleteEdge).toHaveBeenCalledExactlyOnceWith({ from: "checks-green", to: "implement" });
  });

  it("inserts a stage from the catalog, refusing a terminal and a trigger with their reasons", () => {
    const { onInsert } = open("checks-green", "implement");

    fireEvent.click(screen.getByRole("button", { name: "Insert stage ▾" }));
    const menu = screen.getByRole("menu", { name: insertMenuLabel("Checks green?", "Code the change") });
    const [trigger, model, , , terminal] = within(menu).getAllByRole("menuitem");

    expect(trigger).toHaveTextContent(RULE_REASONS["document.multiple_triggers"]);
    expect(terminal).toHaveAttribute("aria-disabled", "true");
    expect(terminal).toHaveTextContent(RULE_REASONS["edge.out_of_terminal"]);

    fireEvent.click(model);
    expect(onInsert).toHaveBeenCalledExactlyOnceWith({ from: "checks-green", to: "implement" }, stageCatalog().nodeTypes[1]);
  });
});

describe("what the panel cannot do", () => {
  it("is inert, with the reason, for a reader who may not edit", () => {
    open("checks-green", "implement", { mayAdminister: false });

    expect(control("combobox", "Kind")).toBeDisabled();
    for (const name of ["Apply", "Delete edge", "Insert stage ▾"]) {
      expect(screen.getByRole("button", { name }), name).toHaveAttribute("title", MEMBER_REASON);
    }
  });

  it("says a condition has no form without the catalog, and offers no insertion", () => {
    open("checks-green", "implement", {
      readings: inspectorReadings({ catalog: { ok: false, reason: "The service is unavailable." } }),
    });

    expect(screen.getByText(CONDITION_UNREAD)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Insert stage ▾" })).toBeNull();
  });
});
