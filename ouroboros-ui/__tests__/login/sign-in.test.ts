import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GITHUB_PROVIDER,
  SOCIAL_SIGN_IN_PATH,
  SignInError,
  beginSignIn,
  socialSignIn,
} from "@/app/login/sign-in";

import { requestedUrl } from "../helpers/auth";

/**
 * How a sign-in begins, now that BetterAuth's own client is what begins it
 * ([#718](https://github.com/NobuData/ouroboros/issues/718)).
 *
 * The suite stubs `fetch` rather than injecting one, which is the pattern
 * `__tests__/api/auth-client.test.tsx` sets for this family: the client resolves its fetch per
 * call for exactly this reason, and answering it there means these cases exercise the real
 * client configuration — the base path, the origin, the plugins — instead of a transport
 * written in the test.
 *
 * Three properties are worth holding and the rest is the library's business. **That it is a
 * `POST` at the route the proxy forwards**, which is what #702 changed and what the login
 * screen was silently failing on for a day. **That `disableRedirect` is sent**, which is the
 * one option keeping the library from assigning `window.location` inside a `try {} catch {}`
 * where nothing could observe it failing. And **the failures**, asserted as carefully as the
 * success, because the button shows every one of them to a person.
 */

/**
 * A safe default installed before any `vi.stubGlobal`, so it is what `unstubAllGlobals`
 * restores — the same guard `auth-client.test.tsx` explains at length. Nothing in this file
 * may reach a socket.
 */
globalThis.fetch = (() => Promise.resolve(new Response("null"))) as typeof fetch;

/** The github.com URL BetterAuth answers a social sign-in with. */
const CONSENT = "https://github.com/login/oauth/authorize?client_id=abc&state=xyz";

/** Every request the stub was handed, and the body each carried. */
let urls: string[];
let bodies: unknown[];

/**
 * Answer whatever the client asks with one body and status.
 *
 * @param body What the service replies with. `undefined` sends an empty body.
 * @param status The status to reply with.
 * @returns The stub, so a case can count its calls.
 */
function serviceAnswering(body: unknown, status = 200) {
  const fetchImpl = vi.fn((input: Request | URL | string, init?: RequestInit) => {
    urls.push(requestedUrl(input));
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : init?.body);

    return Promise.resolve(
      new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

beforeEach(() => {
  urls = [];
  bodies = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("socialSignIn", () => {
  it("addresses BetterAuth's social route, on this origin", async () => {
    // Same-origin because `proxy.ts` forwards it. An absolute address here would be the
    // cross-origin sign-in that could not set a cookie the callback is checked against — and
    // would be the service's address in the browser's bundle, which is what `OURO_REST_URL`
    // carrying no `NEXT_PUBLIC_` prefix exists to prevent.
    serviceAnswering({ url: CONSENT, redirect: false });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER));

    expect(new URL(urls[0]).pathname).toBe(SOCIAL_SIGN_IN_PATH);
    expect(new URL(urls[0]).origin).toBe(window.location.origin);
  });

  it("POSTs, as the only verb the route answers", async () => {
    const fetchImpl = serviceAnswering({ url: CONSENT, redirect: false });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER));

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("distinguishes the provider in the body, which is what makes a second one free", async () => {
    // The extension point: every social provider shares this route and differs only here, so
    // adding one is a builder call and a button rather than a new code path.
    serviceAnswering({ url: CONSENT, redirect: false });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER));

    expect(bodies[0]).toMatchObject({ provider: "github" });
  });

  it("refuses the library's own redirect, so the one navigation is the button's", async () => {
    // Without this, better-auth's `redirect` fetch plugin assigns `window.location.href`
    // itself whenever an answer carries `{url, redirect: true}` — inside a `try {} catch {}`
    // that swallows whatever goes wrong. A departure nothing can observe is a departure the
    // button cannot report having failed.
    serviceAnswering({ url: CONSENT, redirect: false });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER));

    expect(bodies[0]).toMatchObject({ disableRedirect: true });
  });

  it("answers with the provider's URL rather than the envelope around it", async () => {
    serviceAnswering({ url: CONSENT, redirect: false });

    await expect(beginSignIn(socialSignIn(GITHUB_PROVIDER))).resolves.toBe(CONSENT);
  });

  it("does not navigate, which is what keeps it testable without a browser", async () => {
    // `window.location` is the component's business. If this module ever starts navigating,
    // this suite stops being able to run it.
    const before = window.location.href;
    serviceAnswering({ url: CONSENT, redirect: false });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER));

    expect(window.location.href).toBe(before);
  });

  it("makes no request until it is begun, so composing one during a render is free", () => {
    // A builder that fetched would make `socialSignIn(…)` in a Server Component's render an
    // outbound request from the server, for a sign-in nobody has pressed.
    const fetchImpl = serviceAnswering({ url: CONSENT, redirect: false });

    socialSignIn(GITHUB_PROVIDER);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is a value a Server Component can hand to a Client Component", () => {
    // Not a stylistic preference: the card is a Server Component and the button is a Client
    // Component, so this crosses a boundary that serialises. A thunk here is *"functions
    // cannot be passed directly to Client Components"* — a 500 on `/login` rather than a type
    // error, which is exactly how this was found.
    const start = socialSignIn(GITHUB_PROVIDER);

    expect(start).toEqual({ kind: "social", provider: "github" });
    expect(JSON.parse(JSON.stringify(start))).toEqual(start);
  });
});

describe("when the sign-in does not begin", () => {
  it("reports the service's own message when it refuses", async () => {
    // BetterAuth composes its own failures — a provider that is not configured is a `400`
    // with a message worth showing rather than a status worth translating.
    serviceAnswering({ message: "Provider not found", code: "PROVIDER_NOT_FOUND" }, 400);

    const refusal = beginSignIn(socialSignIn(GITHUB_PROVIDER));

    await expect(refusal).rejects.toBeInstanceOf(SignInError);
    await expect(refusal).rejects.toThrow(/Provider not found/);
  });

  it("carries the status, for a caller that wants to tell refusals apart", async () => {
    serviceAnswering({ message: "no" }, 429);

    await expect(beginSignIn(socialSignIn(GITHUB_PROVIDER))).rejects.toMatchObject({
      status: 429,
      name: "SignInError",
    });
  });

  it("names the status when the refusal carried no message", async () => {
    serviceAnswering(undefined, 503);

    await expect(beginSignIn(socialSignIn(GITHUB_PROVIDER))).rejects.toThrow(/503/);
  });

  it("survives a refusal that is not JSON at all", async () => {
    // A gateway in front of the service answers HTML. The status is the fact worth reporting;
    // a parse error would replace it with a `SyntaxError` naming a character position.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("<html>502</html>", { status: 502 }))),
    );

    await expect(beginSignIn(socialSignIn(GITHUB_PROVIDER))).rejects.toBeInstanceOf(SignInError);
  });

  it("refuses an answer that carried nowhere to go", async () => {
    // A real shape rather than a defensive check — an `idToken` sign-in completes without
    // leaving the origin — and navigating to `undefined` would put the string "undefined" in
    // the address bar.
    serviceAnswering({ redirect: false });

    await expect(beginSignIn(socialSignIn(GITHUB_PROVIDER))).rejects.toThrow(
      /did not return somewhere to go/i,
    );
  });

  it("says the service could not be reached when the request itself failed", async () => {
    // better-fetch reports a refusal in the value but *throws* when the request never
    // happened: it only catches its own errors under `catchAllError`, which BetterAuth does
    // not set. A caller that only read the value would turn a dropped connection into an
    // unhandled rejection on a press.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const failure = beginSignIn(socialSignIn(GITHUB_PROVIDER));

    await expect(failure).rejects.toBeInstanceOf(SignInError);
    await expect(failure).rejects.toThrow(/connection/i);
    await expect(failure).rejects.toMatchObject({ status: 0 });
  });
});
