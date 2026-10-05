import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatsCard } from "@/app/inbox/stats-card";
import { STATS_METHOD_LABEL, UNREACHABLE_STATS, UNREADABLE_STATS } from "@/app/inbox/stats-view";

import { coldStats, inboxStats } from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * **This week** (BO.5, #470, mockup 16): `11 decisions · median answer time 41s · loops never
 * waited longer than 6m` from the seeds, em dashes on a cold workspace, a methodology a keyboard
 * reaches, and a designed failure.
 */

/** The card, by its name. */
const card = () => screen.getByRole("region", { name: "This week" });

describe("the seeded week", () => {
  it("matches the mockup", () => {
    render(<StatsCard failure={null} stats={inboxStats()} />);

    expect(card()).toHaveTextContent("This week");
    expect(card().querySelector(".ou-stat__value")).toHaveTextContent(/^11 decisions$/);
    expect(card().querySelector(".ou-stat__delta")).toHaveTextContent(
      /^median answer time 41s · loops never waited longer than 6m$/,
    );
  });

  it("sets the two durations in the mockup's mono", () => {
    const { container } = render(<StatsCard failure={null} stats={inboxStats()} />);

    expect([...container.querySelectorAll(".inbox-stat__figure")].map((node) => node.textContent)).toEqual([
      "41s",
      "6m",
    ]);
  });

  it("prints what the service printed — the numbers change when the seeds do", () => {
    render(
      <StatsCard
        failure={null}
        stats={inboxStats({ decisions: 1, display: { decisions: "1", medianAnswer: "3m", maxLoopWait: "2h" } })}
      />,
    );

    expect(card().querySelector(".ou-stat__value")).toHaveTextContent(/^1 decision$/);
    expect(card()).toHaveTextContent("median answer time 3m · loops never waited longer than 2h");
  });

  it("keeps a failed later read's figures — the read on screen is still the week", () => {
    render(<StatsCard failure={UNREACHABLE_STATS} stats={inboxStats()} />);

    expect(card()).toHaveTextContent("11 decisions");
    expect(card()).not.toHaveTextContent(UNREACHABLE_STATS);
  });
});

describe("a cold workspace", () => {
  it("renders em dashes, never zeros", () => {
    render(<StatsCard failure={null} stats={coldStats()} />);

    expect(card().querySelector(".ou-stat__value")).toHaveTextContent(/^— decisions$/);
    expect(card().querySelector(".ou-stat__delta")).toHaveTextContent(
      /^median answer time — · loops never waited longer than —$/,
    );
    expect(card().querySelector(".ou-stat__value")!.textContent).not.toMatch(/\d/);
    expect(card().querySelector(".ou-stat__delta")!.textContent).not.toMatch(/\d/);
  });
});

describe("the methodology", () => {
  it("is a control a keyboard reaches, described by a note that tells the two measures apart", () => {
    render(<StatsCard failure={null} stats={inboxStats()} />);

    const control = within(card()).getByRole("button", { name: STATS_METHOD_LABEL });

    expect(control).toHaveAccessibleDescription(expect.stringContaining("Median answer time is answer latency"));
    expect(control).toHaveAccessibleDescription(expect.stringContaining("Loop wait is a different measure"));

    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    expect(within(card()).getByRole("note")).toHaveTextContent(
      /from when it was asked to when it was answered.*the longest span any run sat blocked/,
    );
  });
});

describe("a failed read", () => {
  it("is the tile's failed state with the reason, not a gap in the column", () => {
    render(<StatsCard failure={UNREACHABLE_STATS} stats={null} />);

    expect(card()).toHaveTextContent("This week");
    expect(card().querySelector(".ou-stat__value")).toHaveTextContent(/^—$/);
    expect(card().querySelector(".ou-stat__delta")).toHaveClass("ou-stat__delta--failed");
    expect(card().querySelector(".ou-stat__delta")).toHaveTextContent(UNREACHABLE_STATS);
    expect(within(card()).queryByRole("button")).toBeNull();
  });

  it("says its own words when it was handed no reason", () => {
    render(<StatsCard failure={null} stats={null} />);

    expect(card()).toHaveTextContent(UNREADABLE_STATS);
  });
});

describe("both themes", () => {
  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<StatsCard failure={null} stats={inboxStats()} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
