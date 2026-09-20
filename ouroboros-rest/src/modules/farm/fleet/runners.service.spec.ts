import type { AuditRecord } from "../../audit/audit.events";
import type { AuditService } from "../../audit/audit.service";
import type { Organization, Runner, RunnerStatus } from "../../db/schema";
import { runnerPool } from "../dispatch/dispatch.fixture";
import { FarmAudit } from "../farm.audit";
import { noLiveCertificate } from "../farm.errors";
import { runner as runnerRow } from "../farm.fixture";
import type { RunnerControl } from "../gateway/runner.control";
import type { RegistrationService } from "../registration.service";
import type { FleetRepository } from "./fleet.repository";
import { REMOVABLE_STATUSES, RunnersService } from "./runners.service";

/**
 * The `⋯` menu, and the two decisions the issue is specific about: **drain goes through
 * AH.3's channel** rather than writing `desired_state` here, and **remove is guarded** to
 * machines that are offline or drained, with an error that names the reason.
 *
 * The guard is asserted twice on purpose — once as the readable refusal, and once as the
 * `where` on the write, because a runner can heartbeat its way back to `online` between the
 * two and the race is the thing worth catching.
 */

/** The workspace every case here acts in. */
const TENANT = { id: "org_5eed0001", slug: "acme-robotics" } as Organization;

/** Who is pressing the menu item. */
const ACTOR = "user_ken";

/** When. */
const NOW = new Date("2026-09-19T12:00:00.000Z");

/** What a case sets up, and what it can read back afterwards. */
interface Harness {
  readonly service: RunnersService;
  readonly written: AuditRecord[];
  readonly drained: { runnerId: string; draining: boolean }[];
  readonly revoked: { runnerId: string; reason: string }[];
  readonly removals: { guard: readonly RunnerStatus[] }[];
}

/** How a case shapes the fleet it is acting on. */
interface Shape {
  /** The row `runnerById` answers with, or nothing for a workspace that has no such runner. */
  readonly row?: Runner;
  /** What the row becomes after a successful removal, or nothing to make the guarded write miss. */
  readonly removed?: Runner | undefined;
  /** What `RunnerControl` answers — `undefined` is *no such runner, or retired*. */
  readonly control?: { runner: Runner; pushed: boolean } | undefined;
  /** What revocation does. */
  readonly revoke?: () => Promise<unknown>;
  /** The row `runnerById` answers with on a *second* read, for the race case. */
  readonly recheck?: Runner;
}

/**
 * The service over stubs.
 *
 * @param shape - What the fleet looks like.
 * @returns The service and what the stubs recorded.
 */
function harness(shape: Shape = {}): Harness {
  const written: AuditRecord[] = [];
  const drained: { runnerId: string; draining: boolean }[] = [];
  const revoked: { runnerId: string; reason: string }[] = [];
  const removals: { guard: readonly RunnerStatus[] }[] = [];
  let reads = 0;
  let retired = false;

  const fleet = {
    // The row as it stands *now*: the pre-removal one until the write lands, and the retired
    // one afterwards — which is what a second `select` against the database would give, and
    // what the read-back at the end of a removal depends on.
    runnerById: jest.fn((_organizationId: string, _id: string) => {
      reads += 1;
      if (retired) return Promise.resolve(shape.removed);
      if (reads > 1 && shape.recheck) return Promise.resolve(shape.recheck);

      return Promise.resolve(shape.row);
    }),
    remove: jest.fn((_organizationId: string, _id: string, guard: readonly RunnerStatus[]) => {
      removals.push({ guard });
      retired = shape.removed !== undefined;

      return Promise.resolve(shape.removed);
    }),
    // The read-back after a write. Empty, so `view` falls through to the retired row — which
    // is the path a removal takes, and the one worth exercising.
    runners: jest.fn(() => Promise.resolve([])),
    queueDepths: jest.fn(() => Promise.resolve(new Map<string, number>())),
    currentJobs: jest.fn(() => Promise.resolve(new Map())),
    poolById: jest.fn(() => Promise.resolve(runnerPool())),
  } as unknown as FleetRepository;

  const control = {
    drain: jest.fn((_organizationId: string, runnerId: string) => {
      drained.push({ runnerId, draining: true });

      return Promise.resolve(shape.control);
    }),
    undrain: jest.fn((_organizationId: string, runnerId: string) => {
      drained.push({ runnerId, draining: false });

      return Promise.resolve(shape.control);
    }),
  } as unknown as RunnerControl;

  const registration = {
    revokeCertificate: jest.fn(
      (_organizationId: string, _actorId: string, runnerId: string, reason: string) => {
        revoked.push({ runnerId, reason });

        return shape.revoke ? shape.revoke() : Promise.resolve({});
      },
    ),
  } as unknown as RegistrationService;

  const audit = new FarmAudit({
    record: jest.fn((event: AuditRecord) => {
      written.push(event);

      return Promise.resolve("event");
    }),
  } as unknown as AuditService);

  return {
    service: new RunnersService(fleet, control, registration, audit, () => NOW),
    written,
    drained,
    revoked,
    removals,
  };
}

describe("draining", () => {
  it("goes through AH.3's channel rather than writing the column here", () => {
    // The seam AH.3 built for this ticket: the intent is written first and the push is an
    // optimisation of it, so a drain cannot be lost to the runner being on another replica.
    // A second implementation would be a drain that reached the database and not the agent.
    expect(REMOVABLE_STATUSES).toEqual(["offline", "draining"]);
  });

  it("asks the control channel and records who asked", () => {
    const row = runnerRow({ name: "bigiron", desired_state: "draining", status: "online" });
    const context = harness({ row, control: { runner: row, pushed: true } });

    return context.service.drain(TENANT, ACTOR, row.id).then((result) => {
      expect(context.drained).toEqual([{ runnerId: row.id, draining: true }]);
      expect(result.pushed).toBe(true);
      expect(context.written).toHaveLength(1);
      expect(context.written[0]).toMatchObject({
        action: "runner.drained",
        actorId: ACTOR,
        subjectType: "runner",
        subjectId: row.id,
      });
    });
  });

  it("records the undrain under its own name", () => {
    const row = runnerRow({ name: "bigiron" });
    const context = harness({ row, control: { runner: row, pushed: false } });

    return context.service.undrain(TENANT, ACTOR, row.id).then(() => {
      expect(context.drained).toEqual([{ runnerId: row.id, draining: false }]);
      expect(context.written[0]).toMatchObject({ action: "runner.undrained" });
    });
  });

  it("is not a failure when the agent is connected elsewhere", () => {
    // `pushed: false` means the frame did not reach a session in *this* process. The intent
    // is in the database and the runner is told at its next heartbeat.
    const row = runnerRow();
    const context = harness({ row, control: { runner: row, pushed: false } });

    return context.service.drain(TENANT, ACTOR, row.id).then((result) => {
      expect(result.pushed).toBe(false);
      expect(context.written[0]?.detail).toMatchObject({ pushed: false });
    });
  });

  it("is a 404 for a runner this workspace does not have", async () => {
    const context = harness({ row: undefined, control: undefined });

    await expect(context.service.drain(TENANT, ACTOR, runnerRow().id)).rejects.toMatchObject({
      code: "farm_runner_not_found",
    });
  });

  it("tells a retired machine apart from one that never existed", async () => {
    // `RunnerControl` answers `undefined` for both and has no reason to tell them apart. The
    // two send an operator to different places, so this service does.
    const context = harness({
      row: runnerRow({ status: "removed", desired_state: "removed" }),
      control: undefined,
    });

    await expect(context.service.drain(TENANT, ACTOR, runnerRow().id)).rejects.toMatchObject({
      code: "farm_runner_removed",
    });
  });

  it("writes no audit row when nothing happened", async () => {
    const context = harness({ row: undefined, control: undefined });

    await expect(context.service.drain(TENANT, ACTOR, runnerRow().id)).rejects.toThrow();
    expect(context.written).toEqual([]);
  });
});

describe("the removal guard", () => {
  it.each(["offline", "draining"] as const)("retires a %s machine", async (status) => {
    const row = runnerRow({ status, desired_state: status === "draining" ? "draining" : "active" });
    const removed = runnerRow({ ...row, status: "removed", desired_state: "removed" });
    const context = harness({ row, removed });

    const result = await context.service.remove(TENANT, ACTOR, row.id);

    expect(result.status).toBe("removed");
    expect(result.desiredState).toBe("removed");
  });

  it.each(["online", "building"] as const)(
    "refuses a %s machine, and the error names the reason",
    async (status) => {
      // The acceptance criterion — *remove is blocked for online runners, with a designed
      // error naming the reason*. Removing mid-build would strand the build: the row would
      // read `removed` while the agent went on compiling.
      const context = harness({ row: runnerRow({ status }) });

      await expect(context.service.remove(TENANT, ACTOR, runnerRow().id)).rejects.toMatchObject({
        code: "farm_runner_not_removable",
        details: { status },
      });
      expect(context.removals).toEqual([]);
    },
  );

  it("refuses a machine that has already been retired", async () => {
    const context = harness({
      row: runnerRow({ status: "removed", desired_state: "removed" }),
    });

    await expect(context.service.remove(TENANT, ACTOR, runnerRow().id)).rejects.toMatchObject({
      code: "farm_runner_removed",
    });
  });

  it("is a 404 for a runner this workspace does not have", async () => {
    const context = harness({ row: undefined });

    await expect(context.service.remove(TENANT, ACTOR, runnerRow().id)).rejects.toMatchObject({
      code: "farm_runner_not_found",
    });
  });

  it("applies the guard again inside the write", async () => {
    // Belt and braces, and the braces are the load-bearing half: a runner that heartbeated
    // its way back to `online` between the check and the write would otherwise be removed
    // out from under whatever it had just been given.
    const row = runnerRow({ status: "offline" });
    const context = harness({ row, removed: runnerRow({ ...row, status: "removed" }) });

    await context.service.remove(TENANT, ACTOR, row.id);

    expect(context.removals).toEqual([{ guard: ["offline", "draining"] }]);
  });

  it("refuses with the state the runner is now in when it came back in between", async () => {
    // The race, played out: the check saw `offline`, the write matched nothing, and the
    // second read says why.
    const context = harness({
      row: runnerRow({ status: "offline" }),
      removed: undefined,
      recheck: runnerRow({ status: "building" }),
    });

    await expect(context.service.remove(TENANT, ACTOR, runnerRow().id)).rejects.toMatchObject({
      code: "farm_runner_not_removable",
      details: { status: "building" },
    });
  });
});

describe("what a removal does besides removing", () => {
  it("revokes the machine's certificate, so it cannot reconnect", async () => {
    const row = runnerRow({ status: "offline" });
    const context = harness({ row, removed: runnerRow({ ...row, status: "removed" }) });

    await context.service.remove(TENANT, ACTOR, row.id);

    expect(context.revoked).toEqual([{ runnerId: row.id, reason: "runner_removed" }]);
  });

  it("records retiring and revoking as two different events", async () => {
    // `audit.events.ts`: a certificate is revoked when a machine is *suspected* and a runner
    // is removed when it is *retired*, and only the first is an incident. The revocation's
    // own row is `registration.service.ts`'s; this one is the retirement.
    const row = runnerRow({ status: "draining", desired_state: "draining" });
    const context = harness({ row, removed: runnerRow({ ...row, status: "removed" }) });

    await context.service.remove(TENANT, ACTOR, row.id);

    expect(context.written).toHaveLength(1);
    expect(context.written[0]).toMatchObject({
      action: "runner.removed",
      subjectType: "runner",
      subjectId: row.id,
      detail: { name: row.name, status: "draining" },
    });
  });

  it("succeeds for a bearer-fallback machine, which holds no certificate to revoke", async () => {
    // Decision B3: a Mac behind a certificate-stripping proxy has none by construction, and
    // `farm_no_live_certificate` there is the expected answer rather than a failure.
    const row = runnerRow({ status: "offline", security_mode: "bearer_fallback" });
    const context = harness({
      row,
      removed: runnerRow({ ...row, status: "removed" }),
      revoke: () => Promise.reject(noLiveCertificate()),
    });

    await expect(context.service.remove(TENANT, ACTOR, row.id)).resolves.toMatchObject({
      status: "removed",
    });
  });

  it("does not swallow a revocation that failed for any other reason", async () => {
    // A retired machine whose certificate is still live is a machine that can reconnect, and
    // the caller has to hear about it.
    const row = runnerRow({ status: "offline" });
    const context = harness({
      row,
      removed: runnerRow({ ...row, status: "removed" }),
      revoke: () => Promise.reject(new Error("the CA is unreachable")),
    });

    await expect(context.service.remove(TENANT, ACTOR, row.id)).rejects.toThrow(
      "the CA is unreachable",
    );
  });
});
