import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/app/dashboard/dashboard-screen";

import { readings } from "../helpers/dashboard";
import { membership, seededWorkspaces, sessionUser } from "../helpers/login";

// The login screen contains the Server-Action forms, whose module reaches for `next/cache`,
// `next/navigation` and the server-only client. Replacing it is what lets the whole screen
// be rendered in a test at all; what the actions do is `__tests__/login/actions.test.ts`.
vi.mock("@/app/login/actions", () => ({
  enterMissionControl: vi.fn(),
  setWorkspaceEnabled: vi.fn(),
  // Step 1's SSO half runs this through `useActionState`, so the mock has to answer with a
  // `DiscoveryState`. What it answers is `sso-form.test.tsx`'s subject, not this file's.
  discoverDomain: vi.fn(() =>
    Promise.resolve({ status: "answered", ssoAvailable: false, message: "not asked here" }),
  ),
}));

// The dashboard has one of its own since #83 — the pulse card's auto-merge switch, whose
// action module sits on the server-only client and whose `useRouter()` wants the App Router
// mounted. What the switch does with either is `__tests__/dashboard/auto-merge-switch.test.tsx`.
vi.mock("@/app/dashboard/pulse-actions", () => ({ setAutoMerge: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { LoginScreen } = await import("@/app/login/login-screen");
type LoginScreenState = Parameters<typeof LoginScreen>[0]["state"];

/**
 * #46's first acceptance criterion, as a test: **the sign-in screen (#44) and the dashboard
 * (#45) are built exclusively from the primitives.**
 *
 * The two halves below are the two ways that can stop being true, and only one of them is
 * visible in a screenshot:
 *
 * 1. **A screen keeps drawing its own version of a shape the design system owns** — the
 *    state before this issue, where a button was defined twice and a chip three times.
 *    Every retired class is named here, so reviving one fails rather than quietly forking
 *    the design system again.
 * 2. **A screen stops using a primitive at all**, replacing it with markup of its own that
 *    happens to look the same. That is caught by requiring each screen to still render the
 *    primitives it is built from.
 *
 * What is deliberately *not* asserted is that every element on these screens is a
 * primitive. A screen composes: the login screen's workspace rows and monogram, the
 * dashboard's stat tile and system list are compositions built *from* primitives and out of
 * this directory's reach. The line is the one `app/ui/index.ts` states — a primitive names
 * no domain concept.
 */


/** The three states of the login screen, so no shape of step 2 escapes the sweep. */
const LOGIN_STATES: readonly (readonly [string, LoginScreenState])[] = [
  ["sign-in", { step: "sign-in" }],
  [
    "choose",
    { step: "choose", memberships: seededWorkspaces(), active: membership(), total: 3 },
  ],
  ["no-workspace", { step: "no-workspace", suggestion: null }],
];

/**
 * The classes the two screens defined for themselves before #46, each now the primitives'.
 *
 * A screen that renders one of these is a screen that has grown a second definition of a
 * shape the design system already names.
 */
const RETIRED = [
  "login-card",
  "login-btn",
  "login-pill",
  "login-switch\"",
  "login-field__",
  "login-empty",
  "dash-btn",
  "dash-card",
  "dash-pill",
  "dash-empty",
  "dash__eyebrow",
];

describe("the sign-in screen", () => {
  it.each(LOGIN_STATES)("draws its %s state out of the primitives", (_, state) => {
    const { container } = render(
      <LoginScreen
        state={state}
       
        user={state.step === "sign-in" ? null : sessionUser()}
      />,
    );

    // Both steps are cards and both carry the head's eyebrow, in every state — which is
    // the part of this screen that is the same however far through it somebody is.
    expect(container.querySelectorAll(".ou-card")).toHaveLength(2);
    expect(container.querySelectorAll(".ou-eyebrow")).toHaveLength(2);
  });

  it("draws its buttons, its field, its switches and its chips out of the primitives", () => {
    // The two states that carry controls. `no-workspace` carries none of these: there is
    // nothing to choose and nothing to switch on.
    //
    // Pinned to a production build, so the counts are the *mockup's* controls and cannot
    // drift with the environment a suite happens to run in — the development sign-in
    // ([#705](https://github.com/NobuData/ouroboros/issues/705)) adds a button and two fields
    // to every other build, and is counted separately below.
    vi.stubEnv("NODE_ENV", "production");

    const signedOut = render(
      <LoginScreen state={{ step: "sign-in" }} user={null} />,
    );

    // "Continue with GitHub", and "Continue with SSO" — live since
    // [#718](https://github.com/NobuData/ouroboros/issues/718), and inert before it.
    expect(signedOut.container.querySelectorAll(".ou-btn")).toHaveLength(2);
    // The company-domain field.
    expect(signedOut.container.querySelectorAll(".ou-input")).toHaveLength(1);

    vi.unstubAllEnvs();

    const seeded = seededWorkspaces();
    const enabling = render(
      <LoginScreen
        state={{ step: "choose", memberships: seeded, active: seeded[0], total: 3 }}
        user={sessionUser()}
      />,
    );

    // One switch per workspace, the `personal` chip on the one workspace the service
    // flagged, and "Enter mission control".
    expect(enabling.container.querySelectorAll(".ou-switch")).toHaveLength(3);
    expect(enabling.container.querySelectorAll(".ou-chip")).toHaveLength(1);
    expect(enabling.container.querySelectorAll(".ou-btn")).toHaveLength(1);
  });

  it("draws the development sign-in out of the primitives too", () => {
    // It is scaffolding rather than product, and that is exactly why it is worth a case: a
    // form written out of raw `<input>`s because "it is only for developers" is how a screen
    // grows a second set of field styles nobody measured.
    const { container } = render(<LoginScreen state={{ step: "sign-in" }} user={null} />);

    // The two above, plus "Sign in"; the domain field, plus the address and the password.
    expect(container.querySelectorAll(".ou-btn")).toHaveLength(3);
    expect(container.querySelectorAll(".ou-input")).toHaveLength(3);
  });

  it.each(LOGIN_STATES)("has no shape of its own left in the %s state", (_, state) => {
    const { container } = render(
      <LoginScreen
        state={state}
       
        user={state.step === "sign-in" ? null : sessionUser()}
      />,
    );

    for (const retired of RETIRED) {
      expect(container.innerHTML, `${retired} is the primitives' now`).not.toContain(
        retired,
      );
    }
  });
});

describe("the dashboard", () => {
  it("draws its cards, actions, chips and empty states out of the primitives", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    // The page head's two actions, plus the active-loops card's *Open run console* (#82).
    // Two empty panels are left: the completions table (#84) and the queue (#85).
    expect(container.querySelectorAll(".ou-card")).toHaveLength(9);
    expect(container.querySelectorAll(".ou-btn")).toHaveLength(3);
    expect(container.querySelectorAll(".ou-empty")).toHaveLength(2);
    expect(container.querySelectorAll(".ou-eyebrow")).toHaveLength(1);
    expect(container.querySelectorAll(".ou-chip").length).toBeGreaterThan(0);
    // The page's one control that changes something (#83) is the primitives' switch, the
    // same one the login screen's workspace rows are turned on with.
    expect(container.querySelectorAll(".ou-switch")).toHaveLength(1);
  });

  it("draws the active-loops table out of them too, rather than out of a second table", () => {
    // The card with the most shapes on it: a table, a tag, two kinds of chip and a meter per
    // row. Each of them is #46's, so the one table in the product that is on a dashboard
    // cannot drift away from the one on a drill-in screen.
    const { container } = render(<DashboardScreen readings={readings()} />);

    expect(container.querySelectorAll(".ou-table")).toHaveLength(1);
    expect(container.querySelectorAll(".ou-table-scroll")).toHaveLength(1);
    // Three workflow tags, one per run, and the pulse card's `7 days` (#83).
    expect(container.querySelectorAll(".ou-tag")).toHaveLength(4);
    // One stage meter per run, and the pulse card's three (#83) — which is the reason the
    // meter is a primitive at all rather than a shape this table drew for itself.
    expect(container.querySelectorAll(".ou-meter")).toHaveLength(6);
    expect(container.querySelectorAll(".ou-chip--model")).toHaveLength(3);
  });

  it("has no shape of its own left", () => {
    const { container } = render(<DashboardScreen readings={readings()} />);

    for (const retired of RETIRED) {
      expect(container.innerHTML, `${retired} is the primitives' now`).not.toContain(
        retired,
      );
    }
  });
});
