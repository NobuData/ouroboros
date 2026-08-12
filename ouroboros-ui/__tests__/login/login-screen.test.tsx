import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { enablement, membership, org, repo, sessionUser } from "../helpers/login";

// The screen contains the Server-Action forms, whose module reaches for `next/cache`,
// `next/navigation` and the server-only client. Replacing it is what lets the whole screen be
// rendered in a test at all; what the actions do is `__tests__/login/actions.test.ts`.
vi.mock("@/app/login/actions", () => ({
  chooseWorkspace: vi.fn(),
  setOrgEnabled: vi.fn(),
  setRepoEnabled: vi.fn(),
}));

const { LoginScreen } = await import("@/app/login/login-screen");

/**
 * The screen, whole — the integration test for #44's UI.
 *
 * Each of the four states is rendered as the route would render it, and what is asserted is
 * what somebody arriving at that state can actually see and do. Between them these are the
 * acceptance criteria's own path: sign in → pick `acme-robotics` → toggle a repo → land on
 * the dashboard, minus the two steps only a browser and a live service can take.
 *
 * The screen is a Server Component with no client component anywhere inside it, which is why
 * it renders here with no provider, no router and no hydration: it is a function from a state
 * to markup.
 */

const SIGN_IN = "http://rest.test:4000/api/v1/auth/github";

describe("the login screen, signed out", () => {
  /**
   * Render the screen as a visitor with no session sees it.
   *
   * @returns Testing Library's result.
   */
  function signedOut() {
    return render(
      <LoginScreen state={{ step: "sign-in" }} signInHref={SIGN_IN} user={null} />,
    );
  }

  it("draws the brand half and the auth half", () => {
    signedOut();

    expect(screen.getByRole("region", { name: "Ouroboros" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sign in to Ouroboros" })).toBeInTheDocument();
  });

  it("shows both of the mockup's steps, with only the first one live", () => {
    signedOut();

    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Choose where the loop runs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continue with GitHub/ })).toHaveAttribute(
      "href",
      SIGN_IN,
    );
  });

  it("carries the brand lines and the trust row from the mockup", () => {
    signedOut();

    const brand = screen.getByRole("region", { name: "Ouroboros" });

    expect(within(brand).getByText("Point it at your backlog.")).toBeInTheDocument();
    expect(
      within(brand).getByText("It plans, codes, builds, reviews, and merges."),
    ).toBeInTheDocument();
    expect(within(brand).getByText("You watch the loop turn.")).toBeInTheDocument();
    expect(within(brand).getByText("SOC 2 Type II")).toBeInTheDocument();
    expect(within(brand).getByText("Self-hostable")).toBeInTheDocument();
  });

  it("owns its scroll container, because the document is locked", () => {
    // globals.css locks html/body so the shell's pane is the only scrolling thing in the
    // product; a screen outside the shell inherits that lock and has to bring its own.
    const { container } = signedOut();

    expect(container.querySelector("main")).toHaveClass("login");
  });
});

describe("the login screen, choosing a workspace", () => {
  it("reports who signed in and asks where the loop should run", () => {
    render(
      <LoginScreen
        state={{ step: "choose", memberships: [membership()] }}
        signInHref={SIGN_IN}
        user={sessionUser()}
      />,
    );

    expect(screen.getByText("Ken Suenobu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Acme Robotics/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Continue with GitHub/ })).not.toBeInTheDocument();
  });
});

describe("the login screen, enabling organisations", () => {
  it("puts the workspace's organisations and repositories in front of an owner", () => {
    render(
      <LoginScreen
        state={{
          step: "enable",
          membership: membership(),
          enablement: enablement([[org(), [repo()]]]),
        }}
        signInHref={SIGN_IN}
        user={sessionUser()}
      />,
    );

    expect(screen.getByText("acme-robotics")).toBeInTheDocument();
    expect(screen.getByText("helios-firmware")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Enter mission control/ })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("the login screen, belonging nowhere", () => {
  it("explains rather than offering an empty list", () => {
    render(
      <LoginScreen
        state={{ step: "no-workspace", suggestion: null, memberships: [] }}
        signInHref={SIGN_IN}
        user={sessionUser()}
      />,
    );

    expect(screen.getByRole("heading", { name: "No workspace yet" })).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});

describe("what every state has in common", () => {
  /** One state per shape the screen can take, with the data each needs. */
  const STATES = [
    ["signed out", { step: "sign-in" }, null],
    ["choosing", { step: "choose", memberships: [membership()] }, sessionUser()],
    [
      "enabling",
      { step: "enable", membership: membership(), enablement: enablement([[org(), [repo()]]]) },
      sessionUser(),
    ],
    ["nowhere", { step: "no-workspace", suggestion: null, memberships: [] }, sessionUser()],
  ] as const;

  it.each(STATES)("in the %s state, draws the brand and two cards", (_, state, user) => {
    const { container } = render(
      <LoginScreen state={state} signInHref={SIGN_IN} user={user} />,
    );

    expect(screen.getByRole("region", { name: "Ouroboros" })).toBeInTheDocument();
    expect(container.querySelectorAll(".login-card")).toHaveLength(2);
  });

  it.each(STATES)("in the %s state, names step 2 with its own heading", (_, state, user) => {
    render(<LoginScreen state={state} signInHref={SIGN_IN} user={user} />);

    // Whatever step 2 is showing, the card is labelled by its heading — so a screen reader
    // moving by region hears which step it has landed in.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });
});
