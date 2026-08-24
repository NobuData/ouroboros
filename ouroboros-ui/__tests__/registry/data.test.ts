import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../helpers/login";
import { seededProviders, stripPayload } from "../helpers/models";

/**
 * The registry page's reader (#591).
 *
 * One call today, so the suite is about the two properties that have to survive CI.2–CI.5
 * adding the alias table, the price catalog and the chain card beside it: **a refused read is
 * a value rather than a throw**, and **anything that is not a refusal keeps travelling** —
 * which is what keeps a session that expired mid-render from being drawn as an empty import
 * menu instead of reaching the login screen.
 */

vi.mock("server-only", () => ({}));

/** What the providers endpoint answers this case with, or the signal it throws instead. */
const providers = vi.fn();

vi.mock("@/app/api/routing", () => ({ routing: { providers: () => providers() } }));

const { readRegistry } = await import("@/app/registry/data");

/**
 * The workspace the gate hands over.
 *
 * Typed as the gate's own return, deliberately: nothing off it is read, so the only thing
 * keeping this argument honest is that it has to satisfy `Workspace` — which is the whole
 * reason the reader takes one.
 */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

beforeEach(() => {
  providers.mockReset().mockResolvedValue(stripPayload());
});

describe("reading the page", () => {
  it("unwraps the strip into the list the import menu offers", () => {
    // The endpoint's envelope is `{providers: [...]}`; the page wants the connections.
    // Unwrapping here rather than in the component is what keeps the component free of the
    // contract's shape.
    return expect(readRegistry(ACCESS)).resolves.toEqual({
      providers: { ok: true, value: seededProviders() },
    });
  });

  it("reads a workspace with no providers as an empty list, not as a failure", async () => {
    // *Nothing connected* and *nobody could read the connections* are different facts, and
    // `importState` says something different for each — which it can only do if this layer
    // keeps them apart.
    providers.mockResolvedValue(stripPayload([]));

    const readings = await readRegistry(ACCESS);

    expect(readings.providers).toEqual({ ok: true, value: [] });
  });

  it("turns a refused read into a value the page can render around", async () => {
    providers.mockRejectedValue(new ApiError(503, "upstream_unavailable", "upstream refused"));

    const readings = await readRegistry(ACCESS);

    expect(readings.providers.ok).toBe(false);
  });

  it("lets anything that is not an ApiError keep travelling", async () => {
    // Next.js's redirect signal above all: a `catch` wide enough to hold it would swallow the
    // navigation to the login screen and draw a registry page captioned with the framework's
    // internal message.
    providers.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readRegistry(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("reads the connections the session's own workspace has, sending no tenant of its own", async () => {
    // The gate's workspace is a precondition rather than a parameter — the client scopes the
    // read to the session's active organization (`app/api/server.ts`).
    await readRegistry(ACCESS);

    expect(providers).toHaveBeenCalledOnce();
    expect(providers).toHaveBeenCalledWith();
  });
});
