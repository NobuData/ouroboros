import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { socialSignIn } from "@/app/login/sign-in";
import { SignInButton } from "@/app/login/sign-in-button";

import { requestedUrl } from "../helpers/auth";

/**
 * The press, and what it does with the answer.
 *
 * `sign-in.ts` is where the call and its failures are asserted; this is the half that needs a
 * DOM — that the browser is sent to the URL the service named, that a second press mid-flight
 * is ignored, and that a failure is *said* rather than swallowed.
 *
 * The last one is the design system's rule (§ 3.5) applied to a control that could act and
 * then did not: a button that quietly does nothing is the failure mode this component exists
 * to avoid, because the flow it begins leaves the page and a person has no other way to tell
 * whether anything happened.
 *
 * It is driven through the real {@link socialSignIn} rather than a hand-written thunk, so
 * these cases are also the check that the two halves still fit: the component takes a
 * {@link SignInStart} since #718, and a builder that stopped producing one would otherwise
 * only be caught by a typecheck.
 */

/** A safe default installed first, so `unstubAllGlobals` never restores the real `fetch`. */
globalThis.fetch = (() => Promise.resolve(new Response("null"))) as typeof fetch;

/** Where the button would send the browser. */
const CONSENT = "https://github.com/login/oauth/authorize?client_id=abc";

/** Where the component said to send the browser. */
let assigned: string[];

/** Every request the stub was handed, and the body each carried. */
let bodies: unknown[];

beforeEach(() => {
  assigned = [];
  bodies = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Answer the sign-in call with a body and a status. */
function serviceAnswering(body: unknown, status = 200) {
  const fetchImpl = vi.fn((input: Request | URL | string, init?: RequestInit) => {
    void requestedUrl(input);
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

/**
 * Render the control as the card does, with the navigation captured.
 *
 * jsdom cannot navigate and will not let `location.assign` be replaced, so the component takes
 * the departure as a parameter — the same seam `app/api/auth-server.ts` opens for `fetch`.
 *
 * @param provider Which provider's sign-in this button begins.
 * @returns Testing Library's result.
 */
function signInButton(provider: "github" | "gitlab" = "github") {
  return render(
    <SignInButton
      begin={socialSignIn(provider)}
      navigate={(url) => assigned.push(url)}
    >
      {provider === "github" ? "Continue with GitHub" : "Continue with GitLab"}
    </SignInButton>,
  );
}

describe("<SignInButton>", () => {
  it("is a button, because the route it calls answers only POST", () => {
    serviceAnswering({ url: CONSENT, redirect: false });
    signInButton();

    expect(screen.getByRole("button", { name: /continue with github/i })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("sends the browser to the URL the service named", async () => {
    serviceAnswering({ url: CONSENT, redirect: false });
    signInButton();

    fireEvent.click(screen.getByRole("button", { name: /continue with github/i }));

    await waitFor(() => expect(assigned).toEqual([CONSENT]));
  });

  it("marks itself busy while it waits, without leaving the tab order", async () => {
    // `aria-busy` rather than `disabled`: a disabled control loses focus mid-press, which
    // moves a keyboard user to the top of the document while the request is in flight.
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    signInButton();

    const button = screen.getByRole("button", { name: /continue with github/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).not.toBeDisabled();

    release(new Response(JSON.stringify({ url: CONSENT, redirect: false }), { status: 200 }));
  });

  it("ignores a second press while the first is in flight", async () => {
    // Two presses would begin two handshakes and issue two `state` cookies; the second
    // invalidates the first, so the one the person is actually following fails at the
    // callback with `state_mismatch`.
    const fetchImpl = serviceAnswering({ url: CONSENT, redirect: false });
    signInButton();

    const button = screen.getByRole("button", { name: /continue with github/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(assigned).toEqual([CONSENT]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("says why when the service refuses, and navigates nowhere", async () => {
    serviceAnswering({ message: "Provider not found" }, 400);
    signInButton();

    fireEvent.click(screen.getByRole("button", { name: /continue with github/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/provider not found/i);
    expect(assigned).toEqual([]);
  });

  it("points the button at that explanation, so it is announced with the control", async () => {
    serviceAnswering({ message: "Provider not found" }, 400);
    signInButton();

    const button = screen.getByRole("button", { name: /continue with github/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAccessibleDescription(/provider not found/i));
  });

  it("names that explanation uniquely, so two buttons cannot describe each other", async () => {
    // The id was a module constant while the screen had one sign-in control. It has more than
    // one now — the SSO half, and the development form — and two elements sharing an id make
    // `aria-describedby` resolve to whichever the document reached first.
    serviceAnswering({ message: "Provider not found" }, 400);
    render(
      <>
        <SignInButton begin={socialSignIn("github")} navigate={() => {}}>
          Continue with GitHub
        </SignInButton>
        <SignInButton begin={socialSignIn("gitlab")} navigate={() => {}}>
          Continue with GitLab
        </SignInButton>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: /continue with github/i }));

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /continue with gitlab/i })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("can be pressed again after a failure", async () => {
    // A failure that left the control busy would be a dead button on a screen whose whole
    // purpose is that one control.
    serviceAnswering({ message: "Temporary" }, 503);
    signInButton();

    const button = screen.getByRole("button", { name: /continue with github/i });
    fireEvent.click(button);
    await screen.findByRole("alert");

    serviceAnswering({ url: CONSENT, redirect: false });
    fireEvent.click(button);

    await waitFor(() => expect(assigned).toEqual([CONSENT]));
  });

  it("clears a previous failure when pressed again", async () => {
    serviceAnswering({ message: "Temporary" }, 503);
    signInButton();

    const button = screen.getByRole("button", { name: /continue with github/i });
    fireEvent.click(button);
    await screen.findByRole("alert");

    serviceAnswering({ url: CONSENT, redirect: false });
    fireEvent.click(button);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("carries whichever provider it was given, not one of its own", async () => {
    // The component is provider-agnostic on purpose: a second social provider — or an SSO
    // route, when there is one — is a different `begin` prop and nothing else.
    serviceAnswering({ url: CONSENT, redirect: false });
    signInButton("gitlab");

    fireEvent.click(screen.getByRole("button", { name: /continue with gitlab/i }));

    await waitFor(() => expect(bodies[0]).toMatchObject({ provider: "gitlab" }));
  });
});
