import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Access } from "@/app/api/access";
import type { Membership } from "@/app/api/membership";
import { DASHBOARD_PATH, LOGIN_PATH, RETURN_TO_PARAM } from "@/app/paths";
import { WORKSPACE_PARAM } from "@/app/login/view";

import { membership, sessionUser } from "../helpers/login";

/**
 * The `/login` route, and the one decision it makes that `app/login/view.ts` does not.
 *
 * Everything about *what the screen shows* is pure and is covered by `view.test.ts`. What is
 * left in the route is where a settled visitor goes, and
 * [#716](https://github.com/NobuData/ouroboros/issues/716) gave that an answer beyond the
 * dashboard: a `401` sends a request here carrying `?next=`, and a screen that always
 * finished on the dashboard would drop the request that was actually being made.
 *
 * The guard is the point of most of these cases. The parameter arrives in a URL, so it is
 * whatever anybody cared to type, and a link carrying `?next=https://evil.test` that
 * otherwise looks like this product's own would hand a freshly signed-in visitor to somebody
 * else's page. `safeReturnTo` is where that is refused — `paths.test.ts` covers the vectors
 * one by one — and this is where the route is held to using it.
 */

/** What `currentAccess()` reports for this case. */
let access: Access;

/** Whether this browser has been through step 2 — the `ouro_tenant` hint. */
let settledBrowser: boolean;

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/access", () => ({ currentAccess: () => Promise.resolve(access) }));
vi.mock("@/app/api/server", () => ({
  workspaceHint: () => Promise.resolve(settledBrowser ? "acme-robotics" : undefined),
}));

// The card the unsettled cases render submits to Server Actions, whose module reaches for
// `next/cache` and the server-only client.
vi.mock("@/app/login/actions", () => ({
  enterMissionControl: vi.fn(),
  setWorkspaceEnabled: vi.fn(),
  discoverDomain: vi.fn(),
}));

/** Where the request was sent, if it was. */
let redirectedTo: string | undefined;

/** What Next.js's `redirect` throws, so that nothing after a redirect renders. */
class RedirectSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectedTo = path;
    throw new RedirectSignal(path);
  },
}));

const { default: LoginPage } = await import("@/app/(auth)/login/page");

/** A person who has signed in and settled on a workspace — the `dashboard` outcome. */
function settled(workspace: Membership = membership()): Access {
  return {
    session: {
      user: sessionUser(),
      memberships: [workspace],
      membershipTotal: 1,
      activeOrganizationId: workspace.id,
      tenantSuggestion: null,
    },
    membership: workspace,
  };
}

/**
 * Render the route for one query string.
 *
 * @param query The parameters, as Next.js hands them over.
 * @returns Nothing — every case here redirects, and the signal is what is asserted.
 */
async function visit(query: Record<string, string | string[] | undefined>): Promise<void> {
  await LoginPage({ searchParams: Promise.resolve(query) }).catch((error: unknown) => {
    if (!(error instanceof RedirectSignal)) throw error;
  });
}

beforeEach(() => {
  redirectedTo = undefined;
  settledBrowser = true;
  access = settled();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("where a settled visitor lands", () => {
  it("goes to the dashboard when nothing said otherwise", async () => {
    await visit({});

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });

  it("goes back to the page a 401 interrupted", async () => {
    // The round trip #716 opened: the browser is sent here carrying where it was, and this is
    // the half that honours it. Without this the parameter would be decoration.
    await visit({ [RETURN_TO_PARAM]: "/dashboard?tab=runs" });

    expect(redirectedTo).toBe("/dashboard?tab=runs");
  });

  it("refuses a return-to that leaves this origin", async () => {
    await visit({ [RETURN_TO_PARAM]: "https://evil.test/dashboard" });

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });

  it("refuses a protocol-relative return-to, which reads as a path and is not one", async () => {
    await visit({ [RETURN_TO_PARAM]: "//evil.test" });

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });

  it("refuses a return-to naming the login screen, which would be a loop", async () => {
    await visit({ [RETURN_TO_PARAM]: LOGIN_PATH });

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });

  it("refuses a repeated parameter rather than picking one of the two", async () => {
    // The rule the `?workspace=` parameter already follows: there is no right answer to which
    // of two was meant, and guessing means a URL that quietly redirects somewhere nobody
    // named.
    await visit({ [RETURN_TO_PARAM]: ["/dashboard", "/settings"] });

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });
});

describe("when the visitor is not settled", () => {
  it("renders the screen rather than redirecting, return-to or not", async () => {
    // A `?next=` is a note about *afterwards*. Somebody who still has to sign in, or still
    // has to be asked where the loop runs, is not afterwards yet.
    access = { session: null, membership: undefined };

    const screen = await LoginPage({
      searchParams: Promise.resolve({ [RETURN_TO_PARAM]: "/dashboard" }),
    });

    expect(redirectedTo).toBeUndefined();
    expect(screen).toBeTruthy();
  });

  it("asks where the loop runs on a browser that has not been asked", async () => {
    // The state a sign-in lands in, and the reason the hint exists at all: the session
    // already names a workspace — `ouroboros-rest` stamps one at session creation — so
    // without this the screen would redirect past the question it exists to ask.
    settledBrowser = false;

    const screen = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(redirectedTo).toBeUndefined();
    expect(screen).toBeTruthy();
  });

  it("asks again when the URL names a workspace, even on a settled browser", async () => {
    const screen = await LoginPage({
      searchParams: Promise.resolve({ [WORKSPACE_PARAM]: "acme-robotics" }),
    });

    expect(redirectedTo).toBeUndefined();
    expect(screen).toBeTruthy();
  });

  it("refuses a repeated workspace parameter rather than picking one of the two", async () => {
    // Guessing would mean a URL that quietly configures a workspace nobody named.
    await visit({ [WORKSPACE_PARAM]: ["acme-robotics", "acme-labs"] });

    expect(redirectedTo).toBe(DASHBOARD_PATH);
  });
});
