import { beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_PATH } from "@/app/paths";

/**
 * The product's root, `app/(app)/page.tsx`.
 *
 * It stopped being a screen in #45: the dashboard moved to a segment of its own, and what
 * is left here is a signpost. So what there is to assert is exactly what a signpost can get
 * wrong — where it points, that it points *somewhere* rather than rendering, and that it
 * does not do anything else on the way.
 *
 * The redirect target is asserted against `DASHBOARD_PATH` rather than against the string,
 * which is the whole reason `app/paths.ts` exists: this file, the login screen's own
 * redirect and the sidebar entry all have to name one route, and three copies of it are a
 * redirect loop waiting for one of them to be renamed.
 */

/** Where the page asked to be sent. */
const redirect = vi.fn((path: string) => {
  // The real `redirect` signals by throwing, and nothing after a call to it runs. A mock
  // that returned would let a bug — markup after the redirect, a second call — pass
  // unnoticed here and fail only in a browser.
  throw new Error(`NEXT_REDIRECT ${path}`);
});

vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

const Page = (await import("@/app/(app)/page")).default;

beforeEach(() => {
  redirect.mockClear();
});

describe("the product's root", () => {
  it("sends the request to the dashboard", () => {
    expect(() => Page()).toThrow(`NEXT_REDIRECT ${DASHBOARD_PATH}`);

    expect(redirect).toHaveBeenCalledExactlyOnceWith(DASHBOARD_PATH);
  });

  it("points somewhere other than itself, so the redirect terminates", () => {
    // The one way a signpost can be catastrophically wrong. `/` redirecting to `/` is a
    // loop the browser gives up on rather than an error anybody sees.
    expect(DASHBOARD_PATH).not.toBe("/");
  });

  it("renders nothing at all — it is a redirect, not a page with a redirect in it", () => {
    expect(() => Page()).toThrow();
  });
});

describe("the gate, which this route deliberately does not call", () => {
  it("is not consulted, because there is nothing here to protect", () => {
    // Every screen in `(app)` calls `requireWorkspace()` to obtain what it renders. This
    // one renders nothing, so a check here would cost every request to `/` an extra
    // `GET /auth/me` to reach the same place one redirect later — and the page it is sent
    // to has the gate. A mock is not even needed for the page to run, which is the
    // assertion: if it ever imports the gate, this suite fails on the server-only module.
    expect(() => Page()).toThrow(`NEXT_REDIRECT ${DASHBOARD_PATH}`);
  });
});
