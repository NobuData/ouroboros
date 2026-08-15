import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QueueCard } from "@/app/dashboard/queue-card";

import { dashboardPayload, failed, queueItem, read } from "../helpers/dashboard";

/**
 * *Up next in queue* (#85) — the mockup's `c-5` card.
 *
 * The issue's four acceptance criteria are all here: the seeded five rows reproduce the
 * mockup and exercise all five effort chips, the chips take the design system's own tones,
 * the *+N queued* footer appears only when the queue holds more than the card draws and says
 * the right remainder, and the empty state is a designed one rather than a blank card.
 *
 * The arithmetic behind the rows is `__tests__/dashboard/view.test.ts`'s. This suite is about
 * what reaches the DOM, the roles and names it reaches it under, and the classes that carry
 * the layout.
 */

/** The card, over the seeded aggregate. */
function seeded() {
  return <QueueCard aggregate={read(dashboardPayload())} />;
}

/**
 * The card, over a queue of a chosen length.
 *
 * @param head The rows the aggregate carries.
 * @param count What `stats.queued.count` reports — the whole queue, which the footer
 *   subtracts the drawn rows from. Defaults to the number of rows, which is a queue with
 *   nothing below the fold.
 * @returns The element.
 */
function withQueue(head: ReturnType<typeof queueItem>[], count = head.length) {
  const base = dashboardPayload();

  return (
    <QueueCard
      aggregate={read(
        dashboardPayload({
          queueHead: head,
          stats: { ...base.stats, queued: { count, estMinutes: 0 } },
        }),
      )}
    />
  );
}

/** The card, by its heading. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: "Up next in queue" });
}

describe("the seeded queue", () => {
  it("draws the mockup's five rows, in the payload's own order", () => {
    // The acceptance criterion, in one case: the seeded organization reproduces the mockup's
    // card. Nothing is re-sorted here — the endpoint orders the whole queue, and five rows
    // sorted again would come out in a different order from the listing that shows all of them.
    render(seeded());

    const rows = within(card()).getAllByRole("listitem");

    expect(rows.map((row) => row.textContent)).toEqual([
      "#485 Watchdog reset on I²C bus lockupMstandard-fix",
      "#486 Expose battery health over BLE GATTLfeature-loop",
      "#488 Typo sweep in operator manualXSdocs-loop",
      "#490 Migrate build to Zephyr 4.2XLdeps-refresh",
      "#491 Add CRC to config persistence layerSstandard-fix",
    ]);
  });

  it("exercises all five effort chips across those rows", () => {
    // The reason this card is where the scale is proved: it is the only surface in the product
    // that draws every size at once, and a size with no hue behind it would be invisible in a
    // screenshot of any other screen.
    render(seeded());

    const chips = [...card().querySelectorAll(".ou-chip--effort")];

    expect(chips.map((chip) => chip.textContent)).toEqual(["M", "L", "XS", "XL", "S"]);
  });

  it("spells the scale out for a reader meeting it for the first time", () => {
    // `XL` is an abbreviation of something the card never writes out, so the chip carries it.
    render(seeded());

    for (const chip of card().querySelectorAll(".ou-chip--effort")) {
      expect(chip.getAttribute("title")).toMatch(/^Effort: (XS|S|M|L|XL)$/);
    }
  });

  it("draws the workflow tag as metadata rather than as a state", () => {
    // A tag has no tones on purpose (#46): a workflow name is a label somebody wrote, and a
    // tag that could be red would be a chip.
    render(seeded());

    const tags = [...card().querySelectorAll(".ou-tag")];

    expect(tags.map((tag) => tag.textContent)).toEqual([
      "standard-fix",
      "feature-loop",
      "docs-loop",
      "deps-refresh",
      "standard-fix",
    ]);
  });

  it("keeps the issue number and its title as two words", () => {
    // The gap between them is a flex gap, which lays out no text — so without a real space a
    // screen reader reads "#485Watchdog reset…" as one word.
    render(seeded());

    const [first] = within(card()).getAllByRole("listitem");

    expect(first?.textContent).toContain("#485 Watchdog");
  });

  it("is a list, so a queue of five is announced as five of something", () => {
    // A queue row has no columns — the chip and the tag are properties of the issue rather
    // than a second and third measurement — so a table would have to invent headers to
    // justify itself.
    render(seeded());

    const list = within(card()).getByRole("list", {
      name: "Issues waiting for a loop, in queue order",
    });

    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(card().querySelectorAll("table")).toHaveLength(0);
  });

  it("names itself, so the card is reachable as a landmark", () => {
    render(seeded());

    expect(card()).toBeInTheDocument();
  });
});

describe("the chips' hues", () => {
  it("derives each from the size rather than from anything on this card", () => {
    // An `L` that was green somewhere would make the scale mean nothing, so the tone is the
    // chip primitive's own — and each is one of the token sheet's published triples, which is
    // what makes it legible in both palettes.
    render(seeded());

    const chips = [...card().querySelectorAll(".ou-chip--effort")];
    const tone = (chip: Element) =>
      [...chip.classList].find((name) => name.startsWith("ou-chip--") && name !== "ou-chip--effort");

    expect(chips.map(tone)).toEqual([
      // M, L, XS, XL, S — the middle is the ordinary case, the smallest two are cheap, and
      // the largest two are the ones worth a second look before they are picked up.
      "ou-chip--accent",
      "ou-chip--warn",
      "ou-chip--ok",
      "ou-chip--err",
      "ou-chip--ok",
    ]);
  });

  it("carries the size in words as well as in hue", () => {
    // Design system § 3.4: no meaning in colour alone. Two chips that share a tone are still
    // told apart by their letters — which is the whole label of an effort chip.
    render(seeded());

    for (const chip of card().querySelectorAll(".ou-chip--effort")) {
      expect(chip.textContent).toMatch(/^(XS|S|M|L|XL)$/);
    }
  });

  it("takes every one of the contract's five sizes", () => {
    // The mapping is a `Record` over the contract's union (`view.ts`), so this is the render
    // that proves each arm draws a chip rather than an empty box.
    render(
      withQueue(
        (["xs", "s", "m", "l", "xl"] as const).map((effort, index) =>
          queueItem({ id: `queued-${effort}`, issueNumber: 500 + index, effort }),
        ),
      ),
    );

    expect([...card().querySelectorAll(".ou-chip--effort")].map((c) => c.textContent)).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
    ]);
  });
});

describe("the +N queued footer", () => {
  it("reports the queue below the fold on the seeded workspace", () => {
    // Twelve queued, five drawn. The two figures are separately true: the head is capped at
    // five by the aggregate and the count speaks for the whole queue.
    render(seeded());

    expect(within(card()).getByRole("button", { name: "+7 queued →" })).toBeInTheDocument();
  });

  it("says nothing when the card is showing the whole queue", () => {
    // A footer promising more where there is none would be the one dishonest thing on a card
    // built to say what is coming.
    render(withQueue([queueItem()]));

    expect(within(card()).queryByRole("button", { name: /queued/ })).toBeNull();
  });

  it("says nothing when a count somehow runs behind its own slice", () => {
    // `−1 queued` is not a thing this card will ever say. The guard is `view.ts`'s.
    render(withQueue([queueItem(), queueItem({ id: "second", issueNumber: 486 })], 1));

    expect(within(card()).queryByRole("button", { name: /queued/ })).toBeNull();
  });

  it("counts the remainder from the count rather than from the rows it drew", () => {
    render(withQueue([queueItem()], 40));

    expect(within(card()).getByRole("button", { name: "+39 queued →" })).toBeInTheDocument();
  });
});

describe("what the card will not do yet", () => {
  it("offers `Manage queue →`, and it does not act", () => {
    // The queue screen is mockup 03 and #49 holds its route, which is post-MVP. Linking there
    // today would satisfy this issue by breaking #49's own first criterion.
    render(seeded());

    const manage = within(card()).getByRole("button", { name: "Manage queue →" });

    expect(manage).toHaveAttribute("aria-disabled", "true");
    expect(manage.getAttribute("title")).toMatch(/not built yet/);
  });

  it("keeps the explanation in the tab order", () => {
    // `aria-disabled` rather than `disabled`: a disabled button leaves the tab order and takes
    // its own tooltip with it, so the keyboard reader who most needs it can never reach it.
    render(seeded());

    for (const control of within(card()).getAllByRole("button")) {
      expect(control).not.toBeDisabled();
    }
  });

  it("says the same thing about the same destination twice", () => {
    // Both controls point at the queue screen. Two sentences for one missing screen would read
    // as two missing screens.
    render(seeded());

    const reasons = within(card())
      .getAllByRole("button")
      .map((control) => control.getAttribute("title"));

    expect(new Set(reasons).size).toBe(1);
  });

  it("links nowhere at all, rather than to a 404", () => {
    render(seeded());

    expect(within(card()).queryAllByRole("link")).toHaveLength(0);
  });

  it("draws no queued issue that did not come from the payload", () => {
    // The mockup fills this card with five plausible rows. An empty queue draws none of them.
    render(withQueue([]));

    expect(card().textContent).not.toMatch(/#\d{3}/);
  });
});

describe("a queue with nothing in it, and one nobody could read", () => {
  it("says the queue is empty, and what would fill it", () => {
    // A workspace that has caught up with its own queue has not failed at anything, so the
    // note says what puts a row here rather than apologising. #86 designs every card's zero
    // state together; this is the sentence until then.
    render(withQueue([]));

    expect(within(card()).getByText("Nothing is queued")).toBeInTheDocument();
    expect(within(card()).getByText(/appear here in the order/)).toBeInTheDocument();
  });

  it("keeps its heading and its control when it has no rows", () => {
    // The honesty rule applied to a whole card: a card with nothing in it is labelled, never
    // dead and never a blank region.
    render(withQueue([]));

    expect(within(card()).getByRole("button", { name: "Manage queue →" })).toBeInTheDocument();
  });

  it("reports the service's reason when the aggregate could not be read", () => {
    // An empty queue and an unread aggregate are different facts and must not read alike —
    // the same rule the stat row's em dash is written under.
    render(<QueueCard aggregate={failed("Choose a workspace first.")} />);

    expect(within(card()).getByText("The queue could not be read")).toBeInTheDocument();
    expect(within(card()).getByText("Choose a workspace first.")).toBeInTheDocument();
    expect(card().textContent).not.toContain("Nothing is queued");
  });

  it("draws no footer on a card that could not be read", () => {
    // The remainder is a subtraction over two figures from the same payload, so a payload
    // nobody could read has neither.
    render(<QueueCard aggregate={failed("Nope.")} />);

    expect(within(card()).queryByRole("button", { name: /queued/ })).toBeNull();
  });
});

describe("the card's own shape", () => {
  it("takes the grid's five columns, as the mockup lays it out", () => {
    const { container } = render(seeded());

    expect(container.querySelector(".ou-card")).toHaveClass("dash-col--5");
  });

  it("carries every colour and length in a class, none of them inline", () => {
    // The mockup writes this card's padding, borders and gaps as `style=` attributes. Every
    // one of them belongs in the sheet, where the theme can reach it.
    const { container } = render(seeded());

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("builds its rows out of the design system rather than out of shapes of its own", () => {
    // The card, its head, the button, the chips and the tags are all #46's. What this card
    // contributes is the list they stand in.
    const { container } = render(seeded());

    expect(container.querySelectorAll(".ou-card")).toHaveLength(1);
    expect(container.querySelectorAll(".ou-chip")).toHaveLength(5);
    expect(container.querySelectorAll(".ou-tag")).toHaveLength(5);
    expect(container.querySelectorAll(".dash-queue__row")).toHaveLength(5);
  });
});
