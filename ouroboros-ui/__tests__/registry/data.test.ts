import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../helpers/login";
import { seededProviders, stripPayload } from "../helpers/models";
import { registryPayload, seededRegistry } from "../helpers/registry";

/**
 * The registry page's reader (#591, and the table's read since #592).
 *
 * Two calls, so the suite is about the three properties that have to survive CI.3–CI.5 adding
 * the inspector's reads and the chain card beside them: **a refused read is a value rather
 * than a throw**, **one refused read leaves the other standing**, and **anything that is not a
 * refusal keeps travelling** — which is what keeps a session that expired mid-render from
 * being drawn as an empty import menu instead of reaching the login screen.
 */

vi.mock("server-only", () => ({}));

/** What the providers endpoint answers this case with, or the signal it throws instead. */
const providers = vi.fn();

/** What the registry endpoint answers with. */
const read = vi.fn();

vi.mock("@/app/api/routing", () => ({ routing: { providers: () => providers() } }));
vi.mock("@/app/api/registry", () => ({ registry: { read: () => read() } }));

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
  read.mockReset().mockResolvedValue(registryPayload());
});

describe("reading the page", () => {
  it("unwraps both envelopes into the lists the page draws from", () => {
    // The endpoints' envelopes are `{providers: [...]}` and `{aliases: [...]}`; the page wants
    // the connections and the rows. Unwrapping here rather than in the components is what
    // keeps them free of the contract's shape.
    return expect(readRegistry(ACCESS)).resolves.toEqual({
      providers: { ok: true, value: seededProviders() },
      aliases: { ok: true, value: seededRegistry() },
    });
  });

  it("reads a workspace with no aliases as an empty list, not as a failure", async () => {
    read.mockResolvedValue(registryPayload([]));

    const readings = await readRegistry(ACCESS);

    expect(readings.aliases).toEqual({ ok: true, value: [] });
  });

  it("leaves the table standing when the strip could not be read, and the other way round", async () => {
    // One failed read is one degraded region, never a blank page.
    providers.mockRejectedValue(new ApiError(503, "upstream_unavailable", "strip away"));

    const first = await readRegistry(ACCESS);

    expect(first.providers).toEqual({ ok: false, reason: "strip away" });
    expect(first.aliases.ok).toBe(true);

    providers.mockResolvedValue(stripPayload());
    read.mockRejectedValue(new ApiError(503, "upstream_unavailable", "registry away"));

    const second = await readRegistry(ACCESS);

    expect(second.providers.ok).toBe(true);
    expect(second.aliases).toEqual({ ok: false, reason: "registry away" });
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

  it("reads the session's own workspace, sending no tenant of its own, and each read once", async () => {
    // The gate's workspace is a precondition rather than a parameter — the client scopes the
    // read to the session's active organization (`app/api/server.ts`). And the table is one
    // request: nothing here composes a cell from two reads.
    await readRegistry(ACCESS);

    expect(providers).toHaveBeenCalledOnce();
    expect(providers).toHaveBeenCalledWith();
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith();
  });
});
