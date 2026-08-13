import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership } from "@/app/api/membership";
import { ACTIVE_TENANT_COOKIE } from "@/app/api/tenant";
import { resetRestUrlCache } from "@/app/env";
import { DASHBOARD_PATH, LOGIN_PATH } from "@/app/paths";

import { authAnswer, isAuthUrl, isOrgsUrl, orgsAnswer, requestedUrl } from "../helpers/auth";
import { TENANT_ID, membership, seededWorkspaces } from "../helpers/login";

/**
 * The three writes the login screen makes — and the security boundary they are.
 *
 * A Server Action is a POST endpoint against the page that renders it, reachable by anybody
 * who can send the same request. Rendering a form only for an owner is therefore not a check;
 * these cases are the checks. Each re-derives who is asking from the session cookie, and
 * resolves the workspace the form names against the memberships the service reports in that
 * same request.
 *
 * **The form carries a workspace since
 * [#719](https://github.com/NobuData/ouroboros/issues/719)**, where it used to be implied by
 * the `ouro_tenant` cookie — the card lists every workspace at once now, so there is no
 * single current one for a request to mean. That is a change of *which untrusted place the
 * reference arrives from* and not a loosening: a cookie is as forgeable as a form field, and
 * the check that made one safe is the check that makes the other safe. The cases below are
 * the ones somebody would compose by hand — a slug they do not belong to, a workspace they
 * may read but not administer, a missing flag.
 */

/** The cookies of the request under test, and what the action wrote back. */
const jar = new Map<string, string>();
const setCookie = vi.fn<(name: string, value: string, options: unknown) => void>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: setCookie,
      delete: () => {},
    }),
  // A Server Action's request always carries one — Next.js refuses the action otherwise —
  // and `app/api/auth-server.ts` forwards it so BetterAuth's origin check is satisfied on a
  // write this process composes rather than the browser.
  headers: () => Promise.resolve(new Headers({ origin: "http://localhost:3000" })),
}));

/** What `redirect()` does: signal by throwing, so nothing after it runs. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}

const redirect = vi.fn((to: string) => {
  throw new RedirectSignal(to);
});

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

// `connection()` is how the data-access layer says "this needs a request", which is what
// keeps `next build` from prerendering a screen that depends on who is asking. Outside a
// Next.js request scope it throws by design, so here it is the no-op it would be inside one.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

/** What re-reads the route after a flag has moved. */
const refresh = vi.fn();

vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { discoverDomain, enterMissionControl, setWorkspaceEnabled } = await import(
  "@/app/login/actions"
);
const { resetApiClient } = await import("@/app/api/server");

/** The base URL every request below is expected to be built against. */
const BASE_URL = "http://rest.test:4000";

/** The one public route on this screen — #712's domain discovery. */
const DISCOVER_PATH = "/api/v1/auth/discover";

/** Every request the stubbed global `fetch` was handed. */
let requests: Request[] = [];

/** Every URL it was handed, whichever family composed it. */
let urls: string[] = [];

/** What this person belongs to, for this case. `null` is nobody signed in. */
let memberships: Membership[] | null = [membership()];

/** What `POST /api/v1/auth/discover` answers, for this case. */
let discovery: { status: number; body: unknown } = {
  status: 200,
  body: {
    ssoAvailable: false,
    message: "Enterprise SSO is not configured yet — sign in with GitHub for now.",
  },
};

/**
 * A form carrying exactly the named fields.
 *
 * @param fields The fields to submit.
 * @returns The form data.
 */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

beforeEach(() => {
  jar.clear();
  setCookie.mockClear();
  redirect.mockClear();
  refresh.mockClear();
  requests = [];
  urls = [];
  memberships = [membership()];
  discovery = {
    status: 200,
    body: {
      ssoAvailable: false,
      message: "Enterprise SSO is not configured yet — sign in with GitHub for now.",
    },
  };
  resetApiClient();
  resetRestUrlCache();
  process.env.OURO_REST_URL = BASE_URL;

  // Two families reach this stub. The generated client hands `fetch` a `Request`; BetterAuth's
  // client hands it a `URL` and an init — see `app/api/auth-client.ts`. Both shapes are
  // answered here, which is what the two-client rule costs a suite that spans both.
  vi.stubGlobal("fetch", (input: Request | URL | string) => {
    const url = requestedUrl(input);
    urls.push(url);
    if (input instanceof Request) requests.push(input);

    // The discovery route answers per case, because it is the one call here whose *body* is
    // the thing under test rather than the request that produced it.
    if (url.includes(DISCOVER_PATH)) {
      return Promise.resolve(
        new Response(JSON.stringify(discovery.body), {
          status: discovery.status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    const body = isAuthUrl(url)
      ? authAnswer(url, memberships)
      : isOrgsUrl(url)
        ? orgsAnswer(memberships)
        : { id: "row", enabled: true };

    return Promise.resolve(
      new Response(body === null ? "null" : JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OURO_REST_URL;
  resetRestUrlCache();
  resetApiClient();
});

/**
 * The writes — every request that is not one of the two reads a session costs.
 *
 * `GET /api/v1/orgs` is a read the *generated* client makes, so unlike before #719 it does
 * land in `requests`; filtering it out here is what keeps each case counting what it pressed
 * rather than what rendering cost.
 */
function writes(): Request[] {
  return requests.filter(
    (request) => !isAuthUrl(request.url) && !isOrgsUrl(request.url),
  );
}

describe("enterMissionControl", () => {
  it("makes the workspace active on the session and lands on the dashboard", async () => {
    await expect(
      enterMissionControl(form({ workspace: "acme-robotics" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(urls).toContain(`${BASE_URL}/api/auth/organization/set-active`);
    expect(redirect).toHaveBeenCalledWith(DASHBOARD_PATH);
  });

  it("writes the step-2 hint, so the next visit to /login goes on through", async () => {
    await expect(
      enterMissionControl(form({ workspace: "acme-robotics" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(setCookie).toHaveBeenCalledWith(
      ACTIVE_TENANT_COOKIE,
      TENANT_ID,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("writes the id rather than the slug, so the cookie cannot be refused after the switch", async () => {
    // `rememberWorkspace` throws on a reference the header grammar would not accept, and a
    // slug is whatever created the workspace called it. Throwing there would mean an error
    // page over a session that had in fact already moved.
    memberships = [membership({ slug: "acme_robotics" })];

    await expect(
      enterMissionControl(form({ workspace: "acme_robotics" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(setCookie).toHaveBeenCalledWith(ACTIVE_TENANT_COOKIE, TENANT_ID, expect.anything());
    expect(redirect).toHaveBeenCalledWith(DASHBOARD_PATH);
  });

  it("refuses a slug this person does not belong to, and writes nothing", async () => {
    // The form is a POST endpoint; a hand-made one naming somebody else's workspace must not
    // be able to make it this session's.
    await expect(
      enterMissionControl(form({ workspace: "someone-elses-workspace" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(urls).not.toContain(`${BASE_URL}/api/auth/organization/set-active`);
    expect(setCookie).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("refuses a form with no workspace in it at all", async () => {
    // What a browser submits when nothing is selected — and what the card is built not to
    // produce, since one row always starts checked.
    await expect(enterMissionControl(form({}))).rejects.toBeInstanceOf(RedirectSignal);

    expect(setCookie).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("refuses when there is no session to check the slug against", async () => {
    // `null` from `get-session` rather than a `401`, since
    // [#711](https://github.com/NobuData/ouroboros/issues/711): the absence of a session is
    // the answer BetterAuth gives, and the action must read it as *nobody* rather than as a
    // failure it might retry past.
    memberships = null;

    await expect(
      enterMissionControl(form({ workspace: "acme-robotics" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(setCookie).not.toHaveBeenCalled();
  });

  it("enters the workspace named by id, which is the other form the contract accepts", async () => {
    await expect(enterMissionControl(form({ workspace: TENANT_ID }))).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(setCookie).toHaveBeenCalledWith(ACTIVE_TENANT_COOKIE, TENANT_ID, expect.anything());
  });

  it("enters the one the form named, not the one the session was already acting in", async () => {
    // The whole point of the radio: a person in three workspaces may enter any of them, and
    // the session's own pointer is where they were rather than where they are going.
    const seeded = seededWorkspaces();
    memberships = seeded;

    await expect(enterMissionControl(form({ workspace: "kensuenobu" }))).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(setCookie).toHaveBeenCalledWith(
      ACTIVE_TENANT_COOKIE,
      seeded[2].id,
      expect.anything(),
    );
  });
});

describe("setWorkspaceEnabled", () => {
  it("patches every GitHub organisation under the workspace, then re-reads", async () => {
    await setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "false" }));

    const [write] = writes();

    expect(write?.method).toBe("PATCH");
    expect(write?.url).toBe(`${BASE_URL}/api/v1/orgs/${TENANT_ID}/github-orgs/acme-robotics`);
    expect(await write?.json()).toEqual({ enabled: false });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("moves all of them, because the row's switch summarises all of them", async () => {
    // `OrgRow.enabled` is "whether **any** of this workspace's GitHub organisations is
    // switched on", so a switch that moved only the first would leave the row reading `on`
    // straight after somebody turned it off.
    memberships = [
      membership({
        githubOrgs: [
          { login: "acme-robotics", enabled: true, repoCounts: { enabled: 4, total: 4 } },
          { login: "acme-tooling", enabled: true, repoCounts: { enabled: 1, total: 1 } },
        ],
      }),
    ];

    await setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "false" }));

    expect(writes().map((request) => request.url)).toEqual([
      `${BASE_URL}/api/v1/orgs/${TENANT_ID}/github-orgs/acme-robotics`,
      `${BASE_URL}/api/v1/orgs/${TENANT_ID}/github-orgs/acme-tooling`,
    ]);
  });

  it("acts in the workspace the form named, and in no other", async () => {
    memberships = seededWorkspaces();

    await setWorkspaceEnabled(form({ workspace: "kensuenobu", enabled: "false" }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.url).toContain("/github-orgs/kensuenobu");
  });

  it("refuses a workspace this person does not belong to", async () => {
    await expect(
      setWorkspaceEnabled(form({ workspace: "someone-elses-workspace", enabled: "true" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a role that may read the workspace but not administer it", async () => {
    memberships = [membership({ roles: ["viewer"] })];

    await expect(
      setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "false" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a member, who may only read it too", async () => {
    memberships = [membership({ roles: ["member"] })];

    await expect(
      setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "false" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
  });

  it("refuses a membership carrying no recognised role at all", async () => {
    memberships = [membership({ roles: [] })];

    await expect(
      setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "true" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
  });

  it("allows an admin, which is the other role the contract lets administer", async () => {
    memberships = [membership({ roles: ["admin"] })];

    await setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "true" }));

    expect(writes()).toHaveLength(1);
  });

  it("refuses when there is no session at all", async () => {
    memberships = null;

    await expect(
      setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "true" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
  });

  it("writes nothing for a workspace with no organisations recorded", async () => {
    // The card renders this switch read-only for the same reason: there is nothing under it
    // for a press to move.
    memberships = [membership({ githubOrgs: [] })];

    await setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "true" }));

    expect(writes()).toHaveLength(0);
  });

  it("refuses a flag that is neither true nor false, rather than guess a direction", async () => {
    // A toggle whose direction was guessed is a toggle that sometimes does the opposite of
    // what was pressed.
    await expect(
      setWorkspaceEnabled(form({ workspace: "acme-robotics", enabled: "on" })),
    ).rejects.toThrow(/enabled field/);
    await expect(setWorkspaceEnabled(form({ workspace: "acme-robotics" }))).rejects.toThrow(
      /enabled field/,
    );
    expect(writes()).toHaveLength(0);
  });
});

/**
 * The one submission that reads rather than writes.
 *
 * Its cases are shaped by the criterion that made it exist: *known seeded domain and unknown
 * domain both render designed states, driven by the response, not a constant*. So what is
 * asserted is that the sentence comes back from the service in every branch, that the branch
 * itself is the service's `ssoAvailable` and not this application's opinion, and that a
 * failure is a state to render rather than an error boundary over a sign-in screen.
 *
 * The `waiting` state is what `useActionState` is initialised with and never what this
 * returns, so every case here passes it in and expects something else.
 */
describe("discoverDomain", () => {
  /** The state the form is rendered in before anything has been submitted. */
  const WAITING = { status: "waiting" } as const;

  it("submits the domain to the public discovery route", async () => {
    await discoverDomain(WAITING, form({ domain: "acme-robotics.dev" }));

    const asked = writes().find((request) => request.url.includes(DISCOVER_PATH));

    expect(asked?.method).toBe("POST");
    expect(await asked?.clone().json()).toEqual({ domain: "acme-robotics.dev" });
  });

  it("renders the service's own sentence for a domain a workspace holds", async () => {
    // The seeded domain (`ouroboros-db/migrations/R__dev_seed.sql`). The endpoint answers the
    // same body for it as for anything else, deliberately — that uniformity is what stops it
    // being a way to ask *is this company a customer* — so what the card can say is what came
    // back, and this is the case that pins it.
    await expect(
      discoverDomain(WAITING, form({ domain: "acme-robotics.dev" })),
    ).resolves.toEqual({
      status: "answered",
      ssoAvailable: false,
      message: "Enterprise SSO is not configured yet — sign in with GitHub for now.",
    });
  });

  it("renders the same state for a domain nothing has ever heard of", async () => {
    await expect(
      discoverDomain(WAITING, form({ domain: "nobody.example" })),
    ).resolves.toMatchObject({ status: "answered", ssoAvailable: false });
  });

  it("takes the flag from the answer, so #722 needs no change here", async () => {
    discovery = {
      status: 200,
      body: { ssoAvailable: true, message: "Taking you to your identity provider…" },
    };

    await expect(
      discoverDomain(WAITING, form({ domain: "acme-robotics.dev" })),
    ).resolves.toEqual({
      status: "answered",
      ssoAvailable: true,
      message: "Taking you to your identity provider…",
    });
  });

  it("follows the identity provider when the answer names one", async () => {
    discovery = {
      status: 200,
      body: {
        ssoAvailable: true,
        message: "Taking you to your identity provider…",
        redirectUrl: "/api/auth/sso/saml2/acme",
      },
    };

    await expect(
      discoverDomain(WAITING, form({ domain: "acme-robotics.dev" })),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirect).toHaveBeenCalledWith("/api/auth/sso/saml2/acme");
  });

  it("goes nowhere for a destination a browser would execute", async () => {
    // The service is trusted and this is still refused: a compromised one sending
    // `javascript:` must not find a client that follows it.
    discovery = {
      status: 200,
      body: {
        ssoAvailable: true,
        message: "Taking you to your identity provider…",
        redirectUrl: "javascript:alert(1)",
      },
    };

    await expect(
      discoverDomain(WAITING, form({ domain: "acme-robotics.dev" })),
    ).resolves.toMatchObject({ status: "answered", ssoAvailable: true });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("names the field when the service refuses the value", async () => {
    discovery = {
      status: 422,
      body: {
        code: "validation_failed",
        message: "The request is not valid. See `details` for each field.",
        details: { domain: ["domain must be a company domain, such as acme.ouroboros.dev"] },
      },
    };

    await expect(discoverDomain(WAITING, form({ domain: "not a domain" }))).resolves.toEqual({
      status: "refused",
      message: "domain must be a company domain, such as acme.ouroboros.dev",
    });
  });

  it("returns a refusal rather than throwing, so the screen survives a bad domain", async () => {
    // A throw from a Server Action reaches the route's error boundary, which would replace
    // the sign-in screen with an error page over a typo in one field.
    discovery = {
      status: 500,
      body: { code: "internal_error", message: "The service failed.", details: {} },
    };

    await expect(
      discoverDomain(WAITING, form({ domain: "acme-robotics.dev" })),
    ).resolves.toMatchObject({ status: "refused" });
  });

  it("refuses a blank submission without spending a request on it", async () => {
    // The browser's `required` catches this first; a form posted by hand does not.
    await expect(discoverDomain(WAITING, form({ domain: "   " }))).resolves.toMatchObject({
      status: "refused",
      message: expect.stringContaining("company domain"),
    });
    expect(writes().filter((request) => request.url.includes(DISCOVER_PATH))).toHaveLength(0);
  });

  it("refuses a form with no domain field at all", async () => {
    await expect(discoverDomain(WAITING, form({}))).resolves.toMatchObject({
      status: "refused",
    });
  });

  it("asks without a session, because the endpoint is public and its caller has none", async () => {
    // The whole point of `anonymousApi()`: `api()`'s `401` handler would send this request to
    // the login screen, which is the page asking.
    memberships = null;

    await expect(
      discoverDomain(WAITING, form({ domain: "acme-robotics.dev" })),
    ).resolves.toMatchObject({ status: "answered" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
