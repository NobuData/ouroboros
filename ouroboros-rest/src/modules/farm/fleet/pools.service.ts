/**
 * The POOLS card's CRUD — create, list, change, switch off, delete.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). A pool is an *execution
 * world* (decision **B4**) rather than a label over a machine: it owns the executor, the
 * pinned image and the environment a build may carry onto hardware this product does not
 * administer. Editing one therefore changes what a workspace's next builds run under, which
 * is why all four writes are an administrator's and all four are audited.
 *
 * ---------------------------------------------------------------------------
 * **Editing a pool never rewrites what already ran.**
 *
 * V040 snapshots `executor`, `image` and `command` onto every `build_jobs` row at submission
 * precisely so this is safe: a pool that moves from `zephyr-sdk:0.16` to `0.17` leaves last
 * week's builds recording the image they were actually built with. This service therefore
 * permits the edit without ceremony — the honesty is in the schema, and a service that
 * refused the change would be protecting something already protected.
 *
 * ---------------------------------------------------------------------------
 * **`autoscale_pref` is stored and never read** (decision **B9**). It arrives validated by
 * `fleet.dto.ts`, is written verbatim, and comes back verbatim. Nothing between those two
 * points looks inside it, and nothing may until AJ.1
 * ([#263](https://github.com/NobuData/ouroboros/issues/263)).
 */

import { Inject, Injectable } from "@nestjs/common";

import type { Organization, RunnerPool } from "../../db/schema";
import { renderCommand } from "../dispatch/command";
import { FarmAudit } from "../farm.audit";
import {
  imageNotAllowed,
  imageRequired,
  poolInUse,
  poolNameTaken,
  poolNotFound,
} from "../farm.errors";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import type { CreatePoolDto, PoolFieldsDto, UpdatePoolDto } from "./fleet.dto";
import { FleetRepository, type NewPool, type PoolWrite } from "./fleet.repository";
import { poolResource, type PoolResource } from "./fleet.resources";

/** PostgreSQL's unique-violation class — what a duplicate pool name arrives as. */
const UNIQUE_VIOLATION = "23505";

@Injectable()
export class PoolsService {
  /**
   * @param fleet - The rows.
   * @param audit - AD.4's trail.
   * @param now - The gateway's clock, shared for `fleet.service.ts`'s reason.
   */
  constructor(
    private readonly fleet: FleetRepository,
    private readonly audit: FarmAudit,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /**
   * One workspace's pools, with their runner counts.
   *
   * The same list `GET /api/v1/farm` carries, as a resource of its own: AI.4
   * ([#259](https://github.com/NobuData/ouroboros/issues/259))'s configuration sheet reloads
   * the pools after an edit and has no use for the fleet and the stat row beside them.
   *
   * @param organizationId - The workspace.
   * @returns The pools, by name.
   */
  async list(organizationId: string): Promise<PoolResource[]> {
    const rows = await this.fleet.pools(organizationId);

    return rows.map(poolResource);
  }

  /**
   * Create a pool.
   *
   * @param tenant - The workspace.
   * @param actorId - Who created it.
   * @param request - The pool, already validated.
   * @returns The pool, with a runner count of zero — nothing has joined it yet.
   * @throws {ConflictError} `farm_pool_name_taken` when the workspace has one of that name.
   * @throws {InvalidRequestError} `validation_failed` when a container pool names no image,
   *   or a shell pool names one.
   */
  async create(
    tenant: Organization,
    actorId: string,
    request: CreatePoolDto,
  ): Promise<PoolResource> {
    const image = request.image ?? null;
    if (request.executor === "container" && image === null) throw imageRequired();
    if (request.executor === "shell" && image !== null) throw imageNotAllowed();

    const pool = await this.insert(tenant.id, {
      ...columns(request),
      name: request.name,
      executor: request.executor,
      image,
    });

    await this.audit.poolCreated(
      { organizationId: tenant.id, actorId, at: this.now() },
      { id: pool.id, name: pool.name, executor: pool.executor, image: pool.image },
    );

    return poolResource({ pool, runners: 0 });
  }

  /**
   * Change a pool — including its enabled switch.
   *
   * **`PATCH`, so an absent field is untouched** rather than cleared. The difference matters
   * for `image` and `defaultCommand`, where `null` is a meaningful value: absent means *leave
   * it*, and `null` means *there is none*.
   *
   * @param tenant - The workspace.
   * @param actorId - Who changed it.
   * @param id - The pool.
   * @param request - The fields to change.
   * @returns The pool, with its runner count.
   * @throws {NotFoundError} `farm_pool_not_found`.
   * @throws {ConflictError} `farm_pool_name_taken` when the new name is taken.
   * @throws {InvalidRequestError} `validation_failed` when the merged row would be a
   *   container pool with no image, or a shell pool with one.
   */
  async update(
    tenant: Organization,
    actorId: string,
    id: string,
    request: UpdatePoolDto,
  ): Promise<PoolResource> {
    const existing = await this.fleet.poolById(tenant.id, id);
    if (!existing) throw poolNotFound(id);

    const write = { ...columns(request), ...named(request) };
    if (Object.keys(write).length === 0) {
      // Nothing to do, and nothing to record. An empty `PATCH` is not an event: writing one
      // would put a row in the trail saying somebody changed a pool in no way at all.
      const [unchanged] = (await this.fleet.pools(tenant.id)).filter((row) => row.pool.id === id);

      return poolResource(unchanged);
    }

    // Both halves of `runner_pools_image_for_container`, against the **merged** row — which
    // is the only thing that knows whether a `PATCH` naming only an executor has left an
    // image behind it. See `fleet.dto.ts` on why the DTO cannot decide this.
    const executor = request.executor ?? existing.executor;
    const image = write.image !== undefined ? (write.image ?? null) : existing.image;
    if (executor === "container" && image === null) throw imageRequired();
    if (executor === "shell" && image !== null) throw imageNotAllowed();

    const pool = await this.applyUpdate(tenant.id, id, write);
    if (!pool) throw poolNotFound(id);

    await this.audit.poolUpdated(
      { organizationId: tenant.id, actorId, at: this.now() },
      // The **columns** that moved, not the DTO's declared fields: under define semantics
      // `Object.keys(request)` would list every field the class declares, so a trail built
      // from it would say a rename changed the environment allow-list.
      { id: pool.id, name: pool.name, fields: Object.keys(write), enabled: request.enabled },
    );

    const rows = await this.fleet.pools(tenant.id);
    const row = rows.find((candidate) => candidate.pool.id === id);

    return poolResource(row ?? { pool, runners: 0 });
  }

  /**
   * Delete a pool.
   *
   * Refused while anything points at it, with the counts in the message. V040's foreign keys
   * are `on delete no action` and would refuse it anyway — the counts are what turn that into
   * something an operator can act on, and the message offers the thing they usually meant:
   * **disable it**, which stops new work and keeps the history.
   *
   * @param tenant - The workspace.
   * @param actorId - Who deleted it.
   * @param id - The pool.
   * @returns When it is gone.
   * @throws {NotFoundError} `farm_pool_not_found`.
   * @throws {ConflictError} `farm_pool_in_use` when runners or builds still name it.
   */
  async remove(tenant: Organization, actorId: string, id: string): Promise<void> {
    const pool = await this.fleet.poolById(tenant.id, id);
    if (!pool) throw poolNotFound(id);

    const references = await this.fleet.poolReferences(tenant.id, id);
    if (references.runners > 0 || references.jobs > 0) throw poolInUse(pool.name, references);

    const deleted = await this.fleet.deletePool(tenant.id, id);
    if (!deleted) throw poolNotFound(id);

    await this.audit.poolDeleted(
      { organizationId: tenant.id, actorId, at: this.now() },
      { id: pool.id, name: pool.name },
    );
  }

  /**
   * Insert, turning a unique violation into the error that names the collision.
   *
   * Raised from the constraint rather than checked for first, which is `runnerNameTaken`'s
   * argument: a check-then-insert leaves exactly the race it was describing.
   *
   * @param organizationId - The workspace.
   * @param write - The columns.
   * @returns The stored row.
   * @throws {ConflictError} `farm_pool_name_taken`.
   */
  private async insert(organizationId: string, write: NewPool): Promise<RunnerPool> {
    try {
      return await this.fleet.insertPool(organizationId, write);
    } catch (error) {
      if (isUniqueViolation(error)) throw poolNameTaken(write.name);

      throw error;
    }
  }

  /**
   * Update, turning a unique violation into the error that names the collision.
   *
   * @param organizationId - The workspace.
   * @param id - The pool.
   * @param write - The columns.
   * @returns The stored row, or `undefined` when there is no such pool.
   * @throws {ConflictError} `farm_pool_name_taken`.
   */
  private async applyUpdate(
    organizationId: string,
    id: string,
    write: PoolWrite,
  ): Promise<RunnerPool | undefined> {
    try {
      return await this.fleet.updatePool(organizationId, id, write);
    } catch (error) {
      if (isUniqueViolation(error) && write.name) throw poolNameTaken(write.name);

      throw error;
    }
  }
}

/**
 * The columns a request names, in the database's spelling.
 *
 * Only the fields the body actually carried, so an absent one is left alone by the `set`
 * rather than written as a default that clears it — the whole of what makes this a `PATCH`.
 *
 * ---------------------------------------------------------------------------
 * **Absence is `undefined`, and it cannot be tested with `in`.**
 *
 * This service targets ES2023, so class fields use *define* semantics: every property a DTO
 * declares exists on the instance whether or not the request named it, holding `undefined`.
 * `"image" in request` is therefore always true, and `Object.keys(request)` lists every
 * declared field rather than the ones that arrived. Both read as if the client had sent a
 * body it did not.
 *
 * `!== undefined` is the test that works, and it keeps the distinction the three nullable
 * fields need: **absent** leaves the column alone, and an explicit **`null`** clears it.
 * `null !== undefined`, so the two do not collapse.
 *
 * @param request - The validated body.
 * @returns The columns to write.
 */
function columns(request: PoolFieldsDto): PoolWrite {
  const write: Record<string, unknown> = {};

  if (request.description !== undefined) write.description = request.description;
  if (request.image !== undefined) write.image = request.image;
  // **Arrays are stringified and objects are not**, which looks inconsistent and is not:
  // `pg` serialises a plain object to JSON and a JavaScript array to a *PostgreSQL array
  // literal* — `{a,b}` — which a `jsonb` column would refuse. Stringifying the two arrays is
  // what sends them as the JSON they are. `gateway.repository.ts` writes its objects the
  // same way, directly, for the same reason.
  if (request.envAllowlist !== undefined)
    write.env_allowlist = JSON.stringify(request.envAllowlist);
  if (request.maxConcurrency !== undefined) write.max_concurrency = request.maxConcurrency;
  if (request.enabled !== undefined) write.enabled = request.enabled;
  if (request.tags !== undefined) write.tags = JSON.stringify(request.tags);
  if (request.autoscalePref !== undefined) write.autoscale_pref = request.autoscalePref;
  if (request.defaultCommand !== undefined) {
    // argv in, the canonical rendering out — the form `build_jobs.command` holds, so a pool's
    // default and a submission's command are one shape. `command.ts` owns that rendering.
    write.default_command = request.defaultCommand ? renderCommand(request.defaultCommand) : null;
  }

  return write;
}

/**
 * The two columns only an update may name without the other.
 *
 * @param request - The validated body.
 * @returns `name` and `executor`, when present.
 */
function named(request: UpdatePoolDto): PoolWrite {
  const write: Record<string, unknown> = {};

  if (request.name !== undefined) write.name = request.name;
  if (request.executor !== undefined) write.executor = request.executor;

  return write;
}

/**
 * Is this PostgreSQL refusing a duplicate?
 *
 * @param error - What the driver threw.
 * @returns Whether it is a unique violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION
  );
}
