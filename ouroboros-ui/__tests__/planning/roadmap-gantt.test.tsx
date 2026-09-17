import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanningEpic } from "@/app/api/planning";
import {
  ADD_EPIC_LABEL,
  GANTT_FOOTNOTE,
  GANTT_LABEL,
  KEYBOARD_HINT,
  MOVE_ROLLED_BACK,
  READ_ONLY_STEP_REASON,
  UNSCOPED_STEP_REASON,
  todayOutside,
  withSpan,
} from "@/app/planning/gantt";

import { installMatchMedia, type MediaController } from "../helpers/match-media";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { SEEDED_READ_MONTH, epicLinks, seededRoadmap } from "../helpers/planning";

/**
 * The roadmap gantt, drawn and driven (#286) — the acceptance criteria about what a person sees and
 * does: the seeded gantt reproducing mockup 09's bars, tints, fills and chips in both themes; the TODAY
 * marker at its real fractional position; the dashed unscoped lane with its `proposed` affix; drag and
 * edge-resize snapping to months and round-tripping through the lane PATCH; optimistic updates rolled
 * back on a refusal; the keyboard path and reduced motion; scrolling inside its own wrapper; the
 * footnote; and chips recomputing when the editor links a ticket.
 *
 * The Server Actions are mocked, not the API: `gantt-actions.test.ts` is that module's suite.
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

const { RoadmapGantt } = await import("@/app/planning/roadmap-gantt");

/** How wide the test lays one month column out — jsdom lays nothing out. */
const MONTH_WIDTH = 100;

/**
 * Render the seeded gantt.
 *
 * @param mayAdminister Whether the reader may change the roadmap.
 * @returns The render result.
 */
function renderGantt(mayAdminister = true) {
  return render(<RoadmapGantt mayAdminister={mayAdminister} readMonth={SEEDED_READ_MONTH} roadmap={seededRoadmap()} />);
}

/**
 * A lane's bar.
 *
 * @param name The lane's name, which leads the bar's accessible name.
 * @returns The button.
 */
function bar(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name} —`) });
}

/**
 * A custom property a bar or marker carries.
 *
 * @param element The element.
 * @param property The property.
 * @returns Its value.
 */
function prop(element: Element, property: string): string {
  return (element as HTMLElement).style.getPropertyValue(property);
}

/**
 * Wait for a lane's saved state to settle.
 *
 * @returns After pending promise callbacks have run.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

let reducedMotion: MediaController;

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
  refresh.mockReset();
  actions.readEpicLinks.mockResolvedValue({ ok: true, value: epicLinks() });
  actions.searchTickets.mockResolvedValue({ ok: true, value: { items: [] } });
  reducedMotion = installMatchMedia(false, "(prefers-reduced-motion: reduce)");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("planning-gantt__month") ? MONTH_WIDTH : 0;

    return { width, height: 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  reducedMotion.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the seeded gantt matches the mockup", () => {
  it("draws the month columns Jul 2026 · Aug · Sep · Oct · Nov · Dec, each with a rule", () => {
    const { container } = renderGantt();
    const grid = screen.getByRole("group", { name: GANTT_LABEL });

    expect([...grid.querySelectorAll(".planning-gantt__month")].map((month) => month.textContent)).toEqual([
      "Jul 2026",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(container.querySelectorAll(".planning-gantt__rule")).toHaveLength(6);
    expect(prop(grid, "--planning-gantt-months")).toBe("6");
    expect(prop(grid, "--planning-gantt-lanes")).toBe("5");
  });

  it("draws five lanes: tints, grid columns, progress fills and chips", () => {
    renderGantt();

    const expected: [string, string, string, string, string | null, string][] = [
      ["OTA hardening", "accent", "2", "5", "67%", "12 issues · 8 done"],
      ["BLE provisioning v2", "model", "3", "6", "22%", "9 issues · 2 done"],
      ["Motor control refactor", "warn", "4", "7", "0%", "14 issues · 0 done"],
      ["Fleet telemetry dashboard", "ok", "5", "8", "0%", "7 issues · 0 done"],
      ["Zephyr 4.2 migration", "neutral", "6", "8", null, "unscoped"],
    ];

    expected.forEach(([name, tint, start, end, fill, chip], index) => {
      const element = bar(name);

      expect(element).toHaveClass(`planning-gantt__bar--${tint}`);
      expect(prop(element, "--planning-gantt-row")).toBe(String(index + 2));
      expect(prop(element, "--planning-gantt-start")).toBe(start);
      expect(prop(element, "--planning-gantt-end")).toBe(end);
      expect(prop(element, "--planning-gantt-fill")).toBe(fill ?? "");
      expect(element.querySelector(".planning-gantt__fill") !== null).toBe(fill !== null);
      expect(within(element).getByText(chip)).toHaveClass("planning-gantt__chip");
      expect(within(element).getByText(name)).toHaveClass("planning-gantt__name");
    });
  });

  it("draws the unscoped lane dashed and chipped unscoped, with the proposed affix, and no drag handles", () => {
    renderGantt();

    const zephyr = bar("Zephyr 4.2 migration");
    const label = screen.getAllByText("Zephyr 4.2 migration").find((element) => element.classList.contains("planning-gantt__label"))!;

    expect(zephyr).toHaveClass("planning-gantt__bar--neutral", "planning-gantt__bar--unscoped");
    expect(zephyr).not.toHaveClass("planning-gantt__bar--editable");
    expect(zephyr.querySelector("[data-edge]")).toBeNull();
    expect(within(label).getByText("proposed")).toHaveClass("planning-gantt__affix");
    expect(zephyr).toHaveAccessibleName("Zephyr 4.2 migration — no months yet — unscoped — proposed");
  });

  it("renders identically in both palettes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 8, 12));

    const [light, dark] = renderInBothPalettes(
      <RoadmapGantt mayAdminister readMonth={SEEDED_READ_MONTH} roadmap={seededRoadmap()} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("planning-gantt__bar--accent");
  });

  it("scrolls inside its own wrapper, and states only what is true in its footnote", () => {
    const { container } = renderGantt();
    const scroll = container.querySelector(".planning-gantt__scroll");

    expect(scroll).not.toBeNull();
    expect(scroll!.firstElementChild).toBe(screen.getByRole("group", { name: GANTT_LABEL }));
    expect(screen.getByText(GANTT_FOOTNOTE)).toBeInTheDocument();
    expect(screen.queryByText(/re-plans/)).toBeNull();
  });
});

describe("the TODAY marker sits at its real fractional position", () => {
  it("is in August's column, 7/31 through it, at midnight on Aug 8 2026", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 8));

    renderGantt();

    const marker = screen.getByRole("img", { name: "Today, 8 August 2026" });

    expect(marker).toHaveClass("planning-gantt__today");
    expect(prop(marker, "--planning-gantt-today-column")).toBe("3");
    expect(prop(marker, "--planning-gantt-today-offset")).toBe("22.581%");
    expect(Number(marker.dataset.todayFraction)).toBeCloseTo(7 / 31, 10);
    expect(within(marker).getByText("TODAY")).toBeInTheDocument();
  });

  it("moves with the clock — Oct 1 is the fifth column's start", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1));

    renderGantt();

    const marker = screen.getByRole("img", { name: /^Today/ });

    expect(prop(marker, "--planning-gantt-today-column")).toBe("5");
    expect(prop(marker, "--planning-gantt-today-offset")).toBe("0%");
  });

  it("is not drawn outside the window, and the card says which side today is on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 2, 3));

    renderGantt();

    expect(screen.queryByRole("img", { name: /^Today/ })).toBeNull();
    expect(screen.getByText(todayOutside("after"))).toBeInTheDocument();
  });
});

describe("drag and edge-resize snap to months, and round-trip through the lane PATCH", () => {
  it("moves a bar by the nearest whole months and PATCHes both months", async () => {
    const stored = withSpan(seededRoadmap().lanes[0]!, { first: 2026 * 12 + 7, last: 2026 * 12 + 9 });

    actions.updateEpic.mockResolvedValue({ ok: true, value: stored });
    renderGantt();

    const ota = bar("OTA hardening");

    fireEvent.pointerDown(ota, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(ota, { clientX: 440, pointerId: 1 });

    // 140px is 1.4 months: snapped to one, drawn there while the pointer is still down.
    expect(prop(ota, "--planning-gantt-start")).toBe("3");
    expect(prop(ota, "--planning-gantt-end")).toBe("6");
    expect(ota).toHaveClass("planning-gantt__bar--dragging");
    expect(prop(ota, "--planning-gantt-residual")).toBe("40px");
    expect(actions.updateEpic).not.toHaveBeenCalled();

    fireEvent.pointerUp(ota, { clientX: 440, pointerId: 1 });
    fireEvent.click(ota);

    expect(actions.updateEpic).toHaveBeenCalledExactlyOnceWith(stored.id, { startMonth: "2026-08", endMonth: "2026-10" });
    // The release's click is the drag's tail, not an open.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(prop(ota, "--planning-gantt-residual")).toBe("0px");

    await flush();

    expect(prop(bar("OTA hardening"), "--planning-gantt-start")).toBe("3");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("resizes from the end edge, and from the start edge, keeping the other end", () => {
    actions.updateEpic.mockReturnValue(new Promise(() => {}));
    renderGantt();

    const ble = bar("BLE provisioning v2");
    const end = ble.querySelector('[data-edge="end"]')!;

    fireEvent.pointerDown(end, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(ble, { clientX: 660, pointerId: 1 });
    fireEvent.pointerUp(ble, { clientX: 660, pointerId: 1 });

    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-08", endMonth: "2026-12" });

    const motor = bar("Motor control refactor");
    const start = motor.querySelector('[data-edge="start"]')!;

    fireEvent.pointerDown(start, { button: 0, clientX: 500, pointerId: 2 });
    fireEvent.pointerMove(motor, { clientX: 290, pointerId: 2 });
    // An edge drag does not follow the pointer between months.
    expect(prop(motor, "--planning-gantt-residual")).toBe("0px");
    fireEvent.pointerUp(motor, { clientX: 290, pointerId: 2 });

    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-07", endMonth: "2026-11" });
  });

  it("stops a bar at the window's edge", () => {
    actions.updateEpic.mockReturnValue(new Promise(() => {}));
    renderGantt();

    const fleet = bar("Fleet telemetry dashboard");

    fireEvent.pointerDown(fleet, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(fleet, { clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(fleet, { clientX: 900, pointerId: 1 });

    // Already at December: nothing to send.
    expect(actions.updateEpic).not.toHaveBeenCalled();
  });

  it("treats a press without movement as a click that opens the editor", async () => {
    renderGantt();

    const ota = bar("OTA hardening");

    fireEvent.pointerDown(ota, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(ota, { clientX: 302, pointerId: 1 });
    fireEvent.pointerUp(ota, { clientX: 302, pointerId: 1 });
    fireEvent.click(ota);

    expect(actions.updateEpic).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Edit epic" })).toBeInTheDocument();
  });

  it("forgets a cancelled drag", () => {
    renderGantt();

    const ota = bar("OTA hardening");

    fireEvent.pointerDown(ota, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(ota, { clientX: 500, pointerId: 1 });
    fireEvent.pointerCancel(ota, { pointerId: 1 });

    expect(prop(ota, "--planning-gantt-start")).toBe("2");
    expect(ota).not.toHaveClass("planning-gantt__bar--dragging");
    expect(actions.updateEpic).not.toHaveBeenCalled();
  });

  it("does not follow the pointer between months under reduced motion — it only snaps", () => {
    reducedMotion.set(true);
    renderGantt();

    const ota = bar("OTA hardening");

    fireEvent.pointerDown(ota, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(ota, { clientX: 440, pointerId: 1 });

    expect(prop(ota, "--planning-gantt-start")).toBe("3");
    expect(prop(ota, "--planning-gantt-residual")).toBe("0px");
  });
});

describe("optimistic updates roll back cleanly on a failed PATCH", () => {
  it("draws the move at once, then puts the bar back and says why", async () => {
    let answer!: (outcome: unknown) => void;

    actions.updateEpic.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderGantt();

    const ota = bar("OTA hardening");

    fireEvent.keyDown(ota, { key: "ArrowRight" });

    expect(prop(bar("OTA hardening"), "--planning-gantt-start")).toBe("3");
    expect(bar("OTA hardening")).toHaveClass("planning-gantt__bar--saving");

    await act(async () => {
      answer({ ok: false, refusal: { code: "epic_month_range_invalid", message: "No.", details: {} } });
      await Promise.resolve();
    });

    expect(prop(bar("OTA hardening"), "--planning-gantt-start")).toBe("2");
    expect(prop(bar("OTA hardening"), "--planning-gantt-end")).toBe("5");
    expect(bar("OTA hardening")).not.toHaveClass("planning-gantt__bar--saving");
    expect(screen.getByRole("alert")).toHaveTextContent(`OTA hardening could not be moved.`);
    expect(screen.getByRole("alert")).toHaveTextContent(MOVE_ROLLED_BACK);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rolls a second refused step back only to the first step the service stored", async () => {
    const answers: ((outcome: unknown) => void)[] = [];

    actions.updateEpic.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    renderGantt();

    fireEvent.keyDown(bar("OTA hardening"), { key: "ArrowRight" });
    fireEvent.keyDown(bar("OTA hardening"), { key: "ArrowRight" });

    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-09", endMonth: "2026-11" });

    const first: PlanningEpic = withSpan(seededRoadmap().lanes[0]!, { first: 2026 * 12 + 7, last: 2026 * 12 + 9 });

    await act(async () => {
      answers[0]!({ ok: true, value: first });
      await Promise.resolve();
    });
    // The second step is still in flight, so it is still what is drawn.
    expect(prop(bar("OTA hardening"), "--planning-gantt-start")).toBe("4");

    await act(async () => {
      answers[1]!({ ok: false, refusal: { code: "internal_error", message: "No.", details: {} } });
      await Promise.resolve();
    });

    expect(prop(bar("OTA hardening"), "--planning-gantt-start")).toBe("3");
  });
});

describe("a complete keyboard path", () => {
  it("moves a focused bar with the arrows, its end with Shift, its start with Alt", () => {
    actions.updateEpic.mockReturnValue(new Promise(() => {}));
    renderGantt();

    const ble = bar("BLE provisioning v2");

    ble.focus();
    fireEvent.keyDown(ble, { key: "ArrowLeft" });
    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-07", endMonth: "2026-09" });

    fireEvent.keyDown(bar("BLE provisioning v2"), { key: "ArrowRight", shiftKey: true });
    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-07", endMonth: "2026-10" });

    fireEvent.keyDown(bar("BLE provisioning v2"), { key: "ArrowRight", altKey: true });
    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-08", endMonth: "2026-10" });
  });

  it("offers month steppers per lane, named for the lane, inert where they cannot act", () => {
    actions.updateEpic.mockReturnValue(new Promise(() => {}));
    renderGantt();

    const toolbar = screen.getByRole("toolbar", { name: "OTA hardening months" });
    const later = within(toolbar).getByRole("button", { name: "Move OTA hardening a month later" });
    const earlier = within(toolbar).getByRole("button", { name: "Move OTA hardening a month earlier" });

    expect(within(toolbar).getAllByRole("button")).toHaveLength(6);
    expect(earlier).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(within(toolbar).getByRole("button", { name: "End OTA hardening a month later" }));
    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-07", endMonth: "2026-10" });

    fireEvent.click(later);
    expect(actions.updateEpic).toHaveBeenLastCalledWith(expect.any(String), { startMonth: "2026-08", endMonth: "2026-11" });

    const zephyr = screen.getByRole("toolbar", { name: "Zephyr 4.2 migration months" });

    for (const button of within(zephyr).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", UNSCOPED_STEP_REASON);
    }
  });

  it("describes the keys on every bar, and opens the editor with Enter", async () => {
    renderGantt();

    const ota = bar("OTA hardening");

    expect(ota).toHaveAccessibleDescription(KEYBOARD_HINT);
    expect(ota.tagName).toBe("BUTTON");

    // A native button's Enter is its click.
    fireEvent.click(ota);

    expect(await screen.findByRole("dialog", { name: "Edit epic" })).toBeInTheDocument();
  });
});

describe("a reader who may not change the roadmap", () => {
  it("gets no steppers, no drag, no key moves, and an inert Add epic — but can open a bar", async () => {
    renderGantt(false);

    const ota = bar("OTA hardening");

    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(ota).not.toHaveClass("planning-gantt__bar--editable");
    expect(ota.querySelector("[data-edge]")).toBeNull();

    fireEvent.pointerDown(ota, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(ota, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(ota, { clientX: 600, pointerId: 1 });
    fireEvent.keyDown(ota, { key: "ArrowRight" });

    expect(actions.updateEpic).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: ADD_EPIC_LABEL })).toHaveAttribute("title", READ_ONLY_STEP_REASON);

    fireEvent.click(ota);

    expect(await screen.findByRole("dialog", { name: "Edit epic" })).toBeInTheDocument();
  });
});

describe("progress chips recompute after a ticket change", () => {
  it("redraws a bar's chip and fill from the lane a link answered", async () => {
    const recomputed = { ...seededRoadmap().lanes[0]!, chips: { issues: 12, done: 9 } };

    actions.setTicketLinked.mockResolvedValue({ ok: true, value: { epic: recomputed, links: epicLinks() } });
    renderGantt();

    fireEvent.click(bar("OTA hardening"));

    const dialog = await screen.findByRole("dialog", { name: "Edit epic" });

    fireEvent.click(await within(dialog).findByRole("button", { name: "Unlink #548" }));

    await waitFor(() => {
      expect(within(bar("OTA hardening")).getByText("12 issues · 9 done")).toBeInTheDocument();
    });
    expect(prop(bar("OTA hardening"), "--planning-gantt-fill")).toBe("75%");
    expect(refresh).toHaveBeenCalled();
  });

  it("draws what a fresh read says, superseding what it had kept", () => {
    const { rerender } = renderGantt();
    const next = seededRoadmap();

    next.lanes[1] = { ...next.lanes[1]!, chips: { issues: 9, done: 3 } };
    rerender(<RoadmapGantt mayAdminister readMonth={SEEDED_READ_MONTH} roadmap={next} />);

    expect(within(bar("BLE provisioning v2")).getByText("9 issues · 3 done")).toBeInTheDocument();
  });
});

describe("Add epic", () => {
  it("opens the editor empty, under the roadmap's head", async () => {
    renderGantt();

    fireEvent.click(screen.getByRole("button", { name: ADD_EPIC_LABEL }));

    const dialog = await screen.findByRole("dialog", { name: "Add epic" });

    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(within(dialog).getByText("Link tickets once the epic exists.")).toBeInTheDocument();
  });
});
