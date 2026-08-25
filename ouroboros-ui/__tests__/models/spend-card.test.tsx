import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpendCard } from "@/app/models/spend-card";
import {
  FULL_REPORT,
  FULL_REPORT_REASON,
  NO_SPEND_TITLE,
  UNPRICED,
} from "@/app/models/spend";

import { emptySpend, seededSpend, spendRow } from "../helpers/models";
import { PALETTES, renderInBothPalettes } from "../helpers/palettes";

/**
 * The spend card as it is drawn (#204) — mockup 06's metered rows, the local share, and the
 * report that is not built.
 *
 * What every row *says* is `spend.test.ts`'s, decided as functions over Z.5's oracle. What is
 * here is what only a render can show: that the seeded rows come out as the mockup draws them,
 * that an unpriced row and a `$0.00` row are two different pictures, that an empty workspace
 * gets a sentence rather than four zeros, and that **Full report →** is inert and says why.
 */

/** The card's rows, as list items. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("list")).getAllByRole("listitem");
}

describe("the seeded card", () => {
  it("is titled from the window, and is a named region", () => {
    render(<SpendCard spend={seededSpend()} />);

    expect(screen.getByRole("region", { name: "Spend by provider · 30d" })).toBeInTheDocument();
  });

  it("draws the four rows in the service's order with the figures the ledger produced", () => {
    render(<SpendCard spend={seededSpend()} />);

    expect(rows().map((row) => row.querySelector(".models-spend__name")?.textContent)).toEqual([
      "Anthropic",
      "GitHub Copilot",
      "Cursor",
      "Local (Ollama + OpenAI-compatible)",
    ]);
    expect(rows().map((row) => row.querySelector(".models-spend__amount")?.textContent)).toEqual([
      "$412.80",
      // Not the mockup's `$96.40` and `$54.10` — the seed's finding, recorded in the roadmap.
      "$76.00",
      "$64.10",
      "$0.00",
    ]);
  });

  it("draws the meters relative to the largest row, with the local row on the ok meter", () => {
    render(<SpendCard spend={seededSpend()} />);

    const meters = rows().map((row) => row.querySelector(".ou-meter"));
    const widths = meters.map((meter) =>
      (meter?.querySelector(".ou-meter__fill") as HTMLElement | null)?.style.getPropertyValue(
        "--ou-meter-fill",
      ),
    );

    expect(widths).toEqual(["100%", "18.4%", "15.5%", "2%"]);
    expect(meters[0]).not.toHaveClass("ou-meter--ok");
    expect(meters[3]).toHaveClass("ou-meter--ok");
  });

  it("keeps the meters out of the accessibility tree, because the line above each one speaks", () => {
    render(<SpendCard spend={seededSpend()} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("prints the footnote as the mockup does", () => {
    render(<SpendCard spend={seededSpend()} />);

    expect(screen.getByText("Local models served 31% of all tokens.")).toBeInTheDocument();
  });

  it("says the local row's $0.00 is a floor over five unpriced calls", () => {
    // Both facts at once: priced at nothing, and five calls nobody priced.
    render(<SpendCard spend={seededSpend()} />);

    const local = rows()[3];

    expect(within(local).getByText("$0.00")).toBeInTheDocument();
    expect(within(local).getByText("5 unpriced calls")).toBeInTheDocument();
  });

  it("carries no unpriced note on a row every call of which was priced", () => {
    render(<SpendCard spend={seededSpend()} />);

    expect(rows()[0].querySelector(".models-spend__partial")).toBeNull();
  });
});

describe("an unpriced row", () => {
  const spend = {
    ...seededSpend(),
    providers: [
      ...seededSpend().providers,
      spendRow({
        key: "custom",
        kinds: ["custom"],
        spendCents: null,
        meterFraction: null,
        pricedCalls: 0,
        unpricedCalls: 9,
      }),
    ],
  };

  it("prints the word, not a figure, and never $0.00", () => {
    render(<SpendCard spend={spend} />);

    const row = rows()[4];

    expect(within(row).getByText(UNPRICED)).toHaveClass("models-spend__unpriced");
    expect(row.querySelector(".models-spend__amount")).toBeNull();
    expect(row).toHaveClass("models-spend__row--unpriced");
  });

  it("draws a dashed track where the meter would be, rather than an empty meter", () => {
    // An empty meter is what a row that cost nothing looks like; the two must not be the
    // same picture.
    render(<SpendCard spend={spend} />);

    const row = rows()[4];

    expect(row.querySelector(".ou-meter")).toBeNull();
    expect(row.querySelector(".models-spend__track--unpriced")).not.toBeNull();
  });

  it("does not repeat the count beside the word", () => {
    render(<SpendCard spend={spend} />);

    expect(rows()[4].querySelector(".models-spend__partial")).toBeNull();
  });
});

describe("a workspace that has spent nothing", () => {
  it("gets the zero-state, and no row of zeros", () => {
    render(<SpendCard spend={emptySpend()} />);

    expect(screen.getByText(NO_SPEND_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/last 30 days/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("prints no footnote, because there is no share to claim", () => {
    render(<SpendCard spend={emptySpend()} />);

    expect(screen.queryByText(/Local models served/)).not.toBeInTheDocument();
  });

  it("still offers the report's control, inert, so the shape of the card is the same", () => {
    render(<SpendCard spend={emptySpend()} />);

    expect(screen.getByRole("button", { name: FULL_REPORT })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Full report →", () => {
  it("is an honest `soon` that names its owner, not a link", () => {
    // AB.4 (#210) does not exist. An inert link has no honest rendering, so the control is a
    // button with a reason — the same treatment the Models tab set gives the Spend tab.
    render(<SpendCard spend={seededSpend()} />);

    const report = screen.getByRole("button", { name: FULL_REPORT });

    expect(report).toHaveAttribute("aria-disabled", "true");
    expect(report).toHaveAttribute("title", FULL_REPORT_REASON);
    expect(report.getAttribute("title")).toMatch(/#210/);
    expect(screen.queryByRole("link", { name: FULL_REPORT })).not.toBeInTheDocument();
  });

  it("stays in the tab order, so a keyboard reader can reach the reason", () => {
    render(<SpendCard spend={seededSpend()} />);

    expect(screen.getByRole("button", { name: FULL_REPORT })).not.toBeDisabled();
  });
});

describe("the palettes", () => {
  it("renders the same markup under both, so nothing is decided in JavaScript from the theme", () => {
    const [light, dark] = renderInBothPalettes(<SpendCard spend={seededSpend()} />);

    expect(light).toBe(dark);
    expect(PALETTES).toHaveLength(2);
  });
});
