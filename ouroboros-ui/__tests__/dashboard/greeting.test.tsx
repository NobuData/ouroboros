import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Greeting } from "@/app/dashboard/greeting";
import { NEUTRAL_GREETING } from "@/app/dashboard/view";

import { activity } from "../helpers/dashboard";

/**
 * The one client-rendered thing on the dashboard (decision F7).
 *
 * The sentence itself is `view.test.ts`'s — it is a pure function of a daypart, a name and
 * the activity, and the boundaries between the three dayparts are covered there. What is
 * here is the half that only exists in a browser: that the heading is built from the
 * *reader's* clock rather than the server's, that it is a complete `h1` before that clock
 * has answered, and that the closing clause is the aggregate's rather than the mockup's.
 *
 * The clock is moved by stubbing `Date.prototype.getHours` rather than by faking timers:
 * the component reads a real `Date` exactly as it does in production, and React's own
 * scheduling is left alone.
 */

/**
 * Put the browser's clock at one hour of the day, for the length of one case.
 *
 * @param hour The local hour to report, `0`–`23`.
 */
function localHour(hour: number): void {
  vi.spyOn(Date.prototype, "getHours").mockReturnValue(hour);
}

/** The page's one heading, as text. */
function heading(): string {
  return screen.getByRole("heading", { level: 1 }).textContent ?? "";
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the greeting", () => {
  it("reads the daypart from the browser's own clock", () => {
    // The whole reason this is a client component: a server saying "good afternoon" is
    // saying it in its own timezone, which is wrong for half of a workspace spread across
    // two hemispheres.
    localHour(14);

    render(<Greeting displayName="Ken Suenobu" activity={activity()} />);

    expect(heading()).toBe("Good afternoon, Ken — the loop is turning.");
  });

  it("greets the morning in the morning", () => {
    localHour(9);

    render(<Greeting displayName="Ken Suenobu" activity={activity()} />);

    expect(heading()).toContain("Good morning, Ken");
  });

  it("greets the evening in the evening", () => {
    localHour(21);

    render(<Greeting displayName="Ken Suenobu" activity={activity()} />);

    expect(heading()).toContain("Good evening, Ken");
  });

  it("is the page's one top-level heading", () => {
    localHour(14);

    render(<Greeting displayName="Ken Suenobu" activity={activity()} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("says the loop is idle when nothing is in flight", () => {
    // The mockup's "the loop is turning" is a claim, and a workspace with no runs would be
    // the page's first untrue sentence.
    localHour(14);

    render(
      <Greeting displayName="Ken Suenobu" activity={activity({ inFlight: 0 })} />,
    );

    expect(heading()).toBe("Good afternoon, Ken — the loop is idle.");
  });

  it("makes no claim about a loop nobody could ask about", () => {
    localHour(14);

    render(<Greeting displayName="Ken Suenobu" activity={null} />);

    expect(heading()).toBe("Good afternoon, Ken.");
    expect(heading()).not.toMatch(/loop/);
  });

  it("uses the first name the session carries, not the whole of it", () => {
    localHour(14);

    render(<Greeting displayName="Maya Chen" activity={activity()} />);

    expect(heading()).toContain("Good afternoon, Maya");
    expect(heading()).not.toContain("Chen");
  });
});

describe("the render that does not know what time it is", () => {
  it("is a complete heading rather than a blank or a skeleton", () => {
    // `useClientValue`'s server snapshot, which is also what the hydration pass renders —
    // so this is the markup React matches against rather than throws away. A page whose
    // `h1` appears only after hydration is a page with no outline until then.
    const html = renderToStaticMarkup(
      <Greeting displayName="Ken Suenobu" activity={activity()} />,
    );

    expect(html).toContain(`${NEUTRAL_GREETING}, Ken — the loop is turning.`);
    expect(html).not.toContain("Good ");
  });

  it("keeps the page-head class the sheet places the heading with", () => {
    localHour(14);

    const { container } = render(
      <Greeting displayName="Ken Suenobu" activity={activity()} />,
    );

    expect(container.querySelector("h1")).toHaveClass("dash__title");
  });
});
