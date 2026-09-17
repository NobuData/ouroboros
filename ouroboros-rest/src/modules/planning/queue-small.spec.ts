import { Logger } from "@nestjs/common";

import { queueIssuesConflict, queueIssuesNotQueueable } from "../backlog/queue.errors";
import type { BacklogQueueService } from "../backlog/queue.service";
import { NotFoundError } from "../errors/error.envelope";
import type { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { BatchRow } from "./planning.repository";
import { PlanningStore, STORE_ORG, STORE_SOURCE } from "./planning.store.fixture";
import { QueueSmallHook, issueProblemsOf, reasonFor } from "./queue-small";

/**
 * The `queue_small` hook (AL.4, #280; decision N7). The criterion: *pushed XS/S tickets route
 * through INTAKE-M.3, with its sized-only rule enforced* — so the hook's only write is M.3's own
 * `queueSelection`, and what M.3 would refuse is reported rather than queued another way.
 */

/**
 * A batch with pushed drafts of the given efforts.
 *
 * @param efforts - One effort (or null) per pushed draft, OTA-1 onwards.
 * @returns The store, the batch, and the queue stand-in.
 */
function build(efforts: ("xs" | "s" | "m" | "l" | "xl" | null)[]) {
  const store = new PlanningStore();
  const batch: BatchRow = {
    id: "batch-1",
    organizationId: STORE_ORG,
    status: "pushed",
    planner: "outline-v0",
    prompt: "p",
    outline: null,
    targetMilestone: null,
    epicId: null,
    autoSize: true,
    queueSmall: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    source: STORE_SOURCE,
  };

  store.batches.set(batch.id, batch);
  efforts.forEach((effort, index) => {
    const id = `draft-${String(index + 1)}`;

    store.draftRows.set(id, {
      id,
      batchId: batch.id,
      localKey: `OTA-${String(index + 1)}`,
      title: "t",
      body: null,
      selected: true,
      suggestedWorkflow: "feature-loop",
      provenance: "planned",
      pushState: "pending",
      pushedTicketId: null,
      externalId: null,
    });
    store.push(id, String(610 + index));

    if (effort !== null) {
      store.estimates.set(id, { effort, estMinutes: 30 });
    }
  });

  const queueSelection = jest.fn(async (_org: string, _body: { issueIds: string[] }) =>
    Promise.resolve({ items: [], estMinutes: 0 }),
  );
  const repoNames: unknown[] = [];
  const registry = {
    find: () => ({
      capabilities: () => ({ write: { createTicket: true } }),
      pushTargetName: (config: unknown) => {
        repoNames.push(config);
        return "acme-robotics/helios-firmware";
      },
    }),
  } as unknown as TicketSourceRegistry;
  const hook = new QueueSmallHook(store.asRepository(), registry, {
    queueSelection,
  } as unknown as BacklogQueueService);

  return { store, batch, hook, queueSelection };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

describe("QueueSmallHook", () => {
  it("queues only the XS/S tickets that are mirrored and sized, through M.3", async () => {
    const { store, batch, hook, queueSelection } = build(["xs", "m", "s", null]);

    store.mirrored = [
      { id: "issue-610", number: 610, sizingStatus: "sized" },
      { id: "issue-611", number: 611, sizingStatus: "sized" },
      { id: "issue-612", number: 612, sizingStatus: "sized" },
    ];

    await expect(hook.run(batch)).resolves.toEqual({ queued: ["OTA-1", "OTA-3"], skipped: [] });
    expect(queueSelection).toHaveBeenCalledTimes(1);
    expect(queueSelection).toHaveBeenCalledWith(STORE_ORG, {
      issueIds: ["issue-610", "issue-612"],
    });
  });

  it("reports a small ticket the sync has not mirrored yet, and one not sized yet", async () => {
    const { store, batch, hook, queueSelection } = build(["xs", "s"]);

    store.mirrored = [{ id: "issue-611", number: 611, sizingStatus: "estimating" }];

    await expect(hook.run(batch)).resolves.toEqual({
      queued: [],
      skipped: [
        { localKey: "OTA-1", reason: "not_yet_mirrored" },
        { localKey: "OTA-2", reason: "not_sized" },
      ],
    });
    // M.3's sized-only rule is never bypassed: nothing unsized reaches the write.
    expect(queueSelection).not.toHaveBeenCalled();
  });

  it("does nothing at all when no pushed ticket is small", async () => {
    const { batch, hook, queueSelection } = build(["m", "xl", null]);

    await expect(hook.run(batch)).resolves.toEqual({ queued: [], skipped: [] });
    expect(queueSelection).not.toHaveBeenCalled();
  });

  it("moves what M.3 refuses to skipped and queues the rest", async () => {
    const { store, batch, hook, queueSelection } = build(["xs", "s", "xs"]);

    store.mirrored = [610, 611, 612].map((number) => ({
      id: `issue-${String(number)}`,
      number,
      sizingStatus: "sized",
    }));
    queueSelection
      .mockRejectedValueOnce(
        queueIssuesNotQueueable([{ issueId: "issue-610", code: "issue_estimate_missing" }]),
      )
      .mockRejectedValueOnce(
        queueIssuesConflict([{ issueId: "issue-611", code: "issue_already_queued" }]),
      );

    await expect(hook.run(batch)).resolves.toEqual({
      queued: ["OTA-3"],
      skipped: [
        { localKey: "OTA-1", reason: "not_sized" },
        { localKey: "OTA-2", reason: "already_queued" },
      ],
    });
    expect(queueSelection).toHaveBeenLastCalledWith(STORE_ORG, { issueIds: ["issue-612"] });
  });

  it("throws a refusal M.3 did not explain per issue", async () => {
    const { store, batch, hook, queueSelection } = build(["xs"]);

    store.mirrored = [{ id: "issue-610", number: 610, sizingStatus: "sized" }];
    queueSelection.mockRejectedValueOnce(new Error("the pool is exhausted"));

    await expect(hook.run(batch)).rejects.toThrow("the pool is exhausted");
  });

  it("stops rather than loops when M.3 names issues it was not asked about", async () => {
    const { store, batch, hook, queueSelection } = build(["xs"]);

    store.mirrored = [{ id: "issue-610", number: 610, sizingStatus: "sized" }];
    queueSelection.mockRejectedValue(
      queueIssuesConflict([{ issueId: "somebody-else", code: "issue_already_queued" }]),
    );

    await expect(hook.run(batch)).rejects.toThrow("did not name");
  });
});

describe("issueProblemsOf", () => {
  it("reads M.3's per-issue refusals, and nothing else", () => {
    expect(
      issueProblemsOf(queueIssuesConflict([{ issueId: "a", code: "issue_number_taken" }])),
    ).toEqual([{ issueId: "a", code: "issue_number_taken" }]);
    expect(
      issueProblemsOf(new NotFoundError("queue_issues_not_found", "x", { issues: [] })),
    ).toBeUndefined();
    expect(issueProblemsOf(new Error("x"))).toBeUndefined();
  });
});

describe("reasonFor", () => {
  it.each([
    ["issue_already_queued", "already_queued"],
    ["issue_number_taken", "already_queued"],
    ["issue_not_sized", "not_sized"],
    ["issue_estimate_missing", "not_sized"],
  ] as const)("reads %s as %s", (code, reason) => {
    expect(reasonFor({ issueId: "a", code })).toBe(reason);
  });
});
