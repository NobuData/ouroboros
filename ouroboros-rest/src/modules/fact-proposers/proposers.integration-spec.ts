import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { RunControlResource } from "../controls/controls.resources";
import { SCHEMA_NAME } from "../db/schema";
import {
  INTERNAL_KEY_HEADER,
  LEARN_REF_KINDS,
  learnedSchema,
  type LearnRequest,
} from "../engine/engine.contract";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { FactDetail, FactList } from "../facts/facts.resources";
import { PRIMARY_REPO } from "../../testing/dashboard.fixture";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { candidatesFromLearned } from "./proposers.learn";
import { STEER_PROPOSER } from "./proposers.registry";
import type {
  BackfillResource,
  ProposerRegistryResource,
  SuppressionList,
} from "./proposers.resources";
import { FactProposersService } from "./proposers.service";
import {
  ProposerContractViolation,
  type FactCandidate,
  type ProposerDefinition,
} from "./proposers.types";

/**
 * The deterministic fact proposers against a migrated database, through the whole pipeline —
 * BF.7's **Proposers** row ([#416](https://github.com/NobuData/ouroboros/issues/416)) over BF.3
 * ([#412](https://github.com/NobuData/ouroboros/issues/412)).
 *
 * The proposers sit on other planes' seams — a classification is the test-results plane's row, a
 * waiver the PR plane's, a steer the run console's — so these rows are the real ones: a run
 * opened through the ingestion contract, a steer sent through `POST /runs/{id}/controls`, and
 * V071's and V074's triggers under every write. What it certifies:
 *
 *   * **extraction** — each source's lead instruction, prose collapsed and inline-code spans
 *     byte for byte, with the provenance line and refs naming the source;
 *   * **remember-this gating** — a steer without the flag, or a classification a rule made,
 *     proposes nothing;
 *   * **dedupe against every status** — a candidate matching a proposed, confirmed, rejected or
 *     expired fact is suppressed and recorded, and the rejected fact stays rejected;
 *   * **idempotent backfill** — a second pass over a run writes nothing;
 *   * **no path to auto-confirm** — every proposal lands `proposed`, confirmed by nobody; a
 *     candidate carrying a status is refused before it reaches a row; and V071 refuses a fact
 *     inserted as anything but `proposed`, beneath all of it;
 *   * **`/v0/learn` drift** — the engine's documented ref vocabulary, this service's mirror and the
 *     database's `fact_provenance_typed` agree, and the engine's documented answer becomes a
 *     proposed fact the database accepts.
 *
 * ```bash
 * yarn test:integration src/modules/fact-proposers
 * ```
 */

const FACTS = "/api/v1/facts";
const PROPOSERS = "/api/v1/fact-proposers";

/** The simulator's credential. */
const SIMULATOR_SECRET = "integration-run-simulator-secret";

/** A correction note whose code span carries spacing prose would lose. */
const NOTE =
  "Please prefer   `k_msgq_put(&q,  K_NO_WAIT)`  over `k_fifo` in ISR paths. Keep the rest.";

/** What {@link NOTE} becomes: prose collapsed, filler and the second sentence gone, code verbatim. */
const NOTE_FACT = "Prefer `k_msgq_put(&q,  K_NO_WAIT)` over `k_fifo` in ISR paths";

/** A waiver reason about the rig — an `environment` fact. */
const WAIVER = "Skip `test_overshoot` until rig 2 is recalibrated; the chamber drifts.";

/** What {@link WAIVER} becomes. */
const WAIVER_FACT = "Skip `test_overshoot` until rig 2 is recalibrated";

/** A remembered steer. */
const STEER = "Remember to run `west update --narrow` first! Thanks.";

/** The pull request `ouroboros-engine/openapi.yaml`'s `/v0/learn` example cites. */
const DOCUMENTED_PR = "a7150000-0000-0000-0000-000000000498";

/** What {@link STEER} becomes. */
const STEER_FACT = "Run `west update --narrow` first";

/**
 * The engine's documented `POST /v0/learn` exchange, read from `ouroboros-engine/openapi.yaml`.
 *
 * @returns The LearnRef kind vocabulary, the request example and the 200 answer's example.
 */
function engineLearnDocument(): {
  refKinds: string[];
  request: { sources: { refs: { kind: string; id: string }[] }[] } & Record<string, unknown>;
  response: unknown;
} {
  const path = join(__dirname, "..", "..", "..", "..", "ouroboros-engine", "openapi.yaml");
  const document = parse(readFileSync(path, "utf8")) as {
    paths: Record<string, { post: Record<string, unknown> }>;
    components: { schemas: { LearnRef: { properties: { kind: { enum: string[] } } } } };
  };
  const operation = document.paths["/v0/learn"].post as {
    requestBody: { content: { "application/json": { example: never } } };
    responses: { "200": { content: { "application/json": { example: unknown } } } };
  };

  return {
    refKinds: document.components.schemas.LearnRef.properties.kind.enum,
    request: operation.requestBody.content["application/json"].example,
    response: operation.responses["200"].content["application/json"].example,
  };
}

/**
 * A registry entry that answers one fixed candidate — how a new proposer plugs into the generic
 * path, and how a misbehaving one is caught at it.
 *
 * @param candidate - What it answers, whatever that is.
 * @returns The entry.
 */
function answering(candidate: FactCandidate): ProposerDefinition<null> {
  return { ...STEER_PROPOSER, propose: () => ({ kind: "candidate", candidate }) } as never;
}

describe("the fact proposers, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({
      OURO_RUN_SIMULATOR_SECRET: SIMULATOR_SECRET,
      OURO_RUN_CONTROL_SWEEP_SECONDS: "3600",
    });
  });

  afterAll(async () => {
    await api.close();
  });

  afterEach(async () => {
    await api.truncate();
  });

  /** A workspace with an owner and a member, and one open run in its repository. */
  interface Scene {
    readonly owner: Person;
    readonly member: Person;
    readonly bench: IngestBench;
    readonly runId: string;
    readonly loopSeq: number;
    readonly repoRef: string;
    readonly org: string;
  }

  /** @returns A fresh scene. */
  async function scene(): Promise<Scene> {
    const owner = await api.signUp();
    const member = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    await api.join(bench.workspace.id, member, "member");
    const run = bodyOf<RunOpenedResource>(
      await api
        .anonymous("post", "/internal/runs")
        .set(INTERNAL_KEY_HEADER, SIMULATOR_SECRET)
        .send({ idempotencyKey: "open-1", ...bench.open })
        .expect(201),
    );
    const { rows } = await api.sql.query<{ loop_seq: number }>(
      `select loop_seq from ${SCHEMA_NAME}.runs where id = $1`,
      [run.id],
    );

    return {
      owner,
      member,
      bench,
      runId: run.id,
      loopSeq: rows[0].loop_seq,
      repoRef: `${bench.workspace.slug}/${PRIMARY_REPO}`.toLowerCase(),
      org: bench.workspace.id,
    };
  }

  /** A request as somebody, in the scene's workspace. */
  function as(person: Person, at: Scene) {
    return (method: "get" | "post", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /**
   * One row, inserted.
   *
   * @param text - The statement, returning `id`.
   * @param values - Its parameters.
   * @returns The id.
   */
  async function insert(text: string, values: unknown[]): Promise<string> {
    const { rows } = await api.sql.query<{ id: string }>(text, values);

    return rows[0].id;
  }

  /**
   * A failing case of the scene's run, classified — the Mark & Route card's row.
   *
   * @param at - The scene.
   * @param note - The correction note.
   * @param actor - Who picked the class.
   * @returns `failure_classifications.id`.
   */
  async function classification(
    at: Scene,
    note: string,
    actor: "human" | "heuristic" = "human",
  ): Promise<string> {
    const testRun = await insert(
      `insert into ${SCHEMA_NAME}.test_runs (organization_id, run_id, attempt_seq, commit_sha, status)
       values ($1, $2, (select coalesce(max(attempt_seq), 0) + 1 from ${SCHEMA_NAME}.test_runs
                         where run_id = $2), 'f42b9a0', 'complete')
       returning id`,
      [at.org, at.runId],
    );
    const suite = await insert(
      `insert into ${SCHEMA_NAME}.test_suites (organization_id, test_run_id, name, platform, kind, meta)
       values ($1, $2, 'motor control', 'qemu_cortex_m3', 'sim', '{}') returning id`,
      [at.org, testRun],
    );
    const testCase = await insert(
      `insert into ${SCHEMA_NAME}.test_cases
         (organization_id, test_suite_id, name, classname, status, retries, retry_outcomes, failure)
       values ($1, $2, 'overshoot', 'motor', 'failed', 0, '["failed"]'::jsonb,
               '{"message": "2.4% > 2.0%"}'::jsonb)
       returning id`,
      [at.org, suite],
    );

    return insert(
      `insert into ${SCHEMA_NAME}.failure_classifications
         (organization_id, test_case_id, class, note, actor, rule_id, created_by)
       values ($1, $2, 'product_bug', $3, $4, $5, $6) returning id`,
      [
        at.org,
        testCase,
        note,
        actor,
        actor === "heuristic" ? "new-failure-in-changed-file" : null,
        actor === "human" ? at.owner.id : null,
      ],
    );
  }

  /**
   * A waiver on the scene's run.
   *
   * @param at - The scene.
   * @param reason - Why.
   * @returns `pr_waivers.id`.
   */
  function waiver(at: Scene, reason: string): Promise<string> {
    return insert(
      `insert into ${SCHEMA_NAME}.pr_waivers (organization_id, run_id, author, reason)
       values ($1, $2, $3, $4) returning id`,
      [at.org, at.runId, at.owner.id, reason],
    );
  }

  /**
   * A steer, sent through the run console's own route.
   *
   * @param at - The scene.
   * @param payload - What the member typed.
   * @param remember - The *remember this* flag.
   * @returns The control.
   */
  async function steer(at: Scene, payload: string, remember: boolean): Promise<RunControlResource> {
    return bodyOf<RunControlResource>(
      await as(at.member, at)("post", `/api/v1/runs/${at.runId}/controls`)
        .send({ kind: "steer", payload, remember })
        .expect(202),
    );
  }

  /**
   * Backfill the scene's run as its owner.
   *
   * @param at - The scene.
   * @returns The answer.
   */
  async function backfill(at: Scene): Promise<BackfillResource> {
    return bodyOf<BackfillResource>(
      await as(at.owner, at)("post", `${PROPOSERS}/backfill`).send({ runId: at.runId }).expect(200),
    );
  }

  /**
   * @param at - The scene.
   * @returns The workspace's facts, as the card lists them.
   */
  async function facts(at: Scene): Promise<FactList> {
    return bodyOf<FactList>(await as(at.member, at)("get", FACTS).expect(200));
  }

  /**
   * @param at - The scene.
   * @returns How many rows `facts` and `fact_suppressions` hold for the workspace.
   */
  async function rowCounts(at: Scene): Promise<{ facts: number; suppressions: number }> {
    const { rows } = await api.sql.query<{ facts: number; suppressions: number }>(
      `select (select count(*)::int from ${SCHEMA_NAME}.facts where organization_id = $1) as facts,
              (select count(*)::int from ${SCHEMA_NAME}.fact_suppressions
                where organization_id = $1) as suppressions`,
      [at.org],
    );

    return rows[0];
  }

  it("extracts each source's lead instruction, code spans verbatim, and lands every one proposed by nobody", async () => {
    const at = await scene();
    const classified = await classification(at, NOTE);
    const waived = await waiver(at, WAIVER);

    // The steer proposes on write: the run console reports it to the observer.
    const remembered = await steer(at, STEER, true);
    expect((await facts(at)).items.map((fact) => fact.text)).toEqual([STEER_FACT]);

    const report = await backfill(at);
    expect(report.counts).toEqual({ proposed: 2, suppressed: 0, alreadyProposed: 1, skipped: 0 });

    const list = await facts(at);
    expect(list.counts).toMatchObject({ proposed: 3, confirmed: 0 });

    const byProposer = new Map(list.items.map((fact) => [fact.proposer, fact]));
    expect(byProposer.get("correction_note")).toMatchObject({
      text: NOTE_FACT,
      repoRef: at.repoRef,
      provenance: {
        line: `from correction note (run #${String(at.loopSeq)})`,
        refs: [
          { kind: "run", id: at.runId },
          { kind: "classification", id: classified },
        ],
      },
    });
    expect(byProposer.get("waiver")).toMatchObject({
      text: WAIVER_FACT,
      provenance: {
        line: `from waiver on run #${String(at.loopSeq)} · environment`,
        refs: [
          { kind: "run", id: at.runId },
          { kind: "waiver", id: waived },
        ],
      },
    });
    expect(byProposer.get("steer")).toMatchObject({
      text: STEER_FACT,
      provenance: {
        line: `from remembered steer (run #${String(at.loopSeq)})`,
        refs: [
          { kind: "run", id: at.runId },
          { kind: "person", id: at.member.id },
          { kind: "steer", id: remembered.id },
        ],
      },
    });

    // No auto-confirm: every one is awaiting review, and the audit's only row is its birth, by nobody.
    for (const fact of list.items) {
      expect(fact).toMatchObject({ status: "proposed", confirmation: null });

      const detail = bodyOf<FactDetail>(
        await as(at.member, at)("get", `${FACTS}/${fact.id}`).expect(200),
      );
      expect(detail.history.map((row) => [row.from, row.to, row.actor])).toEqual([
        [null, "proposed", null],
      ]);
    }
  });

  it("proposes nothing from a steer without remember this, or a class a rule picked", async () => {
    const at = await scene();

    await steer(at, "Just this once, skip the lint stage.", false);
    await classification(at, "Prefer `k_msgq` in ISR paths.", "heuristic");
    expect((await facts(at)).items).toEqual([]);

    const report = await backfill(at);
    expect(report.outcomes).toEqual([
      expect.objectContaining({ outcome: "skipped", reason: "not_human" }),
    ]);
    expect(await rowCounts(at)).toEqual({ facts: 0, suppressions: 0 });
  });

  it("dedupes against a fact in every status, rejected included, and records each suppression", async () => {
    const at = await scene();
    const decide = as(at.member, at);

    /** A hand-proposed fact, moved to a status. */
    async function fact(text: string, path: string[]): Promise<string> {
      const created = bodyOf<FactDetail>(await decide("post", FACTS).send({ text }).expect(201));

      for (const step of path) {
        await decide("post", `${FACTS}/${created.id}/${step}`)
          .send(step === "expire" ? { reason: "Zephyr 4.1 migration" } : {})
          .expect(200);
      }

      return created.id;
    }

    const matched = {
      proposed: await fact("Pin the SDK to 0.16.8", []),
      confirmed: await fact("Flash with `nrfjprog --recover` after a brick", ["confirm"]),
      rejected: await fact("Rig 2 needs a manual power cycle after flashing", ["reject"]),
      expired: await fact("Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`", ["confirm", "expire"]),
    };

    // The same four, as the loop would phrase them: case, markup and punctuation differ.
    const sources = {
      proposed: await waiver(at, "pin the SDK to 0.16.8."),
      confirmed: await classification(at, "Flash with nrfjprog --recover after a brick!"),
      rejected: await waiver(at, "RIG 2 needs a manual power cycle after flashing."),
      expired: await classification(at, "Zephyr 4.0 needs *CONFIG_LEGACY_TIMER*."),
    };

    const report = await backfill(at);
    expect(report.counts).toEqual({ proposed: 0, suppressed: 4, alreadyProposed: 0, skipped: 0 });

    const suppressions = bodyOf<SuppressionList>(
      await decide("get", `${PROPOSERS}/suppressions`).expect(200),
    );
    expect(
      Object.fromEntries(suppressions.items.map((row) => [row.sourceKey, row.matchedFactId])),
    ).toEqual({
      [`waiver:${sources.proposed}`]: matched.proposed,
      [`classification:${sources.confirmed}`]: matched.confirmed,
      [`waiver:${sources.rejected}`]: matched.rejected,
      [`classification:${sources.expired}`]: matched.expired,
    });

    // Turned down stays turned down: nothing was re-proposed, nothing moved.
    const list = await facts(at);
    expect(list.items).toHaveLength(4);
    expect(list.counts).toMatchObject({ proposed: 1, confirmed: 1, rejected: 1, expired: 1 });

    // A second pass records nothing new either.
    const again = await backfill(at);
    expect(again.counts.suppressed).toBe(4);
    expect(await rowCounts(at)).toEqual({ facts: 4, suppressions: 4 });
  });

  it("backfills idempotently — a second pass over a run writes nothing", async () => {
    const at = await scene();
    await classification(at, NOTE);
    await waiver(at, WAIVER);
    await steer(at, STEER, true);

    const first = await backfill(at);
    const before = await rowCounts(at);
    const second = await backfill(at);

    expect(first.counts.proposed).toBe(2);
    expect(second.counts).toEqual({ proposed: 0, suppressed: 0, alreadyProposed: 3, skipped: 0 });
    expect(await rowCounts(at)).toEqual(before);
    expect(before.facts).toBe(3);
  });

  it("has no path to auto-confirm: the registry, the generic path and V071 all refuse one", async () => {
    const at = await scene();
    const proposers = api.nest.get(FactProposersService);

    const registry = bodyOf<ProposerRegistryResource>(
      await as(at.member, at)("get", PROPOSERS).expect(200),
    );
    expect(registry.landsAs).toBe("proposed");

    // A proposer that tries to hand the writer a status is caught before any row exists.
    const candidate: FactCandidate = {
      text: "Always claim the rig before a HIL test",
      repoRef: at.repoRef,
      proposer: "steer",
      proposerVersion: 1,
      category: "instruction",
      confidence: null,
      provenance: { line: "from a rogue proposer", refs: [] },
      source: { kind: "steer", id: "rogue" },
    };
    await expect(
      proposers.propose(
        at.org,
        answering({ ...candidate, status: "confirmed" } as FactCandidate),
        null,
        candidate.source,
      ),
    ).rejects.toThrow(ProposerContractViolation);
    expect(await rowCounts(at)).toEqual({ facts: 0, suppressions: 0 });

    // The database's own rule, beneath the service's.
    await expect(
      api.sql.query(
        `insert into ${SCHEMA_NAME}.facts (organization_id, text, proposer, provenance, status,
                                           confirmed_at, status_changed_by)
         values ($1, 'x y', 'steer', '{"line": "l", "refs": []}', 'confirmed', now(), $2)`,
        [at.org, at.owner.id],
      ),
    ).rejects.toThrow(/created proposed/);

    // And confirming is a person's act on the route, never the proposer's.
    await as(at.member, at)("post", FACTS).send({ text: "a person proposes" }).expect(201);
    expect((await facts(at)).counts.confirmed).toBe(0);
  });

  it("keeps the /v0/learn contract in step with the engine and the database", async () => {
    const at = await scene();
    const engine = engineLearnDocument();

    // Engine's documented vocabulary ⇔ this service's mirror ⇔ V074's fact_provenance_typed.
    expect([...engine.refKinds].sort()).toEqual([...LEARN_REF_KINDS].sort());
    for (const kind of LEARN_REF_KINDS) {
      const { rows } = await api.sql.query<{ ok: boolean }>(
        `select ${SCHEMA_NAME}.fact_provenance_typed($1::jsonb) as ok`,
        [JSON.stringify({ line: "l", refs: [{ kind, id: DOCUMENTED_PR }] })],
      );
      expect({ kind, ok: rows[0].ok }).toEqual({ kind, ok: true });
    }

    // The documented answer, its PR re-pointed at a row of this workspace so it resolves.
    const pr = await insert(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, run_id, external_number, external_url, title,
               head_branch, base_branch, state)
       values ($1, $2, $3, 498, 'https://github.com/acme/helios/pull/498', 'rig claim',
               'loop/498', 'main', 'open')
       returning id`,
      [at.org, at.bench.source, at.runId],
    );
    const documented = JSON.stringify(engine.request).replaceAll(DOCUMENTED_PR, pr);
    const request = JSON.parse(documented) as {
      sources: LearnRequest["sources"];
      context: { repo: string | null; existing_facts: string[] };
    };
    const learned = learnedSchema.parse(
      JSON.parse(JSON.stringify(engine.response).replaceAll(DOCUMENTED_PR, pr)),
    );
    const [candidate] = candidatesFromLearned(learned, {
      sources: request.sources,
      context: { repo: at.repoRef, existingFacts: request.context.existing_facts },
    });

    const outcome = await api.nest
      .get(FactProposersService)
      .propose(at.org, answering(candidate), null, candidate.source);
    expect(outcome.outcome).toBe("proposed");

    const written = (await facts(at)).items;
    expect(written).toEqual([
      expect.objectContaining({
        proposer: "llm",
        status: "proposed",
        confirmation: null,
        text: "Tests under `tests/hil/` require rig reservation via `rig claim`",
        provenance: { line: "from PR #498 review cycle", refs: [{ kind: "pull_request", id: pr }] },
      }),
    ]);

    // A second answer of the same candidate is deduped like any proposer's, and recorded.
    const repeat = await api.nest
      .get(FactProposersService)
      .propose(at.org, answering(candidate), null, candidate.source);
    expect(repeat).toMatchObject({ outcome: "suppressed", matchedFactId: written[0].id });
  });

  it("keeps the backfill an administrator's, and another workspace's run a 404", async () => {
    const at = await scene();
    const theirs = await scene();

    await as(at.member, at)("post", `${PROPOSERS}/backfill`).send({ runId: at.runId }).expect(403);
    const refused = bodyOf<ErrorEnvelope>(
      await as(at.owner, at)("post", `${PROPOSERS}/backfill`)
        .send({ runId: theirs.runId })
        .expect(404),
    );
    expect(refused.code).toBe("run_not_found");
  });
});
