import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GITHUB_PROVIDER,
  SOCIAL_SIGN_IN_PATH,
  SignInError,
  beginSignIn,
  socialSignIn,
} from "@/app/login/sign-in";

/**
 * How a sign-in begins.
 *
 * **The shape here is the one #702 changed**, and these are the assertions that would have
 * caught the breakage it shipped: the route answers `POST` only, so what matters is that a
 * `POST` is what gets made, that the body carries the provider, and that the URL in the
 * answer is what comes back rather than the answer itself. A `GET` at this path is a `404`
 * from the service, which is what the login screen was doing for a day.
 *
 * The failures are asserted as carefully as the success, because the button shows them to a
 * person: the design system asks that a control which cannot act say why, and a press that
 * failed is that case arriving late.
 */

/** Answer one request with a body and a status. */
function answering(body: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as unknown as typeof fetch;
}

/** The github.com URL BetterAuth answers a social sign-in with. */
const CONSENT = "https://github.com/login/oauth/authorize?client_id=abc&state=xyz";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("socialSignIn", () => {
  it("addresses BetterAuth's social route, same-origin", () => {
    // Same-origin because `proxy.ts` forwards it. An absolute URL here would be the
    // cross-origin sign-in that could not set a cookie the callback is checked against.
    const request = socialSignIn(GITHUB_PROVIDER);

    expect(request.path).toBe("/api/auth/sign-in/social");
    expect(request.path.startsWith("/")).toBe(true);
  });

  it("distinguishes the provider in the body, which is what makes a second one free", () => {
    // The extension point: every social provider shares this route and differs only here,
    // so adding one is a builder call and a button rather than a new code path.
    expect(socialSignIn(GITHUB_PROVIDER).body).toEqual({ provider: "github" });
    expect(socialSignIn("gitlab").body).toEqual({ provider: "gitlab" });
    expect(socialSignIn("gitlab").path).toBe(SOCIAL_SIGN_IN_PATH);
  });
});

describe("beginSignIn", () => {
  it("POSTs the request, as the only verb the route answers", async () => {
    const fetchImpl = answering({ url: CONSENT, redirect: true });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "github" }),
      }),
    );
  });

  it("sends the cookies, which the callback is later checked against", async () => {
    // The answer sets `better-auth.state`; without it the handshake fails at the last hop
    // with `state_mismatch` — a failure that appears at the *end* of a round trip to
    // github.com and names nothing about this request.
    const fetchImpl = answering({ url: CONSENT });

    await beginSignIn(socialSignIn(GITHUB_PROVIDER), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("answers with the provider's URL rather than the envelope around it", async () => {
    const url = await beginSignIn(socialSignIn(GITHUB_PROVIDER), answering({ url: CONSENT }));

    expect(url).toBe(CONSENT);
  });

  it("does not navigate, which is what keeps it testable without a browser", async () => {
    // `window.location` is the component's business. If this function ever starts
    // navigating, this suite stops being able to run it.
    const before = globalThis.window?.location.href;

    await beginSignIn(socialSignIn(GITHUB_PROVIDER), answering({ url: CONSENT }));

    expect(globalThis.window?.location.href).toBe(before);
  });

  it("reports the service's own message when it refuses", async () => {
    // BetterAuth composes its own failures — a provider that is not configured is a `400`
    // with a message worth showing rather than a status worth translating.
    const refusal = beginSignIn(
      socialSignIn("nonesuch"),
      answering({ message: "Provider not found", code: "PROVIDER_NOT_FOUND" }, 400),
    );

    await expect(refusal).rejects.toBeInstanceOf(SignInError);
    await expect(refusal).rejects.toThrow(/Provider not found/);
  });

  it("names the status when the refusal carried no message", async () => {
    await expect(
      beginSignIn(socialSignIn(GITHUB_PROVIDER), answering(undefined, 503)),
    ).rejects.toThrow(/503/);
  });

  it("survives a refusal that is not JSON at all", async () => {
    // A gateway in front of the service answers HTML. The status is the fact worth
    // reporting; a parse error would replace it with a `SyntaxError` naming a character.
    const html = vi.fn(() =>
      Promise.resolve(new Response("<html>502</html>", { status: 502 })),
    ) as unknown as typeof fetch;

    await expect(beginSignIn(socialSignIn(GITHUB_PROVIDER), html)).rejects.toThrow(/502/);
  });

  it("refuses an answer that carried nowhere to go", async () => {
    // `redirect: false` is a real shape, not a defensive check — and navigating to
    // `undefined` would put the string "undefined" in the address bar.
    await expect(
      beginSignIn(socialSignIn(GITHUB_PROVIDER), answering({ redirect: false })),
    ).rejects.toThrow(/did not return somewhere to go/i);
  });

  it("says the service could not be reached when the request itself failed", async () => {
    const offline = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));

    const failure = beginSignIn(
      socialSignIn(GITHUB_PROVIDER),
      offline as unknown as typeof fetch,
    );

    await expect(failure).rejects.toBeInstanceOf(SignInError);
    await expect(failure).rejects.toThrow(/connection/i);
  });

  it("carries the status on the error, for a caller that wants to tell them apart", async () => {
    await expect(
      beginSignIn(socialSignIn(GITHUB_PROVIDER), answering({ message: "no" }, 429)),
    ).rejects.toMatchObject({ status: 429, name: "SignInError" });
  });
});
