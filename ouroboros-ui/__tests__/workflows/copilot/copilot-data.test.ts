import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { TENANT_ID, membership, sessionUser } from "../../helpers/login";
import { connectionPage, seededConnections } from "../../helpers/providers";
import {
  NO_GATEWAY,
  SECURITY_PATCH_ID,
  closedConversation,
  copilotConversation,
  copilotPromotion,
  copilotRail,
  copilotReadiness,
  drySafety,
  securityPatchDetail,
  securityPatchEntry,
  DRY_RUN_ID,
  seededAliases,
  seededDryRun,
  seededHistory,
  seededStageDraft,
  seededSuggestions,
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

/** What the readiness endpoint answers, by id. */
const readiness = vi.fn();

/** What the draft endpoint answers, by id. */
const draft = vi.fn();

/** What the registry's alias list answers. */
const aliases = vi.fn();

vi.mock("@/app/api/workflows", () => ({
  workflows: { list: () => list(), read: (id: string) => read(id) },
}));
vi.mock("@/app/api/workflow-copilot", () => ({
  workflowCopilot: {
    promotion: (id: string) => promotion(id),
    conversation: (id: string) => conversation(id),
    readiness: (id: string) => readiness(id),
    draft: (id: string) => draft(id),
  },
}));
vi.mock("@/app/api/routing", () => ({ routing: { aliases: () => aliases() } }));

/** What the dry-run history endpoint answers, by workflow id. */
const dryRunHistory = vi.fn();

/** What the dry-run endpoint answers, by workflow and run id. */
const dryRunRead = vi.fn();

/** What the suggestions endpoint answers, by workflow and run id. */
const dryRunSuggestions = vi.fn();

/** What the safety-strip endpoint answers, by workflow id. */
const dryRunSafety = vi.fn();

/** What the providers listing answers. */
const providerList = vi.fn();

vi.mock("@/app/api/workflow-dry-runs", () => ({
  workflowDryRuns: {
    history: (id: string) => dryRunHistory(id),
    read: (id: string, dryRunId: string) => dryRunRead(id, dryRunId),
    suggestions: (id: string, dryRunId: string) => dryRunSuggestions(id, dryRunId),
    safety: (id: string) => dryRunSafety(id),
  },
}));
vi.mock("@/app/api/providers", () => ({ providers: { list: () => providerList() } }));

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
  readiness.mockReset().mockResolvedValue(copilotReadiness());
  draft.mockReset().mockResolvedValue(seededStageDraft());
  aliases.mockReset().mockResolvedValue(seededAliases());
  dryRunHistory.mockReset().mockResolvedValue(seededHistory());
  dryRunRead.mockReset().mockResolvedValue(seededDryRun());
  dryRunSuggestions.mockReset().mockResolvedValue({ dryRunId: DRY_RUN_ID, suggestions: seededSuggestions() });
  dryRunSafety.mockReset().mockResolvedValue(drySafety());
  providerList.mockReset().mockResolvedValue(connectionPage(seededConnections()));
});

describe("the safety strip's reads (#569)", () => {
  it("reads the strip by the id the rail gave, and hands it to the page as served", async () => {
    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(dryRunSafety).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(readings.selected?.safety).toEqual({ ok: true, value: drySafety() });
  });

  it("keeps a refused strip as its own degraded reading, and every other read as it was", async () => {
    dryRunSafety.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.safety).toEqual({ ok: false, reason: "The service could not answer." });
    expect(readings.selected?.dryRun).toMatchObject({ ok: true });
    expect(readings.selected?.conversation).toMatchObject({ ok: true });
  });

  it("reads the workspace's provider connections, for the gateway notice's status", async () => {
    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(providerList).toHaveBeenCalledOnce();
    expect(readings.selected?.providers).toEqual({ ok: true, value: seededConnections() });
  });

  it("keeps refused providers as their own degraded reading — the readiness still reads", async () => {
    providerList.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.providers).toEqual({ ok: false, reason: "The service could not answer." });
    expect(readings.selected?.readiness).toMatchObject({ ok: true });
  });

  it("lets what is not a refusal from either read keep travelling", async () => {
    dryRunSafety.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT /login");

    dryRunSafety.mockResolvedValue(drySafety());
    providerList.mockRejectedValue(new Error("NEXT_REDIRECT /login"));
    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("asks for neither when the slug is not on the rail", async () => {
    await readStudioCopilot(ACCESS, "no-such-workflow");

    expect(dryRunSafety).not.toHaveBeenCalled();
    expect(providerList).not.toHaveBeenCalled();
  });
});

describe("the dry-run card's reads (#568)", () => {
  it("reads the history, then the newest run and its suggestions by the ids the history gave", async () => {
    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(dryRunHistory).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(dryRunRead).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(dryRunSuggestions).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, DRY_RUN_ID);
    expect(readings.selected?.dryRun).toEqual({
      ok: true,
      value: { history: seededHistory(), run: seededDryRun(), suggestions: seededSuggestions() },
    });
  });

  it("reads a workflow never dry-run as a board with no run, and asks for nothing more", async () => {
    const history = seededHistory({ count: 0, runs: [] });
    dryRunHistory.mockResolvedValue(history);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(dryRunRead).not.toHaveBeenCalled();
    expect(dryRunSuggestions).not.toHaveBeenCalled();
    expect(readings.selected?.dryRun).toEqual({ ok: true, value: { history, run: null, suggestions: [] } });
  });

  it("keeps a refused history as its own degraded reading, and every other read as it was", async () => {
    dryRunHistory.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.dryRun).toEqual({ ok: false, reason: "The service could not answer." });
    expect(readings.selected?.draft).toMatchObject({ ok: true });
    expect(readings.selected?.conversation).toMatchObject({ ok: true });
  });

  it("keeps a refused run as the board's refusal — there is nothing to draw rows from", async () => {
    dryRunRead.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.dryRun).toEqual({ ok: false, reason: "The service could not answer." });
  });

  it("keeps the run when only its suggestions were refused — the rows and the diff still draw", async () => {
    dryRunSuggestions.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.dryRun).toEqual({
      ok: true,
      value: { history: seededHistory(), run: seededDryRun(), suggestions: null },
    });
  });

  it("lets anything that is not a refusal keep travelling", async () => {
    dryRunHistory.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("the stage list's reads (#567)", () => {
  it("reads the draft by the id the rail gave, and the workspace's aliases, with the other reads", async () => {
    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(draft).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(aliases).toHaveBeenCalledOnce();
    expect(readings.selected?.draft).toEqual({ ok: true, value: seededStageDraft() });
    expect(readings.selected?.aliases).toEqual({ ok: true, value: seededAliases() });
  });

  it("reads the draft for a workflow that never had a conversation — the list does not hang off it", async () => {
    conversation.mockResolvedValue(null);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.conversation).toEqual({ ok: true, value: null });
    expect(readings.selected?.draft).toEqual({ ok: true, value: seededStageDraft() });
  });

  it("keeps a refused draft as its own degraded reading, and every other read as it was", async () => {
    draft.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.draft).toEqual({ ok: false, reason: "The service could not answer." });
    expect(readings.selected?.conversation).toEqual({ ok: true, value: copilotConversation() });
    expect(readings.selected?.aliases).toMatchObject({ ok: true });
  });

  it("keeps refused aliases as their own degraded reading — the draft still reads", async () => {
    aliases.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.aliases).toEqual({ ok: false, reason: "The service could not answer." });
    expect(readings.selected?.draft).toMatchObject({ ok: true });
  });

  it("lets what is not a refusal from the draft read keep travelling", async () => {
    draft.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("makes neither read for a slug the rail does not hold", async () => {
    await readStudioCopilot(ACCESS, "no-such-workflow");

    expect(draft).not.toHaveBeenCalled();
    expect(aliases).not.toHaveBeenCalled();
  });
});

describe("a workflow the rail holds", () => {
  it("reads the rail, then the workflow, its promotion and its conversation by the id the rail gave", async () => {
    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(read).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(promotion).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(conversation).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(readiness).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(readings).toMatchObject({
      rail: { ok: true, value: copilotRail() },
      requested: "security-patch",
      selected: {
        entry: securityPatchEntry(),
        detail: { ok: true, value: securityPatchDetail() },
        promotion: { ok: true, value: copilotPromotion() },
        conversation: { ok: true, value: copilotConversation() },
        readiness: { ok: true, value: copilotReadiness() },
      },
    });
  });

  it("hands the service's readiness to the page as it was read — the composer's reasons are the service's", async () => {
    readiness.mockResolvedValue(NO_GATEWAY);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.readiness).toEqual({ ok: true, value: NO_GATEWAY });
  });

  it("keeps a refused readiness as its own degraded reading, and every other read as it was", async () => {
    readiness.mockRejectedValue(REFUSED);

    const readings = await readStudioCopilot(ACCESS, "security-patch");

    expect(readings.selected?.readiness).toEqual({ ok: false, reason: "The service could not answer." });
    expect(readings.selected?.conversation).toEqual({ ok: true, value: copilotConversation() });
    expect(readings.selected?.promotion).toMatchObject({ ok: true });
  });

  it("lets what is not a refusal from the readiness read keep travelling — the redirect to login above all", async () => {
    readiness.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readStudioCopilot(ACCESS, "security-patch")).rejects.toThrow("NEXT_REDIRECT /login");
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
    expect(readiness).toHaveBeenCalledOnce();

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
