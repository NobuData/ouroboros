import { Logger } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { recordingDatabase } from "../db/database.fixture";
import { JITTER_SPREAD } from "../scheduling/cadence";
import { SEEDED_PAYLOADS } from "./decision.kinds.fixture";
import { registryHarness, type RegistryHarness } from "./decision.store.fixture";
import {
  DECISION_SOURCE_SWEEP_SECONDS,
  DECISION_SOURCE_SWEEP_TIMEOUT,
  DecisionSourceSweeper,
  DecisionSourceWatcher,
  prSettledDetector,
  refIds,
  runTerminatedDetector,
  type AskingDecision,
  type DecisionSourceDetector,
} from "./decision.watchers";

/**
 * Out-of-band resolution (#461, X4): detectors judge asking items by their plane's state, the
 * watcher closes what they find as policy(source_resolved), and the sweeper keeps doing it.
 */

const ORG = "acme-robotics";
const RUN = "0a1b2c3d-0000-4000-8000-000000001851";
const PR = "0a1b2c3d-0000-4000-8000-000000000509";
const OTHER_PR = "0a1b2c3d-0000-4000-8000-000000000514";

/** An asking item about PR #509. */
function askingAboutPr(prId = PR, organizationId = ORG): AskingDecision {
  return {
    id: `item-${prId}`,
    organizationId,
    kindId: "merge_approval",
    refs: [
      { type: "run", id: RUN, label: "loop #1843" },
      { type: "pr", id: prId, label: "PR" },
    ],
    sourceRef: `pr:${prId}`,
  };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("refIds", () => {
  it("reads one ref type's ids, in tag order", () => {
    expect(refIds(askingAboutPr(), "pr")).toEqual([PR]);
    expect(refIds(askingAboutPr(), "ticket")).toEqual([]);
  });
});

describe("prSettledDetector", () => {
  it("closes an item whose PR merged as pr_merged through github, one closed as pr_closed", async () => {
    const database = recordingDatabase();
    database.answers({
      rows: [
        { id: PR, organization_id: ORG, state: "merged" },
        { id: OTHER_PR, organization_id: ORG, state: "closed" },
      ],
    });

    const settled = await prSettledDetector(["merge_approval"]).settled(
      [
        askingAboutPr(),
        askingAboutPr(OTHER_PR),
        askingAboutPr("0a1b2c3d-0000-4000-8000-0000000000ff"),
      ],
      database.service.db,
    );

    expect(settled).toEqual([
      { itemId: `item-${PR}`, organizationId: ORG, settlement: "pr_merged", channel: "github" },
      {
        itemId: `item-${OTHER_PR}`,
        organizationId: ORG,
        settlement: "pr_closed",
        channel: "github",
      },
    ]);
    expect(database.sql()[0]).toContain('"state" in ($');
  });

  it("matches the PR within the item's own workspace only", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: PR, organization_id: "someone-else", state: "merged" }] });

    expect(
      await prSettledDetector(["merge_approval"]).settled([askingAboutPr()], database.service.db),
    ).toEqual([]);
  });

  it("asks nothing when no item carries a PR ref", async () => {
    const database = recordingDatabase();

    expect(
      await prSettledDetector(["merge_approval"]).settled(
        [{ ...askingAboutPr(), refs: [] }],
        database.service.db,
      ),
    ).toEqual([]);
    expect(database.statements).toEqual([]);
  });
});

describe("runTerminatedDetector", () => {
  it("closes items whose run reached one of the settling statuses", async () => {
    const database = recordingDatabase();
    database.answers({ rows: [{ id: RUN, organization_id: ORG }] });

    const settled = await runTerminatedDetector(
      ["protected_path_allow_once"],
      ["merged", "failed", "canceled"],
    ).settled([askingAboutPr()], database.service.db);

    expect(settled).toEqual([
      { itemId: `item-${PR}`, organizationId: ORG, settlement: "run_terminated", channel: "api" },
    ]);
    expect(database.statements[0].parameters).toEqual(
      expect.arrayContaining(["merged", "failed", "canceled"]),
    );
  });

  it("names its settlement in its receipt and its log name", async () => {
    const detector = runTerminatedDetector(["run_needs_human"], ["coding"], "run_moved_on");
    const database = recordingDatabase();
    database.answers({ rows: [{ id: RUN, organization_id: ORG }] });

    expect(detector.name).toBe("run-run_moved_on");
    expect((await detector.settled([askingAboutPr()], database.service.db))[0].settlement).toBe(
      "run_moved_on",
    );
  });
});

describe("DecisionSourceWatcher", () => {
  let harness: RegistryHarness;
  let watcher: DecisionSourceWatcher;

  beforeEach(() => {
    harness = registryHarness();
    watcher = new DecisionSourceWatcher(harness.store.asRepository(), harness.registry);
  });

  /** File PR #509's merge approval and answer its id. */
  async function filePr509(): Promise<string> {
    const { itemId } = await harness.registry.emit({
      organizationId: ORG,
      kindId: "merge_approval",
      payload: SEEDED_PAYLOADS.merge_approval,
      refs: askingAboutPr().refs,
      key: { plane: "pr.gates", sourceRef: `pr:${PR}` },
    });

    return String(itemId);
  }

  it("closes what a detector finds settled — PR #509 merged out of band — as policy(source_resolved)", async () => {
    const itemId = await filePr509();
    const detector: DecisionSourceDetector = {
      name: "stub",
      kinds: ["merge_approval"],
      settled: (items) =>
        Promise.resolve(
          items.map((item) => ({
            itemId: item.id,
            organizationId: item.organizationId,
            settlement: "pr_merged" as const,
            channel: "github" as const,
          })),
        ),
    };
    watcher.register(detector);

    expect(await watcher.sweep(ORG)).toBe(1);
    expect(harness.store.resolutions).toEqual([
      expect.objectContaining({ itemId, resolver: "policy", policy: "source_resolved" }),
    ]);
    expect(await watcher.sweep(ORG)).toBe(0);
  });

  it("hands each detector only asking items of its own kinds and workspace", async () => {
    await filePr509();
    const seen: AskingDecision[][] = [];
    watcher.register({
      name: "claims",
      kinds: ["claim_waiver"],
      settled: (items) => {
        seen.push([...items]);
        return Promise.resolve([]);
      },
    });
    watcher.register({
      name: "merges",
      kinds: ["merge_approval"],
      settled: (items) => {
        seen.push([...items]);
        return Promise.resolve([]);
      },
    });

    await watcher.sweep("another-workspace");
    await watcher.sweep(ORG);

    expect(seen).toEqual([
      [expect.objectContaining({ kindId: "merge_approval", sourceRef: `pr:${PR}` })],
    ]);
  });

  it("logs a failing detector and still runs the others", async () => {
    const itemId = await filePr509();
    watcher.register({
      name: "broken",
      kinds: ["merge_approval"],
      settled: () => Promise.reject(new Error("down")),
    });
    watcher.register({
      name: "working",
      kinds: ["merge_approval"],
      settled: (items) =>
        Promise.resolve([
          { itemId: items[0].id, organizationId: ORG, settlement: "pr_closed", channel: "github" },
        ]),
    });

    expect(await watcher.sweep()).toBe(1);
    expect(harness.store.items.find((item) => item.id === itemId)?.status).toBe("resolved");
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "Decision source detector broken failed.",
      expect.anything(),
    );
  });

  it("stops asking a detector once it is unregistered", async () => {
    await filePr509();
    const settled = jest.fn().mockResolvedValue([]);
    const unregister = watcher.register({ name: "x", kinds: ["merge_approval"], settled });

    unregister();
    await watcher.sweep();

    expect(settled).not.toHaveBeenCalled();
  });
});

describe("DecisionSourceSweeper", () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    jest.useFakeTimers();
    registry = new SchedulerRegistry();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** A sweeper over a watcher stand-in. */
  function loop(sweep: jest.Mock) {
    return new DecisionSourceSweeper({ sweep } as unknown as DecisionSourceWatcher, registry);
  }

  it("books its first sweep a jittered minute after bootstrap", () => {
    const sweep = jest.fn().mockResolvedValue(0);
    const sweeper = loop(sweep);

    sweeper.onApplicationBootstrap();

    expect(sweep).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DECISION_SOURCE_SWEEP_SECONDS * 1000 * (1 + JITTER_SPREAD));
    expect(sweep).toHaveBeenCalledWith();
    sweeper.onApplicationShutdown();
  });

  it("logs a sweep that closed something, and keeps the loop alive when one fails", async () => {
    const sweeper = loop(
      jest.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error("down")),
    );

    await sweeper.tick();
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "Decision sweep: 2 item(s) closed — their source settled.",
    );

    await sweeper.tick();
    expect(registry.doesExist("timeout", DECISION_SOURCE_SWEEP_TIMEOUT)).toBe(true);
    sweeper.onApplicationShutdown();
    expect(registry.doesExist("timeout", DECISION_SOURCE_SWEEP_TIMEOUT)).toBe(false);
  });

  it("books nothing after shutdown", async () => {
    const sweeper = loop(jest.fn().mockResolvedValue(0));

    sweeper.onApplicationShutdown();
    await sweeper.tick();

    expect(registry.doesExist("timeout", DECISION_SOURCE_SWEEP_TIMEOUT)).toBe(false);
  });
});
