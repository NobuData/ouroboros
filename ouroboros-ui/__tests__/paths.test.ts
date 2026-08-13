import { describe, expect, it } from "vitest";

import {
  DASHBOARD_PATH,
  LOGIN_PATH,
  RETURN_TO_PARAM,
  loginPath,
  safeReturnTo,
} from "@/app/paths";

/**
 * The routes this application redirects to, and the one of them that takes an argument.
 *
 * `loginPath` and `safeReturnTo` arrived with
 * [#716](https://github.com/NobuData/ouroboros/issues/716), which made a `401` carry where it
 * came from. Most of what is asserted here is the *guard*: the return-to is a value from a
 * URL, so it is whatever anybody cared to type, and the whole of what stands between that and
 * an open redirect is `safeReturnTo`. Each vector below is a way a string that looks like a
 * path leaves this origin — which is why they are listed one by one rather than covered by a
 * single "rejects a URL" case.
 */

describe("the paths themselves", () => {
  it("are the two segments the application redirects between", () => {
    expect(LOGIN_PATH).toBe("/login");
    expect(DASHBOARD_PATH).toBe("/dashboard");
  });
});

describe("safeReturnTo", () => {
  it("accepts a path on this origin, unchanged", () => {
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
  });

  it("keeps the query string, because that is usually the request being resumed", () => {
    expect(safeReturnTo("/dashboard?tab=runs&limit=10")).toBe("/dashboard?tab=runs&limit=10");
  });

  it("keeps a fragment", () => {
    expect(safeReturnTo("/dashboard#system")).toBe("/dashboard#system");
  });

  it("has nothing to return to when there was no parameter", () => {
    expect(safeReturnTo(undefined)).toBeUndefined();
  });

  it("has nothing to return to for an empty parameter", () => {
    // `?next=` is what an unset value in a hand-built link looks like.
    expect(safeReturnTo("")).toBeUndefined();
  });

  it("refuses an absolute URL", () => {
    expect(safeReturnTo("https://evil.test/dashboard")).toBeUndefined();
  });

  it("refuses a protocol-relative URL", () => {
    // The one that looks most like a path: `new URL("//evil.test", origin)` is `evil.test`,
    // so a guard that parsed rather than read would have to notice this on the far side.
    expect(safeReturnTo("//evil.test/dashboard")).toBeUndefined();
  });

  it("refuses a backslash in the leading pair, which browsers read as that same slash", () => {
    expect(safeReturnTo("/\\evil.test/dashboard")).toBeUndefined();
  });

  it("refuses a javascript: URL", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBeUndefined();
  });

  it("refuses a scheme-relative path that does not begin with a slash at all", () => {
    expect(safeReturnTo("dashboard")).toBeUndefined();
  });

  it("refuses a value carrying a newline", () => {
    // A browser strips it before resolving, so this reads as a path here and leaves the
    // origin there. The same is true of a tab and of a carriage return.
    expect(safeReturnTo("/\nhttps://evil.test")).toBeUndefined();
    expect(safeReturnTo("/\thttps://evil.test")).toBeUndefined();
    expect(safeReturnTo("/\rhttps://evil.test")).toBeUndefined();
  });

  it("refuses the login screen itself, so nothing can bounce between it and itself", () => {
    expect(safeReturnTo(LOGIN_PATH)).toBeUndefined();
    expect(safeReturnTo(`${LOGIN_PATH}?workspace=acme-robotics`)).toBeUndefined();
  });

  it("accepts a path that merely begins with the login screen's name", () => {
    // `/login-help` is a different route, and a prefix comparison would refuse it.
    expect(safeReturnTo("/login-help")).toBe("/login-help");
  });
});

describe("loginPath", () => {
  it("is the bare login screen when there is nowhere to return to", () => {
    expect(loginPath()).toBe(LOGIN_PATH);
  });

  it("carries a safe return-to as an encoded parameter", () => {
    expect(loginPath("/dashboard?tab=runs")).toBe(
      `${LOGIN_PATH}?${RETURN_TO_PARAM}=%2Fdashboard%3Ftab%3Druns`,
    );
  });

  it("encodes the value, so its own query string cannot end the parameter early", () => {
    const composed = loginPath("/dashboard?next=/somewhere-else");

    expect(new URL(composed, "http://ui.test").searchParams.get(RETURN_TO_PARAM)).toBe(
      "/dashboard?next=/somewhere-else",
    );
  });

  it("drops a return-to the guard refuses rather than passing it on", () => {
    // The property that lets every caller hand it whatever it has: an unsafe value produces
    // the bare login path rather than a decision for the caller to make.
    expect(loginPath("https://evil.test")).toBe(LOGIN_PATH);
  });
});
