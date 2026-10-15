import { NotFoundError } from "../errors/error.envelope";
import type { QueueItem, WorkspaceLifecycleState } from "../db/schema";
import { queueItemRow } from "./admission.fixture";
import { AdmissionService, CLAIM_CANDIDATE_LIMIT, EXECUTOR_CACHE_MS } from "./admission.service";

const ORG = "acme-robotics-id";
const NOW = new Date("2026-10-15T14:25:00.000Z");
const REPO = "a1312000-0000-4000-8000-0000000000aa";

/** A pinned definition whose one model stage inherits `implement`. */
const DEFINITION = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes: [
    {
      id: "implement",
      type: "llm",
      title: "implement",
      position: { x: 0, y: 0 },
      config: {
        mode: "prompt",
        prompt_template: "Implement it.",
        routing: { inherit_task: "implement" },
        limits: { max_retries: 1, token_budget: 200000 },
        permissions: { push_fixup: false, touch_ci: false },
      },
    },
  ],
  edges: [],
};

/** A resolution with one kept hop. */
const RESOLVED = { outcome: "resolved", chain: [{ decision: "kept" }] };

interface RigOptions {
  live?: boolean;
  ceilingMax?: number;
  state?: WorkspaceLifecycleState;
  ceiling?: number;
  taken?: number;
  enabled?: boolean;
  dryRun?: boolean;
  invocable?: boolean;
  definition?: { definition: unknown } | undefined;
  resolve?: jest.Mock;
  status?: jest.Mock;
  explicit?: boolean | null;
  candidates?: QueueItem[];
  clock?: () => number;
}

/**
 * An admission service over stand-ins.
 *
 * @param options - What each stand-in answers.
 * @returns The service and its stand-ins.
 */
function rig(options: RigOptions = {}) {
  const store = {
    db: "pool",
    lockClaims: jest.fn().mockResolvedValue(undefined),
    ceiling: jest.fn().mockResolvedValue(options.ceiling ?? 1),
    liveSlotsTaken: jest.fn().mockResolvedValue(options.taken ?? 0),
    repositoriesEnabled: jest.fn(async (_w: unknown, _o: string, ids: readonly string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, options.enabled ?? true]))),
    ),
    pinnedDefinition: jest
      .fn()
      .mockResolvedValue("definition" in options ? options.definition : { definition: DEFINITION }),
    claimableCandidates: jest.fn().mockResolvedValue(options.candidates ?? []),
  };
  const config = {
    liveExecutionEnabled: options.live ?? true,
    liveRunCeilingMax: options.ceilingMax ?? 4,
  };
  const states = { stateOf: jest.fn().mockResolvedValue(options.state ?? "active") };
  const connections = {
    invocableConnectionExists: jest.fn().mockResolvedValue(options.invocable ?? true),
  };
  const engine = {
    status: options.status ?? jest.fn().mockResolvedValue({ executors: ["native"] }),
  };
  const routing = { resolve: options.resolve ?? jest.fn().mockResolvedValue(RESOLVED) };
  const policy = {
    dryRun: jest.fn(),
    dryRunNow: jest.fn().mockResolvedValue(options.dryRun ?? true),
  };
  const capabilities = { explicitFor: jest.fn().mockResolvedValue(options.explicit ?? null) };

  const service = new AdmissionService(
    store as never,
    config as never,
    states as never,
    connections as never,
    engine as never,
    routing,
    policy,
    // No resolver: the org-wide switch alone decides dry-run in these suites.
    undefined as never,
    capabilities as never,
    options.clock,
  );

  return { service, store, states, connections, engine, routing, policy, capabilities };
}

describe("the admission service", () => {
  describe("who confirms an enqueue", () => {
    const CALLER = { userId: "user-1", roles: ["member"] };

    it("is nobody for a write no person made", async () => {
      const { service, capabilities } = rig();

      await expect(service.confirmerFor(ORG, undefined)).resolves.toBeNull();
      expect(capabilities.explicitFor).not.toHaveBeenCalled();
    });

    it("is nobody while the deployment does not run live loops", async () => {
      const { service } = rig({ live: false, explicit: true });

      await expect(service.confirmerFor(ORG, CALLER)).resolves.toBeNull();
    });

    it("is the caller when their explicit setting grants can_approve_loops", async () => {
      const { service, capabilities } = rig({ explicit: true });

      await expect(service.confirmerFor(ORG, CALLER)).resolves.toBe("user-1");
      expect(capabilities.explicitFor).toHaveBeenCalledWith(ORG, "user-1");
    });

    it("is the caller when their role grants it and nothing was set", async () => {
      const { service } = rig({ explicit: null });

      await expect(service.confirmerFor(ORG, { userId: "u", roles: ["admin"] })).resolves.toBe("u");
      await expect(service.confirmerFor(ORG, CALLER)).resolves.toBeNull();
    });

    it("is nobody when an explicit setting withholds it from an admin", async () => {
      const { service } = rig({ explicit: false });

      await expect(
        service.confirmerFor(ORG, { userId: "u", roles: ["admin"] }),
      ).resolves.toBeNull();
    });
  });

  describe("the executor count", () => {
    it("takes the worker's own declaration without asking the engine", async () => {
      const { service, engine } = rig();

      await expect(service.executorCount(["native", "harness"])).resolves.toBe(2);
      await expect(service.executorCount([])).resolves.toBe(0);
      expect(engine.status).not.toHaveBeenCalled();
    });

    it("asks the engine, and reuses its answer until the cache runs out", async () => {
      let now = 0;
      const { service, engine } = rig({ clock: () => now });

      await expect(service.executorCount()).resolves.toBe(1);
      now = EXECUTOR_CACHE_MS - 1;
      await expect(service.executorCount()).resolves.toBe(1);
      expect(engine.status).toHaveBeenCalledTimes(1);

      now = EXECUTOR_CACHE_MS;
      await service.executorCount();
      expect(engine.status).toHaveBeenCalledTimes(2);
    });

    it("counts none for an engine that does not answer, or reports none", async () => {
      await expect(
        rig({ status: jest.fn().mockRejectedValue(new Error("down")) }).service.executorCount(),
      ).resolves.toBe(0);
      await expect(
        rig({ status: jest.fn().mockResolvedValue({}) }).service.executorCount(),
      ).resolves.toBe(0);
    });
  });

  describe("an item's facts", () => {
    it("admits a confirmed item on an enabled dry-run repository with a resolving route", async () => {
      const { service } = rig();
      const row = queueItemRow({ confirmed_at: NOW });

      const facts = await service.itemFacts("trx" as never, ORG, [row]);

      expect(facts.get(row.id)).toEqual({
        repositoryEnabled: true,
        dryRun: true,
        workflowPublished: true,
        routeInvocable: true,
        confirmed: true,
      });
    });

    it("answers no facts for no items, asking nothing", async () => {
      const { service, store } = rig();

      expect((await service.itemFacts("trx" as never, ORG, [])).size).toBe(0);
      expect(store.repositoriesEnabled).not.toHaveBeenCalled();
    });

    it("reads a disabled repository, a repository out of dry-run and an unconfirmed item", async () => {
      const { service } = rig({ enabled: false, dryRun: false });
      const row = queueItemRow();

      expect((await service.itemFacts("trx" as never, ORG, [row])).get(row.id)).toMatchObject({
        repositoryEnabled: false,
        dryRun: false,
        confirmed: false,
      });
    });

    it("reads an item pinning no version as unpublished, without reading a definition", async () => {
      const { service, store } = rig();
      const row = queueItemRow({ workflow_version: null });

      const facts = (await service.itemFacts("trx" as never, ORG, [row])).get(row.id);

      expect(facts).toMatchObject({ workflowPublished: false, routeInvocable: false });
      expect(store.pinnedDefinition).not.toHaveBeenCalled();
    });

    it("reads a pin with no such version as unpublished", async () => {
      const { service } = rig({ definition: undefined });
      const row = queueItemRow();

      expect((await service.itemFacts("trx" as never, ORG, [row])).get(row.id)).toMatchObject({
        workflowPublished: false,
      });
    });

    it.each([
      ["has no route", jest.fn().mockRejectedValue(new NotFoundError("route_not_found", "none"))],
      ["fails the run", jest.fn().mockResolvedValue({ outcome: "fail_run", chain: [] })],
      [
        "keeps no hop",
        jest.fn().mockResolvedValue({ outcome: "resolved", chain: [{ decision: "dropped" }] }),
      ],
    ])("reads the route as not invocable when it %s", async (_label, resolve) => {
      const { service } = rig({ resolve });
      const row = queueItemRow();

      expect((await service.itemFacts("trx" as never, ORG, [row])).get(row.id)).toMatchObject({
        workflowPublished: true,
        routeInvocable: false,
      });
    });

    it("lets a router failure that is not a missing route through", async () => {
      const { service } = rig({ resolve: jest.fn().mockRejectedValue(new Error("boom")) });

      await expect(service.itemFacts("trx" as never, ORG, [queueItemRow()])).rejects.toThrow(
        "boom",
      );
    });

    it("reads the route as not invocable when the workspace has no cleared connection", async () => {
      const { service } = rig({ invocable: false });
      const row = queueItemRow();

      expect((await service.itemFacts("trx" as never, ORG, [row])).get(row.id)).toMatchObject({
        routeInvocable: false,
      });
    });

    it("asks once per distinct repository, pin and route", async () => {
      const { service, store, routing, policy } = rig();
      const rows = [
        queueItemRow({ id: "a1312000-0000-4000-8000-000000000001" }),
        queueItemRow({ id: "a1312000-0000-4000-8000-000000000002", issue_number: 483 }),
        queueItemRow({ id: "a1312000-0000-4000-8000-000000000003", workflow_version: 4 }),
      ];

      await service.itemFacts("trx" as never, ORG, rows);

      expect(store.repositoriesEnabled).toHaveBeenCalledWith("trx", ORG, [REPO]);
      expect(policy.dryRunNow).toHaveBeenCalledTimes(1);
      expect(store.pinnedDefinition).toHaveBeenCalledTimes(2);
      expect(routing.resolve).toHaveBeenCalledTimes(1);
      expect(routing.resolve).toHaveBeenCalledWith(ORG, "implement");
    });
  });

  describe("why each queued item waits", () => {
    it("is null for an item a worker holds", async () => {
      const { service } = rig({ live: false });
      const held = queueItemRow({ claim_expires_at: new Date(NOW.getTime() + 60_000) });

      expect((await service.waiting(ORG, [held], NOW)).get(held.id)).toBeNull();
    });

    it("holds every item alike for a workspace reason", async () => {
      const { service } = rig({ state: "paused" });
      const rows = [
        queueItemRow({ id: "a1312000-0000-4000-8000-000000000001" }),
        queueItemRow({ id: "a1312000-0000-4000-8000-000000000002", confirmed_at: NOW }),
      ];

      const waiting = await service.waiting(ORG, rows, NOW);

      expect([...waiting.values()]).toEqual([
        { reason: "workspace_paused", scope: "workspace" },
        { reason: "workspace_paused", scope: "workspace" },
      ]);
    });

    it("names an item's own reason, and null for one admission would take", async () => {
      const { service } = rig();
      const waits = queueItemRow({ id: "a1312000-0000-4000-8000-000000000001" });
      const ready = queueItemRow({ id: "a1312000-0000-4000-8000-000000000002", confirmed_at: NOW });

      const waiting = await service.waiting(ORG, [waits, ready], NOW);

      expect(waiting.get(waits.id)).toEqual({ reason: "needs_confirmation", scope: "item" });
      expect(waiting.get(ready.id)).toBeNull();
    });

    it("asks nothing for an empty list", async () => {
      const { service, states } = rig();

      expect((await service.waiting(ORG, [], NOW)).size).toBe(0);
      expect(states.stateOf).not.toHaveBeenCalled();
    });

    it("publishes each row as a summary carrying its reason", async () => {
      const { service } = rig();
      const row = queueItemRow();

      const [summary] = await service.summaries(ORG, [row], NOW);

      expect(summary).toMatchObject({
        id: row.id,
        issueNumber: 482,
        confirmedAt: null,
        waiting: { reason: "needs_confirmation", scope: "item" },
      });
    });
  });

  describe("the claim's decision", () => {
    it("locks the workspace's claims before it reads anything", async () => {
      const { service, store } = rig({ candidates: [queueItemRow({ confirmed_at: NOW })] });

      await service.admitNext("trx" as never, ORG, NOW, 1);

      expect(store.lockClaims).toHaveBeenCalledWith("trx", ORG);
      expect(store.lockClaims.mock.invocationCallOrder[0]).toBeLessThan(
        store.liveSlotsTaken.mock.invocationCallOrder[0],
      );
      expect(store.claimableCandidates).toHaveBeenCalledWith(
        "trx",
        ORG,
        NOW,
        CLAIM_CANDIDATE_LIMIT,
      );
    });

    it("refuses with the slots taken and the ceiling when the ceiling is full", async () => {
      const { service, store } = rig({ taken: 1, ceiling: 1 });

      await expect(service.admitNext("trx" as never, ORG, NOW, 1)).resolves.toEqual({
        refused: "concurrency_ceiling",
        taken: 1,
        ceiling: 1,
      });
      expect(store.claimableCandidates).not.toHaveBeenCalled();
    });

    it("clamps the workspace's ceiling to the deployment's maximum", async () => {
      const { service } = rig({ taken: 2, ceiling: 5, ceilingMax: 2 });

      await expect(service.admitNext("trx" as never, ORG, NOW, 1)).resolves.toEqual({
        refused: "concurrency_ceiling",
        taken: 2,
        ceiling: 2,
      });
    });

    it("refuses with no_executor for an engine with none", async () => {
      const { service } = rig();

      await expect(service.admitNext("trx" as never, ORG, NOW, 0)).resolves.toMatchObject({
        refused: "no_executor",
      });
    });

    it("skips an item that cannot start and takes the first that can", async () => {
      const head = queueItemRow({ id: "a1312000-0000-4000-8000-000000000001", position: 1 });
      const next = queueItemRow({
        id: "a1312000-0000-4000-8000-000000000002",
        position: 2,
        confirmed_at: NOW,
      });
      const { service } = rig({ candidates: [head, next] });

      await expect(service.admitNext("trx" as never, ORG, NOW, 1)).resolves.toEqual({
        refused: null,
        item: next,
      });
    });

    it("admits nothing when no candidate can start", async () => {
      const { service } = rig({ candidates: [queueItemRow()] });

      await expect(service.admitNext("trx" as never, ORG, NOW, 1)).resolves.toEqual({
        refused: null,
        item: undefined,
      });
    });
  });
});
