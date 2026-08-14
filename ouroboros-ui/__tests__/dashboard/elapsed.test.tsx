import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Elapsed } from "@/app/dashboard/elapsed";

/**
 * The elapsed column, which is the one thing on this page that moves on its own
 * ([#82](https://github.com/NobuData/ouroboros/issues/82)).
 *
 * Its acceptance criterion has two halves and they pull in opposite directions: the figure
 * must **advance between polls**, which needs a clock, and it must **never jump backward when
 * a poll lands**, which is what a clock plus a stale server figure would do to it. Both fall
 * out of counting from the run's start rather than from the duration the server computed, and
 * this suite is where that is pinned.
 *
 * The formatting itself is `__tests__/format.test.ts`'s.
 */

/** The instant every case starts at, and the origin the runs below are measured from. */
const NOW = Date.parse("2026-08-14T18:20:00.000Z");

/** {@link NOW} in the whole seconds the component works in. */
const NOW_SECONDS = Math.floor(NOW / 1000);

/**
 * Render one run's elapsed cell.
 *
 * @param elapsed How long the server said it had been running.
 * @param startedAt When it started, in seconds since the epoch. Defaults to whatever makes
 *   the server's figure true.
 * @returns The Testing Library render result.
 */
function elapsed(elapsedSeconds: number, startedAt = NOW_SECONDS - elapsedSeconds) {
  return render(
    <output>
      <Elapsed startedAtSeconds={startedAt} serverSeconds={elapsedSeconds} />
    </output>,
  );
}

/** What the cell currently reads. */
function shown(): string {
  return screen.getByRole("status").textContent ?? "";
}

/**
 * Let the clock run.
 *
 * @param seconds How far.
 */
function advance(seconds: number): void {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what it draws", () => {
  it("is the mockup's own figure for the seeded run", () => {
    elapsed(760);

    expect(shown()).toBe("12m 40s");
  });

  it("advances once a second, with no poll and no new data", () => {
    // The half of the criterion that needs a clock: between two polls the client is the only
    // thing that knows any time has passed at all.
    elapsed(760);

    advance(1);
    expect(shown()).toBe("12m 41s");

    advance(20);
    expect(shown()).toBe("13m 01s");
  });

  it("counts from the run's start rather than adding to the server's figure", () => {
    // The distinction that matters when a tab has been throttled or a render was slow: the
    // figure is recomputed from the origin, so it is *correct* rather than merely increasing.
    elapsed(760);

    act(() => {
      vi.setSystemTime(NOW + 299 * 1000);
      vi.advanceTimersByTime(1000);
    });

    expect(shown()).toBe("17m 40s");
  });
});

describe("what a poll cannot do to it", () => {
  it("does not move when the same run is re-rendered with a fresh reading", () => {
    // #87's poll brings the same `startedAt` — the field is immutable for the life of a run
    // — so the arithmetic lands on the same figure. There is nothing to jump back to.
    const { rerender } = elapsed(760);

    advance(30);
    expect(shown()).toBe("13m 10s");

    rerender(
      <output>
        <Elapsed startedAtSeconds={NOW_SECONDS - 760} serverSeconds={790} />
      </output>,
    );

    expect(shown()).toBe("13m 10s");
  });

  it("holds the server's reading as a floor when the browser's clock runs behind", () => {
    // The one moment the figure could still go backwards: hydration, where two machines
    // answer "what time is it" and one of them is slow. The server's own reading wins until
    // the reader's clock passes it.
    elapsed(760, NOW_SECONDS - 700);

    expect(shown()).toBe("12m 40s");

    advance(30);
    expect(shown()).toBe("12m 40s");
  });

  it("never counts backwards from a start that is in the future", () => {
    // A clock disagreeing with another clock, drawn as a fact about the run, would be the
    // one figure on this card that is not a measurement.
    elapsed(0, NOW_SECONDS + 500);

    expect(shown()).toBe("0m 00s");
  });
});

describe("the render that has no browser", () => {
  it("draws the server's own reading rather than a placeholder", () => {
    // This is the markup hydration matches against. A dash here would mean every run on the
    // page changed its mind about how long it had been running the moment React attached.
    const html = renderToStaticMarkup(
      <Elapsed startedAtSeconds={NOW_SECONDS - 2285} serverSeconds={2285} />,
    );

    expect(html).toBe("38m 05s");
  });
});
