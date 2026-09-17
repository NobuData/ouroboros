import { Logger } from "@nestjs/common";

import type { EngineClient } from "../engine/engine.client";
import { planSchema, type Plan, type PlanRequest } from "../engine/engine.contract";
import { planGoldenCase } from "../engine/engine.fixture";
import { DomainError } from "../errors/error.envelope";
import type {
  DraftSizingListener,
  DraftSizingRequest,
  EstimationOrchestrator,
} from "../estimation/estimation.orchestrator";
import type { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import type { WorkflowRegistryService } from "../workflows/registry.service";
import { BatchesService, prefixOf } from "./batches.service";
import type { CreateBatchBody } from "./planning.dto";
import { PLANNING_ERRORS } from "./planning.errors";
import { OTHER_ORG, PlanningStore, STORE_ORG, STORE_SOURCE } from "./planning.store.fixture";
import { PUSH_ERRORS } from "./push.errors";
import type { PushReport, PushService } from "./push.service";
import type { QueueSmallHook } from "./queue-small";

/**
 * The generator card's orchestration (AL.4, [#280](https://github.com/NobuData/ouroboros/issues/280)),
 * over an in-memory store holding V034–V037's rules and stand-ins for the planner, the one sizer,
 * the push and the queue-small hook. `planning.integration-spec.ts` repeats the flow against
 * PostgreSQL.
 */

/** The golden OTA batch, in this service's names. */
function goldenPlan(): Plan {
  return planSchema.parse(planGoldenCase().response);
}

/** What the generator card sends. */
function body(overrides: Partial<CreateBatchBody> = {}): CreateBatchBody {
  return {
    prompt: "We need OTA updates to survive power loss mid-flash.",
    outline: "- Partition table & bootloader slot flag for A/B scheme  blocks: OTA-3",
    targetSourceId: STORE_SOURCE.sourceId,
    milestone: "Helios 2.1",
    ...overrides,
  };
}

/** How the stand-ins behave. */
interface Behaviour {
  plan?: () => Plan;
  writable?: boolean;
  milestones?: boolean;
  pushing?: boolean;
}

/**
 * The service over stand-ins.
 *
 * @param behaviour - What the stand-ins do.
 * @returns The service, the store, and what each stand-in recorded.
 */
function build(behaviour: Behaviour = {}) {
  const store = new PlanningStore();
  const plans: PlanRequest[] = [];
  const sized: { request: DraftSizingRequest; listener?: DraftSizingListener }[] = [];
  const engine = {
    plan: async (request: PlanRequest) => {
      plans.push(request);
      return Promise.resolve((behaviour.plan ?? goldenPlan)());
    },
  } as unknown as EngineClient;
  const workflows = {
    offered: async () =>
      Promise.resolve({ slugs: ["feature-loop", "hil-verify", "docs-loop", "standard-fix"] }),
  } as unknown as WorkflowRegistryService;
  const listMilestones = jest.fn(async () =>
    Promise.resolve([{ externalRef: "3", name: "Helios 2.1" }]),
  );
  const provider = {
    kind: "github",
    capabilities: () => ({
      write: {
        createTicket: behaviour.writable ?? true,
        nativeDependencies: true,
        epicMapping: "parent_issue",
        milestones: behaviour.milestones ?? true,
      },
    }),
    pushTargetName: () => "acme-robotics/helios-firmware",
    listMilestones,
  };
  const registry = { find: () => provider } as unknown as TicketSourceRegistry;
  const sources = {
    withCredentials: async (_source: unknown, run: (context: unknown) => Promise<unknown>) =>
      run({ credentials: "token" }),
  } as unknown as TicketSourcesService;
  const orchestrator = {
    enqueueDraft: (request: DraftSizingRequest, listener?: DraftSizingListener) => {
      sized.push({ request, listener });
      return true;
    },
  } as unknown as EstimationOrchestrator;
  const report = { batchId: "", outcome: "pushed" } as unknown as PushReport;
  const pusher = {
    push: jest.fn(async () => Promise.resolve(report)),
    resume: jest.fn(async () => Promise.resolve(report)),
    isPushing: () => behaviour.pushing ?? false,
  } as unknown as PushService;
  const queueSmall = {
    run: jest.fn(async () => Promise.resolve({ queued: ["OTA-6"], skipped: [] })),
  } as unknown as QueueSmallHook;

  return {
    service: new BatchesService(
      store.asRepository(),
      engine,
      workflows,
      registry,
      sources,
      orchestrator,
      pusher,
      queueSmall,
    ),
    store,
    plans,
    sized,
    pusher,
    queueSmall,
    listMilestones,
  };
}

/**
 * The envelope a call refused with.
 *
 * @param run - The call.
 * @returns Its status, code and details.
 */
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof DomainError)) {
      throw error;
    }

    return { status: error.getStatus(), ...error.envelope() };
  }

  throw new Error("expected a refusal");
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

describe("generating a batch", () => {
  it("stores the planner's six drafts with the mockup's dependency shape", async () => {
    const { service, plans } = build();

    const batch = await service.generate(STORE_ORG, "user-1", body());

    expect(batch.planner).toBe("outline-v0");
    expect(batch.status).toBe("drafting");
    expect(batch.notes).toEqual([]);
    expect(batch.drafts.map((draft) => draft.localKey)).toEqual([
      "OTA-1",
      "OTA-2",
      "OTA-3",
      "OTA-4",
      "OTA-5",
      "OTA-6",
    ]);
    expect(batch.drafts[2].dependencies).toEqual(["OTA-1", "OTA-2"]);
    expect(batch.drafts[4].dependencies).toEqual(["OTA-3", "OTA-4"]);
    expect(batch.drafts.every((draft) => draft.selected && draft.provenance === "planned")).toBe(
      true,
    );
    expect(plans[0].context).toEqual({
      workflowTags: ["feature-loop", "hil-verify", "docs-loop", "standard-fix"],
      milestone: "Helios 2.1",
      localKeyPrefix: "OTA",
    });
  });

  it("sizes every draft through the one orchestrator, naming the push target", async () => {
    const { service, sized } = build();

    const batch = await service.generate(STORE_ORG, null, body());

    expect(sized.map((entry) => entry.request.draftId)).toEqual(
      batch.drafts.map((draft) => draft.id),
    );
    expect(sized.every((entry) => entry.request.repo === "acme-robotics/helios-firmware")).toBe(
      true,
    );
  });

  it("moves the batch to sized once every selected draft has an estimate", async () => {
    const { service, store, sized } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    for (const [index, entry] of sized.entries()) {
      store.estimates.set(entry.request.draftId, { effort: "s", estMinutes: 100 });
      await entry.listener?.(entry.request.draftId, "sized");

      const status = store.batches.get(batch.id)?.status;

      expect(status).toBe(index === sized.length - 1 ? "sized" : "drafting");
    }

    const read = await service.read(STORE_ORG, batch.id);

    expect(read.summary).toMatchObject({ allSized: true, sizedCount: 6, estMinutes: 600 });
  });

  it("does not size anything with auto-size off, and keeps the toggles", async () => {
    const { service, sized } = build();

    const batch = await service.generate(
      STORE_ORG,
      null,
      body({ autoSize: false, queueSmall: true }),
    );

    expect(sized).toEqual([]);
    expect(batch).toMatchObject({ autoSize: false, queueSmall: true });
  });

  it("refuses a source in another workspace as not found", async () => {
    const { service } = build();

    await expect(
      refusal(async () => service.generate(OTHER_ORG, null, body())),
    ).resolves.toMatchObject({
      status: 404,
      code: PLANNING_ERRORS.sourceNotFound,
    });
  });

  it("refuses a read-only target", async () => {
    const { service } = build({ writable: false });

    await expect(
      refusal(async () => service.generate(STORE_ORG, null, body())),
    ).resolves.toMatchObject({
      status: 409,
      code: PLANNING_ERRORS.targetReadOnly,
    });
  });

  it("refuses an epic the workspace does not have", async () => {
    const { service } = build();

    await expect(
      refusal(async () =>
        service.generate(STORE_ORG, null, body({ epicId: "5eed0280-0000-4000-8000-00000000ee99" })),
      ),
    ).resolves.toMatchObject({ status: 404, code: PLANNING_ERRORS.epicNotFound });
  });

  it("refuses a planner that cannot say which version it is", async () => {
    const { service, store } = build({
      plan: () => ({ ...goldenPlan(), planner: "llm-v1 - fable" }),
    });

    await expect(
      refusal(async () => service.generate(STORE_ORG, null, body())),
    ).resolves.toMatchObject({
      status: 502,
      code: PLANNING_ERRORS.plannerUnversioned,
    });
    expect(store.batches.size).toBe(0);
  });

  it("refuses a planned cycle, naming it, and stores nothing", async () => {
    const cyclic = goldenPlan();

    cyclic.drafts[0] = { ...cyclic.drafts[0], dependencies: ["OTA-5"] };

    const { service, store } = build({ plan: () => cyclic });

    await expect(
      refusal(async () => service.generate(STORE_ORG, null, body())),
    ).resolves.toMatchObject({
      status: 422,
      code: PUSH_ERRORS.cycle,
      details: { cycle: ["OTA-1", "OTA-3", "OTA-5", "OTA-1"] },
    });
    expect(store.batches.size).toBe(0);
  });

  it("stores an empty body as no body", async () => {
    const empty = goldenPlan();

    empty.drafts[5] = { ...empty.drafts[5], body: "" };

    const { service } = build({ plan: () => empty });
    const batch = await service.generate(STORE_ORG, null, body());

    expect(batch.drafts[5].body).toBeNull();
  });
});

describe("regenerating a batch", () => {
  it("preserves selections by local key and leaves pushed drafts untouched", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    await service.patchDraft(STORE_ORG, batch.id, "OTA-4", { selected: false });
    await service.patchDraft(STORE_ORG, batch.id, "OTA-2", { selected: false });

    const pushed = store.draftByKey(batch.id, "OTA-1");

    store.push(pushed.id, "612");
    await service.patchDraft(STORE_ORG, batch.id, "OTA-1", { selected: true });
    pushed.title = "Partition table — as pushed";

    const regenerated = await service.regenerate(STORE_ORG, batch.id);
    const byKey = new Map(regenerated.drafts.map((draft) => [draft.localKey, draft]));

    expect(byKey.get("OTA-4")?.selected).toBe(false);
    expect(byKey.get("OTA-2")?.selected).toBe(false);
    expect(byKey.get("OTA-3")?.selected).toBe(true);
    // The pushed draft is the same row, with the same title and push state.
    expect(byKey.get("OTA-1")).toMatchObject({
      id: pushed.id,
      title: "Partition table — as pushed",
      pushState: "pushed",
    });
    // OTA-3 still depends on OTA-1, now through the ticket it became.
    expect(byKey.get("OTA-3")?.dependencies).toEqual(["OTA-1", "OTA-2"]);
    expect(regenerated.drafts).toHaveLength(6);
    expect(regenerated.status).toBe("drafting");
  });

  it("starts a key the planner did not produce before checked", async () => {
    let calls = 0;
    const { service } = build({
      plan: () => {
        calls += 1;
        const plan = goldenPlan();

        return calls === 1
          ? {
              ...plan,
              drafts: plan.drafts.slice(0, 5).map((draft) => ({
                ...draft,
                dependencies: draft.dependencies.filter((key) => key !== "OTA-6"),
              })),
            }
          : plan;
      },
    });
    const batch = await service.generate(STORE_ORG, null, body());

    await service.patchDraft(STORE_ORG, batch.id, "OTA-5", { selected: false });

    const regenerated = await service.regenerate(STORE_ORG, batch.id);

    expect(regenerated.drafts.find((draft) => draft.localKey === "OTA-6")?.selected).toBe(true);
    expect(regenerated.drafts.find((draft) => draft.localKey === "OTA-5")?.selected).toBe(false);
  });

  it("re-sizes the new drafts when auto-size is on", async () => {
    const { service, sized } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    sized.length = 0;
    await service.regenerate(STORE_ORG, batch.id);

    expect(sized).toHaveLength(6);
  });

  it.each(["pushed", "abandoned"] as const)("refuses a %s batch", async (status) => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    const stored = store.batches.get(batch.id);

    if (stored === undefined) {
      throw new Error("the batch was not stored");
    }

    store.batches.set(batch.id, { ...stored, status });

    await expect(
      refusal(async () => service.regenerate(STORE_ORG, batch.id)),
    ).resolves.toMatchObject({
      status: 409,
      code: PLANNING_ERRORS.batchNotEditable,
    });
  });

  it("re-plans a batch whose push stopped short, when no push is running", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());
    const stored = store.batches.get(batch.id);

    if (stored === undefined) {
      throw new Error("the batch was not stored");
    }

    store.push(store.draftByKey(batch.id, "OTA-1").id, "612");
    store.batches.set(batch.id, { ...stored, status: "pushing" });

    const regenerated = await service.regenerate(STORE_ORG, batch.id);

    expect(regenerated.status).toBe("drafting");
    expect(regenerated.drafts[0].pushState).toBe("pushed");
  });

  it("refuses while this process is pushing the batch", async () => {
    const { service } = build({ pushing: true });
    const batch = await service.generate(STORE_ORG, null, body());

    await expect(
      refusal(async () => service.regenerate(STORE_ORG, batch.id)),
    ).resolves.toMatchObject({
      status: 409,
      details: { status: "pushing" },
    });
  });

  it("answers another workspace's batch as not found", async () => {
    const { service } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    await expect(
      refusal(async () => service.regenerate(OTHER_ORG, batch.id)),
    ).resolves.toMatchObject({
      status: 404,
      code: PUSH_ERRORS.batchNotFound,
    });
  });
});

describe("editing a draft", () => {
  it("marks a title or body edit as edited, and a selection as nothing", async () => {
    const { service } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    const selected = await service.patchDraft(STORE_ORG, batch.id, "OTA-2", { selected: false });

    expect(selected.drafts[1]).toMatchObject({ selected: false, provenance: "planned" });

    const edited = await service.patchDraft(STORE_ORG, batch.id, "OTA-2", {
      title: "SHA-256 verification before swap",
      body: null,
    });

    expect(edited.drafts[1]).toMatchObject({
      title: "SHA-256 verification before swap",
      body: null,
      provenance: "edited",
    });
  });

  it("refuses the issue's cycle — OTA-3 blocked by OTA-5 — naming it", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());
    const before = store.edgeRows.length;

    await expect(
      refusal(async () =>
        service.patchDraft(STORE_ORG, batch.id, "OTA-3", { dependencies: ["OTA-5"] }),
      ),
    ).resolves.toEqual({
      status: 422,
      code: PUSH_ERRORS.cycle,
      message:
        "This batch's dependencies form a cycle (OTA-3 → OTA-5 → OTA-3), so no ticket of it can go first.",
      details: { batchId: batch.id, cycle: ["OTA-3", "OTA-5", "OTA-3"] },
    });
    expect(store.edgeRows).toHaveLength(before);
  });

  it("replaces the blocked-by set, and clears it with an empty list", async () => {
    const { service } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    const rewired = await service.patchDraft(STORE_ORG, batch.id, "OTA-6", {
      dependencies: ["OTA-5", "OTA-2"],
    });

    expect(rewired.drafts[5].dependencies).toEqual(["OTA-2", "OTA-5"]);

    const cleared = await service.patchDraft(STORE_ORG, batch.id, "OTA-5", { dependencies: [] });

    expect(cleared.drafts[4].dependencies).toEqual([]);
  });

  it("refuses an unknown key and a self-reference", async () => {
    const { service } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    await expect(
      refusal(async () =>
        service.patchDraft(STORE_ORG, batch.id, "OTA-3", { dependencies: ["OTA-9"] }),
      ),
    ).resolves.toMatchObject({ status: 422, code: PLANNING_ERRORS.unknownDependency });
    await expect(
      refusal(async () =>
        service.patchDraft(STORE_ORG, batch.id, "OTA-3", { dependencies: ["OTA-3"] }),
      ),
    ).resolves.toMatchObject({ status: 422, code: PLANNING_ERRORS.selfDependency });
  });

  it("refuses a key the batch does not hold", async () => {
    const { service } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    await expect(
      refusal(async () => service.patchDraft(STORE_ORG, batch.id, "OTA-99", { selected: false })),
    ).resolves.toMatchObject({ status: 404, code: PLANNING_ERRORS.draftNotFound });
  });

  it("refuses an edit to a pushed draft, but lets its selection change", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    store.push(store.draftByKey(batch.id, "OTA-1").id, "612");

    await expect(
      refusal(async () => service.patchDraft(STORE_ORG, batch.id, "OTA-1", { title: "Renamed" })),
    ).resolves.toMatchObject({ status: 409, code: PLANNING_ERRORS.draftPushed });
    await expect(
      service.patchDraft(STORE_ORG, batch.id, "OTA-1", { selected: false }),
    ).resolves.toBeDefined();
  });

  it("wires a dependency on a pushed draft to the ticket it became", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());
    const ticketId = store.push(store.draftByKey(batch.id, "OTA-4").id, "615");

    const rewired = await service.patchDraft(STORE_ORG, batch.id, "OTA-6", {
      dependencies: ["OTA-4"],
    });

    expect(rewired.drafts[5].dependencies).toEqual(["OTA-4"]);
    expect(
      store.edgeRows.some(
        (edge) =>
          edge.blockedDraftId === store.draftByKey(batch.id, "OTA-6").id &&
          edge.blockerTicketId === ticketId,
      ),
    ).toBe(true);
  });

  it("keeps drafting and sized truthful as the selection moves", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body({ autoSize: false }));
    const drafts = [...store.draftRows.values()];

    drafts
      .slice(0, 5)
      .forEach((draft) => store.estimates.set(draft.id, { effort: "s", estMinutes: 60 }));

    await service.patchDraft(STORE_ORG, batch.id, "OTA-6", { selected: false });
    expect(store.batches.get(batch.id)?.status).toBe("sized");

    await service.patchDraft(STORE_ORG, batch.id, "OTA-6", { selected: true });
    expect(store.batches.get(batch.id)?.status).toBe("drafting");
  });
});

describe("pushing a batch", () => {
  it("pushes through AL.3 and runs the queue-small hook when the toggle is on", async () => {
    const { service, pusher, queueSmall } = build();
    const batch = await service.generate(STORE_ORG, null, body({ queueSmall: true }));

    const result = await service.push(STORE_ORG, batch.id);

    expect(pusher.push).toHaveBeenCalledWith(STORE_ORG, batch.id);
    expect(queueSmall.run).toHaveBeenCalledTimes(1);
    expect(result.queueSmall).toEqual({ queued: ["OTA-6"], skipped: [] });
  });

  it("answers queueSmall null when the toggle is off", async () => {
    const { service, queueSmall } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    const result = await service.resume(STORE_ORG, batch.id);

    expect(result.queueSmall).toBeNull();
    expect(queueSmall.run).not.toHaveBeenCalled();
  });

  it("finds the batch in the workspace before anything is pushed", async () => {
    const { service, pusher } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    await expect(refusal(async () => service.push(OTHER_ORG, batch.id))).resolves.toMatchObject({
      status: 404,
    });
    expect(pusher.push).not.toHaveBeenCalled();
  });

  it("reports per-draft push states", async () => {
    const { service, store } = build();
    const batch = await service.generate(STORE_ORG, null, body());

    store.push(store.draftByKey(batch.id, "OTA-2").id, "613");

    const status = await service.pushStatus(STORE_ORG, batch.id);

    expect(status).toMatchObject({ batchId: batch.id, status: "drafting", pushing: false });
    expect(status.drafts[1]).toEqual({
      localKey: "OTA-2",
      selected: true,
      pushState: "pushed",
      pushedTicketId: "ticket-613",
      pushedTicket: {
        externalId: "613",
        externalKey: "#613",
        url: "https://github.com/acme-robotics/helios-firmware/issues/613",
      },
      pushError: null,
    });
  });
});

describe("listing milestones", () => {
  it("passes the tracker's milestones through", async () => {
    const { service, listMilestones } = build();

    await expect(service.milestones(STORE_ORG, STORE_SOURCE.sourceId)).resolves.toEqual({
      sourceId: STORE_SOURCE.sourceId,
      supported: true,
      milestones: [{ externalRef: "3", name: "Helios 2.1" }],
    });
    expect(listMilestones).toHaveBeenCalledTimes(1);
  });

  it("answers unsupported without asking a tracker that has none", async () => {
    const { service, listMilestones } = build({ milestones: false });

    await expect(service.milestones(STORE_ORG, STORE_SOURCE.sourceId)).resolves.toEqual({
      sourceId: STORE_SOURCE.sourceId,
      supported: false,
      milestones: [],
    });
    expect(listMilestones).not.toHaveBeenCalled();
  });

  it("answers another workspace's source as not found", async () => {
    const { service } = build();

    await expect(
      refusal(async () => service.milestones(OTHER_ORG, STORE_SOURCE.sourceId)),
    ).resolves.toMatchObject({ status: 404, code: PLANNING_ERRORS.sourceNotFound });
  });
});

describe("prefixOf", () => {
  it.each([
    [["OTA-1", "OTA-2"], "OTA"],
    [["hand-seeded", "HEL2-4"], "HEL2"],
    [["hand-seeded"], undefined],
  ])("reads %j as %s", (keys, prefix) => {
    expect(prefixOf(keys)).toBe(prefix);
  });
});
