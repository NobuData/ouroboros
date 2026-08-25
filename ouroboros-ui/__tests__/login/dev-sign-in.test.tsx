import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_BASE_PATH } from "@/app/api/auth-client";
import { DevSignInForm } from "@/app/login/dev-sign-in";
import { LOGIN_PATH } from "@/app/paths";

import { requestedUrl } from "../helpers/auth";
import { settle } from "../helpers/settle";

/**
 * The development email/password form
 * ([#705](https://github.com/NobuData/ouroboros/issues/705)).
 *
 * Two properties carry the weight and they pull in opposite directions, which is why both are
 * asserted here rather than assumed:
 *
 *   * **It works**, because a developer with no GitHub OAuth application and a database that
 *     has just been recreated has no other way into the product, and the e2e suite has no way
 *     to script one.
 *   * **It is not in a production build.** The service refuses the route there whatever a
 *     browser asks (`ouroboros-rest/src/auth/password.provider.ts`), so what this file covers
 *     is the client half of that: a production render offering a control the service would
 *     refuse is a broken screen even when it is a safe one.
 *
 * The credentials below are the seeded ones (`ouroboros-db/migrations/R__dev_seed.sql`),
 * written out because a form asserted with `a@b.c` / `hunter2` would pass just as well while
 * being useless as documentation of how to actually sign in.
 */

/** A safe default installed first, so `unstubAllGlobals` never restores the real `fetch`. */
globalThis.fetch = (() => Promise.resolve(new Response("null"))) as typeof fetch;

/** The seeded person, and the documented development password. */
const EMAIL = "ken@acme-robotics.dev";
const PASSWORD = "ouroboros-dev-password";

/** Every request the stub was handed, and the body each carried. */
let urls: string[];
let bodies: unknown[];

/** How many times the component asked for the page to be read again. */
let rereads: number;

beforeEach(() => {
  urls = [];
  bodies = [];
  rereads = 0;

  // This form only ever renders on `/login`, and where the document is matters to what a
  // refusal does: the auth client sends a `401` to the login screen (`app/api/auth-client.ts`)
  // *unless it is already there*, and a wrong password is a `401`. Left at jsdom's default
  // `/`, every refusal case below would be asserting the message while the client navigated
  // out from under it — which is not a thing that can happen on the real screen.
  window.history.replaceState({}, "", LOGIN_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * Answer the sign-in call with a body and a status.
 *
 * @param body What BetterAuth replies with.
 * @param status The status to reply with.
 * @returns The stub, so a case can count its calls.
 */
function serviceAnswering(body: unknown, status = 200) {
  const fetchImpl = vi.fn((input: Request | URL | string, init?: RequestInit) => {
    urls.push(requestedUrl(input));
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

/** What a successful email sign-in answers with — the session travels in `Set-Cookie`. */
const SIGNED_IN = {
  redirect: false,
  token: "session-token",
  user: { id: "5eed0003-0000-4000-8000-000000000001", email: EMAIL, name: "Ken Suenobu" },
};

/**
 * Render the form with the re-read captured.
 *
 * jsdom cannot reload, so the component takes it as a parameter — the same seam
 * `sign-in-button.tsx` opens for its departure.
 *
 * @returns Testing Library's result.
 */
function devForm() {
  return render(<DevSignInForm onSignedIn={() => (rereads += 1)} />);
}

/**
 * Fill both fields and press.
 *
 * @param email The address to submit.
 * @param password The password to submit.
 */
function signIn(email = EMAIL, password = PASSWORD) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

describe("outside production", () => {
  it("offers both fields and a way to submit them", () => {
    serviceAnswering(SIGNED_IN);
    devForm();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /^sign in$/i })).toHaveAttribute("type", "submit");
  });

  it("says out loud that it is a development control", () => {
    // A password form beside a GitHub button, unexplained, reads as the product having two
    // sign-in methods. It has one; this is scaffolding.
    serviceAnswering(SIGNED_IN);
    devForm();

    expect(screen.getByText(/development builds only/i)).toBeInTheDocument();
  });

  it("posts the credentials to BetterAuth's email route, on this origin", async () => {
    // Same-origin because `proxy.ts` forwards it — and because the session cookie the answer
    // sets reaches this browser only on a request this browser made.
    serviceAnswering(SIGNED_IN);
    devForm();

    signIn();

    await waitFor(() => expect(urls).toHaveLength(1));
    expect(new URL(urls[0]).pathname).toBe(`${AUTH_BASE_PATH}/sign-in/email`);
    expect(new URL(urls[0]).origin).toBe(window.location.origin);
    expect(bodies[0]).toMatchObject({ email: EMAIL, password: PASSWORD });
  });

  it("reads the page again once a session exists", async () => {
    // Rather than routing anywhere itself: `/login` is where the decision already lives, and
    // reloading the current URL keeps a `?next=` rather than dropping it.
    serviceAnswering(SIGNED_IN);
    devForm();

    signIn();

    await waitFor(() => expect(rereads).toBe(1));
  });

  it("marks itself busy while it waits, without leaving the tab order", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    devForm();

    const button = screen.getByRole("button", { name: /^sign in$/i });
    signIn();

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).not.toBeDisabled();

    release(new Response(JSON.stringify(SIGNED_IN), { status: 200 }));
  });

  it("ignores a second press while the first is in flight", async () => {
    const fetchImpl = serviceAnswering(SIGNED_IN);
    devForm();

    signIn();
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(rereads).toBe(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("says why when the credentials are refused, and reads nothing again", async () => {
    serviceAnswering({ message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" }, 401);
    devForm();

    signIn(EMAIL, "wrong-password-entirely");

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
    expect(rereads).toBe(0);
  });

  it("stays on the login screen when the credentials are refused", async () => {
    // A `401` normally sends the browser to `/login`, which here *is* the page — so the rule
    // has an exception for exactly this, and without it a wrong password would reload the
    // screen out from under the message explaining it.
    serviceAnswering({ message: "Invalid email or password" }, 401);
    devForm();

    signIn(EMAIL, "wrong-password-entirely");

    await screen.findByRole("alert");
    expect(window.location.pathname).toBe(LOGIN_PATH);
  });

  it("points the button at that explanation, so it is announced with the control", async () => {
    serviceAnswering({ message: "Invalid email or password" }, 401);
    devForm();

    signIn(EMAIL, "wrong-password-entirely");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^sign in$/i })).toHaveAccessibleDescription(
        /invalid email or password/i,
      ),
    );
  });

  it("says the route is disabled when a development build meets a production service", async () => {
    // What `emailAndPassword.enabled: false` actually answers — a `400`, not a `404`. The
    // library's own message is worth reading and is not worth translating.
    serviceAnswering(
      { message: "Email and password sign in is not enabled", code: "EMAIL_PASSWORD_DISABLED" },
      400,
    );
    devForm();

    signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(/not enabled/i);
  });

  it("says the service could not be reached when the request itself failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    devForm();

    signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(/connection/i);
  });

  it("can be pressed again after a failure", async () => {
    serviceAnswering({ message: "Invalid email or password" }, 401);
    devForm();

    signIn(EMAIL, "wrong-password-entirely");
    await screen.findByRole("alert");
    // The alert is the failed press's output; its transition may still be pending for a turn,
    // and a press while it is would be dropped (`../helpers/settle.ts`).
    await settle();

    serviceAnswering(SIGNED_IN);
    signIn();

    await waitFor(() => expect(rereads).toBe(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("in a production build", () => {
  it("renders nothing at all", () => {
    // The service refuses the route in production whatever a browser asks, so this is not the
    // security boundary — it is what keeps a production screen from offering a control that
    // could only ever fail. The component checks as well as the card that composes it, which
    // is what leaves the fields referenced from dead code a minifier can drop.
    vi.stubEnv("NODE_ENV", "production");

    const { container } = render(<DevSignInForm />);

    expect(container).toBeEmptyDOMElement();
  });
});
