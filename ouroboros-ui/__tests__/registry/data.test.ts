import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../helpers/login";
import { connectionPage, seededCards } from "../helpers/providers";
import { registryPayload, seededRegistry } from "../helpers/registry";

/**
 * The registry page's reader (#591, and the table's read since #592).
 *
 * Two calls, and the suite is about the three properties that have to survive CI.5 adding the
 * chain card beside them: **a refused read is a value rather than a throw**, **one refused read
 * leaves the other standing**, and **anything that is not a refusal keeps travelling** — which
 * is what keeps a session that expired mid-render from being drawn as an empty import menu
 * instead of reaching the login screen.
 *
 * The connections call is `GET /api/v1/providers` rather than the routing page's health strip
 * since CI.3 ([#593](https://github.com/NobuData/ouroboros/issues/593)): the inspector's
 * provider select renders the masked key, which only that payload carries. The last case below
 * is what holds the page to **one** read of the connection list rather than two.
 */

vi.mock("server-only", () => ({}));

/** What the connections endpoint answers this case with, or the signal it throws instead. */
const list = vi.fn();

/** What the registry endpoint answers with. */
const read = vi.fn();

vi.mock("@/app/api/providers", () => ({ providers: { list: () => list() } }));
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
  list.mockReset().mockResolvedValue(connectionPage(seededCards()));
  read.mockReset().mockResolvedValue(registryPayload());
});

describe("reading the page", () => {
  it("unwraps both envelopes into the lists the page draws from", () => {
    // The endpoints' envelopes are `{items, total, limit, offset}` and `{aliases: [...]}`; the
    // page wants the connections and the rows. Unwrapping here rather than in the components is
    // what keeps them free of the contract's shape.
    return expect(readRegistry(ACCESS)).resolves.toEqual({
      providers: { ok: true, value: seededCards() },
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
    list.mockRejectedValue(new ApiError(503, "upstream_unavailable", "connections away"));

    const first = await readRegistry(ACCESS);

    expect(first.providers).toEqual({ ok: false, reason: "connections away" });
    expect(first.aliases.ok).toBe(true);

    list.mockResolvedValue(connectionPage(seededCards()));
    read.mockRejectedValue(new ApiError(503, "upstream_unavailable", "registry away"));

    const second = await readRegistry(ACCESS);

    expect(second.providers.ok).toBe(true);
    expect(second.aliases).toEqual({ ok: false, reason: "registry away" });
  });

  it("reads a workspace with no providers as an empty list, not as a failure", async () => {
    // *Nothing connected* and *nobody could read the connections* are different facts, and
    // `importState` says something different for each — which it can only do if this layer
    // keeps them apart.
    list.mockResolvedValue(connectionPage([]));

    const readings = await readRegistry(ACCESS);

    expect(readings.providers).toEqual({ ok: true, value: [] });
  });

  it("turns a refused read into a value the page can render around", async () => {
    list.mockRejectedValue(new ApiError(503, "upstream_unavailable", "upstream refused"));

    const readings = await readRegistry(ACCESS);

    expect(readings.providers.ok).toBe(false);
  });

  it("lets anything that is not an ApiError keep travelling", async () => {
    // Next.js's redirect signal above all: a `catch` wide enough to hold it would swallow the
    // navigation to the login screen and draw a registry page captioned with the framework's
    // internal message.
    list.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readRegistry(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("reads the session's own workspace, sending no tenant of its own, and each read once", async () => {
    // The gate's workspace is a precondition rather than a parameter — the client scopes the
    // read to the session's active organization (`app/api/server.ts`). And the table is one
    // request: nothing here composes a cell from two reads.
    await readRegistry(ACCESS);

    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith();
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith();
  });
});
