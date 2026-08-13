import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Membership } from "@/app/api/membership";
import { ACTIVE_TENANT_COOKIE } from "@/app/api/tenant";
import { resetRestUrlCache } from "@/app/env";
import { LOGIN_PATH } from "@/app/paths";

import { authAnswer, isAuthUrl, requestedUrl } from "../helpers/auth";
import { TENANT_ID, membership } from "../helpers/login";

/**
 * The three writes the login screen makes — and the security boundary they are.
 *
 * A Server Action is a POST endpoint against the page that renders it, reachable by anybody
 * who can send the same request. Rendering a form only for an owner is therefore not a check;
 * these cases are the checks. Each of the three re-derives who is asking from the session
 * cookie and which workspace from the `ouro_tenant` cookie, matched against the memberships
 * the service reports in that same request, and takes nothing else from the form but the
 * smallest reference to what was pressed.
 *
 * So the interesting cases are all the ones somebody would compose by hand: a slug they do
 * not belong to, a workspace they may read but not administer, an organisation login carrying
 * a path separator, a missing flag.
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

const { chooseWorkspace, setOrgEnabled, setRepoEnabled } = await import(
  "@/app/login/actions"
);
const { resetApiClient } = await import("@/app/api/server");

/** The base URL every request below is expected to be built against. */
const BASE_URL = "http://rest.test:4000";

/** Every request the stubbed global `fetch` was handed. */
let requests: Request[] = [];

/** What this person belongs to, for this case. `null` is nobody signed in. */
let memberships: Membership[] | null = [membership()];

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
  memberships = [membership()];
  resetApiClient();
  resetRestUrlCache();
  process.env.OURO_REST_URL = BASE_URL;

  // Two families reach this stub. The generated client hands `fetch` a `Request`; BetterAuth's
  // client hands it a `URL` and an init — see `app/api/auth-client.ts`. Both shapes are
  // answered here, which is what the two-client rule costs a suite that spans both.
  vi.stubGlobal("fetch", (input: Request | URL | string) => {
    const url = requestedUrl(input);
    if (input instanceof Request) requests.push(input);

    const body = isAuthUrl(url) ? authAnswer(url, memberships) : { id: "row", enabled: true };

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
 * The writes.
 *
 * `requests` already holds only what the *generated* client sent — the auth client is
 * answered by the same stub but hands it a URL rather than a `Request`, so the session read
 * never lands here. The filter is kept anyway, so a session read that came back through the
 * generated family would be visible rather than counted as a write.
 */
function writes(): Request[] {
  return requests.filter((request) => !isAuthUrl(request.url));
}

describe("chooseWorkspace", () => {
  it("remembers the workspace and moves on to the enablement step", async () => {
    await expect(chooseWorkspace(form({ workspace: "acme-robotics" }))).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(setCookie).toHaveBeenCalledWith(
      ACTIVE_TENANT_COOKIE,
      "acme-robotics",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(redirect).toHaveBeenCalledWith("/login?workspace=acme-robotics");
  });

  it("refuses a slug this person does not belong to, and writes nothing", async () => {
    // The form is a POST endpoint; a hand-made one naming somebody else's workspace must not
    // be able to point this browser at it.
    await expect(
      chooseWorkspace(form({ workspace: "someone-elses-workspace" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(setCookie).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  // *Refuses a suspended workspace they do belong to* was here, and is not any more. The
  // case cannot be composed at this level after
  // [#711](https://github.com/NobuData/ouroboros/issues/711): a membership is built from
  // BetterAuth's organization listing now, and an organization has no lifecycle column for
  // the service to report `suspended` in — see `app/api/auth-server.ts`. The rule the case was
  // covering is `selectableMemberships`, which still filters and is still asserted directly
  // in `__tests__/api/membership.test.ts`; what is gone is the *route* to it, and
  // [#714](https://github.com/NobuData/ouroboros/issues/714) is what restores one by
  // putting the workspace row model back in the generated family.

  it("refuses a form with no workspace in it at all", async () => {
    await expect(chooseWorkspace(form({}))).rejects.toBeInstanceOf(RedirectSignal);

    expect(setCookie).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(LOGIN_PATH);
  });

  it("refuses when there is no session to check the slug against", async () => {
    // `null` from `get-session` rather than a `401`, since
    // [#711](https://github.com/NobuData/ouroboros/issues/711): the absence of a session is
    // the answer BetterAuth gives, and the action must read it as *nobody* rather than as a
    // failure it might retry past.
    memberships = null;

    await expect(chooseWorkspace(form({ workspace: "acme-robotics" }))).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(setCookie).not.toHaveBeenCalled();
  });

  it("writes the slug rather than whatever the form said, so the cookie is canonical", async () => {
    // The uuid is the other form the contract accepts, and a person can put it in a URL. What
    // is stored is the membership's own slug either way.
    await expect(chooseWorkspace(form({ workspace: TENANT_ID }))).rejects.toBeInstanceOf(
      RedirectSignal,
    );

    expect(setCookie).toHaveBeenCalledWith(
      ACTIVE_TENANT_COOKIE,
      "acme-robotics",
      expect.anything(),
    );
  });
});

describe("setOrgEnabled", () => {
  beforeEach(() => {
    jar.set(ACTIVE_TENANT_COOKIE, "acme-robotics");
  });

  it("patches the organisation in the workspace the cookie named, then re-reads", async () => {
    await setOrgEnabled(form({ login: "acme-robotics", enabled: "false" }));

    const [write] = writes();

    expect(write?.method).toBe("PATCH");
    expect(write?.url).toBe(`${BASE_URL}/api/v1/orgs/${TENANT_ID}/github-orgs/acme-robotics`);
    expect(await write?.json()).toEqual({ enabled: false });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("takes the workspace from the session rather than from the form", async () => {
    // Even a form that names another workspace outright changes nothing about where the
    // request goes: the id in the path came from `/auth/me`.
    await setOrgEnabled(
      form({
        login: "acme-robotics",
        enabled: "true",
        tenantId: "00000000-0000-4000-8000-000000000000",
      }),
    );

    expect(writes()[0]?.url).toContain(`/orgs/${TENANT_ID}/`);
  });

  it("refuses a role that may read the workspace but not administer it", async () => {
    memberships = [membership({ role: "viewer" })];

    await expect(
      setOrgEnabled(form({ login: "acme-robotics", enabled: "false" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a member, who may only read it too", async () => {
    memberships = [membership({ role: "member" })];

    await expect(
      setOrgEnabled(form({ login: "acme-robotics", enabled: "false" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
  });

  it("allows an admin, which is the other role the contract lets administer", async () => {
    memberships = [membership({ role: "admin" })];

    await setOrgEnabled(form({ login: "acme-robotics", enabled: "true" }));

    expect(writes()).toHaveLength(1);
  });

  it("refuses when no workspace has been chosen at all", async () => {
    jar.delete(ACTIVE_TENANT_COOKIE);

    await expect(
      setOrgEnabled(form({ login: "acme-robotics", enabled: "true" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
  });

  it("refuses a login carrying a path separator", async () => {
    // The value is interpolated into a request path, so this is a safety property rather
    // than politeness about input.
    await expect(
      setOrgEnabled(form({ login: "../../tenants", enabled: "true" })),
    ).rejects.toThrow(/login field/);

    expect(writes()).toHaveLength(0);
  });

  it("refuses a login that is absent", async () => {
    await expect(setOrgEnabled(form({ enabled: "true" }))).rejects.toThrow(/login field/);
  });

  it("refuses a flag that is neither true nor false, rather than guess a direction", async () => {
    // A toggle whose direction was guessed is a toggle that sometimes does the opposite of
    // what was pressed.
    await expect(setOrgEnabled(form({ login: "acme-robotics", enabled: "on" }))).rejects.toThrow(
      /enabled field/,
    );
    await expect(setOrgEnabled(form({ login: "acme-robotics" }))).rejects.toThrow(
      /enabled field/,
    );
    expect(writes()).toHaveLength(0);
  });
});

describe("setRepoEnabled", () => {
  beforeEach(() => {
    jar.set(ACTIVE_TENANT_COOKIE, "acme-robotics");
  });

  it("patches the repository under its organisation, then re-reads the route", async () => {
    await setRepoEnabled(
      form({ login: "acme-robotics", repo: "helios-firmware", enabled: "true" }),
    );

    const [write] = writes();

    expect(write?.url).toBe(
      `${BASE_URL}/api/v1/orgs/${TENANT_ID}/github-orgs/acme-robotics/repos/helios-firmware`,
    );
    expect(await write?.json()).toEqual({ enabled: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("sends only the flag, so an enable does not forget the default branch", async () => {
    await setRepoEnabled(
      form({ login: "acme-robotics", repo: "helios-firmware", enabled: "false" }),
    );

    expect(await writes()[0]?.json()).toEqual({ enabled: false });
  });

  it("refuses a role that may only read", async () => {
    memberships = [membership({ role: "viewer" })];

    await expect(
      setRepoEnabled(form({ login: "acme-robotics", repo: "helios-firmware", enabled: "true" })),
    ).rejects.toBeInstanceOf(RedirectSignal);

    expect(writes()).toHaveLength(0);
  });

  it("refuses a repository name carrying a path separator", async () => {
    await expect(
      setRepoEnabled(form({ login: "acme-robotics", repo: "a/../b", enabled: "true" })),
    ).rejects.toThrow(/repo field/);

    expect(writes()).toHaveLength(0);
  });

  it("refuses a repository name that is absent", async () => {
    await expect(
      setRepoEnabled(form({ login: "acme-robotics", enabled: "true" })),
    ).rejects.toThrow(/repo field/);
  });

  it("accepts the dots and hyphens a real repository name carries", async () => {
    await setRepoEnabled(
      form({ login: "acme-robotics", repo: "docs.site-v2", enabled: "true" }),
    );

    expect(writes()[0]?.url).toContain("/repos/docs.site-v2");
  });
});
