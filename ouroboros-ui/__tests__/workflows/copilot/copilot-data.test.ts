import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../../helpers/login";
import {
  SECURITY_PATCH_ID,
  closedConversation,
  copilotConversation,
  copilotPromotion,
  copilotRail,
  securityPatchDetail,
  securityPatchEntry,
} from "../../helpers/workflow-copilot";

/**
 * The copilot route's reader (CE.1, #565).
 *
 * The code route's reader's properties, kept: **a refused read is a value**, **anything that is
 * not a refusal keeps travelling**, **one failed read is one degraded region**, **the slug is
 * resolved against the rail**. And the one this surface is for — decision **W9**: the draft and
 * the conversation are asked for on *every* read, so a switch from another surface carries
 * nothing and loses nothing.
 */

vi.mock("server-only", () => ({}));

/** What the rail endpoint answers. */
const list = vi.fn();

/** What the workflow endpoint answers, by id. */
const read = vi.fn();

/** What the promotion endpoint answers, by id. */
const promotion = vi.fn();

/** What the conversation endpoint answers, by id. */
const conversation = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  workflows: { list: () => list(), read: (id: string) => read(id) },
}));
vi.mock("@/app/api/workflow-copilot", () => ({
  workflowCopilot: {
    promotion: (id: string) => promotion(id),
    conversation: (id: string) => conversation(id),
  },
}));

const { readStudioCopilot } = await import("@/app/workflows/copilot/copilot-data");

/** The workspace the gate hands over. */
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

/** A refusal, as the client throws it. */
const REFUSED = new ApiError(503, "service_unavailable", "The service could not answer.");

beforeEach(() => {
  list.mockReset().mockResolvedValue(copilotRail());
  read.mockReset().mockResolvedValue(securityPatchDetail());
  promotion.mockReset().mockResolvedValue(copilotPromotion());
  conversation.mockReset().mockResolvedValue(copilotConversation());
});

describe("a workflow the rail holds", () => {
  it("reads the rail, then the workflow, its promotion and its conversation by the id the rail gave", async () => {
    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(read).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(promotion).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(conversation).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(readings).toMatchObject({
      rail: { ok: true, value: copilotRail() },
      requested: "security-patch",
      selected: {
        entry: securityPatchEntry(),
        detail: { ok: true, value: securityPatchDetail() },
        promotion: { ok: true, value: copilotPromotion() },
        conversation: { ok: true, value: copilotConversation() },
      },
    });
  });

  it("stamps the instant the page was read, for every message's age", async () => {
    const before = Date.now();
    const { now } = await readStudioCopilot(ACCESS, "security-patch");

    expect(Date.parse(now)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(now)).toBeLessThanOrEqual(Date.now());
  });

  it("makes the three reads in parallel, not one after the other", async () => {
    let release: (value: unknown) => void = () => {};
    read.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const pending = readStudioCopilot(ACCESS, "security-patch");
    // The workflow has not answered, and the other two have already been asked.
    await vi.waitFor(() => expect(promotion).toHaveBeenCalledOnce());
    expect(conversation).toHaveBeenCalledOnce();

    release(securityPatchDetail());
    await expect(pending).resolves.toMatchObject({ selected: { detail: { ok: true } } });
  });

  it("reads the draft and the conversation again on every arrival — nothing is kept between surfaces (W9)", async () => {
    await readStudioCopilot(ACCESS, "security-patch");

    // A node dragged on the canvas in between: the next arrival reads the draft as it now is.
    promotion.mockResolvedValue(copilotPromotion({ draft: { present: true, label: "v0.4", etag: "etag-draft-4" } }));
    const again = await readStudioCopilot(ACCESS, "security-patch");

    expect(promotion).toHaveBeenCalledTimes(2);
    expect(conversation).toHaveBeenCalledTimes(2);
    expect(again.selected?.promotion).toMatchObject({ ok: true, value: { draft: { label: "v0.4" } } });
    expect(again.selected?.conversation).toEqual({ ok: true, value: copilotConversation() });
  });

  it("keeps a workflow with no conversation yet as a successful reading of null", async () => {
    conversation.mockResolvedValue(null);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.conversation).toEqual({ ok: true, value: null });
  });

  it("hands back a closed conversation as it was read, for the page to draw read-only", async () => {
    conversation.mockResolvedValue(closedConversation("discarded"));

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.conversation).toMatchObject({ ok: true, value: { session: { status: "discarded" } } });
  });
});

describe("one failed read is one degraded region", () => {
  it("keeps a refused promotion as its reason, and the other two as read", async () => {
    promotion.mockRejectedValue(REFUSED);

    const { selected } = await readStudioCopilot(ACCESS, "security-patch");

    expect(selected?.promotion).toEqual({ ok: false, reason: "The service could not answer." });
    expect(selected?.detail.ok).toBe(true);
    expect(selected?.conversation.ok).toBe(true);
  });

  it("keeps a refused conversation as its reason, and the other two as read", async () => {
    conversation.mockRejectedValue(REFUSED);

    const { selected } = await readStudioCopilot(ACCESS, "security-patch");

    expect(selected?.conversation).toEqual({ ok: false, reason: "The service could not answer." });
    expect(selected?.promotion.ok).toBe(true);
  });

  it("keeps a refused workflow read as its reason — it costs only the findings' anchoring", async () => {
    read.mockRejectedValue(REFUSED);

    const { selected } = await readStudioCopilot(ACCESS, "security-patch");

    expect(selected?.detail).toEqual({ ok: false, reason: "The service could not answer." });
    expect(selected?.promotion.ok).toBe(true);
  });
});

describe("a slug the rail does not hold", () => {
  it("costs no further request and selects nothing", async () => {
    const readings = await readStudioCopilot(ACCESS, "retired-loop");

    expect(read).not.toHaveBeenCalled();
    expect(promotion).not.toHaveBeenCalled();
    expect(conversation).not.toHaveBeenCalled();
    expect(readings).toMatchObject({ rail: { ok: true }, requested: "retired-loop", selected: null });
  });

  it("selects nothing in an empty workspace", async () => {
    list.mockResolvedValue([]);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings).toMatchObject({ rail: { ok: true, value: [] }, selected: null });
    expect(promotion).not.toHaveBeenCalled();
  });
});

describe("a rail that could not be read", () => {
  it("is a value, and nothing else is asked for", async () => {
    list.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings).toMatchObject({
      rail: { ok: false, reason: "The service could not answer." },
      requested: "security-patch",
      selected: null,
    });
    expect(read).not.toHaveBeenCalled();
    expect(promotion).not.toHaveBeenCalled();
  });
});

describe("anything that is not a refusal", () => {
  it("keeps travelling from the rail read — the redirect of an expired session above all", async () => {
    list.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("keeps travelling from the conversation read too", async () => {
    conversation.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
