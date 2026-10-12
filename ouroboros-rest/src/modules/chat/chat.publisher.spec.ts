import type { DatabaseService } from "../db/db.service";
import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { DecisionLifecycle } from "../decisions/decision.lifecycle";
import * as outbox from "./chat.outbox";
import { ChatPublisher, SYSTEM_LINE_DELAY_MS } from "./chat.publisher";
import type { ChatRepository, DecisionCardPlacement, DigestRouteRow } from "./chat.repository";

/**
 * The publisher (#536): the decision lifecycle and the weekly slot become intents — and a
 * listener that fails costs a message, never the decision.
 */

jest.mock("./chat.outbox", () => ({
  ...jest.requireActual<typeof import("./chat.outbox")>("./chat.outbox"),
  enqueueChatIntent: jest.fn(),
}));

const enqueue = outbox.enqueueChatIntent as jest.MockedFunction<typeof outbox.enqueueChatIntent>;
const DB = { marker: "db" };
const ORG = "org-acme";
const ITEM = "5eed0082-0000-4000-8000-000000000002";

const PLACEMENT: DecisionCardPlacement = {
  organizationId: ORG,
  connectionId: "connection-1",
  cardKind: "protected_path_allow_once",
  routeKind: "custom:blocking-questions",
  channelId: "channel-1",
  dmPlatformUserId: null,
  messageId: "message-1",
};

/** A publisher over stubs, on a real lifecycle. */
function harness(routes: DigestRouteRow[] = []) {
  const repository = {
    cardPlacements: jest.fn().mockResolvedValue([PLACEMENT]),
    enqueueResolution: jest.fn().mockResolvedValue(2),
    digestRoutes: jest.fn().mockResolvedValue(routes),
  };
  const lifecycle = new DecisionLifecycle();
  const publisher = new ChatPublisher(
    { db: DB } as unknown as DatabaseService,
    repository as unknown as ChatRepository,
    {
      isDormant: (kindId: string) => kindId === "spend_approval",
    } as unknown as DecisionKindRegistry,
    lifecycle,
  );

  return { publisher, repository, lifecycle };
}

/** Let detached handlers finish. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  enqueue.mockReset().mockResolvedValue(1);
});

describe("hearing the decision lifecycle", () => {
  it("registers at module init and stops at destroy", async () => {
    const { publisher, lifecycle } = harness();
    const event = {
      type: "filed" as const,
      itemId: ITEM,
      organizationId: ORG,
      kindId: "fact_review",
    };

    lifecycle.emit(event);
    await settled();
    expect(enqueue).not.toHaveBeenCalled();

    publisher.onModuleInit();
    lifecycle.emit(event);
    await settled();
    expect(enqueue).toHaveBeenCalledTimes(1);

    publisher.onModuleDestroy();
    lifecycle.emit(event);
    await settled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("intends a decision card on the blocking-question routes when a decision is filed", async () => {
    const { publisher } = harness();

    await expect(publisher.decisionFiled(ORG, ITEM, "protected_path_allow_once")).resolves.toBe(1);

    expect(enqueue).toHaveBeenCalledWith(DB, {
      organizationId: ORG,
      messageKind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      subject: {},
      routeKinds: ["custom:blocking-questions", "needs_you_dm"],
      dedupe: ["decision_card", ITEM],
    });
  });

  it("says nothing for a dormant kind, which files no decision", async () => {
    const { publisher } = harness();

    await expect(publisher.decisionFiled(ORG, ITEM, "spend_approval")).resolves.toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("says nothing on a refresh — the card is re-composed when it is next written", async () => {
    const { publisher, repository } = harness();

    publisher.decisionChanged({
      type: "refreshed",
      itemId: ITEM,
      organizationId: ORG,
      kindId: "fact_review",
    });
    await settled();

    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.enqueueResolution).not.toHaveBeenCalled();
  });

  it("intends the edit of every card and the line after it when a decision is resolved", async () => {
    const { publisher, repository } = harness();
    const now = new Date("2026-10-11T14:11:00.000Z");

    await expect(publisher.decisionResolved(ITEM, "allow_once", now)).resolves.toBe(2);

    expect(repository.cardPlacements).toHaveBeenCalledWith(ITEM);
    expect(repository.enqueueResolution).toHaveBeenCalledWith(
      ITEM,
      "allow_once",
      [PLACEMENT],
      new Date(now.getTime() + SYSTEM_LINE_DELAY_MS),
    );
  });

  it("routes a resolved event to the resolution, whoever resolved it", async () => {
    const { publisher, repository } = harness();

    publisher.decisionChanged({
      type: "resolved",
      itemId: ITEM,
      organizationId: ORG,
      kindId: "protected_path_allow_once",
      resolver: "policy",
      policy: "source_resolved",
      actionId: "source_resolved",
      channel: "api",
    });
    await settled();

    expect(repository.enqueueResolution).toHaveBeenCalledWith(
      ITEM,
      "source_resolved",
      [PLACEMENT],
      expect.any(Date),
    );
  });

  it("never throws into the lifecycle: a failed enqueue is logged and costs one message", async () => {
    const { publisher, repository } = harness();
    enqueue.mockRejectedValueOnce(new Error("the database went away"));
    repository.cardPlacements.mockRejectedValueOnce(new Error("the database went away"));

    await expect(publisher.decisionFiled(ORG, ITEM, "fact_review")).resolves.toBe(0);
    await expect(publisher.decisionResolved(ITEM, "confirm")).resolves.toBe(0);
  });
});

describe("the weekly digest", () => {
  // Monday 2026-10-05, 09:00 UTC is the slot; the pass runs half a minute after it.
  const NOW = new Date("2026-10-05T09:00:30.000Z");
  const SLOT = "2026-10-05T09:00:00.000Z";
  const route = (overrides: Partial<DigestRouteRow> = {}): DigestRouteRow => ({
    organizationId: ORG,
    kind: "custom:weekly-insights",
    config: { weekday: "monday", time: "09:00" },
    lastSlot: undefined,
    ...overrides,
  });

  it("intends the digest on the route whose slot has come, once per slot", async () => {
    const { publisher, repository } = harness([route()]);

    await expect(publisher.digestPass(NOW)).resolves.toBe(1);

    expect(repository.digestRoutes).toHaveBeenCalledWith([
      "custom:weekly-insights",
      "weekly_insights",
    ]);
    expect(enqueue).toHaveBeenCalledWith(DB, {
      organizationId: ORG,
      messageKind: "event_card",
      cardKind: "digest",
      subject: { slot: SLOT },
      routeKinds: ["custom:weekly-insights"],
      dedupe: ["digest", SLOT],
    });
  });

  it("intends the same slot again harmlessly — the dedupe key is the slot", async () => {
    const { publisher } = harness([route({ lastSlot: new Date(SLOT) })]);

    await publisher.digestPass(NOW);

    expect(enqueue).toHaveBeenCalledWith(DB, expect.objectContaining({ dedupe: ["digest", SLOT] }));
  });

  it("does not intend a digest long after its slot, or twice in one week", async () => {
    const late = harness([route()]);
    await late.publisher.digestPass(new Date("2026-10-07T09:00:30.000Z"));
    expect(enqueue).not.toHaveBeenCalled();

    // The schedule was moved a day later after this week's digest went out.
    const moved = harness([
      route({ config: { weekday: "tuesday", time: "09:00" }, lastSlot: new Date(SLOT) }),
    ]);
    await moved.publisher.digestPass(new Date("2026-10-06T09:00:30.000Z"));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("keeps going when one workspace's enqueue fails", async () => {
    const { publisher } = harness([route(), route({ organizationId: "org-other" })]);
    enqueue.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(1);

    await expect(publisher.digestPass(NOW)).resolves.toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
