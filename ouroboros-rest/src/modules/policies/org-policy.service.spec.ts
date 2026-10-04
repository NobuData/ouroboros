import type { AuditRecord } from "../audit/audit.events";
import type { OrgPolicies, OrgPoliciesEffective } from "../db/schema";
import type { DryRunFlip, OrgPolicyStore } from "./org-policy.repository";
import { DRY_RUN_REASON } from "./org-policy.rules";
import { DRY_RUN_CACHE_TTL_MS, OrgPolicyService, dryRunPolicyResource } from "./org-policy.service";

/**
 * The dry-run policy's one source (BA.3, #382): off for a workspace that never answered (onboarding
 * completion turns it on), caches reads and busts the cache on every write, and audits each flip
 * with its actor, instant and prior value.
 */

const ORG = "org-dry";
const ACTOR = "user-owner";
const AT = new Date("2026-09-30T12:00:00.000Z");

/** An effective row. */
function effective(dryRun: boolean, explicit = true): OrgPoliciesEffective {
  return {
    organization_id: ORG,
    dry_run: dryRun,
    is_explicit: explicit,
    updated_at: explicit ? AT : null,
    updated_by: explicit ? ACTOR : null,
  };
}

/** A stored row after a flip. */
function stored(dryRun: boolean): OrgPolicies {
  return {
    organization_id: ORG,
    dry_run: dryRun,
    updated_by: ACTOR,
    created_at: AT,
    updated_at: AT,
    current_version: null,
  };
}

describe("the org policy service", () => {
  let store: jest.Mocked<OrgPolicyStore>;
  let audit: { record: jest.Mock<Promise<string>, [AuditRecord]> };
  let clock: number;
  let service: OrgPolicyService;

  beforeEach(() => {
    store = {
      effective: jest.fn().mockResolvedValue(effective(true)),
      adoptDefault: jest.fn().mockResolvedValue(true),
      setDryRun: jest.fn(),
    };
    audit = { record: jest.fn<Promise<string>, [AuditRecord]>().mockResolvedValue("event-1") };
    clock = 1_000;
    service = new OrgPolicyService(store, audit, () => clock);
  });

  describe("the resource", () => {
    it("is off for a workspace the view has no row for — nothing changes for it at deploy", () => {
      expect(dryRunPolicyResource(undefined)).toEqual({
        dryRun: false,
        explicit: false,
        reason: null,
        updatedAt: null,
        updatedBy: null,
      });
    });

    it("carries the designed reason while active", () => {
      expect(dryRunPolicyResource(effective(true))).toMatchObject({
        dryRun: true,
        reason: DRY_RUN_REASON,
      });
    });

    it("carries no reason once dry-run is off", () => {
      expect(dryRunPolicyResource(effective(false))).toEqual({
        dryRun: false,
        explicit: true,
        reason: null,
        updatedAt: AT.toISOString(),
        updatedBy: ACTOR,
      });
    });
  });

  describe("reads", () => {
    it("answers a workspace that never answered as the view reads it", async () => {
      store.effective.mockResolvedValue(effective(false, false));

      await expect(service.read(ORG)).resolves.toMatchObject({ dryRun: false, explicit: false });
    });

    it("caches the enforcement read within the TTL", async () => {
      await expect(service.dryRun(ORG)).resolves.toBe(true);
      store.effective.mockResolvedValue(effective(false));
      clock += DRY_RUN_CACHE_TTL_MS - 1;

      await expect(service.dryRun(ORG)).resolves.toBe(true);
      expect(store.effective).toHaveBeenCalledTimes(1);
    });

    it("reads again once the TTL has passed", async () => {
      await service.dryRun(ORG);
      store.effective.mockResolvedValue(effective(false));
      clock += DRY_RUN_CACHE_TTL_MS;

      await expect(service.dryRun(ORG)).resolves.toBe(false);
    });

    it("never answers the execution re-check from the cache", async () => {
      await service.dryRun(ORG);
      store.effective.mockResolvedValue(effective(false));

      await expect(service.dryRunNow(ORG)).resolves.toBe(false);
      expect(store.effective).toHaveBeenCalledTimes(2);
    });
  });

  describe("the flip", () => {
    it("persists, busts the cache and audits actor, instant and prior value", async () => {
      await service.dryRun(ORG);
      const flip: DryRunFlip = { row: stored(false), previous: true, previousExplicit: false };
      store.setDryRun.mockResolvedValue(flip);

      const resource = await service.setDryRun(ORG, ACTOR, false);

      expect(store.setDryRun).toHaveBeenCalledWith(ORG, false, ACTOR);
      expect(resource).toEqual({
        dryRun: false,
        explicit: true,
        reason: null,
        updatedAt: AT.toISOString(),
        updatedBy: ACTOR,
      });
      expect(audit.record).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: ACTOR,
        action: "policy.dry_run_changed",
        subjectType: "org_policy",
        subjectId: ORG,
        at: AT,
        detail: { dry_run: false, previous: true, previous_explicit: false },
      });

      // Enforcement lifts at once in this process: the next read is the database's.
      store.effective.mockResolvedValue(effective(false));
      await expect(service.dryRun(ORG)).resolves.toBe(false);
    });

    it("propagates an audit failure — an unaudited flip is not a success", async () => {
      store.setDryRun.mockResolvedValue({
        row: stored(false),
        previous: true,
        previousExplicit: true,
      });
      audit.record.mockRejectedValue(new Error("audit down"));

      await expect(service.setDryRun(ORG, ACTOR, false)).rejects.toThrow("audit down");
    });
  });

  describe("the onboarding default", () => {
    it("writes through the store and busts the cache", async () => {
      store.effective.mockResolvedValue(effective(false));
      await service.dryRun(ORG);

      await expect(service.adoptDefault(ORG)).resolves.toBe(true);
      expect(store.adoptDefault).toHaveBeenCalledWith(ORG);

      await service.dryRun(ORG);
      expect(store.effective).toHaveBeenCalledTimes(2);
    });

    it("reports an explicit answer left alone", async () => {
      store.adoptDefault.mockResolvedValue(false);

      await expect(service.adoptDefault(ORG)).resolves.toBe(false);
    });
  });
});
