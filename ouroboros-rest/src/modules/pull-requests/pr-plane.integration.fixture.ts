/**
 * The PR plane's integration scene — mockup 12's PR on the in-memory git host, reached through the
 * **application's own** services (AX.6, [#362](https://github.com/NobuData/ouroboros/issues/362)).
 *
 * The AX.1–AX.5 suites each build their services by hand over a fake host, which proves a service
 * but not the wiring. This scene replaces one provider — the `TicketSourceRegistry` — so the
 * routes, the merge executor, the gate engine and the head actions the application built all reach
 * the fake host, and a suite asserts on what the host holds rather than on what a service said.
 *
 * ```
 * PrPlaneHosts ── registry override ──▶ app's PrSyncService ──▶ InMemoryPrHost (swapped per test)
 * prPlaneScene ─▶ run #482 · host issue · git-host source · PR on the host · revision 1 at its head
 *                 gates: "manual" (build green, test suite pending) or "engine" (the pin's seven)
 * ```
 *
 * **Fixtures derive from mockup 12** (`docs/mockups/12-pr-verification.html`): the title, branch,
 * the three files (+68 −15), the gate evidence lines and the waiver's reason are the mockup's text,
 * so a drift from the design source is a failing assertion rather than a design review.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { ApiHarness, Person, ProviderOverride } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import {
  IN_MEMORY_DEFAULT_BRANCH,
  InMemoryPrHost,
  InMemoryPrTicketSourceProvider,
  pullUrl,
  type InMemoryFileChange,
} from "../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import type { TicketSourceProvider } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { VaultService } from "../vault/vault.service";
import { GateEngineService } from "./gates/gate.service";

/** Mockup 12's PR title. */
export const MOCKUP_TITLE = "can: fix flaky telemetry frame order under ISR load";

/** Mockup 12's branch. */
export const MOCKUP_BRANCH = "loop/482-canbus-flake";

/** Mockup 12's changed files — `+68 −15 · 3 files`. */
export const MOCKUP_FILES: readonly InMemoryFileChange[] = [
  { path: "drivers/can/telemetry_buf.c", additions: 38, deletions: 12 },
  { path: "drivers/can/isr_fastpath.c", additions: 9, deletions: 3 },
  { path: "tests/telemetry/test_frame_order.c", additions: 21, deletions: 0 },
];

/** Revision 1's red HIL line, as the gate engine writes it for mockup 12's overshoot. */
export const HIL_RED_EVIDENCE = "overshoot 2.4% > 2.0% · rig helios-rig-02";

/** Revision 1's red test line — two of 63 failing after attempt 3. */
export const TESTS_RED_EVIDENCE = "61/63 · 2 failing after attempt 3";

/** The mockup's waiver reason. */
export const MOCKUP_WAIVER_REASON = "rig runs at 22°C only — thermal chamber not in bench";

/**
 * The fake git host the application talks to, swapped for a fresh one per test.
 *
 * The registry is built once, when the harness starts, so the provider it holds is a delegate that
 * forwards every member to the current host's provider. {@link PrPlaneHosts.reset} gives the next
 * test an empty host without restarting the application.
 */
export class PrPlaneHosts {
  private current = new InMemoryPrHost();
  private provider = new InMemoryPrTicketSourceProvider(new InMemoryTracker(), this.current);

  /** @returns The host the application reaches now. */
  get host(): InMemoryPrHost {
    return this.current;
  }

  /**
   * Replace the host with an empty one.
   *
   * @returns The new host.
   */
  reset(): InMemoryPrHost {
    this.current = new InMemoryPrHost();
    this.provider = new InMemoryPrTicketSourceProvider(new InMemoryTracker(), this.current);

    return this.current;
  }

  /**
   * The harness's provider overrides: a registry whose one provider — kind `custom` — forwards to
   * the current host.
   *
   * @returns The overrides, for `ApiHarness.start`.
   */
  overrides(): ProviderOverride[] {
    const delegate = new Proxy(this.provider, {
      get: (_target, member) => {
        const value: unknown = Reflect.get(this.provider, member);

        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(this.provider)
          : value;
      },
    }) as TicketSourceProvider;

    return [{ provide: TicketSourceRegistry, useValue: new TicketSourceRegistry([delegate]) }];
  }
}

/** How a scene's gates are set up. */
export type SceneGates =
  /** Two required gates written by hand — build green, test suite pending — as AX.4's suite. */
  | "manual"
  /** The pin's seven, materialized and judged by the application's gate engine. */
  | "engine";

/** Everything a case starts from. */
export interface PrPlaneScene {
  readonly owner: Person;
  readonly bench: IngestBench;
  /** The workspace. */
  readonly org: string;
  readonly runId: string;
  readonly ticketId: string;
  /** The git-host source the PR lives on. */
  readonly sourceId: string;
  readonly prId: string;
  /** The host's number for the PR. */
  readonly prNumber: number;
  /** The host issue the PR closes. */
  readonly issue: number;
  /** Revision 1, at the host's head. */
  readonly revisionId: string;
  readonly headSha: string;
  /** Each definition's id, by gate key. */
  readonly gates: Readonly<Record<string, string>>;
}

/**
 * The one row a statement returns.
 *
 * @param api - The harness.
 * @param text - The statement.
 * @param values - Its parameters.
 * @returns The first row.
 */
export async function one<T extends object>(
  api: ApiHarness,
  text: string,
  values: unknown[],
): Promise<T> {
  const { rows } = await api.sql.query<T>(text, values);

  return rows[0];
}

/**
 * Run #482 opened by the executor with `implement` active; the ticket bound to a host issue; a
 * git-host source on the in-memory host with its credential sealed; mockup 12's PR opened on the
 * host and mirrored at `verifying` on revision 1; and its gates.
 *
 * @param api - The started harness, whose registry is {@link PrPlaneHosts.overrides}.
 * @param host - The current host.
 * @param gates - How the gates are set up.
 * @returns The scene.
 */
export async function prPlaneScene(
  api: ApiHarness,
  host: InMemoryPrHost,
  gates: SceneGates = "manual",
): Promise<PrPlaneScene> {
  const owner = await api.signUp();
  const bench = await seedIngestBench(api, owner);
  const org = bench.workspace.id;
  const run = bodyOf<RunOpenedResource>(
    await internal(api, "post", "/internal/runs", { idempotencyKey: "open", ...bench.open }).expect(
      201,
    ),
  );

  await internal(api, "post", `/internal/runs/${run.id}/stage-transitions`, {
    idempotencyKey: "implement",
    stageKey: "implement",
    status: "active",
  }).expect(200);

  const issue = host.openIssue();
  // The canonical ticket is the host's issue, so the merge's `Closes #n.` closes it.
  const ticket = await one<{ id: string }>(
    api,
    `update ${SCHEMA_NAME}.tickets set external_key = $3
      where organization_id = $1 and source_id = $2 returning id`,
    [org, bench.source, `#${String(issue)}`],
  );
  const source = await one<{ id: string }>(
    api,
    `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
     values ($1, 'custom', 'Sandbox host', $2::jsonb) returning id`,
    [org, JSON.stringify({ project: IN_MEMORY_PROJECT })],
  );
  const sealed = await api.nest.get(VaultService).encryptText(org, source.id, IN_MEMORY_TOKEN);

  await api.sql.query(
    `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
    [source.id, sealed],
  );
  host.push(MOCKUP_BRANCH, MOCKUP_FILES);

  const opened = host.open(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, {
    branch: MOCKUP_BRANCH,
    base: IN_MEMORY_DEFAULT_BRANCH,
    title: MOCKUP_TITLE,
    body: null,
  });
  const headSha = host.headOf(opened);
  const pr = await one<{ id: string }>(
    api,
    `insert into ${SCHEMA_NAME}.pull_requests
            (organization_id, source_id, external_number, external_url, title, head_branch,
             base_branch, state, run_id, ticket_id, additions, deletions, changed_files)
     values ($1, $2, $3, $4, $5, $6, 'main', 'verifying', $7, $8, 68, 15, 3)
     returning id`,
    [
      org,
      source.id,
      opened.number,
      pullUrl(IN_MEMORY_PROJECT, opened.number),
      MOCKUP_TITLE,
      MOCKUP_BRANCH,
      run.id,
      ticket.id,
    ],
  );
  const revision = await one<{ id: string }>(
    api,
    `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at, files)
     values ($1, 1, $2, now(), $3::jsonb) returning id`,
    [pr.id, headSha, JSON.stringify(MOCKUP_FILES)],
  );
  const definitions =
    gates === "manual" ? await manualGates(api, pr.id, revision.id) : await engineGates(api, pr.id);

  return {
    owner,
    bench,
    org,
    runId: run.id,
    ticketId: ticket.id,
    sourceId: source.id,
    prId: pr.id,
    prNumber: opened.number,
    issue,
    revisionId: revision.id,
    headSha,
    gates: definitions,
  };
}

/**
 * Append one gate verdict — what the gate engine writes.
 *
 * @param api - The harness.
 * @param definitionId - The gate.
 * @param revisionId - The revision.
 * @param value - The verdict.
 * @param evidence - Its line; `<verdict> by the suite` unless given.
 */
export async function verdict(
  api: ApiHarness,
  definitionId: string,
  revisionId: string,
  value: "green" | "red" | "pending",
  evidence = `${value} by the suite`,
): Promise<void> {
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.pr_gate_results
            (definition_id, revision_id, verdict, evidence, provider_version, evaluated_at)
     values ($1, $2, $3, $4, 'gate-test@1.0.0', clock_timestamp())`,
    [definitionId, revisionId, value, evidence],
  );
}

/**
 * A call to an internal route with the engine's shared secret.
 *
 * @param api - The harness.
 * @param method - `post` or `put`.
 * @param path - The route.
 * @param body - The body.
 * @returns The pending request.
 */
function internal(api: ApiHarness, method: "post" | "put", path: string, body: object) {
  return api
    .anonymous(method, path)
    .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
    .send(body);
}

/**
 * AX.4's two required gates: build green, test suite pending.
 *
 * @param api - The harness.
 * @param prId - The PR.
 * @param revisionId - Revision 1.
 * @returns The definitions' ids.
 */
async function manualGates(
  api: ApiHarness,
  prId: string,
  revisionId: string,
): Promise<Record<string, string>> {
  const definition = async (key: string, label: string, order: number) =>
    (
      await one<{ id: string }>(
        api,
        `insert into ${SCHEMA_NAME}.pr_gate_definitions
                (pr_id, gate_key, source, required, sort_order, label)
         values ($1, $2, 'standard-fix@v14 pin', true, $3, $4) returning id`,
        [prId, key, order, label],
      )
    ).id;
  const build = await definition("build", "Build", 1);
  const tests = await definition("test_suite", "Test suite", 2);

  await verdict(api, build, revisionId, "green", "forge-01 · zephyr.elf · FLASH 43.5%");
  await verdict(api, tests, revisionId, "pending", "attempt 4 running");

  return { build, test_suite: tests };
}

/**
 * The pin's seven gates, as the application's engine materializes and judges them.
 *
 * @param api - The harness.
 * @param prId - The PR.
 * @returns The definitions' ids.
 */
async function engineGates(api: ApiHarness, prId: string): Promise<Record<string, string>> {
  await api.nest.get(GateEngineService).evaluate(prId);

  const { rows } = await api.sql.query<{ id: string; gate_key: string }>(
    `select id, gate_key from ${SCHEMA_NAME}.pr_gate_definitions where pr_id = $1`,
    [prId],
  );

  return Object.fromEntries(rows.map((row) => [row.gate_key, row.id]));
}
