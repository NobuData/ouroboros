import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../helpers/login";
import { seededProviders, stripPayload } from "../helpers/models";

/**
 * The routing page's reader (#200).
 *
 * One call today, so the suite is about the two properties that have to survive AA.2–AA.5
 * adding four more: **a refused read is a value rather than a throw**, and **anything that is
 * not a refusal keeps travelling** — which is what keeps a session that expired mid-render
 * from being drawn as an empty strip instead of reaching the login screen.
 */

vi.mock("server-only", () => ({}));

/** What the strip endpoint answers this case with, or the signal it throws instead. */
const providers = vi.fn();

vi.mock("@/app/api/routing", () => ({ routing: { providers: () => providers() } }));

const { readModels } = await import("@/app/models/data");

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
  it("unwraps the strip into the list the screen draws", async () => {
    // The endpoint's envelope is `{providers: [...]}`; the screen wants the chips. Unwrapping
    // here rather than in the component is what keeps the component free of the contract's
    // shape.
    const readings = await readModels(ACCESS);

    expect(readings.providers).toEqual({ ok: true, value: seededProviders() });
  });

  it("reads a workspace with no providers as an empty strip, not as a failure", async () => {
    providers.mockResolvedValue(stripPayload([]));

    const readings = await readModels(ACCESS);

    expect(readings.providers).toEqual({ ok: true, value: [] });
  });

  it("keeps a refusal as the reason the strip is empty", async () => {
    // One failed read is one degraded region, never a blank page. The message is the
    // service's own and is safe to render: every one in the contract's envelope is written
    // for a person.
    providers.mockRejectedValue(
      new ApiError(400, "organization_required", "Choose a workspace."),
    );

    const readings = await readModels(ACCESS);

    expect(readings.providers).toEqual({ ok: false, reason: "Choose a workspace." });
  });

  it("lets a redirect through rather than drawing around it", async () => {
    // A `401` reaches this layer as Next.js's redirect signal rather than as an error, and a
    // `catch` wide enough to hold it would swallow the navigation to the login screen and
    // draw a routing page captioned with the framework's internal message.
    providers.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readModels(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("lets a dropped connection through, because it is not an answer from the service", async () => {
    providers.mockRejectedValue(new TypeError("fetch failed"));

    await expect(readModels(ACCESS)).rejects.toThrow("fetch failed");
  });

  it("asks for the strip once, and asks for nothing else", async () => {
    await readModels(ACCESS);

    expect(providers).toHaveBeenCalledOnce();
  });
});

describe("what Save routes is enabled by", () => {
  it("reports nothing pending, because nothing on this page can change a route yet", async () => {
    // Structurally zero rather than absent: the figure is carried so that
    // `saveRoutesReason` stays the one rule deciding the control's state, and AA.3 (#202)
    // supplies a real number without anything here needing to change.
    const readings = await readModels(ACCESS);

    expect(readings.pending).toBe(0);
  });

  it("still reports it when the strip could not be read", async () => {
    // The two are independent: a failed health read says nothing about whether there is a
    // draft to save, and a page that disabled the save button *because* of it would be
    // explaining the wrong thing.
    providers.mockRejectedValue(new ApiError(503, "unavailable", "Down."));

    const readings = await readModels(ACCESS);

    expect(readings.pending).toBe(0);
  });
});
