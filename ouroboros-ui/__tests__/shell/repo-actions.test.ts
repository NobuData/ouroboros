import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../helpers/login";

/**
 * The chip's one server hop ([#77](https://github.com/NobuData/ouroboros/issues/77)): the
 * repositories the caller's active workspace has enabled.
 *
 * A Server Action is a POST endpoint anybody can reach, so every action suite in this module
 * is written as the security case first. Here the case is unusually short and this is what it
 * proves: **the action takes no arguments**, so the workspace it answers for is the one the
 * caller's own session names, and there is no reference in the call for anybody to point
 * somewhere else. What remains is the posture — a refusal is a value the menu can draw, and
 * the gate's redirect is the one throw that must travel.
 */

/** What the gate answers. Mutable, so a case says which world it is about. */
let gate: { session: unknown; membership: unknown } = {
  session: null,
  membership: undefined,
};

/** What `redirect()` does: signal by throwing, so nothing after it runs. */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}

vi.mock("@/app/api/access", () => ({
  requireWorkspace: () => {
    if (gate.session === null || gate.membership === undefined) {
      throw new RedirectSignal("/login");
    }
    return Promise.resolve(gate);
  },
}));

/** What the enablement read answers, per case. */
const readEnablement = vi.fn();

vi.mock("@/app/api/enablement", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/enablement")>(
    "@/app/api/enablement",
  );

  // The derivation is the real one — `enabledRepos` is what applies the two-flag rule, and a
  // suite that stubbed it would be asserting against its own reading of that rule rather than
  // against the application's. Only the *read* is replaced.
  return { ...actual, readEnablement: () => readEnablement() };
});

// The enablement module is `server-only` and sits on the server-side client, whose own
// imports are the three every server-side suite answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readFocusRepos } = await import("@/app/shell/repo-actions");

/**
 * The seeded organisation row.
 *
 * @param login Its GitHub login.
 * @param enabled Whether it is switched on.
 * @returns The row, in the shape the composition carries it.
 */
function org(login: string, enabled = true) {
  return { id: `org-${login}`, orgId: TENANT_ID, login, enabled, installedAt: null };
}

/**
 * One repository under an organisation.
 *
 * @param name Its name.
 * @param enabled Whether it is switched on.
 * @returns The row.
 */
function repo(name: string, enabled = true) {
  return { id: `repo-${name}`, githubOrgId: "org-acme-robotics", name, enabled };
}

beforeEach(() => {
  gate = { session: { user: sessionUser() }, membership: membership() };
  readEnablement.mockReset();
  readEnablement.mockResolvedValue({
    orgTotal: 1,
    orgs: [
      {
        org: org("acme-robotics"),
        repos: [repo("helios-firmware"), repo("atlas-scheduler", false)],
        repoTotal: 2,
      },
    ],
  });
});

describe("reading the focus-repo choices", () => {
  it("answers the enabled repositories of the workspace the session is acting in", async () => {
    const answer = await readFocusRepos();

    expect(answer).toEqual({
      ok: true,
      organizationId: TENANT_ID,
      repos: [{ id: "repo-helios-firmware", name: "helios-firmware", login: "acme-robotics" }],
    });
  });

  it("names the workspace it answered for, so a stale answer can be discarded", async () => {
    // The chip pairs the listing with the workspace it asked about: an answer that arrives
    // after a switch, or survives one, describes somewhere the session no longer is.
    gate = {
      session: { user: sessionUser() },
      membership: membership({ id: "5eed0001-0000-4000-8000-000000000003" }),
    };

    const answer = await readFocusRepos();

    expect(answer).toMatchObject({ organizationId: "5eed0001-0000-4000-8000-000000000003" });
  });

  it("takes no argument at all, which is the whole of its authorization", async () => {
    // Nothing in the call names a workspace, so there is nothing to forge: the gate resolves
    // it from the cookie this request carries.
    expect(readFocusRepos).toHaveLength(0);
  });

  it("answers an empty list for a workspace with nothing enabled", async () => {
    // A state to draw, not a failure — the submenu says so in words and *All repos* is still
    // choosable, because that choice needs no listing to be true.
    readEnablement.mockResolvedValue({ orgTotal: 0, orgs: [] });

    expect(await readFocusRepos()).toEqual({ ok: true, organizationId: TENANT_ID, repos: [] });
  });

  it("keeps a refusal as a value the menu can draw", async () => {
    // `Reading<T>`'s posture (`app/dashboard/data.ts`): the menu is chrome, and a workspace
    // whose repositories could not be listed is a submenu that says so rather than an error
    // boundary over the screen the reader is still entitled to be on.
    readEnablement.mockRejectedValue(
      new ApiError(503, "service_unavailable", "The service is not answering.", {}, "/repos"),
    );

    expect(await readFocusRepos()).toEqual({
      ok: false,
      reason: "The service is not answering.",
    });
  });

  it("lets the gate's redirect travel", async () => {
    // The one throw that must not be caught: a `catch` wide enough to hold it would swallow
    // the navigation to the login screen and report it as a workspace that could not be read.
    gate = { session: null, membership: undefined };

    await expect(readFocusRepos()).rejects.toBeInstanceOf(RedirectSignal);
  });

  it("lets anything that is not the service refusing travel too", async () => {
    readEnablement.mockRejectedValue(new TypeError("fetch failed"));

    await expect(readFocusRepos()).rejects.toBeInstanceOf(TypeError);
  });
});
