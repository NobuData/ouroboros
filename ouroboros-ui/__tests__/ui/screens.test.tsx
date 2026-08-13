import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardScreen } from "@/app/dashboard/dashboard-screen";

import { readings } from "../helpers/dashboard";
import { enablement, membership, org, repo, sessionUser } from "../helpers/login";

// The login screen contains the Server-Action forms, whose module reaches for `next/cache`,
// `next/navigation` and the server-only client. Replacing it is what lets the whole screen
// be rendered in a test at all; what the actions do is `__tests__/login/actions.test.ts`.
vi.mock("@/app/login/actions", () => ({
  chooseWorkspace: vi.fn(),
  setOrgEnabled: vi.fn(),
  setRepoEnabled: vi.fn(),
}));

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


/** The four states of the login screen, so no shape of step 2 escapes the sweep. */
const LOGIN_STATES: readonly (readonly [string, LoginScreenState])[] = [
  ["sign-in", { step: "sign-in" }],
  ["choose", { step: "choose", memberships: [membership()] }],
  ["no-workspace", { step: "no-workspace", suggestion: null, memberships: [membership()] }],
  [
    "enable",
    {
      step: "enable",
      membership: membership(),
      enablement: enablement([[org(), [repo()]]]),
    },
  ],
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
    // The two states that carry controls. `choose` and `no-workspace` carry none of these:
    // a workspace is picked by pressing its whole row, which is this screen's own
    // composition rather than a button.
    const signedOut = render(
      <LoginScreen state={{ step: "sign-in" }} user={null} />,
    );

    // "Continue with GitHub", and the SSO control that explains why it cannot act.
    expect(signedOut.container.querySelectorAll(".ou-btn")).toHaveLength(2);
    expect(signedOut.container.querySelectorAll(".ou-input")).toHaveLength(1);

    const enabling = render(
      <LoginScreen
        state={{
          step: "enable",
          membership: membership(),
          enablement: enablement([[org(), [repo()]]]),
        }}
       
        user={sessionUser()}
      />,
    );

    // One switch per organisation and per repository, the "on" chip beside an enabled
    // organisation, and "Enter mission control".
    expect(enabling.container.querySelectorAll(".ou-switch")).toHaveLength(2);
    expect(enabling.container.querySelectorAll(".ou-chip").length).toBeGreaterThan(0);
    expect(enabling.container.querySelectorAll(".ou-btn")).toHaveLength(1);
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

    expect(container.querySelectorAll(".ou-card")).toHaveLength(8);
    expect(container.querySelectorAll(".ou-btn")).toHaveLength(2);
    expect(container.querySelectorAll(".ou-empty")).toHaveLength(3);
    expect(container.querySelectorAll(".ou-eyebrow")).toHaveLength(1);
    expect(container.querySelectorAll(".ou-chip").length).toBeGreaterThan(0);
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
