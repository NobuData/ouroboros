import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { readStages } from "@/app/workflows/canvas/graph";
import { DELETE_CANCEL_LABEL, DELETE_CONFIRM_LABEL } from "@/app/workflows/canvas/view";
import { ConfirmDelete } from "@/app/workflows/confirm-delete";

import { standardFixDefinition } from "../helpers/workflows";

/**
 * The delete confirmation (#151): what it names, and its three ways out — Delete, Cancel and Escape.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** The seeded split stage's title. */
const SPLIT = readStages(SEEDED).find((stage) => stage.id === "split")?.title ?? "split";

describe("the confirmation", () => {
  it("names the stage and the edges that go with it, and says Undo brings them back", () => {
    render(<ConfirmDelete definition={SEEDED} deletion={{ stages: ["split"], edges: [] }} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: `Delete ${SPLIT}?` });

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(`Delete ${SPLIT}?`);
    expect(dialog).toHaveTextContent("2 edges connected to it go too. Undo brings them back.");
  });

  it("names an edge by its stages' titles", () => {
    render(
      <ConfirmDelete
        definition={SEEDED}
        deletion={{ stages: [], edges: [{ from: "checks-green", to: "implement" }] }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Delete the edge Checks green? → Code the change?" })).toBeInTheDocument();
  });

  it("deletes on Delete, and keeps everything on Cancel or Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDelete definition={SEEDED} deletion={{ stages: ["split"], edges: [] }} onCancel={onCancel} onConfirm={onConfirm} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: DELETE_CONFIRM_LABEL }));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(within(dialog).getByRole("button", { name: DELETE_CANCEL_LABEL }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("draws nothing while nothing waits to be deleted", () => {
    render(<ConfirmDelete definition={SEEDED} deletion={null} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
