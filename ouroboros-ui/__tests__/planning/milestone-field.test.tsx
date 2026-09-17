import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MILESTONES_LOADING,
  MILESTONES_UNSUPPORTED,
  NEW_MILESTONE_HINT,
  NEW_MILESTONE_LABEL,
  NEW_MILESTONE_OPTION,
  type MilestoneChoice,
} from "@/app/planning/generator";

import { SEEDED_GITHUB_ID } from "../helpers/sources";

/**
 * **Milestone ▾** (#284): the chosen tracker's own milestones, a disabled select saying why for a
 * tracker without them, and the inline create that names a milestone the push will ensure.
 */

const readMilestones = vi.fn();

vi.mock("@/app/planning/generator-actions", () => ({
  readMilestones: (sourceId: string) => readMilestones(sourceId),
}));

const { MilestoneField } = await import("@/app/planning/milestone-field");

/**
 * Render the field.
 *
 * @param value What is chosen.
 * @param sourceId The tracker.
 * @returns The change handler.
 */
function field(value: MilestoneChoice = { mode: "none" }, sourceId: string | null = SEEDED_GITHUB_ID) {
  const onChange = vi.fn();
  const view = render(<MilestoneField id="m" onChange={onChange} sourceId={sourceId} value={value} />);
  return { onChange, ...view };
}

beforeEach(() => {
  readMilestones.mockReset().mockResolvedValue({
    ok: true,
    value: { sourceId: SEEDED_GITHUB_ID, supported: true, milestones: [{ externalRef: "3", name: "Helios 2.1" }] },
  });
});

describe("MilestoneField", () => {
  it("asks the chosen tracker, saying so while it does, and offers what it answered", async () => {
    const { onChange } = field();

    expect(screen.getByText(MILESTONES_LOADING)).toBeInTheDocument();
    expect(readMilestones).toHaveBeenCalledExactlyOnceWith(SEEDED_GITHUB_ID);

    await waitFor(() => { expect(screen.getByLabelText("Milestone")).toBeEnabled(); });
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "m:Helios 2.1" } });

    expect(onChange).toHaveBeenCalledWith({ mode: "existing", name: "Helios 2.1" });
  });

  it("opens an inline create, whose name is created at push", async () => {
    const { onChange, rerender } = field();

    await waitFor(() => { expect(screen.getByLabelText("Milestone")).toBeEnabled(); });
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "__new__" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "new", name: "" });

    rerender(<MilestoneField id="m" onChange={onChange} sourceId={SEEDED_GITHUB_ID} value={{ mode: "new", name: "" }} />);

    expect(screen.getByLabelText("Milestone")).toHaveDisplayValue(NEW_MILESTONE_OPTION);
    const name = screen.getByLabelText(NEW_MILESTONE_LABEL);
    expect(name).toHaveAccessibleDescription(NEW_MILESTONE_HINT);

    fireEvent.change(name, { target: { value: "Helios 2.2" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "new", name: "Helios 2.2" });
  });

  it("disables the select for a tracker without milestones, saying so", async () => {
    readMilestones.mockResolvedValue({ ok: true, value: { sourceId: SEEDED_GITHUB_ID, supported: false, milestones: [] } });

    field();

    await waitFor(() => { expect(screen.getByText(MILESTONES_UNSUPPORTED)).toBeInTheDocument(); });
    expect(screen.getByLabelText("Milestone")).toBeDisabled();
  });

  it("says why the tracker could not be asked", async () => {
    readMilestones.mockResolvedValue({ ok: false, refusal: { code: "x", message: "credentials rejected (401)", details: {} } });

    field();

    expect(await screen.findByText("credentials rejected (401)")).toBeInTheDocument();
    expect(screen.getByLabelText("Milestone")).toBeDisabled();
  });

  it("keeps a batch's milestone the tracker no longer lists, and asks nothing without a tracker", async () => {
    field({ mode: "existing", name: "Helios 2.0" });
    await waitFor(() => { expect(screen.getByLabelText("Milestone")).toHaveDisplayValue("Helios 2.0"); });

    readMilestones.mockClear();
    render(<MilestoneField id="n" onChange={vi.fn()} sourceId={null} value={{ mode: "none" }} />);
    expect(readMilestones).not.toHaveBeenCalled();
  });
});
