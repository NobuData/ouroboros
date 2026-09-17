import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanningEpic } from "@/app/api/planning";
import {
  MIRRORS_NONE,
  NOTHING_CHANGED,
  NOTHING_SAVED,
  READ_ONLY_NOTE,
  SEARCH_DEBOUNCE_MS,
  TICKETS_NONE,
  TICKETS_UNREAD,
} from "@/app/planning/epic-draft";
import { READ_ONLY_STEP_REASON } from "@/app/planning/gantt";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { epicLinks, planningEpic, planningTicket, seededRoadmap } from "../helpers/planning";

/**
 * The epic editor sheet (#286): it round-trips name, tint, status, range and ticket links; shows where
 * the lane is mirrored; adds a lane under the roadmap's head; and is read-only for a reader.
 */

const actions = {
  updateEpic: vi.fn(),
  addEpic: vi.fn(),
  readEpicLinks: vi.fn(),
  searchTickets: vi.fn(),
  setTicketLinked: vi.fn(),
};

vi.mock("@/app/planning/gantt-actions", () => ({
  updateEpic: (...args: unknown[]) => actions.updateEpic(...args),
  addEpic: (...args: unknown[]) => actions.addEpic(...args),
  readEpicLinks: (...args: unknown[]) => actions.readEpicLinks(...args),
  searchTickets: (...args: unknown[]) => actions.searchTickets(...args),
  setTicketLinked: (...args: unknown[]) => actions.setTicketLinked(...args),
}));

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }) }));

const { EpicEditor } = await import("@/app/planning/epic-editor");

const onClose = vi.fn();
const onSaved = vi.fn();

/**
 * Render the sheet.
 *
 * @param epic The lane, or `null` to add one.
 * @param mayAdminister Whether the reader may change the roadmap.
 * @returns The dialog.
 */
async function openSheet(epic: PlanningEpic | null = planningEpic(), mayAdminister = true): Promise<HTMLElement> {
  render(
    <EpicEditor
      epic={epic}
      mayAdminister={mayAdminister}
      onClose={onClose}
      onSaved={onSaved}
      roadmap={seededRoadmap()}
    />,
  );

  return screen.findByRole("dialog");
}

beforeEach(() => {
  for (const mock of [...Object.values(actions), refresh, onClose, onSaved]) mock.mockReset();
  actions.readEpicLinks.mockResolvedValue({ ok: true, value: epicLinks() });
  actions.searchTickets.mockResolvedValue({ ok: true, value: { items: [] } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("editing a lane", () => {
  it("opens on the lane's name, tint, status and months", async () => {
    const dialog = await openSheet();

    expect(dialog).toHaveAccessibleName("Edit epic");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("OTA hardening");
    expect(within(dialog).getByRole("combobox", { name: "Tint" })).toHaveValue("accent");
    expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveValue("active");
    expect(within(dialog).getByLabelText("First month")).toHaveValue("2026-07");
    expect(within(dialog).getByLabelText("Last month")).toHaveValue("2026-09");
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveAttribute("title", NOTHING_CHANGED);
    await flushLinks();
  });

  it("round-trips name, tint, status and range — sending only what changed", async () => {
    const stored = planningEpic({ name: "OTA v2", tint: "ok", status: "proposed", endMonth: "2026-10" });

    actions.updateEpic.mockResolvedValue({ ok: true, value: stored });

    const dialog = await openSheet();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "OTA v2" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Tint" }), { target: { value: "ok" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Status" }), { target: { value: "proposed" } });
    fireEvent.change(within(dialog).getByLabelText("Last month"), { target: { value: "2026-10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith(stored); });
    expect(actions.updateEpic).toHaveBeenCalledExactlyOnceWith(planningEpic().id, {
      name: "OTA v2",
      tint: "ok",
      status: "proposed",
      startMonth: "2026-07",
      endMonth: "2026-10",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("clears a range to unscoped with both months null", async () => {
    actions.updateEpic.mockResolvedValue({ ok: true, value: planningEpic({ startMonth: null, endMonth: null }) });

    const dialog = await openSheet();

    fireEvent.change(within(dialog).getByLabelText("First month"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Last month"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateEpic).toHaveBeenCalledWith(planningEpic().id, { startMonth: null, endMonth: null });
    });
  });

  it("will not save half a range, and says so under the months", async () => {
    const dialog = await openSheet();

    fireEvent.change(within(dialog).getByLabelText("Last month"), { target: { value: "" } });

    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByText("Give both months, or neither for an unscoped epic.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(actions.updateEpic).not.toHaveBeenCalled();
    await flushLinks();
  });

  it("keeps the sheet open on a refusal, saying nothing was saved", async () => {
    actions.updateEpic.mockResolvedValue({
      ok: false,
      refusal: { code: "epic_month_range_invalid", message: "Backwards.", details: {} },
    });

    const dialog = await openSheet();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "OTA v2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(`The months are not a forwards pair. ${NOTHING_SAVED}`)).toHaveAttribute(
      "role",
      "alert",
    );
    // The refusal was about the months, so the months say so too.
    expect(within(dialog).getByText("The last month is before the first.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ticket links", () => {
  it("lists the linked tickets with their synced states, linking out to the tracker, and the mirrors", async () => {
    const dialog = await openSheet();

    const list = await within(dialog).findByRole("heading", { name: "Linked tickets · 2 · 1 done" });
    const key = within(dialog).getByRole("link", { name: "#548" });

    expect(list).toBeInTheDocument();
    expect(key).toHaveAttribute("href", "https://github.com/acme-robotics/helios-firmware/issues/548");
    expect(within(dialog).getByText("Stage A/B partitions")).toBeInTheDocument();
    expect(within(dialog).getByText("done")).toHaveClass("planning-epic__state--done");
    expect(within(dialog).getByText("GitHub · acme-robotics — parent issue #612")).toBeInTheDocument();
    expect(actions.readEpicLinks).toHaveBeenCalledExactlyOnceWith(planningEpic().id);
  });

  it("says when nothing is linked or mirrored, and when the lists could not be read", async () => {
    actions.readEpicLinks.mockResolvedValueOnce({ ok: true, value: epicLinks({ tickets: [], mirrors: [] }) });

    const dialog = await openSheet();

    expect(await within(dialog).findByText(TICKETS_NONE)).toBeInTheDocument();
    expect(within(dialog).getByText(MIRRORS_NONE)).toBeInTheDocument();
  });

  it("says the lists could not be read", async () => {
    actions.readEpicLinks.mockResolvedValueOnce({ ok: false, refusal: { code: "internal_error", message: "x", details: {} } });

    const dialog = await openSheet();

    expect(await within(dialog).findByText(TICKETS_UNREAD)).toBeInTheDocument();
  });

  it("unlinks at once, and hands the gantt the lane with its chip recomputed", async () => {
    const recomputed = planningEpic({ chips: { issues: 11, done: 8 } });

    actions.setTicketLinked.mockResolvedValue({
      ok: true,
      value: { epic: recomputed, links: epicLinks({ tickets: [epicLinks().tickets[1]!] }) },
    });

    const dialog = await openSheet();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Unlink #548" }));

    await waitFor(() => { expect(onSaved).toHaveBeenCalledWith(recomputed); });
    expect(actions.setTicketLinked).toHaveBeenCalledExactlyOnceWith(planningEpic().id, planningTicket().id, false);
    expect(within(dialog).getByRole("heading", { name: "Linked tickets · 1 · 1 done" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "#548" })).toBeNull();
  });

  it("searches after a pause, offers only unlinked tickets, and links one", async () => {
    vi.useFakeTimers();

    const candidate = planningTicket({ id: "5eed0280-0000-4000-8000-0000000071c9", externalKey: "#560", title: "Recovery beacon" });

    actions.searchTickets.mockResolvedValue({ ok: true, value: { items: [planningTicket(), candidate] } });
    actions.setTicketLinked.mockResolvedValue({
      ok: true,
      value: { epic: planningEpic({ chips: { issues: 13, done: 8 } }), links: epicLinks({ tickets: [...epicLinks().tickets, candidate] }) },
    });

    render(<EpicEditor epic={planningEpic()} mayAdminister onClose={onClose} onSaved={onSaved} roadmap={seededRoadmap()} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a ticket to link" }), { target: { value: "beacon" } });
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    expect(actions.searchTickets).toHaveBeenLastCalledWith("beacon");
    // Each keystroke restarts the wait: the mount's empty search and "beacon", never a half-typed term.
    expect(actions.searchTickets.mock.calls.map((call) => call[0])).toEqual(["beacon"]);

    const picker = screen.getByRole("list", { name: "Find a ticket to link" });

    expect(within(picker).queryByText("#548")).toBeNull();
    fireEvent.click(within(picker).getByRole("button", { name: "Link #560" }));

    await act(async () => { await vi.runAllTimersAsync(); });

    expect(actions.setTicketLinked).toHaveBeenCalledWith(planningEpic().id, candidate.id, true);
    expect(onSaved).toHaveBeenCalledWith(planningEpic({ chips: { issues: 13, done: 8 } }));
    expect(screen.getByRole("heading", { name: "Linked tickets · 3 · 1 done" })).toBeInTheDocument();
  });

  it("says a refused link changed nothing", async () => {
    actions.setTicketLinked.mockResolvedValue({ ok: false, refusal: { code: "forbidden", message: "x", details: {} } });

    const dialog = await openSheet();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Unlink #548" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(`${READ_ONLY_STEP_REASON} The links are unchanged.`);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("a reader who may not change the roadmap", () => {
  it("reads the epic, its tickets and mirrors, with every control disabled or absent", async () => {
    const dialog = await openSheet(planningEpic(), false);

    expect(within(dialog).getByText(READ_ONLY_NOTE)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Tint" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(await within(dialog).findByRole("link", { name: "#548" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Unlink/ })).toBeNull();
    expect(within(dialog).queryByRole("searchbox")).toBeNull();
    expect(actions.searchTickets).not.toHaveBeenCalled();
  });
});

describe("adding a lane", () => {
  it("creates it under the roadmap's head, closes, and re-reads the page", async () => {
    actions.addEpic.mockResolvedValue({ ok: true, value: planningEpic({ id: "new" }) });

    const dialog = await openSheet(null);

    expect(dialog).toHaveAccessibleName("Add epic");
    expect(within(dialog).getByRole("button", { name: "Add epic" })).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Secure boot" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Tint" }), { target: { value: "warn" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add epic" }));

    await waitFor(() => { expect(refresh).toHaveBeenCalled(); });
    expect(actions.addEpic).toHaveBeenCalledExactlyOnceWith({
      name: "Secure boot",
      tint: "warn",
      status: "active",
      startMonth: null,
      endMonth: null,
      roadmapName: "Helios 2.1",
      roadmapWindow: "Q3–Q4 2026",
    });
    expect(onClose).toHaveBeenCalled();
    expect(actions.readEpicLinks).not.toHaveBeenCalled();
  });

  it("says no epic was added when refused", async () => {
    actions.addEpic.mockResolvedValue({ ok: false, refusal: { code: "forbidden", message: "x", details: {} } });

    const dialog = await openSheet(null);

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Secure boot" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add epic" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No epic was added.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("both palettes", () => {
  it("renders identically", () => {
    actions.readEpicLinks.mockReturnValue(new Promise(() => {}));
    actions.searchTickets.mockReturnValue(new Promise(() => {}));

    const [light, dark] = renderInBothPalettes(
      <EpicEditor epic={planningEpic()} mayAdminister onClose={onClose} onSaved={onSaved} roadmap={seededRoadmap()} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

/**
 * Let the sheet's links read land, so a case that asserts nothing about it ends without a pending update.
 *
 * @returns Once the read has been drawn.
 */
async function flushLinks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
