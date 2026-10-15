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
    ...overrides,
  };
}

const REQUEST: ClaimQueueItemDto = {
  idempotencyKey: "worker-a-claim-1",
  workspace: "acme-robotics",
  worker: "engine-worker-a",
};

/**
 * A claim service over stand-ins.
 *
 * @param options - The switch, the workspace's state, what the queue holds.
 * @returns The service and its repository stand-in.
 */
function rig(
  options: {
    live?: boolean;
    state?: WorkspaceLifecycleState;
    workspace?: string | undefined;
    head?: QueueItem | undefined;
    leasedBy?: QueueItem | undefined;
    ticket?: typeof TICKET | undefined;
  } = {},
) {
  const repository = {
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work("trx")),
    workspaceId: jest.fn().mockResolvedValue("workspace" in options ? options.workspace : ORG),
    leasedBy: jest.fn().mockResolvedValue(options.leasedBy),
    releaseLease: jest.fn().mockResolvedValue(undefined),
    claimableHead: jest.fn().mockResolvedValue("head" in options ? options.head : item()),
    lease: jest.fn(async (_trx: unknown, id: string, lease: Partial<QueueItem>) =>
      Promise.resolve(item({ id, ...lease })),
    ),
    ticketOfQueuedIssue: jest.fn().mockResolvedValue("ticket" in options ? options.ticket : TICKET),
  };
  const config = {
    liveExecutionEnabled: options.live ?? true,
    queueClaimLeaseSeconds: 300,
  } as AppConfigService;
  const states = {
    stateOf: jest.fn().mockResolvedValue(options.state ?? "active"),
  } as unknown as WorkspaceStateReader;
  const service = new QueueClaimService(repository as unknown as IngestRepository, config, states);

  return { service, repository };
}

describe("claiming the head of a workspace's queue (#91)", () => {
  it("leases the head to the worker for the configured lease and answers what opening it needs", async () => {
    const { service, repository } = rig();

    const claimed = await service.claim(REQUEST, NOW);

    expect(repository.workspaceId).toHaveBeenCalledWith("trx", "acme-robotics");
    expect(repository.claimableHead).toHaveBeenCalledWith("trx", ORG, NOW);
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
    });
  });

  it("answers nothing when the queue holds nothing claimable", async () => {
    const { service, repository } = rig({ head: undefined });

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
      const { service, repository } = rig({ state });

      await expect(service.claim(REQUEST, NOW)).rejects.toMatchObject({ code });
      expect(repository.claimableHead).not.toHaveBeenCalled();
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
      const { service, repository } = rig({ leasedBy: held });

      const claimed = await service.claim(REQUEST, NOW);

      expect(claimed?.id).toBe(held.id);
      expect(claimed?.claimToken).toBe("0b6a1c55-3f2e-4a7d-9c1e-2d8f4b6a9e10");
      expect(repository.claimableHead).not.toHaveBeenCalled();
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
