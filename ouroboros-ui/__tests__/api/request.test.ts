import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGIN_PATH, RETURN_TO_PARAM } from "@/app/paths";

/**
 * The server's end of "where was this request going" — the header `proxy.ts` stamps, read
 * back for the three redirects that want it.
 *
 * The module is four lines of code and the reason it exists is a framework limitation:
 * Next.js gives a Server Component no way to learn the URL it is rendering for, so the value
 * has to arrive as a header from the one place that saw it. What is worth asserting is
 * therefore not the plumbing but the two properties the redirects depend on — that an absent
 * header is an ordinary answer rather than a fault, and that **nothing composed here escapes
 * `safeReturnTo`**, since the value it reads is one a caller can also send.
 *
 * `paths.test.ts` covers the guard itself, vector by vector; this covers that the guard is
 * on the path between the header and the redirect.
 */

/** The headers of the request under test. */
const incoming = new Headers();

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming) }));

const { REQUEST_PATH_HEADER, loginDestination, requestPath } = await import(
  "@/app/api/request"
);

beforeEach(() => {
  incoming.delete(REQUEST_PATH_HEADER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the header proxy.ts and this module agree on", () => {
  it("is this application's own, and named like the one beside it", () => {
    // `X-Ouro-Tenant` is the other, in `app/api/tenant.ts`. Neither is in the contract nor
    // in BetterAuth's vocabulary, so the prefix is what says whose they are.
    expect(REQUEST_PATH_HEADER).toBe("x-ouro-path");
  });
});

describe("requestPath", () => {
  it("reads the address the proxy stamped", async () => {
    incoming.set(REQUEST_PATH_HEADER, "/dashboard");

    expect(await requestPath()).toBe("/dashboard");
  });

  it("keeps the query, because a deep link is often the query", async () => {
    incoming.set(REQUEST_PATH_HEADER, "/runs?status=failed");

    expect(await requestPath()).toBe("/runs?status=failed");
  });

  it("answers undefined rather than an empty string when there is no header", async () => {
    // Not a fault: `proxy.ts` does not match every path, and a caller reached from a
    // context the proxy never saw simply has no return-to to offer.
    expect(await requestPath()).toBeUndefined();
  });
});

describe("loginDestination", () => {
  it("sends a request back to where it was going", async () => {
    incoming.set(REQUEST_PATH_HEADER, "/dashboard");

    expect(await loginDestination()).toBe(`${LOGIN_PATH}?${RETURN_TO_PARAM}=%2Fdashboard`);
  });

  it("falls back to a bare login path, which is what every redirect used to send", async () => {
    expect(await loginDestination()).toBe(LOGIN_PATH);
  });

  it("refuses a forged header naming another origin", async () => {
    // The value travels in a request header, so a caller can send one too. `proxy.ts`
    // overwrites it on every path it matches; this is the second line, and it is the one
    // that holds for a path the matcher does not cover.
    for (const forged of [
      "https://evil.test/dashboard",
      "//evil.test",
      "/\\evil.test",
      // A browser strips a tab before it resolves, so this would leave the origin while
      // reading as a path here. A newline would too, and cannot be tested: a `Headers`
      // instance refuses to hold one, which is a second guard rather than a gap.
      "/\tevil.test",
      "",
    ]) {
      incoming.set(REQUEST_PATH_HEADER, forged);

      expect(await loginDestination()).toBe(LOGIN_PATH);
    }
  });

  it("refuses the login screen itself, so the redirect cannot loop", async () => {
    // A `401` raised while rendering `/login` is the case: the screen would otherwise
    // redirect to itself once per render, for every signed-out visitor.
    incoming.set(REQUEST_PATH_HEADER, `${LOGIN_PATH}?${RETURN_TO_PARAM}=%2Fdashboard`);

    expect(await loginDestination()).toBe(LOGIN_PATH);
  });
});
