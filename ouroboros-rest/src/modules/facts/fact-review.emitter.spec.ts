import { Logger } from "@nestjs/common";

import { recordingDatabase } from "../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { registryHarness } from "../decisions/decision.store.fixture";
import { renderDecision } from "../decisions/decision.templates";
import { DecisionSourceWatcher, type AskingDecision } from "../decisions/decision.watchers";
import { FactReviewEmitter, factResolvedDetector, factReviewEmission } from "./fact-review.emitter";

/**
 * The fact-review emitter (#461, BF.2): a proposal or a stale flag files an `info` card under its
 * own key, and the fact leaving that wait settles it.
 */

const ORG = "acme-robotics";
const FACT = "0a1b2c3d-0000-4000-8000-00000000fac7";
const STALE = "0a1b2c3d-0000-4000-8000-00000000075a";

/** A fact's card facts. */
function fact(status: "proposed" | "stale" | "confirmed", staleTransitionId: string | null = null) {
  return {
    organizationId: ORG,
    factId: FACT,
    status,
    text: "CAN frames are DMA-backed on helios-firmware",
    provenanceLine: "from PR #514 review cycle",
    staleTransitionId,
  };
}

describe("factReviewEmission", () => {
  it("files a proposal as awaiting review, at info, with no refs", () => {
    const emission = factReviewEmission(fact("proposed"));

    expect(emission?.key).toEqual({ plane: "facts", sourceRef: `fact:${FACT}:proposed` });
    expect(emission?.refs).toEqual([]);
    expect(renderDecision(SHIPPED_KINDS.fact_review, emission?.payload ?? {})).toEqual(MOCKUP_PROSE.fact_review);
  });

  it("keys a stale episode by the transition that began it, so a second episode asks again", () => {
    expect(factReviewEmission(fact("stale", STALE))).toMatchObject({
      payload: { reason: "flagged stale" },
      key: { sourceRef: `fact:${FACT}:stale:${STALE}` },
    });
  });

  it("asks nothing about a fact waiting on nobody", () => {
    expect(factReviewEmission(fact("confirmed"))).toBeNull();
    expect(factReviewEmission(fact("stale", null))).toBeNull();
  });
});

describe("factResolvedDetector", () => {
  /** An asking card about the fact. */
  function asking(sourceRef: string): AskingDecision {
    return { id: sourceRef, organizationId: ORG, kindId: "fact_review", refs: [], sourceRef };
  }

  it("settles a card once its fact left the wait it was filed for", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: FACT, organization_id: ORG, status: "confirmed" }] });

    expect(
      await factResolvedDetector().settled(
        [asking(`fact:${FACT}:proposed`), asking(`fact:${FACT}:stale:${STALE}`)],
        database.service.db,
      ),
    ).toEqual([
      { itemId: `fact:${FACT}:proposed`, organizationId: ORG, settlement: "fact_resolved", channel: "web" },
      { itemId: `fact:${FACT}:stale:${STALE}`, organizationId: ORG, settlement: "fact_resolved", channel: "web" },
    ]);
  });

  it("leaves a card whose fact still waits, and settles one whose fact is gone", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: FACT, organization_id: ORG, status: "proposed" }] });

    expect(
      (
        await factResolvedDetector().settled(
          [asking(`fact:${FACT}:proposed`), asking("fact:0a1b2c3d-0000-4000-8000-000000000000:proposed")],
          database.service.db,
        )
      ).map((settled) => settled.itemId),
    ).toEqual(["fact:0a1b2c3d-0000-4000-8000-000000000000:proposed"]);
  });
});

describe("FactReviewEmitter", () => {
  afterEach(() => jest.restoreAllMocks());

  it("files a proposal's card, and a stale fact's under its flagging transition", async () => {
    const harness = registryHarness();
    const database = recordingDatabase();
    database.answers(
      { rows: [{ id: FACT, status: "proposed", text: "A", provenance: { line: "from a note", refs: [] } }] },
      { rows: [{ id: "0a1b2c3d-0000-4000-8000-00000000fac8", status: "stale", text: "B", provenance: { line: "from PR #9", refs: [] } }] },
      { rows: [{ id: STALE }] },
    );

    await new FactReviewEmitter(database.service, harness.registry).review(ORG, [
      FACT,
      "0a1b2c3d-0000-4000-8000-00000000fac8",
    ]);

    expect(harness.store.items.map((item) => [item.severity, item.sourceRef])).toEqual([
      ["info", `fact:${FACT}:proposed`],
      ["info", `fact:0a1b2c3d-0000-4000-8000-00000000fac8:stale:${STALE}`],
    ]);
  });

  it("logs a fact it could not file and goes on to the next", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const harness = registryHarness();
    const database = recordingDatabase();
    database.answers(
      { rows: [{ id: FACT, status: "proposed", text: "", provenance: { line: "x", refs: [] } }] },
      { rows: [{ id: "0a1b2c3d-0000-4000-8000-00000000fac8", status: "proposed", text: "B", provenance: { line: "x", refs: [] } }] },
    );

    await new FactReviewEmitter(database.service, harness.registry).review(ORG, [
      FACT,
      "0a1b2c3d-0000-4000-8000-00000000fac8",
    ]);

    expect(harness.store.items).toHaveLength(1);
    expect(Logger.prototype.error).toHaveBeenCalledWith(`Could not file the review of fact ${FACT}.`, expect.anything());
  });

  it("sweeps the workspace when a fact is decided, and registers its detector", async () => {
    const harness = registryHarness();
    const watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
    const sweep = jest.spyOn(watcher, "sweep").mockResolvedValue(0);
    const register = jest.spyOn(watcher, "register");
    const emitter = new FactReviewEmitter(recordingDatabase().service, harness.registry, watcher);

    emitter.onModuleInit();
    await emitter.settled(ORG);

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: "fact-resolved" }));
    expect(sweep).toHaveBeenCalledWith(ORG);
  });
});
