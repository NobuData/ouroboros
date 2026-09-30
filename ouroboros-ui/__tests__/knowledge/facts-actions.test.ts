import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SEEDED_REPO, seededFact } from "../helpers/knowledge";

/**
 * The learned-facts card's server hops (#419). A Server Action is a POST endpoint anybody can
 * reach, so each call takes no workspace and no person — the actor is the session's, recorded by
 * the service — and every gate is the service's, answered back as a value.
 */

const confirm = vi.fn();
const reject = vi.fn();
const reconfirm = vi.fn();
const expire = vi.fn();
const relearn = vi.fn();
const propose = vi.fn();

vi.mock("@/app/api/facts", () => ({
  facts: {
    confirm: (id: string, body: unknown) => confirm(id, body),
    reject: (id: string, body: unknown) => reject(id, body),
    reconfirm: (id: string, body: unknown) => reconfirm(id, body),
    expire: (id: string, body: unknown) => expire(id, body),
    relearn: (id: string, body: unknown) => relearn(id, body),
    propose: (body: unknown) => propose(body),
  },
}));

const { decideFact, proposeFact } = await import("@/app/knowledge/facts-actions");

const PROPOSAL = seededFact("Team");

beforeEach(() => {
  for (const call of [confirm, reject, reconfirm, expire, relearn, propose]) {
    call.mockReset().mockResolvedValue({ ...PROPOSAL, status: "confirmed" });
  }
});

describe("decideFact", () => {
  it("calls the edge the verb names, with the note only when there is one", async () => {
    await decideFact(PROPOSAL.id, "confirm");
    await decideFact(PROPOSAL.id, "reject", "duplicate of an older fact");
    await decideFact(PROPOSAL.id, "reconfirm", "");
    await decideFact(PROPOSAL.id, "expire", "Zephyr 4.1 migration");
    await decideFact(PROPOSAL.id, "relearn");
    await decideFact(PROPOSAL.id, "relearn", "Zephyr 4.1 needs nothing special");

    expect(confirm).toHaveBeenCalledExactlyOnceWith(PROPOSAL.id, {});
    expect(reject).toHaveBeenCalledExactlyOnceWith(PROPOSAL.id, { reason: "duplicate of an older fact" });
    expect(reconfirm).toHaveBeenCalledExactlyOnceWith(PROPOSAL.id, {});
    expect(expire).toHaveBeenCalledExactlyOnceWith(PROPOSAL.id, { reason: "Zephyr 4.1 migration" });
    expect(relearn).toHaveBeenNthCalledWith(1, PROPOSAL.id, {});
    expect(relearn).toHaveBeenNthCalledWith(2, PROPOSAL.id, { text: "Zephyr 4.1 needs nothing special" });
  });

  it("answers with the fact as the service now holds it", async () => {
    await expect(decideFact(PROPOSAL.id, "confirm")).resolves.toEqual({ ok: true, value: { ...PROPOSAL, status: "confirmed" } });
  });

  it("answers a refused edge as a value, with the service's reason", async () => {
    confirm.mockRejectedValue(
      new ApiError(409, "fact_transition_refused", "A rejected fact cannot be confirmed.", { from: "rejected", to: "confirmed" }),
    );

    await expect(decideFact(PROPOSAL.id, "confirm")).resolves.toEqual({
      ok: false,
      refusal: {
        code: "fact_transition_refused",
        message: "A rejected fact cannot be confirmed.",
        details: { from: "rejected", to: "confirmed" },
      },
    });
  });

  it("answers a viewer's direct call with the service's forbidden, and changes nothing", async () => {
    reject.mockRejectedValue(new ApiError(403, "forbidden", "Forbidden.", {}));

    await expect(decideFact(PROPOSAL.id, "reject")).resolves.toMatchObject({ ok: false, refusal: { code: "forbidden" } });
  });

  it("lets anything that is not the service's refusal travel — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    expire.mockRejectedValue(redirect);

    await expect(decideFact(PROPOSAL.id, "expire", "x")).rejects.toBe(redirect);
  });
});

describe("proposeFact", () => {
  it("forwards the body as the dialog composed it, and answers with the proposal", async () => {
    const body = { text: "A fact", repoRef: SEEDED_REPO, anchors: [{ kind: "dependency" as const, value: "west" }] };
    propose.mockResolvedValue(PROPOSAL);

    await expect(proposeFact(body)).resolves.toEqual({ ok: true, value: PROPOSAL });
    expect(propose).toHaveBeenCalledExactlyOnceWith(body);
  });

  it("answers a refused anchor as a value, naming it", async () => {
    propose.mockRejectedValue(new ApiError(422, "fact_anchor_invalid", "Not a glob.", { kind: "path_glob", value: "[" }));

    await expect(proposeFact({ text: "A fact" })).resolves.toEqual({
      ok: false,
      refusal: { code: "fact_anchor_invalid", message: "Not a glob.", details: { kind: "path_glob", value: "[" } },
    });
  });

  it("lets the redirect signal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    propose.mockRejectedValue(redirect);

    await expect(proposeFact({ text: "A fact" })).rejects.toBe(redirect);
  });
});
