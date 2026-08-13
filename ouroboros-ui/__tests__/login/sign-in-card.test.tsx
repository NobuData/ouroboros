import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignInCard } from "@/app/login/sign-in-card";

import { sessionUser } from "../helpers/login";

/**
 * Step 1 of the mockup, in both of its shapes.
 *
 * The two properties worth holding here are the ones that would be easy to break and hard to
 * notice: "Continue with GitHub" is a **button** and not a link, and the SSO half is present,
 * inert, and says why — which is the design system's rule for a control that cannot act, and
 * the opposite of quietly dropping it.
 *
 * **The first of those was the opposite assertion until #702's flow landed**, and the reason
 * is worth keeping: #33's route answered `302` to github.com, so a link was the honest
 * element and a `fetch` would have landed nobody anywhere. BetterAuth's answers `POST` only,
 * so the anchor became a `GET` at a route that has none — a `404` from the service. What the
 * element *is* follows what the operation *does*, and the operation changed.
 */

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

    const field = screen.getByLabelText("Company domain");

    expect(field).toHaveAttribute("placeholder", "acme.ouroboros.dev");
  });

  it("disables that field rather than accepting typing it would discard", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByLabelText("Company domain")).toBeDisabled();
  });

  it("keeps the SSO button reachable and marks it unavailable, with the reason", () => {
    // `aria-disabled` rather than `disabled`: a disabled button leaves the tab order and
    // takes its explanation with it.
    render(<SignInCard user={null} />);

    const button = screen.getByRole("button", { name: /continue with sso/i });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription(/not configured yet/i);
  });

  it("keeps the mockup's SSO and isolation copy", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByText(/SAML 2\.0 and OIDC/)).toBeInTheDocument();
    expect(screen.getByText(/Each domain is an isolated tenant/)).toBeInTheDocument();
    expect(screen.getByText(/or enterprise SSO/i)).toBeInTheDocument();
  });

  it("is the page's heading, since it is the first thing on the screen", () => {
    render(<SignInCard user={null} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
  });
});

describe("<SignInCard>, signed in", () => {
  it("states who is signed in, by name and address", () => {
    render(<SignInCard user={sessionUser()} />);

    expect(screen.getByText("Ken Suenobu")).toBeInTheDocument();
    expect(screen.getByText("ken@acme-robotics.dev")).toBeInTheDocument();
  });

  it("stops offering to sign in, and stops offering SSO with it", () => {
    render(<SignInCard user={sessionUser()} />);

    expect(
      screen.queryByRole("button", { name: /continue with github/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Company domain")).not.toBeInTheDocument();
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
