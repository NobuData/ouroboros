import { startEngineStub, type EngineStub } from "../../testing/engine.stub.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { EstimationOrchestrator } from "../estimation/estimation.orchestrator";
import type { FactDetail } from "../facts/facts.resources";
import { seedRoutingBench } from "../routing/workspace.fixture";
import type { SkillStats } from "../skills/skills.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { WorkflowDetail } from "../workflows/workflows.resources";
import { estimateTokens } from "./context-assembly.profiles";
import type { ContextManifest, InjectionResource } from "./context-assembly.resources";
import { ContextAssemblyService, injectionOf } from "./context-assembly.service";

/**
 * Context assembly certified against a migrated database, through the whole pipeline — BF.7
 * ([#416](https://github.com/NobuData/ouroboros/issues/416)), the Assembly row.
 *
 * BF.5 ([#414](https://github.com/NobuData/ouroboros/issues/414)) proved the resolver pure and its
 * rules one by one. This suite holds the rules *where they are served* — rows written the way
 * the registry writes them, read by the repository, resolved and answered over HTTP — so a
 * refactor on any layer turns a fixture red:
 *
 *   * **the full resolution matrix** — the subject's scope (org · repo) × a same-name rival at
 *     the other scope (absent · present) × `required` × `draft` × a `disable` override (absent ·
 *     present): thirty-two cells, generated rather than hand-picked, each asserting who holds the
 *     name and why the other is out. The eight `required ∧ draft` cells are asserted *impossible*
 *     — V069's `skills_required_not_draft` refuses the row — rather than skipped;
 *   * closest scope wins up the whole ladder (`workflow` > `repo` > `org`), and a `required`
 *     skill holds its name against a closer rival and against a `disable` override;
 *   * drafts are never candidates, and V071 refuses an injection naming one;
 *   * the trim is deterministic and **never silent** — every drop is in `trimmed` with its
 *     reason, the same inputs trim identically twice, and a required skill is never dropped;
 *   * the manifest names the version in force, and the preview is `assemble` byte for byte;
 *   * the estimator sends the manifest's facts to the engine and records what it sent;
 *   * injection records reproduce mockup 14's `used 48×` and `61% of runs`, counted.
 */

const CONTEXT = "/api/v1/knowledge/context";
const FACTS = "/api/v1/facts";
const SKILLS = "/api/v1/skills";
const WORKFLOWS = "/api/v1/workflows";

/** The repository every scoped fixture here is assembled for. */
const REPO = "acme-robotics/helios-firmware";

/** What {@link seedSkill} writes. */
interface SkillSeed {
  readonly slug: string;
  /** The contested name — defaults to the slug. */
  readonly name?: string;
  readonly scope: "org" | "repo" | "workflow";
  readonly workflowId?: string;
  readonly required?: boolean;
  readonly draft?: boolean;
  readonly enabled?: boolean;
  /** The published versions' bodies, v1 first; the last is in force. */
  readonly bodies?: readonly string[];
}

/** A seeded skill. */
interface SeededSkill {
  readonly id: string;
  readonly slug: string;
  /** `skill_versions.id` per version, v1 first. */
  readonly versionIds: readonly string[];
}

/** One cell of the resolution matrix. */
interface MatrixCell {
  readonly index: number;
  readonly scope: "org" | "repo";
  readonly rival: boolean;
  readonly required: boolean;
  readonly draft: boolean;
  readonly disable: boolean;
}

/** What a cell's two skills should come to. */
type Fate =
  | { readonly kind: "kept" }
  | { readonly kind: "excluded"; readonly reason: string; readonly by: string | null }
  | { readonly kind: "absent" };

/** A cell's expected outcome — written from resolve.ts' rules, not from its code. */
interface Expectation {
  readonly subject: Fate;
  readonly rival: Fate | null;
  /** The reason the subject's `disable` override was refused, when it was. */
  readonly refused: string | null;
}

/**
 * Every combination of the matrix's five dimensions, numbered.
 *
 * @returns Thirty-two cells.
 */
function matrixCells(): MatrixCell[] {
  const cells: MatrixCell[] = [];

  for (const scope of ["org", "repo"] as const) {
    for (const rival of [false, true]) {
      for (const required of [false, true]) {
        for (const draft of [false, true]) {
          for (const disable of [false, true]) {
            cells.push({ index: cells.length, scope, rival, required, draft, disable });
          }
        }
      }
    }
  }

  return cells;
}

/**
 * @param cell - A cell.
 * @returns The subject's slug.
 */
function subjectSlug(cell: MatrixCell): string {
  return `m${String(cell.index)}-subject`;
}

/**
 * @param cell - A cell.
 * @returns The rival's slug.
 */
function rivalSlug(cell: MatrixCell): string {
  return `m${String(cell.index)}-rival`;
}

/**
 * The oracle: resolve.ts' rules 2–5, restated for one feasible cell.
 *
 * @param cell - The cell; never `required ∧ draft`.
 * @returns Who holds the name, and what became of the override.
 */
function expected(cell: MatrixCell): Expectation {
  if (cell.draft) {
    // Rule 2: a draft is never a candidate — not kept, not excluded, not resolvable.
    return {
      subject: { kind: "absent" },
      rival: cell.rival ? { kind: "kept" } : null,
      refused: cell.disable ? "not_resolved" : null,
    };
  }

  // Rules 3 and 4: required holds the name; otherwise the closer scope does.
  const subjectWins = !cell.rival || cell.required || cell.scope === "repo";

  if (!subjectWins) {
    return {
      subject: { kind: "excluded", reason: "shadowed", by: rivalSlug(cell) },
      rival: { kind: "kept" },
      refused: cell.disable ? "not_resolved" : null,
    };
  }

  const rival: Fate | null = cell.rival
    ? { kind: "excluded", reason: "shadowed", by: subjectSlug(cell) }
    : null;

  if (!cell.disable) {
    return { subject: { kind: "kept" }, rival, refused: null };
  }

  // Rule 5: the override is applied last, and a required skill refuses it.
  return cell.required
    ? { subject: { kind: "kept" }, rival, refused: "required" }
    : {
        subject: { kind: "excluded", reason: "override_disabled", by: null },
        rival,
        refused: null,
      };
}

/**
 * Where a slug landed in a manifest.
 *
 * @param manifest - The manifest.
 * @param slug - The skill.
 * @returns Its fate.
 */
function fateOf(manifest: ContextManifest, slug: string): Fate {
  if (manifest.skillVersions.some((skill) => skill.slug === slug)) {
    return { kind: "kept" };
  }

  const excluded = manifest.excluded.find((skill) => skill.slug === slug);

  return excluded === undefined
    ? { kind: "absent" }
    : { kind: "excluded", reason: excluded.reason, by: excluded.by };
}

describe("context assembly, against a migrated database", () => {
  let api: ApiHarness;
  let engine: EngineStub;

  beforeAll(async () => {
    engine = await startEngineStub();
    api = await ApiHarness.start({
      OURO_ENGINE_URL: engine.url,
      // A day, so neither background loop fires in the middle of a test.
      OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400",
      OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS: "86400",
    });
  });

  afterAll(async () => {
    await api.close();
    await engine.stop();
  });

  /** A workspace, its owner and a viewer. */
  interface Bench {
    owner: Person;
    viewer: Person;
    id: string;
    slug: string;
  }

  /**
   * @param tag - Distinguishes two benches' people.
   * @returns A workspace with an owner and a viewer.
   */
  async function bench(tag = "a"): Promise<Bench> {
    const owner = await api.signIn({ email: `owner-${tag}@ouroboros.invalid` });
    const viewer = await api.signIn({ email: `viewer-${tag}@ouroboros.invalid` });
    const workspace = await api.workspace(owner);

    await api.join(workspace.id, viewer, "viewer");

    return { owner, viewer, id: workspace.id, slug: workspace.slug };
  }

  /** A request as somebody, in a bench's workspace. */
  function as(person: Person, place: Pick<Bench, "slug">) {
    return (method: "get" | "post", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, place.slug);
  }

  /**
   * A skill written the way the registry writes one — the row, its published versions and its
   * version in force — straight into the tables, so a matrix of them costs milliseconds.
   *
   * @param organizationId - The workspace.
   * @param seed - The skill.
   * @returns Its id and version ids.
   */
  async function seedSkill(organizationId: string, seed: SkillSeed): Promise<SeededSkill> {
    const bodies = seed.bodies ?? [`# ${seed.slug}\n\nFollow ${seed.slug}.`];
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.skills
              (organization_id, slug, name, description, scope, repo_ref, workflow_id,
               required, draft, enabled)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        organizationId,
        seed.slug,
        seed.name ?? seed.slug,
        `The ${seed.slug} skill.`,
        seed.scope,
        seed.scope === "repo" ? REPO : null,
        seed.workflowId ?? null,
        seed.required ?? false,
        seed.draft ?? false,
        seed.enabled ?? true,
      ],
    );
    const id = rows[0].id;
    const versionIds: string[] = [];

    for (const [index, body] of bodies.entries()) {
      const version = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.skill_versions (skill_id, version, body, frontmatter,
                                                     published_at)
         values ($1, $2, $3, $4, now())
         returning id`,
        [
          id,
          index + 1,
          body,
          JSON.stringify({ name: seed.name ?? seed.slug, description: `The ${seed.slug} skill.` }),
        ],
      );
      versionIds.push(version.rows[0].id);
    }

    await api.sql.query(`update ${SCHEMA_NAME}.skills set current_version = $2 where id = $1`, [
      id,
      bodies.length,
    ]);

    return { id, slug: seed.slug, versionIds };
  }

  /**
   * Confirmed facts, written along K3's edges — inserted `proposed`, then confirmed by a person —
   * so V071's triggers see exactly the moves the service makes.
   *
   * @param organizationId - The workspace.
   * @param confirmer - Who confirms them.
   * @param facts - Each fact's text and repository (null for workspace-wide).
   * @returns Their ids, in order.
   */
  async function confirmedFacts(
    organizationId: string,
    confirmer: Person,
    facts: readonly { text: string; repoRef: string | null }[],
  ): Promise<string[]> {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.facts (organization_id, repo_ref, text, proposer, provenance)
       select $1, fact.repo_ref, fact.text, 'manual', '{"line": "added by hand", "refs": []}'
         from jsonb_to_recordset($2::jsonb) as fact(text text, repo_ref text)
       returning id`,
      [
        organizationId,
        JSON.stringify(facts.map((fact) => ({ text: fact.text, repo_ref: fact.repoRef }))),
      ],
    );
    const ids = rows.map((row) => row.id);

    await api.sql.query(
      `update ${SCHEMA_NAME}.facts
          set status = 'confirmed', status_changed_by = $2, confirmed_by = $2,
              confirmed_at = now()
        where id = any ($1::uuid[])`,
      [ids, confirmer.id],
    );

    // `returning` does not promise the insert's order; read the ids back by text.
    const { rows: ordered } = await api.sql.query<{ id: string; text: string }>(
      `select id, text from ${SCHEMA_NAME}.facts where id = any ($1::uuid[])`,
      [ids],
    );

    return facts.map((fact) => ordered.find((row) => row.text === fact.text)?.id ?? "");
  }

  /**
   * `POST /knowledge/context/preview` as a person.
   *
   * @param person - Who asks.
   * @param place - Where.
   * @param body - The preview's body.
   * @returns The manifest.
   */
  async function preview(
    person: Person,
    place: Pick<Bench, "slug">,
    body: Record<string, unknown>,
  ): Promise<ContextManifest> {
    return bodyOf<ContextManifest>(
      await as(person, place)("post", `${CONTEXT}/preview`).send(body).expect(200),
    );
  }

  describe("the resolution matrix — scope × rival × required × draft × override", () => {
    const cells = matrixCells();
    const feasible = cells.filter((cell) => !(cell.required && cell.draft));
    const refusedBySchema = new Map<number, string>();
    let manifest: ContextManifest;
    let subjects: Map<number, SeededSkill>;

    beforeAll(async () => {
      const place = await bench();
      subjects = new Map();

      for (const cell of cells) {
        const name = `Matrix ${String(cell.index)}`;

        try {
          subjects.set(
            cell.index,
            await seedSkill(place.id, {
              slug: subjectSlug(cell),
              name,
              scope: cell.scope,
              required: cell.required,
              draft: cell.draft,
            }),
          );
        } catch (error) {
          refusedBySchema.set(cell.index, error instanceof Error ? error.message : String(error));
          continue;
        }

        if (cell.rival) {
          // The rival is plain, at the other scope, and names itself differently in case only:
          // the contest is by name, case-insensitively.
          await seedSkill(place.id, {
            slug: rivalSlug(cell),
            name: name.toUpperCase(),
            scope: cell.scope === "org" ? "repo" : "org",
          });
        }
      }

      // One assembly resolves every cell: the names are distinct, so the cells cannot interact.
      manifest = await preview(place.owner, place, {
        consumer: "run_stage",
        repo: REPO,
        overrides: {
          disable: feasible
            .filter((cell) => cell.disable)
            .map((cell) => subjects.get(cell.index)?.id ?? ""),
        },
      });
    });

    afterAll(async () => {
      await api.truncate();
    });

    it("enumerates every combination, and eight of them are ones the schema refuses", () => {
      expect(cells).toHaveLength(32);
      expect(feasible).toHaveLength(24);
      expect([...refusedBySchema.keys()]).toEqual(
        cells.filter((cell) => cell.required && cell.draft).map((cell) => cell.index),
      );
      for (const message of refusedBySchema.values()) {
        expect(message).toMatch(/skills_required_not_draft/);
      }
    });

    it.each(feasible.map((cell) => [describeCell(cell), cell] as const))(
      "resolves %s",
      (_label, cell) => {
        const expectation = expected(cell);
        const subject = subjects.get(cell.index);

        expect(fateOf(manifest, subjectSlug(cell))).toEqual(expectation.subject);
        if (expectation.rival !== null) {
          expect(fateOf(manifest, rivalSlug(cell))).toEqual(expectation.rival);
        }

        const refusal = manifest.refusedOverrides.find((entry) => entry.skillId === subject?.id);
        expect(refusal?.reason ?? null).toBe(expectation.refused);

        // Whoever holds the name is injected at its published version, and exactly once.
        const holders = manifest.skillVersions.filter((skill) =>
          [subjectSlug(cell), rivalSlug(cell)].includes(skill.slug),
        );
        expect(holders.length).toBeLessThanOrEqual(1);
        if (expectation.subject.kind === "kept") {
          expect(holders[0]).toMatchObject({
            versionId: subject?.versionIds[0],
            version: 1,
            required: cell.required,
            tier: cell.required ? "required" : cell.scope,
          });
        }
      },
    );

    /**
     * @param cell - A cell.
     * @returns Its test name.
     */
    function describeCell(cell: MatrixCell): string {
      return [
        `${cell.scope} subject`,
        cell.rival ? `a ${cell.scope === "org" ? "repo" : "org"} rival` : "no rival",
        cell.required ? "required" : "optional",
        cell.draft ? "draft" : "published",
        cell.disable ? "disable override" : "no override",
      ].join(" · ");
    }
  });

  describe("the rules around the matrix", () => {
    afterEach(async () => {
      await api.truncate();
    });

    it("lets the closest scope win up the whole ladder — workflow over repo over org", async () => {
      const place = await bench();
      const workflow = bodyOf<WorkflowDetail>(
        await as(place.owner, place)("post", WORKFLOWS).send({ name: "Feature loop" }).expect(201),
      );
      await seedSkill(place.id, { slug: "repo-map-org", name: "repo-map", scope: "org" });
      await seedSkill(place.id, { slug: "repo-map-repo", name: "repo-map", scope: "repo" });
      await seedSkill(place.id, {
        slug: "repo-map-flow",
        name: "repo-map",
        scope: "workflow",
        workflowId: workflow.id,
      });

      const all = await preview(place.owner, place, {
        consumer: "run_stage",
        repo: REPO,
        workflow: "feature-loop",
      });
      expect(all.skillVersions.map((skill) => skill.slug)).toEqual(["repo-map-flow"]);
      expect(all.excluded).toEqual([
        expect.objectContaining({ slug: "repo-map-org", reason: "shadowed", by: "repo-map-flow" }),
        expect.objectContaining({ slug: "repo-map-repo", reason: "shadowed", by: "repo-map-flow" }),
      ]);

      // Out of the workflow, the repository's copy is the closest; out of both, the org's.
      const repo = await preview(place.owner, place, { consumer: "run_stage", repo: REPO });
      expect(repo.skillVersions.map((skill) => skill.slug)).toEqual(["repo-map-repo"]);
      const org = await preview(place.owner, place, { consumer: "run_stage" });
      expect(org.skillVersions.map((skill) => skill.slug)).toEqual(["repo-map-org"]);
    });

    it("switches a farther skill off with a closer disabled one, and re-admits it only by override", async () => {
      const place = await bench();
      await seedSkill(place.id, { slug: "lint-org", name: "lint", scope: "org" });
      const closer = await seedSkill(place.id, {
        slug: "lint-repo",
        name: "lint",
        scope: "repo",
        enabled: false,
      });

      const off = await preview(place.owner, place, { consumer: "run_stage", repo: REPO });
      expect(off.skillVersions).toEqual([]);
      expect(off.excluded.map((skill) => [skill.slug, skill.reason])).toEqual([
        ["lint-org", "shadowed"],
        ["lint-repo", "disabled"],
      ]);

      const on = await preview(place.owner, place, {
        consumer: "run_stage",
        repo: REPO,
        overrides: { enable: [closer.id] },
      });
      expect(on.skillVersions.map((skill) => skill.slug)).toEqual(["lint-repo"]);
    });

    it("never injects a draft, and V071 refuses a record that names one", async () => {
      const place = await bench();
      const draft = await seedSkill(place.id, { slug: "power-budget", scope: "org", draft: true });
      const runId = await seedRuns(place.id, 1).then((ids) => ids[0]);

      const manifest = await preview(place.owner, place, {
        consumer: "run_stage",
        overrides: { enable: [draft.id] },
      });
      expect(manifest.skillVersions).toEqual([]);
      expect(manifest.excluded).toEqual([]);
      expect(manifest.refusedOverrides).toEqual([
        { skillId: draft.id, action: "enable", reason: "not_resolved" },
      ]);

      const refused = bodyOf<ErrorEnvelope>(
        await as(place.owner, place)("post", `${CONTEXT}/injections`)
          .send({
            consumer: "playbook",
            runId,
            skillVersionIds: draft.versionIds,
            factIds: [],
            manifestHash: manifest.manifestHash,
          })
          .expect(422),
      );
      expect(refused.code).toBe("context_injection_unresolved");
    });

    it("names the version in force, and its id, for every skill it injects", async () => {
      const place = await bench();
      const skill = await seedSkill(place.id, {
        slug: "commit-style",
        scope: "org",
        bodies: ["# v1\n\nOld.", "# v2\n\nConventional commits."],
      });

      const manifest = await preview(place.owner, place, { consumer: "playbook" });

      expect(manifest.skillVersions).toEqual([
        expect.objectContaining({
          skillId: skill.id,
          slug: "commit-style",
          version: 2,
          versionId: skill.versionIds[1],
          body: "# v2\n\nConventional commits.",
        }),
      ]);
      expect(injectionOf(manifest).skillVersionIds).toEqual([skill.versionIds[1]]);
    });

    it("answers the preview exactly as `assemble` would, and records nothing", async () => {
      const place = await bench();
      const optional = await seedSkill(place.id, { slug: "pr-etiquette", scope: "org" });
      await seedSkill(place.id, { slug: "zephyr", scope: "repo" });
      await confirmedFacts(place.id, place.owner, [
        { text: "Tests under `tests/hil/` need a rig reservation", repoRef: REPO },
        { text: "PID gains live in config", repoRef: null },
      ]);
      const options = { overrides: { disable: [optional.id] }, budgetTokens: 4_000 };

      // A viewer may preview; it writes nothing.
      const served = await preview(place.viewer, place, {
        consumer: "run_stage",
        repo: REPO,
        ...options,
      });
      const assembled = await api.nest
        .get(ContextAssemblyService)
        .assemble(place.id, { repo: REPO }, "run_stage", options);

      expect(served).toEqual(JSON.parse(JSON.stringify(assembled)) as ContextManifest);
      expect(served.facts).toHaveLength(2);

      const { rows } = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.context_injections where organization_id = $1`,
        [place.id],
      );
      expect(rows).toEqual([]);
    });
  });

  describe("the trim", () => {
    afterEach(async () => {
      await api.truncate();
    });

    /** Bodies sized so the estimate is exact: four characters a token. */
    function body(tokens: number): string {
      return "x".repeat(tokens * 4);
    }

    it("drops the farthest tier first, records every drop with its reason, and does it the same way twice", async () => {
      const place = await bench();
      await seedSkill(place.id, {
        slug: "hil-safety",
        scope: "org",
        required: true,
        bodies: [body(100)],
      });
      await seedSkill(place.id, { slug: "zephyr", scope: "repo", bodies: [body(50)] });
      await seedSkill(place.id, { slug: "commit-style", scope: "org", bodies: [body(30)] });
      await seedSkill(place.id, { slug: "pr-etiquette", scope: "org", bodies: [body(20)] });
      const repoFactText = "Tests under `tests/hil/` need a rig reservation";
      const orgFactText = "PID gains live in config";
      const [repoFact, orgFact] = await confirmedFacts(place.id, place.owner, [
        { text: repoFactText, repoRef: REPO },
        { text: orgFactText, repoRef: null },
      ]);
      const budgetTokens = 100 + 50 + estimateTokens(repoFactText);
      const request = { consumer: "run_stage", repo: REPO, budgetTokens };

      const first = await preview(place.owner, place, request);

      // org tier first; within it skills before facts, the largest first.
      expect(first.trimmed).toEqual([
        {
          kind: "skill",
          id: expect.any(String) as unknown,
          slug: "commit-style",
          tier: "org",
          estTokens: 30,
          reason: "over_budget",
        },
        {
          kind: "skill",
          id: expect.any(String) as unknown,
          slug: "pr-etiquette",
          tier: "org",
          estTokens: 20,
          reason: "over_budget",
        },
        {
          kind: "fact",
          id: orgFact,
          slug: null,
          tier: "org",
          estTokens: estimateTokens(orgFactText),
          reason: "over_budget",
        },
      ]);
      expect(first.skillVersions.map((skill) => skill.slug)).toEqual(["hil-safety", "zephyr"]);
      expect(first.facts.map((fact) => fact.id)).toEqual([repoFact]);
      expect(first.estTokens).toBe(budgetTokens);

      // Nothing dropped goes unrecorded: what went in and what was trimmed is everything.
      const untrimmed = await preview(place.owner, place, { consumer: "run_stage", repo: REPO });
      expect(untrimmed.trimmed).toEqual([]);
      expect(first.estTokens + first.trimmed.reduce((sum, entry) => sum + entry.estTokens, 0)).toBe(
        untrimmed.estTokens,
      );

      // The same inputs, the same trim, the same hash.
      expect(await preview(place.owner, place, request)).toEqual(first);
      expect(first.manifestHash).not.toBe(untrimmed.manifestHash);
    });

    it("never drops a required skill, even when it alone is over budget", async () => {
      const place = await bench();
      await seedSkill(place.id, {
        slug: "hil-safety",
        scope: "org",
        required: true,
        bodies: [body(100)],
      });
      await seedSkill(place.id, { slug: "zephyr", scope: "repo", bodies: [body(50)] });

      const manifest = await preview(place.owner, place, {
        consumer: "run_stage",
        repo: REPO,
        budgetTokens: 10,
      });

      expect(manifest.skillVersions.map((skill) => skill.slug)).toEqual(["hil-safety"]);
      expect(manifest.trimmed.map((entry) => [entry.slug, entry.reason])).toEqual([
        ["zephyr", "over_budget"],
      ]);
      expect(manifest.estTokens).toBe(100);
    });

    it("caps the estimator's facts at the engine's limit, recording each one it leaves out", async () => {
      const place = await bench();
      const facts = [
        { text: `The longest fact of the workspace, ${"y".repeat(60)}`, repoRef: null },
        { text: `The second longest fact, ${"y".repeat(50)}`, repoRef: null },
        ...Array.from({ length: 64 }, (_, n) => ({
          text: `House rule ${String(n).padStart(2, "0")}`,
          repoRef: null,
        })),
      ];
      const [longest, second] = await confirmedFacts(place.id, place.owner, facts);

      const manifest = await preview(place.owner, place, { consumer: "estimator" });

      expect(manifest.skillVersions).toEqual([]);
      expect(manifest.facts).toHaveLength(64);
      expect(manifest.trimmed.map((entry) => [entry.kind, entry.id, entry.reason])).toEqual([
        ["fact", longest, "item_limit"],
        ["fact", second, "item_limit"],
      ]);
    });
  });

  /**
   * A mirrored repository and runs of it — what an injection record's `run_id` names.
   *
   * @param organizationId - The workspace.
   * @param count - How many runs.
   * @returns Their ids, in issue order.
   */
  async function seedRuns(organizationId: string, count: number): Promise<string[]> {
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [organizationId],
    );
    const { rows: repos } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true) returning id`,
      [orgs[0].id],
    );
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs (organization_id, github_repo_id, issue_number, issue_title,
                                        workflow_tag, model, status, stage_label, stage_index,
                                        stage_total, started_at)
       select $1, $2, n, 'A run', 'standard-fix', 'claude-fable-5', 'coding', 'Implementing',
              4, 6, now()
         from generate_series(1, $3::int) as n
       returning id, issue_number`,
      [organizationId, repos[0].id, count],
    );

    return (rows as { id: string; issue_number: number }[])
      .sort((a, b) => a.issue_number - b.issue_number)
      .map((row) => row.id);
  }

  describe("the consumers", () => {
    beforeEach(() => {
      engine.reset();
    });

    afterEach(async () => {
      await api.truncate();
    });

    it("reproduces `used 48×` and `61% of runs` from injection records, counted", async () => {
      const place = await bench();
      await seedSkill(place.id, { slug: "zephyr-conventions", scope: "org" });
      const [fact] = await confirmedFacts(place.id, place.owner, [
        { text: "Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`", repoRef: REPO },
      ]);
      const runs = await seedRuns(place.id, 18);
      const manifest = await preview(place.owner, place, { consumer: "playbook", repo: REPO });
      const injected = injectionOf(manifest);

      expect(injected.factIds).toEqual([fact]);
      expect(injected.skillVersionIds).toHaveLength(1);

      // A viewer cannot inflate a usage number.
      await as(place.viewer, place)("post", `${CONTEXT}/injections`)
        .send({ consumer: "playbook", runId: runs[0], ...injected })
        .expect(403);

      // 48 manifests over 18 runs; the skill rode in those of the first 11 runs — 11/18 = 61%.
      for (let n = 0; n < 48; n += 1) {
        const run = n % runs.length;
        const record = bodyOf<InjectionResource>(
          await as(place.owner, place)("post", `${CONTEXT}/injections`)
            .send({
              consumer: "playbook",
              runId: runs[run],
              skillVersionIds: run < 11 ? injected.skillVersionIds : [],
              factIds: injected.factIds,
              manifestHash: injected.manifestHash,
            })
            .expect(201),
        );
        expect(record.manifestHash).toBe(manifest.manifestHash);
      }

      const detail = bodyOf<FactDetail>(
        await as(place.viewer, place)("get", `${FACTS}/${fact}`).expect(200),
      );
      expect(detail.usedCount).toBe(48);

      const stats = bodyOf<SkillStats>(
        await as(place.viewer, place)("get", `${SKILLS}/stats`).expect(200),
      );
      expect(stats.skills).toEqual([
        {
          slug: "zephyr-conventions",
          active: true,
          usedBy: { label: "61% of runs", carried: 11, inScope: 18 },
          injections: 33,
        },
      ]);
    });

    it("sends the estimator's manifest facts to the engine, and records what it sent", async () => {
      const routing = await seedRoutingBench(api, await api.signIn());
      const [repoFact, orgFact] = await confirmedFacts(routing.id, routing.owner, [
        { text: "I²C drivers must reset the bus after sleep", repoRef: REPO },
        { text: "PID gains live in config", repoRef: null },
        { text: "Another repository's rule", repoRef: "acme-robotics/other" },
      ]);
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.facts (organization_id, repo_ref, text, proposer, provenance)
         values ($1, $2, 'A proposal nobody approved', 'manual',
                 '{"line": "added by hand", "refs": []}')`,
        [routing.id, REPO],
      );
      const { rows: orgs } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
         values ($1, 'acme-robotics', true) returning id`,
        [routing.id],
      );
      const { rows: repos } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
         values ($1, 'helios-firmware', true) returning id`,
        [orgs[0].id],
      );
      const { rows: issues } = await api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.github_issues
                (organization_id, github_repo_id, number, title, body, state, labels,
                 gh_created_at, gh_updated_at, gh_url, sizing_status)
         values ($1, $2, 485, 'I2C bus lockup after IMU sleep/wake cycle', 'The bus locks up.',
                 'open', '["bug","i2c"]'::jsonb, now(), now(),
                 'https://github.com/acme-robotics/helios-firmware/issues/485', 'unsized')
         returning id`,
        [routing.id, repos[0].id],
      );

      const manifest = await preview(routing.owner, routing, { consumer: "estimator", repo: REPO });
      expect(manifest.facts.map((fact) => fact.id)).toEqual([repoFact, orgFact]);

      const orchestrator = api.nest.get(EstimationOrchestrator);
      orchestrator.enqueue(issues[0].id);
      await orchestrator.settled();

      expect(engine.requests).toHaveLength(1);
      expect((engine.requests[0].context as { facts: unknown }).facts).toEqual(
        manifest.facts.map((fact) => ({ id: fact.id, text: fact.text })),
      );
      expect(engine.violations).toEqual([]);

      const { rows } = await api.sql.query<{
        consumer: string;
        fact_ids: string[];
        skill_version_ids: string[];
        manifest_hash: string;
        estimated: boolean;
      }>(
        `select injection.consumer, injection.fact_ids, injection.skill_version_ids,
                injection.manifest_hash, estimate.github_issue_id = $2 as estimated
           from ${SCHEMA_NAME}.context_injections injection
           join ${SCHEMA_NAME}.issue_estimates estimate on estimate.id = injection.estimate_id
          where injection.organization_id = $1`,
        [routing.id, issues[0].id],
      );
      expect(rows).toEqual([
        {
          consumer: "estimator",
          fact_ids: [repoFact, orgFact],
          skill_version_ids: [],
          manifest_hash: manifest.manifestHash,
          estimated: true,
        },
      ]);
    });

    it("resolves only this workspace's rows — another's skill is not resolvable, its fact not recordable", async () => {
      const mine = await bench("a");
      const theirs = await bench("b");
      const foreign = await seedSkill(theirs.id, { slug: "their-skill", scope: "org" });
      const [foreignFact] = await confirmedFacts(theirs.id, theirs.owner, [
        { text: "Their rule", repoRef: null },
      ]);
      const [runId] = await seedRuns(mine.id, 1);

      const manifest = await preview(mine.owner, mine, {
        consumer: "run_stage",
        overrides: { enable: [foreign.id] },
      });
      expect(manifest.skillVersions).toEqual([]);
      expect(manifest.facts).toEqual([]);
      expect(manifest.refusedOverrides).toEqual([
        { skillId: foreign.id, action: "enable", reason: "not_resolved" },
      ]);

      const refused = bodyOf<ErrorEnvelope>(
        await as(mine.owner, mine)("post", `${CONTEXT}/injections`)
          .send({
            consumer: "playbook",
            runId,
            skillVersionIds: foreign.versionIds,
            factIds: [foreignFact],
            manifestHash: manifest.manifestHash,
          })
          .expect(422),
      );
      expect(refused.code).toBe("context_injection_unresolved");
    });
  });
});
