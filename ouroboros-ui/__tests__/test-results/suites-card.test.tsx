import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  NO_CASES,
  NO_SUITES,
  READING_SUITES,
  SUITES_LIST_LABEL,
  SUITES_STALE_HEADLINE,
  SUITES_TITLE,
  SUITES_UNREAD_HEADLINE,
  type SuiteSelection,
  suitesView,
} from "@/app/test-results/suites";
import { SuitesCard, type SuitesCardProps } from "@/app/test-results/suites-card";

import { seededSuites, suite } from "../helpers/test-results";

/**
 * The suites card (#337), rendered: the seeded five rows against mockup 11, status-coloured meters
 * and counts, selection by press and by keyboard, the case drill with its retry chip, and platform
 * tags that are tags.
 */

/**
 * Draw the card.
 *
 * @param over What to pass besides the seed with nothing selected.
 * @returns The Testing Library render result, and the `onSelect` spy.
 */
function draw(over: Partial<SuitesCardProps> & { selection?: SuiteSelection | null } = {}) {
  const onSelect = vi.fn();
  const { selection = null, ...props } = over;
  const result = render(
    <SuitesCard
      error={null}
      notice={null}
      onRetry={() => {}}
      onSelect={onSelect}
      view={suitesView(seededSuites(), selection)}
      {...props}
    />,
  );

  return { ...result, onSelect };
}

/** The card. */
function card() {
  return within(screen.getByRole("region", { name: SUITES_TITLE }));
}

/** The suite rows, top to bottom. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".tests-suites__row")];
}

/** A row's select button, by the suite's label. */
function select(name: string): HTMLElement {
  return card().getByRole("button", { name });
}

/** A row's disclosure, by the suite's label. */
function chevron(name: string): HTMLElement {
  return card().getByRole("button", { name: `Cases of ${name}` });
}

describe("the seeded rows (mockup 11)", () => {
  it("draws name, platform tag and count for each of the five, in order", () => {
    draw();

    expect(
      rows().map((row) => [
        row.querySelector(".tests-suites__select")?.textContent,
        row.querySelector(".ou-tag")?.textContent,
        row.querySelector(".tests-suites__count")?.textContent,
      ]),
    ).toEqual([
      ["unit · drivers", "native_sim", "24/24"],
      ["telemetry integration", "qemu_cortex_m3", "18/19"],
      ["motor control", "qemu_cortex_m3", "12/12"],
      ["OTA update", "native_sim", "6/6"],
      ["PHYSICAL · HIL rig", "rig:helios-rig-02", "1/2"],
    ]);
    expect(card().getByRole("list", { name: SUITES_LIST_LABEL })).toBeInTheDocument();
  });

  it("colours the meter and the count by status — the 1/2 physical row is warn, 18/19 is err", () => {
    draw();

    const tones = rows().map((row) => [
      [...(row.querySelector(".ou-meter")?.classList ?? [])].find((name) => name.startsWith("ou-meter--")),
      [...(row.querySelector(".tests-suites__count")?.classList ?? [])].find((name) => name.includes("--")),
    ]);

    expect(tones).toEqual([
      ["ou-meter--ok", "tests-suites__count--ok"],
      ["ou-meter--err", "tests-suites__count--err"],
      ["ou-meter--ok", "tests-suites__count--ok"],
      ["ou-meter--ok", "tests-suites__count--ok"],
      ["ou-meter--warn", "tests-suites__count--warn"],
    ]);
  });

  it("fills each meter to the fraction that passed", () => {
    draw();

    const fills = rows().map((row) =>
      row.querySelector<HTMLElement>(".ou-meter__fill")?.style.getPropertyValue("--ou-meter-fill"),
    );

    expect(fills).toEqual(["100%", "94.7%", "100%", "100%", "50%"]);
  });

  it("says the count to a screen reader, and hides the meter that repeats it", () => {
    draw();

    expect(card().getByRole("img", { name: "18 of 19 passed" })).toHaveTextContent("18/19");
    expect(rows()[1]!.querySelector(".ou-meter")).toHaveAttribute("aria-hidden", "true");
  });

  it("prefixes a rig suite the payload did not", () => {
    draw({ view: suitesView([suite({ name: "HIL rig", kind: "physical", platform: "rig:helios-rig-02" })], null) });

    expect(select("PHYSICAL · HIL rig")).toBeInTheDocument();
  });
});

describe("platform tags", () => {
  it("are plain text — no link, no button, nothing to focus", () => {
    draw();

    const tags = [...document.querySelectorAll<HTMLElement>(".tests-suites__row .ou-tag")];

    expect(tags).toHaveLength(5);
    for (const tag of tags) {
      expect(tag.tagName).toBe("SPAN");
      expect(tag.closest("a, button")).toBeNull();
      expect(tag.querySelector("a, button")).toBeNull();
      expect(tag).not.toHaveAttribute("tabindex");
      expect(tag).not.toHaveAttribute("role");
    }
    expect(card().queryAllByRole("link")).toHaveLength(0);
  });
});

describe("selection", () => {
  it("starts with nothing selected", () => {
    draw();

    expect(card().queryByRole("button", { pressed: true })).toBeNull();
    expect(document.querySelector('.tests-suites__row[data-selected="true"]')).toBeNull();
  });

  it("marks the selected row, and only it", () => {
    draw({ selection: { name: "telemetry integration", platform: null } });

    expect(select("telemetry integration")).toHaveAttribute("aria-pressed", "true");
    expect(rows().map((row) => row.dataset.selected)).toEqual([undefined, "true", undefined, undefined, undefined]);
  });

  it("asks for a suite by its own name and platform when its row is pressed", () => {
    const { onSelect } = draw();

    fireEvent.click(select("PHYSICAL · HIL rig"));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ name: "PHYSICAL · HIL rig", platform: "rig:helios-rig-02" });
  });

  it("remembers a prefixed rig suite by the name the payload gave it", () => {
    const { onSelect } = draw({
      view: suitesView([suite({ name: "HIL rig", kind: "physical", platform: "rig:helios-rig-02" })], null),
    });

    fireEvent.click(select("PHYSICAL · HIL rig"));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ name: "HIL rig", platform: "rig:helios-rig-02" });
  });

  it("clears the selection when the selected row is pressed again", () => {
    const { onSelect } = draw({ selection: { name: "OTA update", platform: null } });

    fireEvent.click(select("OTA update"));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("says what became of a selection that did not survive", () => {
    draw({ notice: "telemetry integration did not run in Build 1 — selection cleared." });

    expect(card().getByRole("status")).toHaveTextContent("telemetry integration did not run in Build 1");
  });
});

describe("the keyboard", () => {
  it("selects with a real button, so Enter and Space press it", () => {
    draw();

    for (const row of rows()) {
      const button = row.querySelector(".tests-suites__select");
      expect(button?.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("walks the rows with the arrows, Home and End", () => {
    draw();

    select("unit · drivers").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(select("telemetry integration")).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(select("PHYSICAL · HIL rig")).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(select("PHYSICAL · HIL rig")).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(select("OTA update")).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(select("unit · drivers")).toHaveFocus();
  });

  it("moves focus without selecting", () => {
    const { onSelect } = draw();

    select("unit · drivers").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });

    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("the case drill", () => {
  it("is folded until asked for, and opens without selecting", () => {
    const { onSelect } = draw();

    expect(chevron("telemetry integration")).toHaveAttribute("aria-expanded", "false");
    expect(card().queryByRole("list", { name: "Cases of telemetry integration" })).toBeNull();

    fireEvent.click(chevron("telemetry integration"));

    expect(chevron("telemetry integration")).toHaveAttribute("aria-expanded", "true");
    expect(card().getByRole("list", { name: "Cases of telemetry integration" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows retry 2/3 on the flaky telemetry case, with its status and duration", () => {
    draw();
    fireEvent.click(chevron("telemetry integration"));

    const cases = within(card().getByRole("list", { name: "Cases of telemetry integration" })).getAllByRole("listitem");

    expect(cases.map((each) => each.textContent)).toEqual([
      "can_frame_orderpassed412ms",
      "can_frame_roundtripflakyretry 2/33s",
    ]);
    expect(within(cases[1]!).getByText("retry 2/3")).toHaveAttribute("title", "Passed on retry 2 of 3 runs");
    expect(within(cases[1]!).getByText("flaky")).toHaveClass("ou-chip--warn");
    expect(within(cases[0]!).getByText("passed")).toHaveClass("ou-chip--ok");
    expect(within(cases[0]!).queryByText(/^retry/)).toBeNull();
  });

  it("draws a failed case in err, and no duration for one that reported none", () => {
    draw();
    fireEvent.click(chevron("PHYSICAL · HIL rig"));

    const cases = within(card().getByRole("list", { name: "Cases of PHYSICAL · HIL rig" })).getAllByRole("listitem");

    expect(cases.map((each) => each.textContent)).toEqual([
      "pid_overshoot_under_loadfailed1m 01s",
      "power_loss_recoverypassed",
    ]);
    expect(within(cases[0]!).getByText("failed")).toHaveClass("ou-chip--err");
  });

  it("opens several at once, folds one, and points each chevron at its own list", () => {
    draw();
    fireEvent.click(chevron("telemetry integration"));
    fireEvent.click(chevron("PHYSICAL · HIL rig"));

    expect(card().getAllByRole("list", { name: /^Cases of/ })).toHaveLength(2);
    expect(chevron("PHYSICAL · HIL rig").getAttribute("aria-controls")).toBe(
      card().getByRole("list", { name: "Cases of PHYSICAL · HIL rig" }).id,
    );

    fireEvent.click(chevron("telemetry integration"));

    expect(card().getAllByRole("list", { name: /^Cases of/ })).toHaveLength(1);
    expect(chevron("telemetry integration")).not.toHaveAttribute("aria-controls");
  });

  it("says a suite with no case has none", () => {
    draw();
    fireEvent.click(chevron("motor control"));

    expect(card().getByText(NO_CASES)).toBeInTheDocument();
  });

  it("stays open across a redraw that gives the suite another id — a poll, an attempt switch", () => {
    const { rerender } = draw();
    fireEvent.click(chevron("telemetry integration"));

    rerender(
      <SuitesCard
        error={null}
        notice={null}
        onRetry={() => {}}
        onSelect={() => {}}
        view={suitesView(
          seededSuites().map((each, index) => ({ ...each, id: `build-2-${index}` })),
          null,
        )}
      />,
    );

    expect(chevron("telemetry integration")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("before and without suites", () => {
  it("says it is reading while the page has not been read", () => {
    draw({ view: null });

    expect(card().getByText(READING_SUITES)).toBeInTheDocument();
    expect(card().queryByRole("list")).toBeNull();
  });

  it("says a build that reported no suites reported none", () => {
    draw({ view: suitesView([], null) });

    expect(card().getByText(NO_SUITES)).toBeInTheDocument();
  });

  it("draws a failed first read as a banner that can be retried", () => {
    const onRetry = vi.fn();
    draw({ view: null, error: "The suites could not be reached.", onRetry });

    expect(card().getByText(SUITES_UNREAD_HEADLINE)).toBeInTheDocument();
    expect(card().getByText("The suites could not be reached.")).toBeInTheDocument();
    expect(card().queryByText(READING_SUITES)).toBeNull();

    fireEvent.click(card().getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the last rows on screen under a banner when a refresh fails", () => {
    draw({ error: "The suites could not be reached." });

    expect(card().getByText(SUITES_STALE_HEADLINE)).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });
});
