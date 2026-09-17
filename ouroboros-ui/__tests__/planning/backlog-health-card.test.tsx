import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BacklogHealthCard } from "@/app/planning/backlog-health-card";
import {
  DRILL_THROUGH_NOTE,
  ESTIMATOR_FOOTNOTE,
  HEALTH_TITLE,
  HEALTH_UNREAD,
  LAST_RUN_LABEL,
} from "@/app/planning/health";

import { CARD_UNREAD_NOTE } from "@/app/planning/states";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { emptyHealth, planningReadings, seededHealth } from "../helpers/planning";

/**
 * The Backlog Health card as it is drawn (AM.3, #285): the mockup's `42 open` tag and
 * `38/42 · 4 · 6` meters, the nightly footnote with a real last-run time, and the designed zero
 * state for a workspace that has ingested nothing.
 */

/** The readings, with whatever health a case wants. */
function readings(over: Parameters<typeof planningReadings>[1] = {}) {
  return planningReadings(undefined, over);
}

describe("the card", () => {
  it("is a region named for the mockup's card title", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.getByRole("region", { name: HEALTH_TITLE })).toBeInTheDocument();
  });

  it("tags the head with the open count", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.getByText("42 open")).toBeInTheDocument();
  });

  // Since AM.5 (#287) the reason is the banner's, said once for the whole page.
  it("names what is missing and points at the banner for why", () => {
    render(<BacklogHealthCard readings={readings({ health: { ok: false, reason: "No." } })} />);

    expect(screen.getByText(HEALTH_UNREAD)).toBeInTheDocument();
    expect(screen.getByText(CARD_UNREAD_NOTE)).toBeInTheDocument();
    expect(screen.queryByText("No.")).not.toBeInTheDocument();
    expect(screen.queryByText("42 open")).not.toBeInTheDocument();
  });
});

describe("the meters", () => {
  it("draw the mockup's three figures", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.getByText("38/42")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Stale > 30d")).toBeInTheDocument();
  });

  it("announces each bar under its own name, with the figure in words", () => {
    render(<BacklogHealthCard readings={readings()} />);

    const sized = screen.getByRole("progressbar", { name: "Sized" });

    expect(sized).toHaveAttribute("aria-valuenow", "90");
    expect(sized).toHaveAttribute(
      "aria-valuetext",
      "38 of 42 open tickets have an estimate",
    );
  });

  it("fills each bar at the mockup's proportion", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.getByRole("progressbar", { name: "Blocked" })).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
    expect(screen.getByRole("progressbar", { name: "Stale > 30d" })).toHaveAttribute(
      "aria-valuenow",
      "14",
    );
  });

  it("hides each caption figure from the tree, since the bar already announces it", () => {
    const { container } = render(<BacklogHealthCard readings={readings()} />);

    for (const value of container.querySelectorAll(".planning-health__value")) {
      expect(value).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("tints each figure with its meter's own hue", () => {
    const { container } = render(<BacklogHealthCard readings={readings()} />);

    expect(container.querySelector(".planning-health__value--ok")).toHaveTextContent("38/42");
    expect(container.querySelector(".planning-health__value--warn")).toHaveTextContent("4");
    expect(container.querySelector(".planning-health__value--err")).toHaveTextContent("6");
  });
});

describe("the nightly footnote", () => {
  it("is the mockup's sentence with a real last-run time behind it", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.getByText(ESTIMATOR_FOOTNOTE, { exact: false })).toBeInTheDocument();
    // Measured from the readings' own instant, so the phrase is arithmetic rather than a clock.
    expect(screen.getByText(/last run 9h 46m ago/)).toBeInTheDocument();
  });

  it("hangs the checkable detail off the phrase as a tooltip", () => {
    render(<BacklogHealthCard readings={readings()} />);

    const phrase = screen.getByText(/last run 9h 46m ago/);

    expect(phrase).toHaveAttribute("title", expect.stringContaining("02:00 UTC"));
    expect(phrase).toHaveAttribute("title", expect.stringContaining("succeeded"));
    expect(phrase.textContent).toContain(LAST_RUN_LABEL);
  });

  it("says why the meters are figures rather than links", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.getByText(DRILL_THROUGH_NOTE)).toBeInTheDocument();
  });

  it("offers no meter as a link, since there is nowhere truthful to send one yet", () => {
    render(<BacklogHealthCard readings={readings()} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("an empty organisation", () => {
  it("shows zeros and still reads as the card it is", () => {
    render(<BacklogHealthCard readings={readings({ health: { ok: true, value: emptyHealth() } })} />);

    expect(screen.getByText("0 open")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(3);
    for (const bar of screen.getAllByRole("progressbar")) {
      expect(bar).toHaveAttribute("aria-valuenow", "0");
    }
    // The footnote is still a promise about a job, so it is still made and still checkable.
    expect(screen.getByText(ESTIMATOR_FOOTNOTE, { exact: false })).toBeInTheDocument();
  });

  it("says the job has not run rather than implying one that never happened", () => {
    render(<BacklogHealthCard readings={readings({ health: { ok: true, value: emptyHealth() } })} />);

    expect(screen.getByText(/not run yet/)).toBeInTheDocument();
    expect(screen.queryByText(/last run/)).not.toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it("renders identically under each, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(
      <BacklogHealthCard readings={readings({ health: { ok: true, value: seededHealth() } })} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("38/42");
  });
});
