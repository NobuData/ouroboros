import { plainToInstance } from "class-transformer";

import type { AuditRecord } from "../../audit/audit.events";
import type { AuditService } from "../../audit/audit.service";
import type { Organization, RunnerPool } from "../../db/schema";
import { runnerPool } from "../dispatch/dispatch.fixture";
import { FarmAudit } from "../farm.audit";
import { CreatePoolDto, UpdatePoolDto } from "./fleet.dto";
import type { FleetRepository, PoolWrite } from "./fleet.repository";
import { PoolsService } from "./pools.service";

/**
 * Pool CRUD, and the three rules that are this service's rather than the DTO's: **the image
 * and the executor agree** (which on a `PATCH` can only be decided against the merged row),
 * **a `PATCH` leaves what it does not name alone**, and **a pool something points at is not
 * deleted** — it is disabled.
 */

/** The workspace every case acts in. */
const TENANT = { id: "org_5eed0001", slug: "acme-robotics" } as Organization;

/** Who is doing it. */
const ACTOR = "user_ken";

/** When. */
const NOW = new Date("2026-09-19T12:00:00.000Z");

/** PostgreSQL's unique violation, as the driver reports one. */
const DUPLICATE = Object.assign(new Error("duplicate key"), { code: "23505" });

/** What a case sets up and reads back. */
interface Harness {
  readonly service: PoolsService;
  readonly written: AuditRecord[];
  readonly inserted: PoolWrite[];
  readonly updated: PoolWrite[];
  readonly deleted: string[];
}

/** How a case shapes the workspace it acts on. */
interface Shape {
  /** The pool `poolById` answers with, or nothing. */
  readonly pool?: RunnerPool;
  /** What still points at it. */
  readonly references?: { runners: number; jobs: number };
  /** Whether the write should collide on the name. */
  readonly collides?: boolean;
}

/**
 * The service over stubs.
 *
 * @param shape - What the workspace looks like.
 * @returns The service and what the stubs recorded.
 */
function harness(shape: Shape = {}): Harness {
  const written: AuditRecord[] = [];
  const inserted: PoolWrite[] = [];
  const updated: PoolWrite[] = [];
  const deleted: string[] = [];

  const fleet = {
    poolById: jest.fn(() => Promise.resolve(shape.pool)),
    pools: jest.fn(() => Promise.resolve(shape.pool ? [{ pool: shape.pool, runners: 3 }] : [])),
    insertPool: jest.fn((_organizationId: string, write: PoolWrite) => {
      inserted.push(write);
      if (shape.collides) return Promise.reject(DUPLICATE);

      return Promise.resolve(runnerPool({ ...write }));
    }),
    updatePool: jest.fn((_organizationId: string, _id: string, write: PoolWrite) => {
      updated.push(write);
      if (shape.collides) return Promise.reject(DUPLICATE);

      return Promise.resolve(runnerPool({ ...shape.pool, ...write }));
    }),
    deletePool: jest.fn((_organizationId: string, id: string) => {
      deleted.push(id);

      return Promise.resolve(true);
    }),
    poolReferences: jest.fn(() => Promise.resolve(shape.references ?? { runners: 0, jobs: 0 })),
  } as unknown as FleetRepository;

  const audit = new FarmAudit({
    record: jest.fn((event: AuditRecord) => {
      written.push(event);

      return Promise.resolve("event");
    }),
  } as unknown as AuditService);

  return {
    service: new PoolsService(fleet, audit, () => NOW),
    written,
    inserted,
    updated,
    deleted,
  };
}

/** A validated create body. */
const create = (body: Record<string, unknown>): CreatePoolDto =>
  plainToInstance(CreatePoolDto, body);

/** A validated update body. */
const update = (body: Record<string, unknown>): UpdatePoolDto =>
  plainToInstance(UpdatePoolDto, body);

describe("creating a pool", () => {
  it("stores a shell pool and records what a build of it will run under", async () => {
    const context = harness();

    const pool = await context.service.create(
      TENANT,
      ACTOR,
      create({ name: "pool-c", executor: "shell", description: "nightly macOS" }),
    );

    expect(pool.runners).toBe(0);
    expect(context.inserted[0]).toMatchObject({
      name: "pool-c",
      executor: "shell",
      image: null,
      description: "nightly macOS",
    });
    expect(context.written[0]).toMatchObject({
      action: "runner.pool_created",
      subjectType: "runner_pool",
      detail: { name: "pool-c", executor: "shell", image: null },
    });
  });

  it("refuses a container pool that pins no image", async () => {
    // Half of V040's `runner_pools_image_for_container`: a container pool with no image has
    // nothing to run a build in.
    const context = harness();

    await expect(
      context.service.create(TENANT, ACTOR, create({ name: "pool-c", executor: "container" })),
    ).rejects.toMatchObject({
      code: "farm_pool_image_mismatch",
      details: { executor: "container" },
    });
    expect(context.inserted).toEqual([]);
  });

  it("refuses a shell pool that pins one", async () => {
    // The other half: a pinned image nothing will ever pull, which the card would render as
    // a promise the pool does not keep.
    const context = harness();

    await expect(
      context.service.create(
        TENANT,
        ACTOR,
        create({ name: "pool-c", executor: "shell", image: "img:1" }),
      ),
    ).rejects.toMatchObject({ code: "farm_pool_image_mismatch", details: { executor: "shell" } });
  });

  it("turns a duplicate name into a conflict that names it", async () => {
    // Raised from the constraint rather than checked for first — a check-then-insert leaves
    // exactly the race it was describing.
    const context = harness({ collides: true });

    await expect(
      context.service.create(TENANT, ACTOR, create({ name: "pool-a", executor: "shell" })),
    ).rejects.toMatchObject({ code: "farm_pool_name_taken", details: { name: "pool-a" } });
  });

  it("renders a default command as argv, never as a shell string", async () => {
    const context = harness();

    await context.service.create(
      TENANT,
      ACTOR,
      create({ name: "pool-c", executor: "shell", defaultCommand: ["make", "hil-sweep"] }),
    );

    expect(context.inserted[0]?.default_command).toBe("make hil-sweep");
  });

  it("writes the auto-scale preference through unchanged", async () => {
    const context = harness();

    await context.service.create(
      TENANT,
      ACTOR,
      create({
        name: "pool-c",
        executor: "shell",
        autoscalePref: { enabled: false, queue_threshold: 5 },
      }),
    );

    expect(context.inserted[0]?.autoscale_pref).toEqual({ enabled: false, queue_threshold: 5 });
  });
});

describe("changing a pool", () => {
  it("writes only the columns the body named", async () => {
    // The whole of what makes this a `PATCH`: an absent field is left alone rather than
    // written as a default that clears it.
    const context = harness({ pool: runnerPool() });

    await context.service.update(TENANT, ACTOR, runnerPool().id, update({ enabled: false }));

    expect(context.updated).toEqual([{ enabled: false }]);
  });

  it("switches a pool off, which is operator intent rather than a delete", async () => {
    const context = harness({ pool: runnerPool() });

    await context.service.update(TENANT, ACTOR, runnerPool().id, update({ enabled: false }));

    expect(context.written[0]).toMatchObject({
      action: "runner.pool_updated",
      detail: { name: "pool-a", fields: "enabled", enabled: false },
    });
  });

  it("records which fields moved, and never their values", async () => {
    // `env_allowlist`'s value is the list of variables a build may carry onto a customer's
    // machine; its shape is operational detail about that workspace's secrets.
    const context = harness({ pool: runnerPool() });

    await context.service.update(
      TENANT,
      ACTOR,
      runnerPool().id,
      update({ envAllowlist: ["SECRET_PATH"], maxConcurrency: 4 }),
    );

    const detail = context.written[0]?.detail as Record<string, unknown>;

    expect(detail.fields).toBe("env_allowlist,max_concurrency");
    expect(JSON.stringify(detail)).not.toContain("SECRET_PATH");
  });

  it("decides the image rule against the merged row, not the body", async () => {
    // The case the DTO cannot decide: the `PATCH` names only an executor, and whether an
    // image is required depends on the one already stored.
    const context = harness({ pool: runnerPool({ executor: "container", image: "img:1" }) });

    await expect(
      context.service.update(TENANT, ACTOR, runnerPool().id, update({ executor: "shell" })),
    ).rejects.toMatchObject({ code: "farm_pool_image_mismatch", details: { executor: "shell" } });
  });

  it("accepts an executor change that clears the image in the same request", async () => {
    const context = harness({ pool: runnerPool({ executor: "container", image: "img:1" }) });

    await context.service.update(
      TENANT,
      ACTOR,
      runnerPool().id,
      update({ executor: "shell", image: null }),
    );

    expect(context.updated[0]).toMatchObject({ executor: "shell", image: null });
  });

  it("refuses clearing a container pool's image on its own", async () => {
    const context = harness({ pool: runnerPool({ executor: "container", image: "img:1" }) });

    await expect(
      context.service.update(TENANT, ACTOR, runnerPool().id, update({ image: null })),
    ).rejects.toMatchObject({ code: "farm_pool_image_mismatch" });
  });

  it("does not mistake a declared field for one the request sent", async () => {
    // ES2023 class fields exist on the instance as `undefined` whether or not the body named
    // them, so `"image" in request` is always true. A `PATCH` naming only the switch would
    // then look as though it had cleared the image — and, for a container pool, be refused
    // by a rule about a field the caller never mentioned.
    const context = harness({ pool: runnerPool({ executor: "container", image: "img:1" }) });

    await context.service.update(TENANT, ACTOR, runnerPool().id, update({ enabled: false }));

    expect(context.updated).toEqual([{ enabled: false }]);
  });

  it("writes nothing and records nothing for a body that changes nothing", async () => {
    // An empty `PATCH` is not an event: a row saying somebody changed a pool in no way at all
    // is noise in the trail.
    const context = harness({ pool: runnerPool() });

    await context.service.update(TENANT, ACTOR, runnerPool().id, update({}));

    expect(context.updated).toEqual([]);
    expect(context.written).toEqual([]);
  });

  it("is a 404 for a pool this workspace does not have", async () => {
    const context = harness({ pool: undefined });

    await expect(
      context.service.update(TENANT, ACTOR, runnerPool().id, update({ enabled: false })),
    ).rejects.toMatchObject({ code: "farm_pool_not_found" });
  });

  it("turns a duplicate new name into a conflict", async () => {
    const context = harness({ pool: runnerPool(), collides: true });

    await expect(
      context.service.update(TENANT, ACTOR, runnerPool().id, update({ name: "pool-b" })),
    ).rejects.toMatchObject({ code: "farm_pool_name_taken", details: { name: "pool-b" } });
  });
});

describe("deleting a pool", () => {
  it("deletes one that nothing points at", async () => {
    const context = harness({ pool: runnerPool(), references: { runners: 0, jobs: 0 } });

    await context.service.remove(TENANT, ACTOR, runnerPool().id);

    expect(context.deleted).toEqual([runnerPool().id]);
    expect(context.written[0]).toMatchObject({
      action: "runner.pool_deleted",
      subjectType: "runner_pool",
      detail: { name: "pool-a" },
    });
  });

  it("refuses one that still has runners, and says how many", async () => {
    // V040's foreign keys refuse it anyway, with a violation nobody outside PostgreSQL can
    // read. The counts are what turn that into something an operator can act on.
    const context = harness({ pool: runnerPool(), references: { runners: 3, jobs: 0 } });

    await expect(context.service.remove(TENANT, ACTOR, runnerPool().id)).rejects.toMatchObject({
      code: "farm_pool_in_use",
      details: { pool: "pool-a", runners: 3, jobs: 0 },
    });
    expect(context.deleted).toEqual([]);
  });

  it("refuses one that still has builds, even with no runners left", async () => {
    // The history outlives the fleet: a pool whose machines were all retired still has the
    // builds they ran.
    const context = harness({ pool: runnerPool(), references: { runners: 0, jobs: 48 } });

    await expect(context.service.remove(TENANT, ACTOR, runnerPool().id)).rejects.toMatchObject({
      code: "farm_pool_in_use",
      details: { jobs: 48 },
    });
  });

  it("offers disabling instead, which is what the caller usually meant", async () => {
    const context = harness({ pool: runnerPool(), references: { runners: 3, jobs: 48 } });

    await expect(context.service.remove(TENANT, ACTOR, runnerPool().id)).rejects.toThrow(
      /disable it instead/,
    );
  });

  it("is a 404 for a pool this workspace does not have", async () => {
    const context = harness({ pool: undefined });

    await expect(context.service.remove(TENANT, ACTOR, runnerPool().id)).rejects.toMatchObject({
      code: "farm_pool_not_found",
    });
  });
});
