import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPILOT_SEATS } from "@/app/workflows/copilot/copilot-view";
import {
  FORMULAS_TERM,
  MECHANISM_WORDS,
  NOTHING_HELD_NOTE,
  PATH_TERM,
  SAFETY_CLAIMS,
  mechanismButtonName,
  withheldNote,
} from "@/app/workflows/copilot/safety";
import { SafetyStrip } from "@/app/workflows/copilot/safety-strip";

import { maskIds, renderInBothPalettes } from "../../helpers/palettes";
import { drySafety, safetyColumn } from "../../helpers/workflow-copilot";

/**
 * The safety strip's card (CE.5, #569).
 *
 * What is rendered is what the payload asserts: the fixture that removes a claim is the
 * acceptance criterion, and it is asserted on the rendered text — the claim's sentence is not
 * anywhere on the card once the payload stops carrying it.
 */

/** The card. */
function strip(): HTMLElement {
  return screen.getByRole("region", { name: COPILOT_SEATS.safety.title });
}

/** One claim's ⓘ. */
function info(id: keyof typeof SAFETY_CLAIMS): HTMLElement {
  return screen.getByRole("button", { name: mechanismButtonName(SAFETY_CLAIMS[id].key) });
}

describe("the strip", () => {
  it("is a region named by mockup 20's heading, on the seat's own id, tagged with its harness", () => {
    render(<SafetyStrip safety={drySafety()} />);

    expect(strip()).toHaveAttribute("id", "copilot-safety");
    expect(strip()).toHaveTextContent("harness: deep_simulated");
  });

  it("draws the three claims verbatim, in the payload's order", () => {
    render(<SafetyStrip safety={drySafety()} />);

    const items = within(strip()).getAllByRole("listitem");

    expect(items.map((item) => item.dataset.claim)).toEqual(["simulated_writes", "replayed_infra", "real_models"]);
    expect(items[0]).toHaveTextContent(SAFETY_CLAIMS.simulated_writes.key);
    expect(items[0]).toHaveTextContent(SAFETY_CLAIMS.simulated_writes.sentence);
    expect(items[1]).toHaveTextContent(SAFETY_CLAIMS.replayed_infra.sentence);
    expect(items[2]).toHaveTextContent(SAFETY_CLAIMS.real_models.sentence);
    expect(within(strip()).queryByRole("status")).toBeNull();
  });
});

describe("a claim the payload does not assert is absent", () => {
  it.each(["simulated_writes", "replayed_infra", "real_models"] as const)(
    "renders no %s column, key or sentence once the payload drops it",
    (removed) => {
      const safety = drySafety({ columns: drySafety().columns.filter((column) => column.id !== removed) });
      render(<SafetyStrip safety={safety} />);

      expect(within(strip()).getAllByRole("listitem")).toHaveLength(2);
      expect(strip()).not.toHaveTextContent(SAFETY_CLAIMS[removed].sentence);
      expect(strip()).not.toHaveTextContent(SAFETY_CLAIMS[removed].key);
      expect(screen.queryByRole("button", { name: mechanismButtonName(SAFETY_CLAIMS[removed].key) })).toBeNull();
      // The strip says it is short — and does not repeat the claim to do so.
      expect(within(strip()).getByRole("status")).toHaveTextContent(withheldNote(2)!);
    },
  );

  it("renders no column for a claim whose mechanism no longer holds", () => {
    const safety = drySafety({
      columns: [
        safetyColumn("simulated_writes", { holds: false }),
        safetyColumn("replayed_infra"),
        safetyColumn("real_models"),
      ],
    });
    render(<SafetyStrip safety={safety} />);

    expect(strip()).not.toHaveTextContent(SAFETY_CLAIMS.simulated_writes.sentence);
    expect(within(strip()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("draws no column, no ⓘ and no claim when none holds — only the warning", () => {
    render(<SafetyStrip safety={drySafety({ columns: [] })} />);

    expect(within(strip()).queryByRole("list")).toBeNull();
    expect(within(strip()).queryByRole("button")).toBeNull();
    expect(within(strip()).queryByRole("note")).toBeNull();
    expect(within(strip()).getByRole("status")).toHaveTextContent(NOTHING_HELD_NOTE);
    for (const claim of Object.values(SAFETY_CLAIMS)) expect(strip()).not.toHaveTextContent(claim.sentence);
  });
});

describe("the mechanism popover", () => {
  it("is closed until asked for, and every ⓘ says so", () => {
    render(<SafetyStrip safety={drySafety()} />);

    for (const id of ["simulated_writes", "replayed_infra", "real_models"] as const) {
      expect(info(id)).toHaveAttribute("aria-expanded", "false");
    }
    expect(within(strip()).queryByRole("note")).toBeNull();
  });

  it("opens a claim's trace: the mechanism, the service's sentence and what carries it", () => {
    render(<SafetyStrip safety={drySafety()} />);

    fireEvent.click(info("replayed_infra"));

    const trace = within(strip()).getByRole("note");

    expect(info("replayed_infra")).toHaveAttribute("aria-expanded", "true");
    expect(info("replayed_infra")).toHaveAttribute("aria-controls", trace.id);
    expect(trace).toHaveTextContent(MECHANISM_WORDS.estimator_service);
    expect(trace).toHaveTextContent(safetyColumn("replayed_infra").mechanism.detail);
    expect(trace).toHaveTextContent(PATH_TERM);
    expect(trace).toHaveTextContent("/internal/dry-runs/{id}/replay-estimates");
    expect(trace).toHaveTextContent(FORMULAS_TERM);
    expect(trace).toHaveTextContent("build_duration_replay v1 — median ± mad");
  });

  it("traces every claim to its own mechanism", () => {
    render(<SafetyStrip safety={drySafety()} />);

    fireEvent.click(info("simulated_writes"));
    expect(within(strip()).getByRole("note")).toHaveTextContent(MECHANISM_WORDS.overlay);
    expect(within(strip()).getByRole("note")).toHaveTextContent("write_file · apply_patch");

    fireEvent.click(info("real_models"));
    expect(within(strip()).getByRole("note")).toHaveTextContent(MECHANISM_WORDS.gateway_routing);
    expect(within(strip()).getByRole("note")).toHaveTextContent("/internal/llm/invoke");
    // One trace at a time.
    expect(info("simulated_writes")).toHaveAttribute("aria-expanded", "false");
    expect(within(strip()).getByRole("note")).not.toHaveTextContent(MECHANISM_WORDS.overlay);
  });

  it("closes on a second press", () => {
    render(<SafetyStrip safety={drySafety()} />);

    fireEvent.click(info("real_models"));
    fireEvent.click(info("real_models"));

    expect(info("real_models")).toHaveAttribute("aria-expanded", "false");
    expect(within(strip()).queryByRole("note")).toBeNull();
  });

  it("closes on Escape and gives focus back to the ⓘ that opened it", () => {
    render(<SafetyStrip safety={drySafety()} />);

    fireEvent.click(info("simulated_writes"));
    fireEvent.keyDown(info("simulated_writes"), { key: "Escape" });

    expect(within(strip()).queryByRole("note")).toBeNull();
    expect(info("simulated_writes")).toHaveFocus();
  });

  it("leaves Escape alone when nothing is open", () => {
    render(<SafetyStrip safety={drySafety()} />);

    fireEvent.keyDown(info("simulated_writes"), { key: "Escape" });

    expect(info("simulated_writes")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, whole and short", () => {
    for (const safety of [drySafety(), drySafety({ columns: [safetyColumn("real_models")] }), drySafety({ columns: [] })]) {
      const [light, dark] = renderInBothPalettes(<SafetyStrip safety={safety} />);

      expect(maskIds(light)).toBe(maskIds(dark));
    }
  });
});
