import { ConflictError } from "../errors/error.envelope";
import type { AdmitNext } from "../admission/admission.service";
import type { AppConfigService } from "../config/config.service";
import type { QueueItem, WorkspaceLifecycleState } from "../db/schema";
import type { WorkspaceStateReader } from "../lifecycle/lifecycle.state";
import type { ClaimQueueItemDto } from "./ingest.dto";
import type { IngestRepository } from "./ingest.repository";
import { QueueClaimService } from "./queue-claim.service";

const ORG = "org-acme";
const NOW = new Date("2026-10-15T14:25:00.000Z");
const TICKET = { source: "8f14e45f-ceea-467a-9f0a-4a1c7c3b2d55", externalKey: "#482" };

/** A queue item, unheld unless overridden. */
function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "5eed0008-0000-4000-8000-000000000001",
    organization_id: ORG,
    github_repo_id: "5eed0003-0000-4000-8000-000000000001",
    issue_number: 482,
    issue_title: "Fix flaky CAN-bus telemetry test",
    effort: "m",
    workflow_tag: "standard-fix",
    workflow_version: 14,
    workflow_pin_reason: null,
    playbook_id: null,
    position: 1,
    est_minutes: 90,
    enqueued_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    claimed_at: null,
    claim_expires_at: null,
    claimed_by: null,
    claim_token: null,
    claim_key: null,
    confirmed_at: null,
    confirmed_by: null,
    ...overrides,
  };
}

/** The pinned version's document, as `workflow_versions.definition` stores it. */
const PINNED = { dsl_version: 1, trigger: { kind: "always" }, nodes: [], edges: [] };

const REQUEST: ClaimQueueItemDto = {
  idempotencyKey: "worker-a-claim-1",
  workspace: "acme-robotics",
  worker: "engine-worker-a",
};

/**
 * A claim service over stand-ins.
 *
 * @param options - The switch, the workspace's state, the executors the engine reports, and
 *   what admission decides.
 * @returns The service, its repository stand-in and its admission stand-in.
 */
function rig(
  options: {
    live?: boolean;
    state?: WorkspaceLifecycleState;
    workspace?: string | undefined;
    executors?: number;
    admitted?: AdmitNext;
    leasedBy?: QueueItem | undefined;
    ticket?: typeof TICKET | undefined;
  } = {},
) {
  const repository = {
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work("trx")),
    workspaceId: jest.fn().mockResolvedValue("workspace" in options ? options.workspace : ORG),
    leasedBy: jest.fn().mockResolvedValue(options.leasedBy),
    releaseLease: jest.fn().mockResolvedValue(undefined),
    lease: jest.fn(async (_trx: unknown, id: string, lease: Partial<QueueItem>) =>
      Promise.resolve(item({ id, ...lease })),
    ),
    ticketOfQueuedIssue: jest.fn().mockResolvedValue("ticket" in options ? options.ticket : TICKET),
    pinnedDefinition: jest.fn().mockResolvedValue({ definition: PINNED }),
  };
  const config = {
    liveExecutionEnabled: options.live ?? true,
    queueClaimLeaseSeconds: 300,
  } as AppConfigService;
  const states = {
    stateOf: jest.fn().mockResolvedValue(options.state ?? "active"),
  } as unknown as WorkspaceStateReader;
  const admission = {
    executorCount: jest.fn().mockResolvedValue(options.executors ?? 1),
    admitNext: jest
      .fn()
      .mockResolvedValue(options.admitted ?? ({ refused: null, item: item() } as AdmitNext)),
    modelFor: jest.fn().mockResolvedValue("coder-max"),
  };
  const service = new QueueClaimService(
    repository as unknown as IngestRepository,
    config,
    states,
    admission,
  );

  return { service, repository, admission };
}

describe("claiming the head of a workspace's queue (#91)", () => {
  it("leases the head to the worker for the configured lease and answers what opening it needs", async () => {
    const { service, repository, admission } = rig();

    const claimed = await service.claim(REQUEST, NOW);

    expect(repository.workspaceId).toHaveBeenCalledWith("trx", "acme-robotics");
    expect(admission.admitNext).toHaveBeenCalledWith("trx", ORG, NOW, 1);
    const lease = repository.lease.mock.calls[0][2];
    expect(lease).toMatchObject({
      claimed_at: NOW,
      claim_expires_at: new Date("2026-10-15T14:30:00.000Z"),
      claimed_by: "engine-worker-a",
      claim_key: "worker-a-claim-1",
    });
    expect(lease.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(claimed).toEqual({
      id: "5eed0008-0000-4000-8000-000000000001",
      claimToken: lease.claim_token,
      expiresAt: "2026-10-15T14:30:00.000Z",
      organizationId: ORG,
      repository: "5eed0003-0000-4000-8000-000000000001",
      issueNumber: 482,
      issueTitle: "Fix flaky CAN-bus telemetry test",
      workflow: { tag: "standard-fix", version: 14 },
      playbookId: null,
      ticket: TICKET,
      model: "coder-max",
    });
  });

  it("names the model from the item's pinned workflow version (#160)", async () => {
    const { service, repository, admission } = rig();

    await service.claim(REQUEST, NOW);

    expect(repository.pinnedDefinition).toHaveBeenCalledWith("trx", ORG, "standard-fix", 14);
    expect(admission.modelFor).toHaveBeenCalledWith(ORG, PINNED);
  });

  it("asks for the model with no definition when the item has no pin", async () => {
    const { service, repository, admission } = rig({
      admitted: { refused: null, item: item({ workflow_version: null }) },
    });
    repository.lease.mockImplementationOnce(async (_trx, id, lease) =>
      Promise.resolve(item({ id, ...lease, workflow_version: null })),
    );

    const claimed = await service.claim(REQUEST, NOW);

    expect(repository.pinnedDefinition).not.toHaveBeenCalled();
    expect(admission.modelFor).toHaveBeenCalledWith(ORG, undefined);
    expect(claimed?.workflow.version).toBeNull();
  });

  it("answers nothing when admission admits no item", async () => {
    const { service, repository } = rig({ admitted: { refused: null, item: undefined } });

    await expect(service.claim(REQUEST, NOW)).resolves.toBeUndefined();
    expect(repository.lease).not.toHaveBeenCalled();
  });

  it("says when the issue has no mirrored ticket, so the worker lets the lease run out", async () => {
    const { service } = rig({ ticket: undefined });

    expect((await service.claim(REQUEST, NOW))?.ticket).toBeNull();
  });

  describe("admission", () => {
    it("refuses every claim while the deployment does not run live loops", async () => {
      const { service, repository } = rig({ live: false });

      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({
        code: "deployment_disabled",
      });
      expect(repository.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ["paused", "workspace_paused"],
      ["pending_delete", "workspace_pending_delete"],
    ] as const)("refuses a claim in a %s workspace", async (state, code) => {
      const { service, admission } = rig({ state });

      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({ code });
      expect(admission.admitNext).not.toHaveBeenCalled();
    });

    it("refuses while the engine has registered no stage executor (#1312)", async () => {
      const { service, admission } = rig({ executors: 0 });

      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({ code: "no_executor" });
      expect(admission.admitNext).not.toHaveBeenCalled();
    });

    it("takes the worker's own word for its executors when it declares them (#1312)", async () => {
      const { service, admission } = rig();

      await service.claim({ ...REQUEST, executors: ["native"] }, NOW);

      expect(admission.executorCount).toHaveBeenCalledWith(["native"]);
    });

    it("refuses with the slots taken when the ceiling is full (#1312)", async () => {
      const { service, repository } = rig({
        admitted: { refused: "concurrency_ceiling", taken: 1, ceiling: 1 },
      });

      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({
        code: "concurrency_ceiling",
        details: { taken: 1, ceiling: 1 },
      });
      expect(repository.lease).not.toHaveBeenCalled();
    });

    it.each([
      ["deployment_disabled", "deployment_disabled"],
      ["workspace_paused", "workspace_paused"],
      ["workspace_pending_delete", "workspace_pending_delete"],
      ["no_executor", "no_executor"],
    ] as const)("answers admission's %s refusal as a 409", async (refused, code) => {
      const { service } = rig({ admitted: { refused, taken: 0, ceiling: 1 } });

      await expect(service.claim(REQUEST, NOW)).rejects.toBeInstanceOf(ConflictError);
      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({ code });
    });

    it("leases the item admission chose, not the head (#1312)", async () => {
      const second = item({ id: "5eed0008-0000-4000-8000-000000000002", position: 2 });
      const { service, repository } = rig({ admitted: { refused: null, item: second } });

      const claimed = await service.claim(REQUEST, NOW);

      expect(repository.lease.mock.calls[0][1]).toBe(second.id);
      expect(claimed?.id).toBe(second.id);
    });

    it("refuses a workspace that does not exist", async () => {
      const { service } = rig({ workspace: undefined });

      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({
        code: "workspace_not_found",
      });
    });
  });

  describe("a replayed claim", () => {
    it("answers the item its key already leases, and takes no other", async () => {
      const held = item({
        id: "5eed0008-0000-4000-8000-000000000002",
        claimed_at: NOW,
        claim_expires_at: new Date("2026-10-15T14:27:00.000Z"),
        claimed_by: "engine-worker-a",
        claim_token: "0b6a1c55-3f2e-4a7d-9c1e-2d8f4b6a9e10",
        claim_key: "worker-a-claim-1",
      });
      const { service, repository, admission } = rig({ leasedBy: held });

      const claimed = await service.claim(REQUEST, NOW);

      expect(claimed?.id).toBe(held.id);
      expect(claimed?.claimToken).toBe("0b6a1c55-3f2e-4a7d-9c1e-2d8f4b6a9e10");
      expect(admission.admitNext).not.toHaveBeenCalled();
      expect(repository.lease).not.toHaveBeenCalled();
    });

    it("lets an expired lease of its key go and leases the head anew", async () => {
      const lapsed = item({
        id: "5eed0008-0000-4000-8000-000000000002",
        claimed_at: new Date("2026-10-15T14:00:00.000Z"),
        claim_expires_at: new Date("2026-10-15T14:05:00.000Z"),
        claimed_by: "engine-worker-a",
        claim_token: "0b6a1c55-3f2e-4a7d-9c1e-2d8f4b6a9e10",
        claim_key: "worker-a-claim-1",
      });
      const { service, repository } = rig({ leasedBy: lapsed });

      await service.claim(REQUEST, NOW);

      expect(repository.releaseLease).toHaveBeenCalledWith("trx", lapsed.id);
      expect(repository.lease).toHaveBeenCalled();
    });
  });
});
