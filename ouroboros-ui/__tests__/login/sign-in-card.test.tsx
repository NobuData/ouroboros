import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryState } from "@/app/login/sso";

import { sessionUser } from "../helpers/login";

/**
 * Step 1 of the mockup, in both of its shapes.
 *
 * The card composes three controls and owns none of them, so what is asserted here is the
 * composition: that every piece of the mockup is on the card, in the mockup's own words, and
 * that the signed-in shape stops offering all three at once. The controls themselves have
 * suites of their own — `sign-in-button.test.tsx`, `sso-form.test.tsx`,
 * `dev-sign-in.test.tsx`.
 *
 * **Two of these cases were the opposite assertion, and both changed for the same kind of
 * reason.** "Continue with GitHub" was asserted to be a *link* until #702 turned sign-in into
 * a `POST`; the SSO half was asserted to be *disabled* until
 * [#712](https://github.com/NobuData/ouroboros/issues/712) gave it an endpoint. What an
 * element *is* follows what the operation *does*, and in both cases the operation changed.
 */

vi.mock("@/app/login/actions", () => ({
  discoverDomain: (): Promise<DiscoveryState> =>
    Promise.resolve({ status: "answered", ssoAvailable: false, message: "not asked here" }),
}));

const { SignInCard } = await import("@/app/login/sign-in-card");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("<SignInCard>, signed out", () => {
  it("offers GitHub sign-in as a button, which is what a POST needs", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
  });

  it("does not render sign-in as a link, which would GET a route that answers only POST", () => {
    render(<SignInCard user={null} />);

    expect(
      screen.queryByRole("link", { name: /continue with github/i }),
    ).not.toBeInTheDocument();
  });

  it("carries the mockup's enterprise-domain field, with its example domain", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByLabelText("Company domain")).toHaveAttribute(
      "placeholder",
      "acme.ouroboros.dev",
    );
  });

  it("lets the SSO half act, because there is an endpoint behind it now", () => {
    // *Asserts disabled* became *asserts submits* — #718's acceptance criterion, and the
    // reason `SSO_UNAVAILABLE` no longer exists to gate this.
    render(<SignInCard user={null} />);

    const button = screen.getByRole("button", { name: /continue with sso/i });

    expect(screen.getByLabelText("Company domain")).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveAttribute("type", "submit");
  });

  it("claims nothing about SSO of its own before anything has been asked", () => {
    // The whole of the deleted constant: the card used to say "not configured yet" to a
    // visitor who had typed nothing, which is an answer to a question nobody put — and which
    // would have gone on being said after #722 made it false.
    render(<SignInCard user={null} />);

    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it("keeps the mockup's SSO and isolation copy, verbatim", () => {
    // Verbatim matters on the first of these: while the constant existed it was appended to
    // this sentence, turning the one paragraph the mockup writes into a paragraph and a
    // disclaimer.
    render(<SignInCard user={null} />);

    expect(
      screen.getByText(
        "SAML 2.0 and OIDC via your identity provider — Okta, Entra ID, Google Workspace.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Each domain is an isolated tenant/)).toBeInTheDocument();
    expect(screen.getByText(/or enterprise SSO/i)).toBeInTheDocument();
  });

  it("is the page's heading, since it is the first thing on the screen", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
  });
});

describe("the development sign-in", () => {
  it("is on the card outside production, because there is no other way in locally", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("is not composed at all in a production build", () => {
    // The gate that matters to a person looking at the screen. The component refuses to
    // render one too — see `dev-sign-in.test.tsx` — and the service refuses the route
    // whatever any client does, which is the actual security boundary.
    vi.stubEnv("NODE_ENV", "production");

    render(<SignInCard user={null} />);

    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign in$/i })).not.toBeInTheDocument();
  });

  it("leaves the mockup's own controls alone in a production build", () => {
    // The gate is around the development form and nothing else. A build that quietly lost
    // the GitHub button or the SSO field would pass the case above.
    vi.stubEnv("NODE_ENV", "production");

    render(<SignInCard user={null} />);

    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Company domain")).toBeInTheDocument();
  });
});

describe("<SignInCard>, signed in", () => {
  it("states who is signed in, by name and address", () => {
    render(<SignInCard user={sessionUser()} />);

    expect(screen.getByText("Ken Suenobu")).toBeInTheDocument();
    expect(screen.getByText("ken@acme-robotics.dev")).toBeInTheDocument();
  });

  it("stops offering every way to sign in at once", () => {
    render(<SignInCard user={sessionUser()} />);

    expect(
      screen.queryByRole("button", { name: /continue with github/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Company domain")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("stays a numbered step, so step 2 is not left without a step above it", () => {
    render(<SignInCard user={sessionUser()} />);

    expect(screen.getByText(/Step 1 · Signed in/)).toBeInTheDocument();
  });

  it("falls back to the address for the monogram when a display name is empty", () => {
    render(<SignInCard user={sessionUser({ displayName: "" })} />);

    // `ken@acme-robotics.dev` splits on the non-letters, so the first two parts are `ken`
    // and `acme` — the point being that the tile is never blank.
    expect(screen.getByText("KA")).toBeInTheDocument();
  });
});
