import { readFileSync } from "node:fs";
import { join } from "node:path";

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { resolve } from "../routing/resolve";
import { resolutionInput, withHealth } from "../routing/routing.fixture";
import { snapshotOf, type ResolutionSnapshotDocument } from "../routing/snapshot";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { LatestResolutionResource } from "./resolutions.resources";

/**
 * `GET /api/v1/registry/resolutions/latest?alias=`, over a socket and against a migrated database
 * ([#589](https://github.com/NobuData/ouroboros/issues/589), decision **R9**).
 *
 * Two kinds of row, and each proves something the other cannot:
 *
 *   * **the dev seed's run #482**, applied from the committed repeatable migrations themselves —
 *     `R__dev_seed.sql`, `_dashboard`, `_providers` and `_routing`, with `${ouro_dev_seed}` on —
 *     so the snapshot the chain card will first render round-trips through the read exactly as
 *     CG.4 (#582) stored it, rather than as a copy of it written into this file; and
 *   * **snapshots `routing/snapshot.ts` builds** from a real `resolve()`, inserted as the executor
 *     will insert them, which is the only way to show the writer's documents are ones V024's
 *     CHECKs accept.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const LATEST = "/api/v1/registry/resolutions/latest";

/** Where the committed migrations are. */
const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "ouroboros-db", "migrations");

/** The seeds run #482's snapshot hangs off, in the order Flyway applies them. */
const SEEDS = [
  "R__dev_seed.sql",
  "R__dev_seed_dashboard.sql",
  "R__dev_seed_providers.sql",
  "R__dev_seed_routing.sql",
] as const;

describe("the latest resolution snapshot read", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /**
   * Apply the development seeds run #482's snapshot needs, as the seeded stack does.
   *
   * @returns The `acme-robotics` workspace's id and slug.
   */
  async function devSeed(): Promise<{ id: string; slug: string }> {
    for (const seed of SEEDS) {
      const text = readFileSync(join(MIGRATIONS, seed), "utf8").replaceAll(
        "${ouro_dev_seed}",
        "true",
      );
      await api.sql.query(text);
    }

    const { rows } = await api.sql.query<{ id: string; slug: string }>(
      `select "id", "slug" from ${SCHEMA_NAME}.organization where "slug" = 'acme-robotics'`,
    );

    return rows[0];
  }

  /**
   * One run in a workspace, for a snapshot to belong to.
   *
   * @param workspace - Where, with the repository a run hangs off.
   * @param issueNumber - The issue it works.
   * @returns The run's id.
   */
  async function run(workspace: SeededWorkspace, issueNumber: number): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs (organization_id, github_repo_id, issue_number, issue_title,
                                        workflow_tag, model, status, stage_label, stage_index,
                                        stage_total, started_at)
       values ($1, $2, $3, 'A run', 'standard-fix', 'claude-fable-5', 'coding', 'Implementing',
               4, 6, now())
       returning id`,
      [workspace.id, workspace.repoId, issueNumber],
    );

    return rows[0].id;
  }

  /**
   * Store a snapshot the way the executor will: the contract's document, beside a run id.
   *
   * @param workspace - Where.
   * @param runId - The run it served.
   * @param document - What `snapshotOf` built.
   * @param resolvedAt - When it was made.
   */
  async function store(
    workspace: SeededWorkspace,
    runId: string,
    document: ResolutionSnapshotDocument,
    resolvedAt: string,
  ): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.resolution_snapshots
         (organization_id, run_id, shape_version, task_kind, route_tag, outcome, duration_ms,
          chain, rules, resolved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
      [
        workspace.id,
        runId,
        document.shape_version,
        document.task_kind,
        document.route_tag,
        document.outcome,
        document.duration_ms,
        JSON.stringify(document.chain),
        JSON.stringify(document.rules),
        resolvedAt,
      ],
    );
  }

  /**
   * Read the latest snapshot through an alias, as somebody.
   *
   * @param person - Whose session.
   * @param slug - Which workspace.
   * @param alias - The query's alias.
   * @returns The pending request.
   */
  function latest(person: Person, slug: string, alias: string) {
    return api.as(person)("get", LATEST).set(TENANT_HEADER, slug).query({ alias });
  }

  describe("the seeded run #482", () => {
    it("round-trips through the read as mockup 21's chain card draws it", async () => {
      const acme = await devSeed();
      const reader = await api.signIn();
      await api.join(acme.id, reader, "member");

      const answer = bodyOf<LatestResolutionResource>(
        await latest(reader, acme.slug, "coder-max").expect(200),
      );
      const snapshot = answer.snapshot!;
      const hop = snapshot.chain.find((each) => each.index === snapshot.resolvedHopIndex)!;

      // The card, one field per word it prints:
      //   route.task("implement") → route implement-primary → alias coder-max
      //     → provider Anthropic (key …Xq4A) → model claude-fable-5    ● resolved · 42ms   run #482
      // The card's `Anthropic` is the provider; the stored connection is named `Anthropic Claude`
      // (mockup 07's card), and `kind` is what a client labels it by.
      expect(answer.alias).toBe("coder-max");
      expect(snapshot.shapeVersion).toBe(1);
      expect(snapshot.run.issueNumber).toBe(482);
      expect(snapshot.taskKind).toBe("implement");
      expect(snapshot.routeTag).toBe("implement-primary");
      expect(hop.alias).toBe("coder-max");
      expect(hop.provider).toMatchObject({
        kind: "anthropic",
        displayName: "Anthropic Claude",
        keySuffix: "Xq4A",
      });
      expect(hop.modelId).toBe("claude-fable-5");
      expect(snapshot.outcome).toBe("resolved");
      expect(snapshot.durationMs).toBe(42);
      expect(hop.durationMs).toBe(42);
      expect(hop.explanation).toBe("Primary · healthy · 42ms");
    });

    it("keeps every hop the run console draws, the dropped Copilot hop included", async () => {
      const acme = await devSeed();
      const reader = await api.signIn();
      await api.join(acme.id, reader, "viewer");

      const { snapshot } = bodyOf<LatestResolutionResource>(
        await latest(reader, acme.slug, "coder-fallback").expect(200),
      );

      // Asked about the hop that was dropped, the answer is the same run: a hop counts whether or
      // not it was kept, because an alias being skipped is what somebody inspecting it needs.
      expect(snapshot?.run.issueNumber).toBe(482);
      expect(snapshot?.chain.map((hop) => [hop.alias, hop.decision])).toEqual([
        ["coder-max", "kept"],
        ["coder-fallback", "dropped"],
        ["local-docs", "kept"],
      ]);
      expect(snapshot?.chain[1].provider?.keySuffix).toBeNull();
    });

    it("answers null for an alias no run has resolved through", async () => {
      const acme = await devSeed();
      const reader = await api.signIn();
      await api.join(acme.id, reader, "member");

      await expect(
        latest(reader, acme.slug, "gpt5-experiments")
          .expect(200)
          .then((response) => bodyOf<LatestResolutionResource>(response)),
      ).resolves.toEqual({ alias: "gpt5-experiments", snapshot: null });
    });
  });

  describe("snapshots the writer contract builds", () => {
    it("are stored under V024's CHECKs and read back, newest first", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);

      await store(
        workspace,
        await run(workspace, 101),
        snapshotOf(resolve(resolutionInput()), {
          durationMs: 40,
          hops: new Map([[1, { keySuffix: "Ab12", durationMs: 40 }]]),
        }),
        "2026-09-12T10:00:00.000Z",
      );
      await store(
        workspace,
        await run(workspace, 102),
        snapshotOf(resolve(withHealth({ anthropic: "error" })), {
          durationMs: 61,
          hops: new Map([[2, { durationMs: 61 }]]),
        }),
        "2026-09-13T10:00:00.000Z",
      );

      const { snapshot } = bodyOf<LatestResolutionResource>(
        await latest(owner, workspace.slug, "coder-max").expect(200),
      );

      // The later run, whose primary was dropped — so the hop that resolved is Copilot's.
      expect(snapshot?.run.issueNumber).toBe(102);
      expect(snapshot?.resolvedHopIndex).toBe(2);
      expect(snapshot?.chain[0]).toMatchObject({
        alias: "coder-max",
        decision: "dropped",
        code: "provider_error",
        durationMs: null,
      });
      expect(snapshot?.resolvedAt).toBe("2026-09-13T10:00:00.000Z");
    });

    it("stores a switched-off hop's sentence as resolution wrote it", async () => {
      const owner = await api.signIn();
      const workspace = await workspaceWithRepo(api, owner);
      const input = resolutionInput();
      const resolution = resolve({
        ...input,
        hops: input.hops.map((hop, offset) =>
          offset === 1 ? { ...hop, target: { ...hop.target, enabled: false } } : hop,
        ),
      });

      await store(
        workspace,
        await run(workspace, 103),
        snapshotOf(resolution, { durationMs: 12 }),
        "2026-09-13T11:00:00.000Z",
      );

      const { snapshot } = bodyOf<LatestResolutionResource>(
        await latest(owner, workspace.slug, "coder-fallback").expect(200),
      );

      expect(snapshot?.chain[1]).toMatchObject({
        code: "alias_disabled",
        explanation:
          "Fallback 1 dropped — coder-fallback: alias disabled by Ken Suenobu 2026-08-01.",
      });
    });

    it("does not read another workspace's snapshot", async () => {
      const owner = await api.signIn();
      const theirs = await workspaceWithRepo(api, owner);
      await store(
        theirs,
        await run(theirs, 104),
        snapshotOf(resolve(resolutionInput()), { durationMs: 9 }),
        "2026-09-13T12:00:00.000Z",
      );

      const stranger = await api.signIn();
      const ours = await workspaceWithRepo(api, stranger);

      await expect(
        latest(stranger, ours.slug, "coder-max")
          .expect(200)
          .then((response) => bodyOf<LatestResolutionResource>(response).snapshot),
      ).resolves.toBeNull();
    });
  });

  describe("who may ask, and what", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", LATEST).query({ alias: "coder-max" }).expect(401);
    });

    it("refuses a session acting in no workspace", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", LATEST).query({ alias: "coder-max" }).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it.each([["Coder-Max"], ["qwen3-coder:32b"], [""]])(
      "answers 422 for an alias no alias could be called: %j",
      async (alias) => {
        const owner = await api.signIn();
        const workspace = await api.workspace(owner);

        const response = await latest(owner, workspace.slug, alias).expect(422);

        expect(bodyOf<ErrorEnvelope>(response).code).toBe("validation_failed");
      },
    );
  });
});
