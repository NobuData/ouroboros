import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignInCard } from "@/app/login/sign-in-card";

import { sessionUser } from "../helpers/login";

/**
 * Step 1 of the mockup, in both of its shapes.
 *
 * The two properties worth holding here are the ones that would be easy to break and hard to
 * notice: "Continue with GitHub" is a **link** and not a button, because the operation behind
 * it answers `302` to github.com and a `fetch` would land nobody anywhere; and the SSO half
 * is present, inert, and says why — which is the design system's rule for a control that
 * cannot act, and the opposite of quietly dropping it.
 */

const SIGN_IN = "http://rest.test:4000/api/v1/auth/github";

describe("<SignInCard>, signed out", () => {
  it("offers GitHub sign-in as a link to the service's own route", () => {
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    const link = screen.getByRole("link", { name: /continue with github/i });

    expect(link).toHaveAttribute("href", SIGN_IN);
  });

  it("does not render sign-in as a button, which could not follow the redirect", () => {
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    expect(
      screen.queryByRole("button", { name: /continue with github/i }),
    ).not.toBeInTheDocument();
  });

  it("carries the mockup's enterprise-domain field, with its example domain", () => {
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    const field = screen.getByLabelText("Company domain");

    expect(field).toHaveAttribute("placeholder", "acme.ouroboros.dev");
  });

  it("disables that field rather than accepting typing it would discard", () => {
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    expect(screen.getByLabelText("Company domain")).toBeDisabled();
  });

  it("keeps the SSO button reachable and marks it unavailable, with the reason", () => {
    // `aria-disabled` rather than `disabled`: a disabled button leaves the tab order and
    // takes its explanation with it.
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    const button = screen.getByRole("button", { name: /continue with sso/i });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription(/not configured yet/i);
  });

  it("keeps the mockup's SSO and isolation copy", () => {
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    expect(screen.getByText(/SAML 2\.0 and OIDC/)).toBeInTheDocument();
    expect(screen.getByText(/Each domain is an isolated tenant/)).toBeInTheDocument();
    expect(screen.getByText(/or enterprise SSO/i)).toBeInTheDocument();
  });

  it("is the page's heading, since it is the first thing on the screen", () => {
    render(<SignInCard signInHref={SIGN_IN} user={null} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
  });
});

describe("<SignInCard>, signed in", () => {
  it("states who is signed in, by name and address", () => {
    render(<SignInCard signInHref={SIGN_IN} user={sessionUser()} />);

    expect(screen.getByText("Ken Suenobu")).toBeInTheDocument();
    expect(screen.getByText("ken@acme-robotics.dev")).toBeInTheDocument();
  });

  it("stops offering to sign in, and stops offering SSO with it", () => {
    render(<SignInCard signInHref={SIGN_IN} user={sessionUser()} />);

    expect(screen.queryByRole("link", { name: /continue with github/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Company domain")).not.toBeInTheDocument();
  });

  it("stays a numbered step, so step 2 is not left without a step above it", () => {
    render(<SignInCard signInHref={SIGN_IN} user={sessionUser()} />);

    expect(screen.getByText(/Step 1 · Signed in/)).toBeInTheDocument();
  });

  it("falls back to the address for the monogram when a display name is empty", () => {
    render(<SignInCard signInHref={SIGN_IN} user={sessionUser({ displayName: "" })} />);

    // `ken@acme-robotics.dev` splits on the non-letters, so the first two parts are `ken`
    // and `acme` — the point being that the tile is never blank.
    expect(screen.getByText("KA")).toBeInTheDocument();
  });
});
