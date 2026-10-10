import { recordingDatabase } from "../db/database.fixture";
import { MOCKUP_PROSE, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { registryHarness } from "../decisions/decision.store.fixture";
import { renderDecision } from "../decisions/decision.templates";
import {
  SplitApprovalEmitter,
  batchSettledDetector,
  batchSubject,
  splitApprovalEmission,
} from "./split-approval.emitter";

/**
 * The split-approval emitter (#461, AL.4): a planner batch becomes *"Approve a split into 6
 * tickets?"*; pushing or abandoning it settles the card.
 */

const ORG = "acme-robotics";
const BATCH = "0a1b2c3d-0000-4000-8000-0000000ba7c4";

describe("batchSubject", () => {
  it("names a batch by its outline's first line, a heading's marks dropped, else its prompt's", () => {
    expect(batchSubject("# Telemetry v2\n- ring buffer", "ignored")).toBe("Telemetry v2");
    expect(batchSubject(null, "\nSplit the CAN stack\nmore")).toBe("Split the CAN stack");
    expect(batchSubject("   ", "")).toBe("a planning batch");
  });
});

describe("splitApprovalEmission", () => {
  it("composes the card, keyed by the batch", () => {
    const emission = splitApprovalEmission({
      organizationId: ORG,
      batchId: BATCH,
      subject: "Telemetry v2",
      draftCount: 6,
      target: "acme-robotics/helios-firmware",
    });

    expect(emission?.key).toEqual({ plane: "planning", sourceRef: `batch:${BATCH}` });
    expect(renderDecision(SHIPPED_KINDS.split_approval, emission?.payload ?? {})).toEqual(
      MOCKUP_PROSE.split_approval,
    );
  });

  it("asks nothing about a batch with no drafts", () => {
    expect(
      splitApprovalEmission({
        organizationId: ORG,
        batchId: BATCH,
        subject: "x",
        draftCount: 0,
        target: "t",
      }),
    ).toBeNull();
  });
});

describe("batchSettledDetector", () => {
  it("settles a card whose batch was pushed or abandoned", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: BATCH, organization_id: ORG }] });

    expect(
      await batchSettledDetector().settled(
        [
          {
            id: "item",
            organizationId: ORG,
            kindId: "split_approval",
            refs: [],
            sourceRef: `batch:${BATCH}`,
          },
        ],
        database.service.db,
      ),
    ).toEqual([
      { itemId: "item", organizationId: ORG, settlement: "batch_settled", channel: "web" },
    ]);
    expect(database.statements[0].parameters).toEqual([BATCH, "pushed", "abandoned"]);
  });
});

describe("SplitApprovalEmitter.drafted", () => {
  it("files the card for a drafting batch with its draft count", async () => {
    const harness = registryHarness();
    const database = recordingDatabase();
    database.answers(
      {
        rows: [
          {
            id: BATCH,
            outline: "# Telemetry v2",
            source_prompt: "p",
            status: "drafting",
            display_name: "acme-robotics/helios-firmware",
          },
        ],
      },
      { rows: [{ count: "6" }] },
    );

    await new SplitApprovalEmitter(database.service, harness.registry).drafted(ORG, BATCH);

    expect(harness.store.items[0]).toMatchObject({
      kindId: "split_approval",
      severity: "info",
      payload: { subject: "Telemetry v2", draft_count: 6, target: "acme-robotics/helios-firmware" },
    });
  });

  it("files nothing for a batch already pushed, or not this workspace's", async () => {
    const harness = registryHarness();
    const pushed = recordingDatabase();
    pushed.answers({
      rows: [{ id: BATCH, outline: null, source_prompt: "p", status: "pushed", display_name: "t" }],
    });

    await new SplitApprovalEmitter(pushed.service, harness.registry).drafted(ORG, BATCH);
    await new SplitApprovalEmitter(recordingDatabase().service, harness.registry).drafted(
      ORG,
      BATCH,
    );

    expect(harness.store.items).toEqual([]);
  });
});
