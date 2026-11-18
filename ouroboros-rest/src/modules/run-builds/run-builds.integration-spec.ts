import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";

/**
 * A run's build stage on the workspace default pool (FE.1,
 * [#1834](https://github.com/NobuData/ouroboros/issues/1834)), against a real database.
 *
 * The acceptance criteria this suite covers:
 *
 *   * **resolution** — a stage naming `runner_pool: "$default"` builds on the workspace default;
 *   * **the pin** — the pool it resolved to is pinned on the run, and a later change of default
 *     does not move the run's next `$default` stage;
 *   * **a published version that names an explicit pool** is untouched by the default;
 *   * a workspace with no pool is refused `farm_pool_not_found`, never sent anywhere silently.
 *
 * No runner is enrolled, so every submission is placed nowhere and answered
 * `409 build_no_eligible_runner` with the pool it was submitted to — which is exactly what the
 * cases read. The pin is written before the job, so it is there either way.
 *
 * ```bash
 * yarn test:integration src/modules/run-builds
 * ```
 */

/** The simulator's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** The commit the engine says it pushed. */
const COMMIT = "3f9c2ae0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";

/** A refusal's body. */
interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

describe("a run's build on the workspace default pool (FE.1, #1834)", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace with a run that is coding on its branch. */
  interface Stage {
    readonly owner: Person;
    readonly bench: IngestBench;
    readonly run: RunOpenedResource;
  }

  /**
   * A workspace, a run opened by the simulator, and the run moved to `coding`.
   *
   * @returns The stage.
   */
  async function stage(): Promise<Stage> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await simulator("post", "/internal/runs", { idempotencyKey: "open-1", ...bench.open }).expect(
        201,
      ),
    );
    await api.sql.query(`update ${SCHEMA_NAME}.runs set status = 'coding' where id = $1`, [run.id]);

    return { owner, bench, run };
  }

  /** Call the internal channel as the simulator. */
  function simulator(method: "post", path: string, body: unknown = {}) {
    return api
      .anonymous(method, path)
      .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
      .send(body as object);
  }

  /**
   * Add a shell pool to the stage's workspace. V156 makes the first one the default.
   *
   * @returns Its id.
   */
  async function addPool(scene: Stage, name: string): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runner_pools (organization_id, name, executor)
       values ($1, $2, 'shell') returning id`,
      [scene.bench.workspace.id, name],
    );

    return rows[0].id;
  }

  /** Make a pool the workspace default, as Settings does. */
  async function makeDefault(scene: Stage, id: string): Promise<void> {
    await api.sql.query(
      `update ${SCHEMA_NAME}.runner_pools set is_default = false
        where organization_id = $1 and is_default`,
      [scene.bench.workspace.id],
    );
    await api.sql.query(`update ${SCHEMA_NAME}.runner_pools set is_default = true where id = $1`, [
      id,
    ]);
  }

  /** Submit a stage's build. */
  function submit(scene: Stage, stageKey: string, pool: string) {
    return simulator("post", `/internal/runs/${scene.run.id}/builds`, {
      idempotencyKey: `${scene.run.id}-${stageKey}`,
      stageKey,
      attempt: 1,
      pool,
      commit: COMMIT,
      // The test pools carry no default command.
      command: ["make", "check"],
    });
  }

  /** The pool a refused submission was sent to, from its details. */
  function poolOf(response: Parameters<typeof bodyOf>[0]): unknown {
    return bodyOf<Refusal>(response).details.pool;
  }

  /** The run's pinned default pool. */
  async function pinned(scene: Stage): Promise<string | null> {
    const { rows } = await api.sql.query<{ default_pool_id: string | null }>(
      `select default_pool_id from ${SCHEMA_NAME}.runs where id = $1`,
      [scene.run.id],
    );

    return rows[0].default_pool_id;
  }

  it("resolves $default to the workspace default and pins it on the run", async () => {
    const scene = await stage();
    const first = await addPool(scene, "pool-c");
    await addPool(scene, "pool-d");

    const response = await submit(scene, "build", "$default").expect(409);

    expect(bodyOf<Refusal>(response).code).toBe("build_no_eligible_runner");
    expect(poolOf(response)).toBe("pool-c");
    expect(await pinned(scene)).toBe(first);
  });

  it("keeps the run on the pinned pool when the default changes mid-run", async () => {
    const scene = await stage();
    const first = await addPool(scene, "pool-c");
    const second = await addPool(scene, "pool-d");

    await submit(scene, "build", "$default").expect(409);
    await makeDefault(scene, second);

    const response = await submit(scene, "test", "$default").expect(409);

    expect(poolOf(response)).toBe("pool-c");
    expect(await pinned(scene)).toBe(first);
  });

  it("leaves a published version that names an explicit pool alone", async () => {
    const scene = await stage();
    await addPool(scene, "pool-c");
    await addPool(scene, "pool-d");

    const response = await submit(scene, "build", "pool-d").expect(409);

    expect(poolOf(response)).toBe("pool-d");
    expect(await pinned(scene)).toBeNull();
  });

  it("refuses farm_pool_not_found, saying why, when the workspace has no pool", async () => {
    const scene = await stage();

    const response = await submit(scene, "build", "$default").expect(404);
    const error = bodyOf<Refusal>(response);

    expect(error.code).toBe("farm_pool_not_found");
    expect(error.message).toContain("the workspace has no pool");
    expect(await pinned(scene)).toBeNull();
  });
});
