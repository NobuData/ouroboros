import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PulseCard } from "@/app/dashboard/pulse-card";
import { PULSE_UNMEASURED } from "@/app/dashboard/view";

import { dashboardPayload, emptyDashboard, failed, read } from "../helpers/dashboard";
import { membership } from "../helpers/login";
import { renderInBothPalettes } from "../helpers/palettes";

/**
 * *Loop pulse* ([#83](https://github.com/NobuData/ouroboros/issues/83)) — the mockup's `c-4`
 * card as a rendered thing.
 *
 * The arithmetic behind every figure and every bar is `view.test.ts`'s (`pulseMeters`), and
 * what the switch *does* is `auto-merge-switch.test.tsx`'s. This suite is the rest of the
 * issue's criteria: that the seeded card carries the mockup's values and widths, that the
 * glyph is the #14 asset pair rather than a blend-mode trick, that a member sees the switch
 * disabled with a reason, and that a pulse nobody could read is not drawn as a workspace that
 * merges nothing.
 */

// The switch is a Client Component over a Server Action: the action module sits on the
// server-only client and `useRouter()` wants the App Router mounted, neither of which a jsdom
// render has. Both are replaced here and are their own suites' subjects.
vi.mock("@/app/dashboard/pulse-actions", () => ({ setAutoMerge: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** The card, by its heading. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: "Loop pulse" });
}

/**
 * One meter, by the name it is announced under.
 *
 * @param label The caption the bar takes its accessible name from.
 * @returns The `progressbar`.
 */
function meter(label: string): HTMLElement {
  return within(card()).getByRole("progressbar", { name: label });
}

/** The seeded card, drawn for an owner. */
function renderSeeded() {
  return render(<PulseCard aggregate={read(dashboardPayload())} workspace={membership()} />);
}

describe("the card", () => {
  it("is a region named as the mockup titles it", () => {
    renderSeeded();

    expect(card()).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Loop pulse" })).toBeInTheDocument();
  });

  it("takes the mockup's column, so the grid keeps its shape", () => {
    const { container } = renderSeeded();

    expect(container.querySelector(".ou-card")).toHaveClass("dash-col--4");
  });

  it("carries the mockup's window tag", () => {
    // By its shape rather than its words: `7 days` is also what two of the three meters say
    // about themselves, and the tag is the card's own claim rather than one of theirs.
    const { container } = renderSeeded();

    expect(container.querySelector(".ou-tag")).toHaveTextContent("7 days");
  });
});

describe("the three meters", () => {
  it("prints the mockup's figures", () => {
    renderSeeded();

    for (const value of ["92%", "14m 20s", "2 this week"]) {
      expect(within(card()).getByText(value)).toBeInTheDocument();
    }
  });

  it("draws the mockup's widths, through the primitive's own custom property", () => {
    // The one length on this page that is data (`app/ui/meter.tsx`), so the sheet still owns
    // the property and the card contributes only the datum.
    const { container } = renderSeeded();

    const fills = [...container.querySelectorAll(".ou-meter__fill")].map((fill) =>
      fill.getAttribute("style"),
    );

    expect(fills).toEqual([
      "--ou-meter-fill: 92%;",
      "--ou-meter-fill: 48%;",
      "--ou-meter-fill: 8%;",
    ]);
  });

  it("hues each bar as the mockup hues it", () => {
    const { container } = renderSeeded();

    const bars = [...container.querySelectorAll(".ou-meter")];

    expect(bars[0]).toHaveClass("ou-meter--ok");
    // The cycle time takes the default accent: it reports neither a success nor a warning.
    expect(bars[1]?.className).toBe("ou-meter");
    expect(bars[2]).toHaveClass("ou-meter--warn");
  });

  it("announces each bar with its own window and denominator", () => {
    // The figure beside a bar is hidden from the accessibility tree, so this is the only
    // statement of it a screen reader gets — and it has to carry what the caption's position
    // tells a sighted reader.
    renderSeeded();

    expect(meter("Autonomous merge rate")).toHaveAttribute(
      "aria-valuetext",
      "92% of runs merged without a person, over 14 days",
    );
    expect(meter("Avg. cycle time")).toHaveAttribute("aria-valuenow", "48");
    expect(meter("Human interventions")).toHaveAttribute(
      "aria-valuetext",
      "2 runs needed a person, of the 25 this workspace allows for in 7 days",
    );
  });

  it("says nothing twice: the figure is drawn for the eye and spoken by the bar", () => {
    const { container } = renderSeeded();

    for (const value of container.querySelectorAll(".dash-pulse__value")) {
      expect(value).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("prints the window each row was measured over rather than inheriting the tag", () => {
    // The roadmap asks this card for it by name: two of the three are the head tag's seven
    // days and the merge rate is fourteen, and a reader must not have to know that.
    renderSeeded();

    expect(within(card()).getByText("14 days")).toBeInTheDocument();
    expect(within(card()).getAllByText("7 days")).toHaveLength(3);
  });
});

describe("the glyph", () => {
  it("draws the #14 pair, both treatments, from the copies under public/", () => {
    // Both are laid out at all times — the swap is an opacity change in CSS — so a mismatched
    // pair would size the box by the larger of the two and move the card.
    const { container } = renderSeeded();

    // `next/image` rewrites the attribute through the optimizer, so the file is read out of
    // the URL it was given rather than compared to it whole.
    const marks = [...container.querySelectorAll(".dash-pulse__mark")].map((mark) =>
      decodeURIComponent(mark.getAttribute("src") ?? ""),
    );

    expect(marks).toHaveLength(2);
    expect(marks[0]).toContain("/brand/glyph-light.png");
    expect(marks[1]).toContain("/brand/glyph-dark.png");
  });

  it("renders identically under both palettes, so CSS is what chooses a treatment", () => {
    // The acceptance criterion — *the glyph renders on both themes* — as the property that
    // makes it true: a component that picked a mark in JavaScript could not be painted before
    // hydration, and would render differently on the server than in the browser.
    const [light, dark] = renderInBothPalettes(
      <PulseCard aggregate={read(dashboardPayload())} workspace={membership()} />,
    );

    expect(light).toBe(dark);
  });

  it("is decoration, not a second name for the card", () => {
    // The card is already called *Loop pulse*; a mark announced inside it would be describing
    // the technique rather than the page.
    const { container } = renderSeeded();

    for (const mark of container.querySelectorAll(".dash-pulse__mark")) {
      expect(mark).toHaveAttribute("alt", "");
    }
  });

  it("paints no blend mode or filter over it", () => {
    // docs/BRAND.md § Rules bans both on this pair by name: the mockup needed them because
    // its crop still had a background attached, and this one does not. The sheet is where a
    // regression would appear, so this reads the sheet.
    const { container } = renderSeeded();

    expect(container.innerHTML).not.toMatch(/mix-blend-mode|drop-shadow/);
  });
});

describe("the auto-merge switch", () => {
  it("draws the mockup's row, in the position the workspace is actually in", () => {
    renderSeeded();

    expect(within(card()).getByText("Auto-merge when checks pass")).toBeInTheDocument();
    expect(within(card()).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("draws a workspace that has not switched it on as off", () => {
    render(<PulseCard aggregate={read(emptyDashboard())} workspace={membership()} />);

    expect(within(card()).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("gives an owner a switch that can be pressed", () => {
    renderSeeded();

    const control = within(card()).getByRole("switch");

    expect(control).not.toHaveAttribute("aria-disabled");
    expect(control).not.toHaveAttribute("title");
  });

  it("shows a member the switch, disabled, with the reason in reach", () => {
    // The design system's § 3.3 permission-limited state: same control, same position, and
    // the reason as its tooltip *and* its description — hiding it would leave a card that
    // looks like it has no setting.
    render(
      <PulseCard
        aggregate={read(dashboardPayload())}
        workspace={membership({ roles: ["member"] })}
      />,
    );

    const control = within(card()).getByRole("switch");
    const reason = "Only an owner or an admin can change auto-merge for this workspace.";

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", reason);
    expect(control).toHaveAccessibleDescription(reason);
    // `aria-disabled` rather than `disabled`, so the explanation keeps its place in the tab
    // order along with the control that needs explaining.
    expect(control).not.toBeDisabled();
  });

  it("gives an admin the same switch an owner gets", () => {
    render(
      <PulseCard
        aggregate={read(dashboardPayload())}
        workspace={membership({ roles: ["admin"] })}
      />,
    );

    expect(within(card()).getByRole("switch")).not.toHaveAttribute("aria-disabled");
  });

  it("does not let a viewer press it either", () => {
    render(
      <PulseCard
        aggregate={read(dashboardPayload())}
        workspace={membership({ roles: ["viewer"] })}
      />,
    );

    expect(within(card()).getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a workspace with nothing to measure", () => {
  it("draws empty bars and says why, rather than reporting a bad week", () => {
    render(<PulseCard aggregate={read(emptyDashboard())} workspace={membership()} />);

    expect(within(card()).getByText(PULSE_UNMEASURED)).toBeInTheDocument();
    expect(within(card()).getByText("0%")).toBeInTheDocument();
  });

  it("says nothing of the kind once something has closed", () => {
    renderSeeded();

    expect(screen.queryByText(PULSE_UNMEASURED)).toBeNull();
  });
});

describe("a pulse that could not be read", () => {
  it("says what it could not read instead of drawing a figure", () => {
    render(<PulseCard aggregate={failed("Choose a workspace first.")} workspace={membership()} />);

    expect(within(card()).getByText("The pulse could not be read.")).toBeInTheDocument();
    expect(within(card()).queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("leaves the reason to the page's banner, and repeats none of it (#86)", () => {
    // The service's sentence appeared here and in eight other places on one page. It is
    // `app/dashboard/stale-banner.tsx`'s now, beside the only retry there is.
    render(<PulseCard aggregate={failed("Choose a workspace first.")} workspace={membership()} />);

    expect(within(card()).queryByText("Choose a workspace first.")).toBeNull();
  });

  it("offers no switch to press, because there is no position to draw", () => {
    // A switch defaulted to `off` here would be this card inventing the one fact on the page
    // that changes what the loop does without asking anybody.
    render(<PulseCard aggregate={failed("Something went wrong.")} workspace={membership()} />);

    expect(within(card()).queryByRole("switch")).toBeNull();
    expect(within(card()).getByText("—")).toBeInTheDocument();
  });

  it("keeps its place on the grid, named, rather than disappearing", () => {
    const { container } = render(
      <PulseCard aggregate={failed("Something went wrong.")} workspace={membership()} />,
    );

    expect(container.querySelector(".ou-card")).toHaveClass("dash-col--4");
    expect(card()).toBeInTheDocument();
  });
});
