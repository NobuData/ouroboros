import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSecondsNow } from "@/app/shell/clock";

/**
 * The shared ticking clock ([#82](https://github.com/NobuData/ouroboros/issues/82)).
 *
 * `client-value.ts` reads something the browser knows once; this reads something that keeps
 * changing. What is worth holding it to is the part that is a *store* rather than a hook: one
 * interval for however many readers there are, no interval at all once the last of them has
 * gone, and a server snapshot the caller supplies so a hydration pass has something to match.
 *
 * Timers are faked, because the thing under test is a timer. The system clock is set with
 * them so that the value the store reports and the interval that reports it move together.
 */

/** The instant every case here starts at. */
const START = Date.parse("2026-08-14T18:20:00.000Z");

/**
 * A component that draws the clock.
 *
 * @param props.onServer What to report where there is no browser.
 * @returns The current second, as text.
 */
function Ticker({ onServer = 0 }: Readonly<{ onServer?: number }>) {
  return <output>{useSecondsNow(onServer)}</output>;
}

/**
 * Move the clock, and let every interval that falls in the gap fire.
 *
 * @param seconds How far forward.
 */
function advance(seconds: number): void {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

/** What the tickers on screen are reporting. */
function reported(): string[] {
  return screen.getAllByRole("status").map((one) => one.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the clock", () => {
  it("reports the current second", () => {
    render(<Ticker />);

    expect(reported()).toEqual([String(Math.floor(START / 1000))]);
  });

  it("moves on once a second, without being asked", () => {
    render(<Ticker />);

    advance(1);
    expect(reported()).toEqual([String(Math.floor(START / 1000) + 1)]);

    advance(9);
    expect(reported()).toEqual([String(Math.floor(START / 1000) + 10)]);
  });

  it("reads the wall clock rather than counting its own ticks", () => {
    // A background tab has its timers throttled, so a counter that added one per tick would
    // come back minutes behind. This one asks what time it is, so a tab that was asleep for
    // an hour is an hour further on at its first tick.
    render(<Ticker />);

    act(() => {
      // An hour passes with the tab throttled — one tick's worth of interval fires at the
      // end of it, and the whole hour is there.
      vi.setSystemTime(START + 3599 * 1000);
      vi.advanceTimersByTime(1000);
    });

    expect(reported()).toEqual([String(Math.floor(START / 1000) + 3600)]);
  });

  it("reports a whole second, so a re-render inside one reads the same value", () => {
    // The property that keeps this a clock rather than a render loop: `useSyncExternalStore`
    // compares what the snapshot returns and re-renders whenever it differs, so a snapshot in
    // milliseconds would be a different value on every read — for ever.
    const { rerender } = render(<Ticker />);
    const first = reported();

    act(() => {
      vi.setSystemTime(START + 900);
    });
    rerender(<Ticker />);

    expect(reported()).toEqual(first);
  });
});

describe("the interval behind it", () => {
  it("runs one timer for however many readers there are", () => {
    // Ten rows of a table are ten readers and one clock; ten intervals would drift against
    // each other, so a column of durations could show two different seconds at once.
    const started = vi.spyOn(globalThis, "setInterval");

    render(
      <>
        <Ticker />
        <Ticker />
        <Ticker />
      </>,
    );

    expect(started).toHaveBeenCalledTimes(1);
  });

  it("keeps every reader on the same beat", () => {
    render(
      <>
        <Ticker />
        <Ticker />
      </>,
    );

    advance(3);

    const [first, second] = reported();
    expect(first).toBe(second);
  });

  it("stops when the last reader leaves, so a page can go idle", () => {
    const stopped = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(
      <>
        <Ticker />
        <Ticker />
      </>,
    );

    unmount();

    expect(stopped).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps ticking while any reader is left", () => {
    const { rerender } = render(
      <>
        <Ticker />
        <Ticker />
      </>,
    );

    rerender(<Ticker />);
    advance(2);

    expect(reported()).toEqual([String(Math.floor(START / 1000) + 2)]);
  });

  it("starts again after a page that had gone idle draws a clock", () => {
    // The store is a module singleton, so an interval that was cleared has to be startable a
    // second time — otherwise the second dashboard a session opens never ticks.
    const { unmount } = render(<Ticker />);
    unmount();

    render(<Ticker />);
    advance(1);

    expect(reported()).toEqual([String(Math.floor(START / 1000) + 1)]);
  });
});

describe("the render that has no browser", () => {
  it("reports what the caller said the server should", () => {
    // The server has a clock of its own; what it does not have is *this reader's*. The
    // caller passes its own reading so the first paint is a real time rather than a
    // placeholder that hydration would then have to replace.
    const html = renderToStaticMarkup(<Ticker onServer={1_700_000_000} />);

    expect(html).toContain("1700000000");
  });

  it("starts no timer there", () => {
    const started = vi.spyOn(globalThis, "setInterval");

    renderToStaticMarkup(<Ticker onServer={1_700_000_000} />);

    expect(started).not.toHaveBeenCalled();
  });
});
