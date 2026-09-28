import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FarmRunner } from "@/app/api/farm";
import type { TestRunPage } from "@/app/api/test-results";
import {
  type CaseSelection,
  HIL_SCHEMA_HINT,
  NO_PHYSICAL,
  PHYSICAL_TITLE,
  READING_PHYSICAL,
  RIG_ONLINE,
  physicalView,
} from "@/app/test-results/physical";
import { PhysicalCard } from "@/app/test-results/physical-card";

import { farmRunner } from "../helpers/farm";
import { measurement, mockupPage, mockupRigSuite, page, physicalCase, suite } from "../helpers/test-results";

/**
 * The physical-tests card, drawn (#338): mockup 11's four rows, the presence pill only for a rig
 * that is a connected runner, the degraded suite's plain rows, and the row as the page's case
 * selector.
 */

/**
 * Draw the card.
 *
 * @param options The page, the selected case, the farm's runners and a notice.
 * @returns What `onSelect` was called with.
 */
function draw(
  options: {
    page?: TestRunPage | null;
    selection?: CaseSelection | null;
    runners?: readonly FarmRunner[] | null;
    notice?: string | null;
  } = {},
) {
  const onSelect = vi.fn();
  const drawn = options.page === undefined ? mockupPage() : options.page;

  render(
    <PhysicalCard
      notice={options.notice ?? null}
      onSelect={onSelect}
      view={
        drawn === null
          ? null
          : physicalView(drawn, null, options.selection ?? null, options.runners ?? null)
      }
    />,
  );

  return onSelect;
}

/** The card. */
function card() {
  return within(screen.getByRole("region", { name: PHYSICAL_TITLE }));
}

/** One row, by its case's name. */
function row(name: string): HTMLElement {
  return card().getByRole("button", { name }).closest("li")!;
}

/** A row's text, line by line. */
function text(name: string): string[] {
  return [...row(name).children].map((child) => child.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

describe("the mockup's four rows", () => {
  it("are drawn name and pill, what the rig did, and what it measured", () => {
    draw();

    expect(text("Power-loss mid-flash recovery")).toEqual([
      "Power-loss mid-flash recoverypass",
      "power-cycler kills 24V rail at 40 / 60 / 80% of OTA write",
      "measured: slot b fallback 412ms vs limit 500ms",
    ]);
    expect(text("CAN bus frame order under 90% load")).toEqual([
      "CAN bus frame order under 90% loadpass",
      "traffic generator floods bus at 900 kbit/s for 60s",
      "measured: reordered frames 0 vs limit 0 (was 37 in build 1)",
    ]);
    expect(text("Motor overshoot on e-stop release")).toEqual([
      "Motor overshoot on e-stop releaseFAIL",
      "dyno bench releases e-stop under 2 Nm load, 3 trials",
      "measured: overshoot 2.4% vs limit 2.0%",
    ]);
    expect(text("BLE beacon in dual-slot-corrupt state")).toEqual([
      "BLE beacon in dual-slot-corrupt statepass",
      "both firmware slots checksum-corrupted deliberately, cold boot",
      "measured: recovery beacon 1.8s vs limit 3.0s",
    ]);
  });

  it("colour only the value that breached", () => {
    draw();

    const breached = [...document.querySelectorAll('[data-breached="true"]')].map((each) => each.textContent);

    expect(breached).toEqual(["2.4%"]);
    expect(document.querySelector(".tests-physical__value--breached")).toHaveTextContent("2.4%");
  });

  it("colour a value short of a min limit the same way", () => {
    draw({
      page: mockupPage({
        physical: [
          physicalCase({
            measurements: [measurement({ metric: "hold_torque_nm", value: 1.8, unit: "Nm", limit: 2, limitKind: "min" })],
          }),
        ],
      }),
    });

    expect(text("Motor overshoot on e-stop release")[2]).toBe("measured: hold torque 1.8Nm vs limit 2.0Nm");
    expect(document.querySelector('[data-breached="true"]')).toHaveTextContent("1.8Nm");
  });

  it("print a comparative only where one is stored", () => {
    draw();

    const comparatives = [...document.querySelectorAll(".tests-physical__comparative")];

    expect(comparatives.map((each) => each.textContent)).toEqual(["(was 37 in build 1)"]);
  });

  it("draw one line for each measurement of a case", () => {
    draw({
      page: mockupPage({
        physical: [
          physicalCase({
            measurements: [measurement(), measurement({ metric: "settle_ms", value: 84, unit: "ms", limit: 120, verdict: "pass" })],
          }),
        ],
      }),
    });

    expect(text("Motor overshoot on e-stop release").slice(2)).toEqual([
      "measured: overshoot 2.4% vs limit 2.0%",
      "measured: settle 84ms vs limit 120ms",
    ]);
  });
});

describe("the rig header", () => {
  it("names the rig and its bench", () => {
    draw();

    const group = card().getByRole("region", { name: "Rig helios-rig-02" });

    expect(within(group).getByRole("heading", { level: 3 })).toHaveTextContent("Rig helios-rig-02");
    expect(group).toHaveTextContent("bench: CAN bus + motor + power-cycler");
  });

  it("draws the rig online pill when the rig is a connected runner", () => {
    draw({ runners: [farmRunner({ name: "helios-rig-02", status: "online" })] });

    expect(card().getByText(RIG_ONLINE)).toBeInTheDocument();
  });

  it("omits the pill for a rig that is only a platform tag", () => {
    draw({ runners: [farmRunner({ name: "forge-01", status: "online" })] });

    expect(card().queryByText(RIG_ONLINE)).toBeNull();
    expect(card().queryByText(/offline/i)).toBeNull();
  });

  it("omits the pill when the farm has not been read, and for a runner that is offline", () => {
    draw({ runners: null });
    expect(card().queryByText(RIG_ONLINE)).toBeNull();
  });

  it("omits the pill for a runner of the rig's name that is offline", () => {
    draw({ runners: [farmRunner({ name: "helios-rig-02", status: "offline" })] });

    expect(card().queryByText(RIG_ONLINE)).toBeNull();
  });

  it("draws two physical suites as two rig groups, each with its own pill", () => {
    const second = mockupRigSuite({
      id: "5eed0032-0000-4000-8000-000000048306",
      name: "PHYSICAL · thermal rig",
      platform: "rig:helios-rig-03",
      rig: "helios-rig-03",
      bench: "thermal chamber",
    });

    draw({
      page: mockupPage({ suites: [mockupRigSuite(), second] }),
      runners: [farmRunner({ name: "helios-rig-03", status: "online" })],
    });

    const groups = card().getAllByRole("region");

    expect(groups.map((group) => within(group).getByRole("heading").textContent)).toEqual([
      "Rig helios-rig-02",
      "Rig helios-rig-03",
    ]);
    expect(within(groups[0]!).queryByText(RIG_ONLINE)).toBeNull();
    expect(within(groups[1]!).getByText(RIG_ONLINE)).toBeInTheDocument();
  });
});

describe("a JUnit-only physical suite", () => {
  it("draws plain case rows under the HIL-schema hint, with no limit invented", () => {
    draw({ page: page({ suites: [mockupRigSuite({ resultsFormat: "junit" })], physical: [] }) });

    expect(card().getByText(HIL_SCHEMA_HINT)).toBeInTheDocument();
    expect(text("Motor overshoot on e-stop release")).toEqual(["Motor overshoot on e-stop releaseFAIL"]);
    expect(text("Power-loss mid-flash recovery")).toEqual(["Power-loss mid-flash recoverypass"]);
    expect(document.querySelector(".tests-physical__measured")).toBeNull();
    expect(screen.getByRole("region", { name: PHYSICAL_TITLE })).not.toHaveTextContent(/limit|measured:/);
  });

  it("is not hinted at beside a suite that has measurements", () => {
    draw();

    expect(card().queryByText(HIL_SCHEMA_HINT)).toBeNull();
  });
});

describe("the card's other states", () => {
  it("says it is reading while the page has not been read", () => {
    draw({ page: null });

    expect(card().getByText(READING_PHYSICAL)).toBeInTheDocument();
  });

  it("says so when the build ran nothing on a rig", () => {
    draw({ page: page({ suites: [suite()] }) });

    expect(card().getByText(NO_PHYSICAL)).toBeInTheDocument();
    expect(card().queryByRole("list")).toBeNull();
  });

  it("says what became of a selection, as a status", () => {
    draw({ notice: "x did not run on a rig in Build 1 — selection cleared." });

    expect(card().getByRole("status")).toHaveTextContent("selection cleared");
  });
});

describe("selection", () => {
  const name = "Motor overshoot on e-stop release";

  it("starts with no row selected", () => {
    draw();

    expect(card().queryByRole("button", { pressed: true })).toBeNull();
  });

  it("selects a row by its case's name and its suite's platform", () => {
    const onSelect = draw();

    fireEvent.click(card().getByRole("button", { name }));

    expect(onSelect).toHaveBeenCalledWith({ name, platform: "rig:helios-rig-02" });
  });

  it("marks the selected row, and the failing one as failing", () => {
    draw({ selection: { name, platform: null } });

    expect(card().getByRole("button", { pressed: true })).toHaveTextContent(name);
    expect(row(name)).toHaveAttribute("data-selected", "true");
    expect(row(name)).toHaveAttribute("data-failing", "true");
    expect(row("Power-loss mid-flash recovery")).not.toHaveAttribute("data-selected");
    expect(row("Power-loss mid-flash recovery")).not.toHaveAttribute("data-failing");
  });

  it("clears the selection when the selected row is pressed again", () => {
    const onSelect = draw({ selection: { name, platform: null } });

    fireEvent.click(card().getByRole("button", { name }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("lets a plain row be selected too", () => {
    const onSelect = draw({ page: page({ suites: [mockupRigSuite()], physical: [] }) });

    fireEvent.click(card().getByRole("button", { name }));

    expect(onSelect).toHaveBeenCalledWith({ name, platform: "rig:helios-rig-02" });
  });
});
