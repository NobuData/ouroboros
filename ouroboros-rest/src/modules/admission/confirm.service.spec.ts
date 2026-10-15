import {
  QUEUE_ITEM_CONFIRMED_EVENT,
  WORKSPACE_LIVE_CEILING_CHANGED_EVENT,
} from "../audit/audit.events";
import { InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import { admissionStub, queueItemRow } from "./admission.fixture";
import { ConfirmService } from "./confirm.service";

const ORG = "acme-robotics-id";
const NOW = new Date("2026-10-15T09:30:00.000Z");

/**
 * A confirm service over stand-ins.
 *
 * @param options - What the store answers, and the deployment's limits.
 * @returns The service and its stand-ins.
 */
function rig(
  options: {
    confirmed?: { item: ReturnType<typeof queueItemRow>; changed: boolean } | undefined;
    ceiling?: number;
    ceilingMax?: number;
  } = {},
) {
  const store = {
    db: "pool",
    confirm: jest
      .fn()
      .mockResolvedValue(
        "confirmed" in options
          ? options.confirmed
          : { item: queueItemRow({ confirmed_at: NOW }), changed: true },
      ),
    ceiling: jest.fn().mockResolvedValue(options.ceiling ?? 1),
    saveCeiling: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    liveExecutionEnabled: true,
    liveRunCeilingMax: options.ceilingMax ?? 4,
    liveRunWallClockMinutes: 120,
    liveRunNoProgressMinutes: 15,
  };
  const audit = { record: jest.fn().mockResolvedValue("audit-1") };
  const service = new ConfirmService(store as never, admissionStub(), config as never, audit, () =>
    NOW.getTime(),
  );

  return { service, store, audit };
}

describe("confirming a queued item", () => {
  it("stamps the item in the confirmer's name and answers its summary", async () => {
    const { service, store } = rig();

    const summary = await service.confirm(ORG, "item-1", "user-1");

    expect(store.confirm).toHaveBeenCalledWith(ORG, "item-1", "user-1", NOW);
    expect(summary).toMatchObject({
      issueNumber: 482,
      confirmedAt: NOW.toISOString(),
      waiting: null,
    });
  });

  it("writes queue_item.confirmed once, naming the issue", async () => {
    const { service, audit } = rig();
    const item = queueItemRow();

    await service.confirm(ORG, item.id, "user-1");

    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: "user-1",
      action: QUEUE_ITEM_CONFIRMED_EVENT,
      subjectType: "queue_item",
      subjectId: item.id,
      at: NOW,
      detail: { repository: item.github_repo_id, issueNumber: 482, workflow: "standard-fix" },
    });
  });

  it("writes nothing to the trail when the item was already confirmed", async () => {
    const { service, audit } = rig({ confirmed: { item: queueItemRow(), changed: false } });

    await service.confirm(ORG, "item-1", "user-1");

    expect(audit.record).not.toHaveBeenCalled();
  });

  it("answers 404 queue_item_not_found for no such item", async () => {
    const { service, audit } = rig({ confirmed: undefined });

    const refusal = service.confirm(ORG, "item-1", "user-1");

    await expect(refusal).rejects.toBeInstanceOf(NotFoundError);
    await expect(refusal).rejects.toMatchObject({ code: "queue_item_not_found" });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("the live-execution settings", () => {
  it("answers the workspace's ceiling beside the deployment's limits", async () => {
    const { service } = rig({ ceiling: 6, ceilingMax: 4 });

    await expect(service.settings(ORG)).resolves.toEqual({
      deploymentEnabled: true,
      ceiling: 6,
      ceilingMax: 4,
      effectiveCeiling: 4,
      wallClockMinutes: 120,
      noProgressMinutes: 15,
    });
  });

  it("sets a new ceiling and records before and after", async () => {
    const { service, store, audit } = rig({ ceiling: 1 });

    await service.setCeiling(ORG, 3, "user-1");

    expect(store.saveCeiling).toHaveBeenCalledWith(ORG, 3, "user-1");
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: "user-1",
      action: WORKSPACE_LIVE_CEILING_CHANGED_EVENT,
      subjectType: "workspace",
      subjectId: ORG,
      at: NOW,
      detail: { before: 1, after: 3 },
    });
  });

  it("writes nothing when the ceiling is already that", async () => {
    const { service, store, audit } = rig({ ceiling: 2 });

    await service.setCeiling(ORG, 2, "user-1");

    expect(store.saveCeiling).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("refuses a ceiling above the deployment's maximum, writing nothing", async () => {
    const { service, store } = rig({ ceilingMax: 4 });

    const refusal = service.setCeiling(ORG, 5, "user-1");

    await expect(refusal).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(refusal).rejects.toMatchObject({
      code: "live_ceiling_above_max",
      details: { requested: 5, maximum: 4 },
    });
    expect(store.saveCeiling).not.toHaveBeenCalled();
  });
});
