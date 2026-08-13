import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useMediaQuery } from "@/app/media-query";

import { type MediaController, installMatchMedia } from "./helpers/match-media";

/**
 * The hook that lets a component ask what the stylesheet already knows.
 *
 * Two of the shell's decisions are behaviour rather than appearance — which way the collapse
 * control is about to move the sidebar, and whether the drawer should trap focus — and both
 * turn on a breakpoint `app/shell/shell.css` owns. What matters here is that the answer stays
 * current as the viewport moves and that the subscription is given back on unmount: a
 * listener left on a `MediaQueryList` outlives the component that wanted it.
 */

const QUERY = "(max-width: 48rem)";

/** The controllable `matchMedia` a case installed, removed afterwards. */
let media: MediaController | undefined;

afterEach(() => {
  media?.restore();
  media = undefined;
});

/**
 * A component that renders nothing but the hook's answer.
 *
 * @returns The answer, as text a case can read.
 */
function Probe() {
  return <span data-testid="answer">{String(useMediaQuery(QUERY))}</span>;
}

/**
 * What the probe currently says.
 *
 * @returns The rendered answer.
 */
function answer(): string {
  return screen.getByTestId("answer").textContent ?? "";
}

describe("useMediaQuery", () => {
  it("answers false for a query nothing matches", () => {
    // jsdom's own `matchMedia` never matches, which is the same answer a server render gives
    // and the same one the base stylesheet assumes.
    render(<Probe />);

    expect(answer()).toBe("false");
  });

  it("answers what the browser says", () => {
    media = installMatchMedia(true, QUERY);

    render(<Probe />);

    expect(answer()).toBe("true");
  });

  it("keeps up when the viewport crosses the breakpoint", () => {
    media = installMatchMedia(true, QUERY);
    render(<Probe />);

    act(() => media?.set(false));

    expect(answer()).toBe("false");
  });

  it("gives the subscription back when it unmounts", () => {
    media = installMatchMedia(true, QUERY);
    const { unmount } = render(<Probe />);
    expect(media.listenerCount()).toBe(1);

    unmount();

    expect(media.listenerCount()).toBe(0);
  });

  it("answers false where there is no matchMedia at all", () => {
    // An old browser, or a test environment that has not installed one: the base stylesheet
    // is where that lands, rather than on a breakpoint nobody can leave.
    const original = window.matchMedia;
    // @ts-expect-error — removing it is the case under test.
    delete window.matchMedia;

    try {
      render(<Probe />);
      expect(answer()).toBe("false");
    } finally {
      window.matchMedia = original;
    }
  });
});
