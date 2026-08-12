import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { resetRestUrlCache } from "@/app/env";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Session } from "@/app/api/session";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";

// The resource sits on the server-side client, so importing it pulls in the same three
// server-only modules `server.test.ts` answers. Nothing here calls the wired client — every
// case passes its own — but the mocks have to exist for the import to succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { githubSignInUrl, session } = await import("@/app/api/session");

/**
 * The session resource: one read, and the one URL that is a link rather than a call.
 */

/** A session as the contract's own example carries it. */
const SESSION = {
  user: {
    id: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    displayName: "Ken Suenobu",
    avatarUrl: null,
    createdAt: "2026-08-11T10:20:23.114Z",
    updatedAt: "2026-08-11T10:20:23.114Z",
  },
  memberships: [
    {
      tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme",
      displayName: "Acme, Inc.",
      status: "active",
      role: "owner",
      invitedAt: "2026-08-11T10:20:23.114Z",
      joinedAt: "2026-08-11T10:20:23.114Z",
    },
  ],
  tenantSuggestion: null,
};

describe("session.read", () => {
  it("calls the one operation the contract publishes for it", async () => {
    const { client, requests } = clientAnswering(SESSION);

    const read = await session.read(client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/auth/me`);
    expect(requests[0]?.method).toBe("GET");
    expect(read).toEqual(SESSION);
  });

  it("returns the memberships as a list, empty rather than absent", async () => {
    const { client } = clientAnswering({ ...SESSION, memberships: [] });

    const read = await session.read(client);

    expect(read.memberships).toEqual([]);
  });

  it("preserves a suggestion, which is what a first-run screen is built on", async () => {
    const suggestion = {
      tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme",
      displayName: "Acme, Inc.",
    };
    const { client } = clientAnswering({
      ...SESSION,
      memberships: [],
      tenantSuggestion: suggestion,
    });

    expect((await session.read(client)).tenantSuggestion).toEqual(suggestion);
  });

  it("rejects with the parsed envelope when there is no session to read", async () => {
    // The one failure the login screen acts on. It is an `ApiError` here rather than a
    // redirect because this case passes a client with no `onUnauthenticated` — which is
    // exactly what `anonymousApi()` is.
    const { client } = clientAnswering(
      { code: "unauthenticated", message: "Sign in first.", details: {} },
      401,
    );

    const caught: unknown = await session.read(client).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).isUnauthenticated).toBe(true);
    expect((caught as ApiError).code).toBe("unauthenticated");
  });

  it("rejects a body the contract does not describe", async () => {
    const { client } = clientAnswering(SESSION);

    const read: Session = await session.read(client);

    // @ts-expect-error — the person is `user`, never `account`. If this line ever compiles,
    // the generated types no longer describe the committed contract.
    expect(read.account).toBeUndefined();
  });

  it("rejects a role the contract does not list", () => {
    // @ts-expect-error — `role` is "owner" | "admin" | "member" | "viewer".
    const role: Session["memberships"][number]["role"] = "superuser";

    expect(role).toBe("superuser");
  });
});

describe("githubSignInUrl", () => {
  const REST = "https://rest.example.test";

  // `restUrl()` memoises the first successful read, which is right for a process whose
  // environment does not change and wrong for a suite whose whole subject is the value.
  beforeEach(() => {
    resetRestUrlCache();
    delete process.env.OURO_REST_URL;
  });

  afterEach(() => {
    resetRestUrlCache();
    delete process.env.OURO_REST_URL;
  });

  it("is an absolute URL on ouroboros-rest, at the path the contract publishes", () => {
    process.env.OURO_REST_URL = REST;

    expect(githubSignInUrl()).toBe(`${REST}/api/v1/auth/github`);
  });

  it("is composed from the configured base rather than from a hard-coded host", () => {
    process.env.OURO_REST_URL = "http://localhost:4000";

    expect(githubSignInUrl()).toBe("http://localhost:4000/api/v1/auth/github");
  });

  it("throws naming the variable when the service's address is not configured", () => {
    // The same failure `app/env.ts` raises everywhere else: a missing address is an error
    // with a name in it, never a request to the wrong host.
    expect(() => githubSignInUrl()).toThrow(/OURO_REST_URL/);
  });
});
