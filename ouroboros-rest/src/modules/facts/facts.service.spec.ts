import type { DatabaseService } from "../db/db.service";
import { FactsService, MANUAL_PROVENANCE_LINE, RELEARN_PROVENANCE_LINE } from "./facts.service";
import { FactStore, StoreViolation } from "./facts.store.fixture";

/**
 * The fact lifecycle (#411): every transition along K3's edges with its actor audited, refusals
 * stated before the database is asked, expiry's reason and frozen count, re-learn's new linked
 * proposal, anchors, the needs-you feed, and tenancy. The store holds V071's rules, so a refusal
 * the service forgot would surface as a raw violation here.
 */

const ORG = "acme-robotics";
const OTHER_ORG = "globex";
const KEN = "user-ken";
const MAYA = "user-maya";

/**
 * Assert a promise rejects with a domain error, and return its envelope.
 *
 * @param promise - The call.
 * @returns `{ status, code, message, details }`.
 */
async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string; message: string; details: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    const domain = error as {
      getStatus: () => number;
      getResponse: () => { code: string; message: string; details: Record<string, unknown> };
    };
    return { status: domain.getStatus(), ...domain.getResponse() };
  }
  throw new Error("expected a refusal");
}

describe("the fact lifecycle service", () => {
  let store: FactStore;
  let service: FactsService;

  beforeEach(() => {
    store = new FactStore();
    store.people.set(KEN, "Ken");
    store.people.set(MAYA, "Maya");
    const database = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
    } as unknown as DatabaseService;
    service = new FactsService(store.asRepository(), database);
  });

  describe("the Needs-You inbox (#461)", () => {
    it("files a proposal's review card, and settles it when the fact is decided", async () => {
      const reviews = {
        review: jest.fn().mockResolvedValue(undefined),
        settled: jest.fn().mockResolvedValue(undefined),
      };
      const database = {
        transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
      } as unknown as DatabaseService;
      const withInbox = new FactsService(store.asRepository(), database, reviews as never);

      const fact = await withInbox.proposeManual(ORG, { text: "CI needs `west update`" }, KEN);
      await withInbox.confirm(ORG, fact.id, MAYA);

      expect(reviews.review).toHaveBeenCalledWith(ORG, [fact.id]);
      expect(reviews.settled).toHaveBeenCalledWith(ORG);
    });
  });

  describe("propose", () => {
    it("creates a proposal, audited with its author, and says an anchor-less fact is not swept", async () => {
      const fact = await service.proposeManual(ORG, { text: "  CI needs `west update`  " }, KEN);

      expect(fact).toMatchObject({
        status: "proposed",
        text: "CI needs `west update`",
        proposer: "manual",
        provenance: { line: MANUAL_PROVENANCE_LINE, refs: [] },
        confirmation: null,
        sweep: { covered: false, reason: "no_anchors" },
      });
      expect(fact.history).toEqual([
        expect.objectContaining({ from: null, to: "proposed", actor: { id: KEN, name: "Ken" } }),
      ]);
    });

    it("takes anchors, trimmed and de-duplicated, and is then swept", async () => {
      const fact = await service.proposeManual(
        ORG,
        {
          text: "Tests under `tests/hil/` require rig reservation",
          repoRef: "acme-robotics/helios-firmware",
          anchors: [
            { kind: "path_glob", value: " tests/hil/** " },
            { kind: "path_glob", value: "tests/hil/**" },
            { kind: "dependency", value: "west" },
          ],
        },
        KEN,
      );

      expect(fact.anchors.map(({ kind, value }) => [kind, value])).toEqual([
        ["path_glob", "tests/hil/**"],
        ["dependency", "west"],
      ]);
      expect(fact.sweep).toEqual({ covered: true, reason: null });
      expect(fact.repoRef).toBe("acme-robotics/helios-firmware");
    });

    it("refuses an anchor V071 would refuse, writing nothing", async () => {
      await expect(
        refusal(
          service.proposeManual(
            ORG,
            { text: "x", anchors: [{ kind: "path_glob", value: "../etc/**" }] },
            KEN,
          ),
        ),
      ).resolves.toMatchObject({ status: 422, code: "fact_anchor_invalid" });
      expect(store.facts).toHaveLength(0);
    });

    it("lower-cases cited ids and refuses one that is not this workspace's", async () => {
      const runId = "0a1b2c3d-0000-4000-8000-00000000abcd";
      store.citable.set(ORG, new Set([runId]));

      const cited = await service.proposeManual(
        ORG,
        { text: "cites a run", refs: [{ kind: "run", id: runId.toUpperCase() }] },
        KEN,
      );
      expect(cited.provenance.refs).toEqual([{ kind: "run", id: runId }]);

      await expect(
        refusal(
          service.proposeManual(
            OTHER_ORG,
            { text: "cites another workspace's run", refs: [{ kind: "run", id: runId }] },
            KEN,
          ),
        ),
      ).resolves.toMatchObject({ status: 422, code: "fact_provenance_unresolved" });
    });

    it("is the automatic proposers' entry point: their proposer, no actor, never confirmed", async () => {
      const fact = await service.propose(
        ORG,
        {
          text: "Team prefers `k_msgq` over `k_fifo` in ISR paths",
          repoRef: "acme-robotics/helios-firmware",
          proposer: "correction_note",
          provenance: { line: "from PR #514 review cycle", refs: [] },
        },
        null,
      );

      expect(fact).toMatchObject({ status: "proposed", proposer: "correction_note" });
      expect(fact.history[0]?.actor).toBeNull();
    });
  });

  describe("confirm and reject", () => {
    it("confirms a proposal, recording who and when — 'confirmed by Ken'", async () => {
      const proposal = store.seed(ORG, "proposed");

      const fact = await service.confirm(ORG, proposal.id, KEN, "checked on the rig");

      expect(fact.status).toBe("confirmed");
      expect(fact.confirmation).toEqual({
        actor: { id: KEN, name: "Ken" },
        at: expect.any(String) as string,
        reason: "checked on the rig",
      });
      expect(fact.history.at(-1)).toMatchObject({
        from: "proposed",
        to: "confirmed",
        actor: { id: KEN, name: "Ken" },
      });
    });

    it("rejects a proposal, finally", async () => {
      const proposal = store.seed(ORG, "proposed");

      const fact = await service.reject(ORG, proposal.id, MAYA);

      expect(fact).toMatchObject({ status: "rejected", confirmation: null });
      expect(fact.history.at(-1)).toMatchObject({ to: "rejected", actor: { id: MAYA } });
      await expect(refusal(service.confirm(ORG, proposal.id, KEN))).resolves.toMatchObject({
        status: 409,
        code: "fact_transition_refused",
        details: { from: "rejected", to: "confirmed" },
        message: expect.stringMatching(/final/) as string,
      });
    });

    it.each([
      ["confirmed", "confirm", /already confirmed/],
      ["stale", "confirm", /re-confirm it instead/],
      ["expired", "confirm", /Re-learn/],
      ["confirmed", "reject", /Only a proposal can be rejected/],
      ["proposed", "reconfirm", /Only a stale fact can be re-confirmed/],
      ["confirmed", "reconfirm", /already confirmed/],
    ] as const)("refuses a %s fact's %s, stating why", async (status, action, reason) => {
      const fact = store.seed(ORG, status);
      const before = store.transitions.length;

      await expect(refusal(service[action](ORG, fact.id, KEN))).resolves.toMatchObject({
        status: 409,
        code: "fact_transition_refused",
        message: expect.stringMatching(reason) as string,
      });
      expect(store.transitions).toHaveLength(before);
    });
  });

  describe("re-confirm", () => {
    it("returns a stale fact to confirmed, the stamp becoming the re-confirmer's", async () => {
      const stale = store.seed(ORG, "stale");

      const fact = await service.reconfirm(ORG, stale.id, MAYA, "still true on 4.1");

      expect(fact.status).toBe("confirmed");
      expect(fact.staleness).toBeNull();
      expect(fact.confirmation).toMatchObject({ actor: { id: MAYA, name: "Maya" } });
      expect(fact.history.at(-1)).toMatchObject({ from: "stale", to: "confirmed" });
    });
  });

  describe("expire", () => {
    it("expires a stale fact with its reason, snapshotting the use count", async () => {
      const stale = store.seed(ORG, "stale");
      store.injections.push(
        ...Array.from({ length: 31 }, () => ({ organizationId: ORG, factIds: [stale.id] })),
      );

      const fact = await service.expire(ORG, stale.id, KEN, " Zephyr 4.1 migration ");

      expect(fact).toMatchObject({
        status: "expired",
        usedCount: 31,
        expiry: {
          reason: "Zephyr 4.1 migration",
          previousUseCount: 31,
          stamp: { actor: { id: KEN, name: "Ken" }, reason: "Zephyr 4.1 migration" },
        },
      });
    });

    it("never changes the snapshot afterwards", async () => {
      const stale = store.seed(ORG, "stale");
      store.injections.push({ organizationId: ORG, factIds: [stale.id] });
      await service.expire(ORG, stale.id, KEN, "moved on");

      // More injection records naming it (history re-imported, say) do not move the number.
      store.injections.push({ organizationId: ORG, factIds: [stale.id] });

      await expect(service.get(ORG, stale.id)).resolves.toMatchObject({
        usedCount: 1,
        expiry: { previousUseCount: 1 },
      });
      await expect(refusal(service.expire(ORG, stale.id, KEN, "again"))).resolves.toMatchObject({
        status: 409,
        code: "fact_transition_refused",
      });
    });

    it("expires a confirmed fact as two audited edges, both naming the person", async () => {
      const confirmed = store.seed(ORG, "confirmed");

      const fact = await service.expire(ORG, confirmed.id, MAYA, "board retired");

      expect(fact.status).toBe("expired");
      expect(fact.history.slice(-2)).toEqual([
        expect.objectContaining({
          from: "confirmed",
          to: "stale",
          actor: { id: MAYA, name: "Maya" },
          reason: "board retired",
        }),
        expect.objectContaining({
          from: "stale",
          to: "expired",
          actor: { id: MAYA, name: "Maya" },
          reason: "board retired",
        }),
      ]);
    });

    it.each(["proposed", "rejected"] as const)("refuses to expire a %s fact", async (status) => {
      const fact = store.seed(ORG, status);

      await expect(refusal(service.expire(ORG, fact.id, KEN, "why"))).resolves.toMatchObject({
        status: 409,
        code: "fact_transition_refused",
        details: { from: status, to: "expired" },
      });
    });
  });

  describe("re-learn", () => {
    it("proposes a NEW fact linked to the expired one, which stays exactly as it was", async () => {
      const expired = store.seed(ORG, "expired", {
        text: "Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`",
        repo_ref: "acme-robotics/helios-firmware",
      });
      const before = { ...store.find(expired.id) };

      const relearned = await service.relearn(
        ORG,
        expired.id,
        KEN,
        "Zephyr 4.1 needs `CONFIG_SYS_CLOCK`",
      );

      expect(relearned.id).not.toBe(expired.id);
      expect(relearned).toMatchObject({
        status: "proposed",
        text: "Zephyr 4.1 needs `CONFIG_SYS_CLOCK`",
        repoRef: "acme-robotics/helios-firmware",
        relearnedFromFactId: expired.id,
        provenance: { line: RELEARN_PROVENANCE_LINE },
        anchors: [],
      });
      expect(store.find(expired.id)).toEqual(before);
      await expect(service.get(ORG, expired.id)).resolves.toMatchObject({
        status: "expired",
        relearnedByFactIds: [relearned.id],
      });
    });

    it("keeps the expired fact's text when none is given", async () => {
      const expired = store.seed(ORG, "expired", { text: "old truth" });

      await expect(service.relearn(ORG, expired.id, KEN)).resolves.toMatchObject({
        text: "old truth",
      });
    });

    it.each(["proposed", "confirmed", "stale", "rejected"] as const)(
      "refuses to re-learn a %s fact",
      async (status) => {
        const fact = store.seed(ORG, status);

        await expect(refusal(service.relearn(ORG, fact.id, KEN))).resolves.toMatchObject({
          status: 409,
          code: "fact_transition_refused",
          message: expect.stringMatching(/Only an expired fact can be re-learned/) as string,
        });
      },
    );
  });

  describe("anchors", () => {
    it("adds and removes an anchor; a fact left with none says it is not swept", async () => {
      const fact = store.seed(ORG, "confirmed");

      const anchored = await service.addAnchor(ORG, fact.id, {
        kind: "platform_version",
        value: "zephyr-4.0",
      });
      expect(anchored.anchors).toEqual([
        expect.objectContaining({ kind: "platform_version", value: "zephyr-4.0" }),
      ]);

      const anchorId = anchored.anchors[0]?.id ?? "";
      const bare = await service.removeAnchor(ORG, fact.id, anchorId);
      expect(bare).toMatchObject({ anchors: [], sweep: { covered: false, reason: "no_anchors" } });
    });

    it("answers a duplicate anchor as a conflict", async () => {
      const fact = store.seed(ORG, "proposed");
      await service.addAnchor(ORG, fact.id, { kind: "dependency", value: "west" });

      await expect(
        refusal(service.addAnchor(ORG, fact.id, { kind: "dependency", value: "west" })),
      ).resolves.toMatchObject({
        status: 409,
        code: "fact_anchor_exists",
        details: { factId: fact.id, kind: "dependency", value: "west" },
      });
    });

    it.each(["rejected", "expired"] as const)("freezes a %s fact's anchors", async (status) => {
      const fact = store.seed(ORG, status);

      await expect(
        refusal(service.addAnchor(ORG, fact.id, { kind: "dependency", value: "west" })),
      ).resolves.toMatchObject({ status: 409, code: "fact_frozen" });
      await expect(
        refusal(service.removeAnchor(ORG, fact.id, "00000000-0000-4000-8000-000000000999")),
      ).resolves.toMatchObject({ status: 409, code: "fact_frozen" });
    });

    it("answers an absent anchor as not found", async () => {
      const fact = store.seed(ORG, "confirmed");

      await expect(
        refusal(service.removeAnchor(ORG, fact.id, "00000000-0000-4000-8000-000000000999")),
      ).resolves.toMatchObject({ status: 404, code: "fact_anchor_not_found" });
    });
  });

  describe("tenancy", () => {
    it.each([
      ["read", (s: FactsService, id: string) => s.get(OTHER_ORG, id)],
      ["confirm", (s: FactsService, id: string) => s.confirm(OTHER_ORG, id, KEN)],
      ["reject", (s: FactsService, id: string) => s.reject(OTHER_ORG, id, KEN)],
      ["reconfirm", (s: FactsService, id: string) => s.reconfirm(OTHER_ORG, id, KEN)],
      ["expire", (s: FactsService, id: string) => s.expire(OTHER_ORG, id, KEN, "why")],
      ["relearn", (s: FactsService, id: string) => s.relearn(OTHER_ORG, id, KEN)],
      [
        "add an anchor",
        (s: FactsService, id: string) =>
          s.addAnchor(OTHER_ORG, id, { kind: "dependency", value: "west" }),
      ],
      ["remove an anchor", (s: FactsService, id: string) => s.removeAnchor(OTHER_ORG, id, id)],
    ])("cannot %s another workspace's fact — it is not found", async (_name, call) => {
      const fact = store.seed(ORG, "proposed");

      await expect(refusal(call(service, fact.id))).resolves.toMatchObject({
        status: 404,
        code: "fact_not_found",
      });
      expect(store.find(fact.id).status).toBe("proposed");
    });

    it("lists and feeds only the workspace's own facts", async () => {
      store.seed(ORG, "proposed");
      store.seed(OTHER_ORG, "proposed");

      await expect(service.list(OTHER_ORG)).resolves.toMatchObject({
        items: [expect.objectContaining({ status: "proposed" })],
        counts: { proposed: 1, confirmed: 0 },
      });
      await expect(service.needsYou(OTHER_ORG)).resolves.toMatchObject({ count: 1 });
    });
  });

  describe("the list and the needs-you feed", () => {
    it("counts every status and filters by one — '2 awaiting review'", async () => {
      store.seed(ORG, "confirmed");
      store.seed(ORG, "proposed");
      store.seed(ORG, "proposed");
      store.seed(ORG, "expired");

      const all = await service.list(ORG);
      const awaiting = await service.list(ORG, "proposed");

      expect(all.counts).toEqual({ proposed: 2, confirmed: 1, rejected: 0, stale: 0, expired: 1 });
      expect(all.items).toHaveLength(4);
      expect(awaiting.items.map((item) => item.status)).toEqual(["proposed", "proposed"]);
      expect(awaiting.counts.proposed).toBe(2);
    });

    it("feeds proposals and stale facts as fact_review items at info, oldest wait first", async () => {
      const proposal = store.seed(ORG, "proposed", { text: "awaiting" });
      const stale = store.seed(ORG, "stale", { text: "flagged" });
      store.seed(ORG, "confirmed");
      store.seed(ORG, "expired");

      const feed = await service.needsYou(ORG);

      expect(feed.count).toBe(2);
      expect(feed.items).toEqual([
        expect.objectContaining({
          kind: "fact_review",
          severity: "info",
          factId: proposal.id,
          reason: "awaiting_review",
          staleness: null,
        }),
        expect.objectContaining({
          kind: "fact_review",
          severity: "info",
          factId: stale.id,
          reason: "stale",
          staleness: expect.objectContaining({ actor: null }) as unknown,
        }),
      ]);
    });

    it("drops a fact from the feed once a person decides it", async () => {
      const proposal = store.seed(ORG, "proposed");

      await service.confirm(ORG, proposal.id, KEN);

      await expect(service.needsYou(ORG)).resolves.toEqual({ count: 0, items: [] });
    });
  });

  it("passes a violation it has no answer for through unchanged", async () => {
    const fact = store.seed(ORG, "proposed");
    const repo = store.asRepository();
    jest.spyOn(repo, "move").mockRejectedValueOnce(new StoreViolation("23514", "something_else"));
    const database = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
    } as unknown as DatabaseService;
    const bare = new FactsService(repo, database);

    await expect(bare.confirm(ORG, fact.id, KEN)).rejects.toBeInstanceOf(StoreViolation);
  });

  it("answers a transition the database refused under a race as fact_changed", async () => {
    const fact = store.seed(ORG, "proposed");
    const repo = store.asRepository();
    jest
      .spyOn(repo, "move")
      .mockRejectedValueOnce(new StoreViolation("23514", "facts_legal_transition"));
    const database = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
    } as unknown as DatabaseService;
    const raced = new FactsService(repo, database);

    await expect(refusal(raced.confirm(ORG, fact.id, KEN))).resolves.toMatchObject({
      status: 409,
      code: "fact_changed",
    });
  });
});
