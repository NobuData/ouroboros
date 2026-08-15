import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DashboardSummary } from "@/app/dashboard/summary";
import { DashboardSummaryProvider } from "@/app/dashboard/summary-store";
import { LoopPills, NEEDS_YOU_NOTE } from "@/app/shell/loop-pills";

import { emptySummary, summary } from "../helpers/dashboard";

/**
 * The two pills, from real counts
 * ([#78](https://github.com/NobuData/ouroboros/issues/78)).
 *
 * Every acceptance criterion of the issue is here except the two that are not assertions
 * about markup: *counts update on the polling cadence* is the store's, held by
 * `__tests__/dashboard/summary-poll.test.ts` and by the pills rendering whatever it last
 * published; and *the dot treatments match the design system in both themes* is the
 * stylesheet's, held by `shell-styles.test.ts` and by `styles.test.ts`'s ban on a colour
 * literal outside the token sheet — jsdom computes no styles, so a rendering test asserting
 * a hue would be asserting its own fixture.
 *
 * The store is stubbed by rendering the **real** provider over a reader that answers once,
 * rather than by mocking the hook: what the pills consume is the snapshot shape, and this
 * way a change to that shape breaks here instead of passing against a mock of the old one.
 */

/**
 * The pills, over a store that has read one payload.
 *
 * @param data What the poll answered with, or `null` for a poll that has not answered yet —
 *   which is the state every screen is in for one round trip after it loads.
 * @returns The render, for the cases that ask the DOM a structural question.
 */
async function pills(data: DashboardSummary | null) {
  const answer =
    data === null
      ? ({ state: "failed", reason: "still asking", pollAfterSeconds: null } as const)
      : ({ state: "fresh", summary: data, etag: null, pollAfterSeconds: null } as const);

  const view = render(
    <DashboardSummaryProvider poll={{ read: () => Promise.resolve(answer), visible: () => true }}>
      <LoopPills />
    </DashboardSummaryProvider>,
  );

  // The provider polls from an effect, so the first answer lands a microtask after the
  // render rather than during it.
  await act(async () => {});

  return view;
}

describe("the live-loops pill", () => {
  it("shows the seeded organization's count", async () => {
    await pills(summary());

    // Three, which is what `ouroboros-rest`'s own fixture asserts the seed produces, and
    // what mockup 02 draws.
    expect(screen.getByText(/loops live/)).toHaveTextContent("3 loops live");
  });

  it("is not drawn for an organization with nothing running", async () => {
    await pills(emptySummary());

    // Not `0 loops live`: an empty workspace is better described by the absence of the claim
    // than by a nought, which is the same honesty rule the em dash it replaced was keeping.
    expect(screen.queryByText(/loops live/)).toBeNull();
  });

  it("is not drawn before the first answer arrives", async () => {
    await pills(null);

    expect(screen.queryByText(/loops live/)).toBeNull();
  });

  it("wears the accent dot the design system reserves for a live thing", async () => {
    const { container } = await pills(summary());

    const dot = container.querySelector(".shell-pill__dot--live");
    expect(dot).not.toBeNull();
    // Decoration: the sentence beside it already says the loop is live, and a dot a screen
    // reader announced would be a bullet read before every count.
    expect(dot).toHaveAttribute("aria-hidden");
  });
});

describe("the needs-you pill", () => {
  it("shows how many runs stopped for a human", async () => {
    await pills(summary());

    const pill = screen.getByTitle(NEEDS_YOU_NOTE);
    expect(pill).toHaveTextContent("Needs you");
    expect(pill).toHaveTextContent("2");
  });

  it("is not drawn when nothing needs anybody", async () => {
    await pills(emptySummary());

    expect(screen.queryByText(/Needs you/)).toBeNull();
  });

  it("says what its number counts, because seven days is not right now", async () => {
    await pills(summary());

    // `interventions7d` is a trailing-seven-day count, not a live queue — without saying so
    // the pill would read as two things waiting at this moment.
    expect(screen.getByTitle(NEEDS_YOU_NOTE)).toBeInTheDocument();
    expect(NEEDS_YOU_NOTE).toMatch(/seven days/);
  });

  it("is not a link, because the inbox it would link to does not exist", async () => {
    await pills(summary());

    // `/inbox` is #49's placeholder and mockup 16's screen. Linking now would be a link to a
    // 404 — exactly what the sidebar's own *Needs You* entry declines to be — so the note
    // stands in for the destination until then.
    expect(screen.queryByRole("link", { name: /Needs you/ })).toBeNull();
    expect(NEEDS_YOU_NOTE).toContain("#49");
  });

  it("wears the warn treatment rather than the live one", async () => {
    const { container } = await pills(summary());

    expect(container.querySelector(".shell-pill--warn")).not.toBeNull();
    expect(container.querySelector(".shell-pill__dot--warn")).not.toBeNull();
    // Not the pulse: that is what distinguishes *running right now* from *waiting for you*.
    expect(container.querySelector(".shell-pill--warn .shell-pill__dot--live")).toBeNull();
  });
});

describe("the pills together", () => {
  it("announce their counts from a region that was already there", async () => {
    const view = render(
      <DashboardSummaryProvider
        poll={{
          read: () =>
            Promise.resolve({
              state: "fresh" as const,
              summary: summary(),
              etag: null,
              pollAfterSeconds: null,
            }),
          visible: () => true,
        }}
      >
        <LoopPills />
      </DashboardSummaryProvider>,
    );

    // Before the first answer: the region exists and is empty. That order is the point — a
    // live region inserted along with its own first announcement is one a screen reader may
    // never read.
    const region = view.container.querySelector(".shell-pills");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region?.children).toHaveLength(0);

    await act(async () => {});

    expect(view.container.querySelector(".shell-pills")?.children).toHaveLength(2);
  });

  it("re-announce a count that moved, without the pills coming and going", async () => {
    // The criterion is *count changes are announced*, and this is the shape that makes it
    // true: the region is the same element before and after, so a screen reader reads an
    // update rather than an insertion.
    let live = 3;
    const view = render(
      <DashboardSummaryProvider
        poll={{
          read: () => {
            const payload = summary();
            payload.stats.loopsLive.total = live;
            live += 1;
            return Promise.resolve({
              state: "fresh" as const,
              summary: payload,
              etag: null,
              pollAfterSeconds: 1,
            });
          },
          visible: () => true,
        }}
      >
        <LoopPills />
      </DashboardSummaryProvider>,
    );

    await act(async () => {});
    const region = view.container.querySelector(".shell-pills");
    expect(region).toHaveTextContent("3 loops live");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    });

    expect(view.container.querySelector(".shell-pills")).toBe(region);
    expect(region).toHaveTextContent("4 loops live");
  });

  it("leave an empty organization with a region and no claims in it", async () => {
    const { container } = await pills(emptySummary());

    const region = container.querySelector(".shell-pills");
    expect(region?.children).toHaveLength(0);
    // Empty, so the stylesheet's `:empty` rule takes it out of the header's flex row
    // entirely rather than paying a gap for a region carrying nothing.
    expect(region?.textContent).toBe("");
  });
});
