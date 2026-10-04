import { recordingDatabase } from "../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { registryHarness } from "../decisions/decision.store.fixture";
import { renderDecision } from "../decisions/decision.templates";
import type { AskingDecision } from "../decisions/decision.watchers";
import { ResizeReviewEmitter, resizeReviewEmission, resizeSettledDetector } from "./resize-review.emitter";

/**
 * The re-size emitter (#461, INTAKE-K.2): a new estimate that moves a ticket's effort becomes
 * *"Accept a re-size of #486 from L to M?"*; a newer estimate or the ticket closing settles it.
 */

const ORG = "acme-robotics";
const TICKET = "0a1b2c3d-0000-4000-8000-000000000486";

/** #486's re-size, L → M at 82%. */
const RESIZE = {
  organizationId: ORG,
  ticketId: TICKET,
  ticketKey: "#486",
  version: 2,
  fromEffort: "l" as const,
  toEffort: "m" as const,
  confidence: 82,
};

describe("resizeReviewEmission", () => {
  it("composes the card in the board's upper-case sizes, keyed by the estimate version", () => {
    const emission = resizeReviewEmission(RESIZE);

    expect(emission?.refs).toEqual([{ type: "ticket", id: TICKET, label: "issue #486" }]);
    expect(emission?.key).toEqual({ plane: "estimation", sourceRef: `ticket:${TICKET}:estimate:2` });
    expect(renderDecision(SHIPPED_KINDS.resize_review, emission?.payload ?? {})).toEqual(MOCKUP_PROSE.resize_review);
  });

  it("asks nothing when the size did not move", () => {
    expect(resizeReviewEmission({ ...RESIZE, toEffort: "l" })).toBeNull();
  });
});

describe("resizeSettledDetector", () => {
  const item: AskingDecision = {
    id: "item",
    organizationId: ORG,
    kindId: "resize_review",
    refs: [{ type: "ticket", id: TICKET, label: "issue #486" }],
    sourceRef: `ticket:${TICKET}:estimate:2`,
  };

  it("settles a re-size superseded by a newer estimate, or whose ticket closed", async () => {
    const newer = recordingDatabase();
    newer.answers({ rows: [{ id: TICKET, organization_id: ORG, state: "open", latest: 3 }] });
    const closed = recordingDatabase();
    closed.answers({ rows: [{ id: TICKET, organization_id: ORG, state: "closed", latest: 2 }] });

    expect((await resizeSettledDetector().settled([item], newer.service.db))[0].settlement).toBe(
      "estimate_superseded",
    );
    expect((await resizeSettledDetector().settled([item], closed.service.db))[0].settlement).toBe("ticket_closed");
  });

  it("leaves the newest re-size of an open ticket asking", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: TICKET, organization_id: ORG, state: "open", latest: 2 }] });

    expect(await resizeSettledDetector().settled([item], database.service.db)).toEqual([]);
  });
});

describe("ResizeReviewEmitter.estimated", () => {
  it("files a card when the new version's effort moved from the one before", async () => {
    const harness = registryHarness();
    const database = recordingDatabase();
    database.answers(
      { rows: [{ id: TICKET, organization_id: ORG, external_key: "#486", state: "open" }] },
      { rows: [{ version: 1, effort: "l", confidence: 70 }, { version: 2, effort: "m", confidence: 82 }] },
    );

    await new ResizeReviewEmitter(database.service, harness.registry).estimated(TICKET, 2);

    expect(harness.store.items[0]).toMatchObject({
      kindId: "resize_review",
      payload: { ticket_key: "#486", from_effort: "L", to_effort: "M", confidence: 82 },
    });
  });

  it("asks nothing about a first estimate, an unmoved size or a closed ticket", async () => {
    const harness = registryHarness();
    const unmoved = recordingDatabase();
    unmoved.answers(
      { rows: [{ id: TICKET, organization_id: ORG, external_key: "#486", state: "open" }] },
      { rows: [{ version: 1, effort: "m", confidence: 70 }, { version: 2, effort: "m", confidence: 82 }] },
    );
    const closed = recordingDatabase();
    closed.answers(
      { rows: [{ id: TICKET, organization_id: ORG, external_key: "#486", state: "closed" }] },
      { rows: [{ version: 1, effort: "l", confidence: 70 }, { version: 2, effort: "m", confidence: 82 }] },
    );
    const first = recordingDatabase();

    await new ResizeReviewEmitter(first.service, harness.registry).estimated(TICKET, 1);
    await new ResizeReviewEmitter(unmoved.service, harness.registry).estimated(TICKET, 2);
    await new ResizeReviewEmitter(closed.service, harness.registry).estimated(TICKET, 2);

    expect(first.statements).toEqual([]);
    expect(harness.store.items).toEqual([]);
  });
});
