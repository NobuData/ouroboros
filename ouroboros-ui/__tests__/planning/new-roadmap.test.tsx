import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CREATE_CANCEL,
  CREATE_READ_ONLY,
  CREATE_SUBMIT,
  CREATE_TITLE,
  CREATING,
  END_MONTH_LABEL,
  EPIC_NAME_LABEL,
  EXISTING_ROADMAP_NOTE,
  NEEDS_EPIC_NAME,
  NEEDS_RANGE,
  NEEDS_ROADMAP_NAME,
  RANGE_BACKWARDS,
  ROADMAP_NAME_LABEL,
  ROADMAP_WINDOW_LABEL,
  START_MONTH_LABEL,
} from "@/app/planning/create";
import type { CreateRoadmapOutcome } from "@/app/planning/create-actions";
import { NEW_ROADMAP_LABEL, NEW_ROADMAP_ROLE_REASON } from "@/app/planning/view";

import { seededRoadmap } from "../helpers/planning";

/**
 * **New roadmap** and its dialog as they are drawn (#283): the head action opens the dialog, it
 * names a roadmap and creates its first epic in one request, a member sees it inert with the reason,
 * and the page re-reads on success so the roadmap region shows what was made.
 *
 * The Server Action is mocked, not the API: `create-actions.test.ts` is that module's suite and
 * `create.test.ts` proves the judgements; this proves what reaches the DOM and what leaves it.
 */

/** What the action answers, per case. */
const createRoadmap = vi.fn<(body: unknown) => Promise<CreateRoadmapOutcome>>();

/** What re-reads the page after a create. */
const refresh = vi.fn();

vi.mock("@/app/planning/create-actions", () => ({
  createRoadmap: (body: unknown) => createRoadmap(body),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { NewRoadmap } = await import("@/app/planning/new-roadmap");

beforeEach(() => {
  createRoadmap.mockReset().mockResolvedValue({ ok: true, epicId: "epic-1", roadmapName: "Helios 3.0" });
  refresh.mockReset();
});

/**
 * Render the action and open its dialog.
 *
 * @param roadmap The roadmap the page read. Defaults to none.
 */
function open(roadmap: Parameters<typeof NewRoadmap>[0]["roadmap"] = null): void {
  render(<NewRoadmap mayAdminister roadmap={roadmap} />);

  fireEvent.click(screen.getByRole("button", { name: NEW_ROADMAP_LABEL }));
}

/**
 * Type into one box.
 *
 * @param label The box's label.
 * @param value What to type.
 */
function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The dialog's primary control. */
function submit(): HTMLElement {
  return screen.getByRole("button", { name: CREATE_SUBMIT });
}

describe("the head action", () => {
  it("opens the dialog for an owner or an admin", () => {
    open();

    expect(screen.getByRole("dialog")).toHaveAccessibleName(CREATE_TITLE);
  });

  it("is the page's primary action", () => {
    render(<NewRoadmap mayAdminister roadmap={null} />);

    expect(screen.getByRole("button", { name: NEW_ROADMAP_LABEL })).toHaveClass("ou-btn--primary");
  });

  it("is inert for anyone else, with the reason, and opens nothing", () => {
    render(<NewRoadmap mayAdminister={false} roadmap={null} />);

    const action = screen.getByRole("button", { name: NEW_ROADMAP_LABEL });

    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAttribute("title", NEW_ROADMAP_ROLE_REASON);

    fireEvent.click(action);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on a clean form every time", () => {
    open();
    type(EPIC_NAME_LABEL, "Half typed");
    fireEvent.click(screen.getByRole("button", { name: CREATE_CANCEL }));
    fireEvent.click(screen.getByRole("button", { name: NEW_ROADMAP_LABEL }));

    expect(screen.getByLabelText(EPIC_NAME_LABEL)).toHaveValue("");
  });
});

describe("the form", () => {
  it("asks for the roadmap's name, its window, its first epic and that epic's months", () => {
    open();

    for (const label of [ROADMAP_NAME_LABEL, ROADMAP_WINDOW_LABEL, EPIC_NAME_LABEL, START_MONTH_LABEL, END_MONTH_LABEL]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(START_MONTH_LABEL)).toHaveAttribute("type", "month");
    expect(screen.getByLabelText(END_MONTH_LABEL)).toHaveAttribute("type", "month");
  });

  it("opens empty for a workspace with no roadmap, without the existing-roadmap note", () => {
    open();

    expect(screen.getByLabelText(ROADMAP_NAME_LABEL)).toHaveValue("");
    expect(screen.queryByText(EXISTING_ROADMAP_NOTE)).toBeNull();
  });

  it("opens on the roadmap in force when there is one, and says why", () => {
    open(seededRoadmap());

    expect(screen.getByLabelText(ROADMAP_NAME_LABEL)).toHaveValue("Helios 2.1");
    expect(screen.getByLabelText(ROADMAP_WINDOW_LABEL)).toHaveValue("Q3–Q4 2026");
    expect(screen.getByText(EXISTING_ROADMAP_NOTE)).toBeInTheDocument();
  });

  it("holds the submit until the roadmap and its first epic are named", () => {
    open();

    expect(submit()).toHaveAttribute("title", NEEDS_ROADMAP_NAME);

    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    expect(submit()).toHaveAttribute("title", NEEDS_EPIC_NAME);

    type(EPIC_NAME_LABEL, "Secure boot");
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });

  it("holds the submit on a backwards range and says so under the months", () => {
    open();
    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    type(EPIC_NAME_LABEL, "Secure boot");
    type(START_MONTH_LABEL, "2027-03");
    type(END_MONTH_LABEL, "2027-01");

    expect(submit()).toHaveAttribute("title", NEEDS_RANGE);
    expect(screen.getByText(RANGE_BACKWARDS)).toBeInTheDocument();

    fireEvent.click(submit());

    expect(createRoadmap).not.toHaveBeenCalled();
  });
});

describe("creating", () => {
  it("names the roadmap by creating its first epic, in one request, then re-reads the page", async () => {
    open();
    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    type(ROADMAP_WINDOW_LABEL, "Q1 2027");
    type(EPIC_NAME_LABEL, "Secure boot");
    type(START_MONTH_LABEL, "2027-01");
    type(END_MONTH_LABEL, "2027-03");

    fireEvent.click(submit());

    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });

    expect(createRoadmap).toHaveBeenCalledExactlyOnceWith({
      name: "Secure boot",
      roadmapName: "Helios 3.0",
      roadmapWindow: "Q1 2027",
      startMonth: "2027-01",
      endMonth: "2027-03",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("creates an unscoped first epic when no months are given", async () => {
    open();
    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    type(EPIC_NAME_LABEL, "Secure boot");

    fireEvent.click(submit());

    await waitFor(() => { expect(createRoadmap).toHaveBeenCalledOnce(); });

    expect(createRoadmap.mock.calls[0]?.[0]).toMatchObject({ startMonth: null, endMonth: null, status: "unscoped" });
  });

  it("says the write is in flight while it is", async () => {
    let answer: (outcome: CreateRoadmapOutcome) => void = () => {};
    createRoadmap.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    open();
    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    type(EPIC_NAME_LABEL, "Secure boot");
    fireEvent.click(submit());

    expect(await screen.findByText(CREATING, { selector: "p" })).toBeInTheDocument();

    answer({ ok: true, epicId: "epic-1", roadmapName: "Helios 3.0" });

    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
  });

  it("keeps the dialog open on a refusal, with every value, and re-reads nothing", async () => {
    createRoadmap.mockResolvedValue({
      ok: false,
      refusal: { code: "forbidden", message: "Owners and admins only.", details: {} },
    });

    open();
    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    type(EPIC_NAME_LABEL, "Secure boot");
    fireEvent.click(submit());

    expect(await screen.findByText(CREATE_READ_ONLY)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(EPIC_NAME_LABEL)).toHaveValue("Secure boot");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts a range the service refused under the months", async () => {
    createRoadmap.mockResolvedValue({
      ok: false,
      refusal: { code: "epic_month_range_invalid", message: "backwards", details: {} },
    });

    open();
    type(ROADMAP_NAME_LABEL, "Helios 3.0");
    type(EPIC_NAME_LABEL, "Secure boot");
    type(START_MONTH_LABEL, "2027-01");
    type(END_MONTH_LABEL, "2027-03");
    fireEvent.click(submit());

    expect(await screen.findByText(RANGE_BACKWARDS)).toBeInTheDocument();
    expect(screen.getByLabelText(END_MONTH_LABEL)).toHaveAttribute("aria-invalid", "true");
  });
});
