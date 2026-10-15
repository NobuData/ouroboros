/**
 * What the copilot certification suites stand on (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)): the development workspace, a
 * scripted engine behind the process's own engine client, and the handful of moves every suite
 * makes — open a workflow, hold a conversation, start a dry run and wait for it to end.
 *
 * **Two things are replaced, and only two.** The engine is `scripted-engine.fixture.ts`'s
 * listener, reached over HTTP by the real `EngineClient` (the issue's *stubbed at the gateway
 * boundary*). The commit a dry run pins is {@link PINNED}: the real reader asks GitHub with the
 * workspace's token, which no test database holds. Everything else — routing, the draft slot,
 * the repositories, the rule pack, the publish gate — is the process's own.
 *
 * **The workspace is the development seed**, as #626's suites have it: `acme-robotics` with its
 * aliases, skills, tickets and farm history. The seed gives the copilot no route, so the stage
 * saves one — through the routing API, to a seeded alias.
 */

import type request from "supertest";

import { ENGINE_STUB_SECRET } from "../../../testing/engine.stub.fixture";
import {
  ApiHarness,
  type Method,
  type Person,
  type Workspace,
} from "../../../testing/harness.fixture";
import { memberOf, SEEDED_WORKSPACE_SLUG } from "../../../testing/registry.seed.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { PinnedCommitReader, type PinnedCommit } from "../../dry-runs/dry-runs.commit";
import { applyDevSeeds } from "../../research/certification/certification.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import type { CopilotStreamEvent } from "../copilot.stream";
import { startScriptedEngine, type ScriptedEngine } from "./scripted-engine.fixture";

/** The commit every certification dry run is pinned to. */
export const PINNED: PinnedCommit = {
  slug: "acme-robotics/helios-firmware",
  sha: "8c1b2e4f".padEnd(40, "0"),
  token: "scripted-read-token",
};

/** The seeded alias the copilot is routed to. */
export const COPILOT_ALIAS = "coder-std";

/** How long a dry run may take to reach its end here; the scripted engine answers at once. */
const RUN_SETTLE_MS = 10_000;

/** A model stage the vocabulary accepts whole. */
export const IMPLEMENT_NODE = {
  id: "implement",
  type: "llm",
  title: "Implement",
  position: { x: 300, y: 200 },
  config: {
    mode: "prompt",
    prompt_template: "Make the change the ticket asks for.",
    routing: { inherit_task: "implement" },
    limits: { max_retries: 1, token_budget: 200_000 },
    permissions: { push_fixup: false, touch_ci: false },
  },
} as const;

/** An infra stage. */
export const TEST_NODE = {
  id: "test",
  type: "infra",
  title: "Test",
  position: { x: 560, y: 200 },
  config: {},
} as const;

/** An ending that leaves the pull request for a person. */
export const REVIEW_END = {
  id: "hand-off",
  type: "term",
  title: "Needs review",
  position: { x: 820, y: 200 },
  config: { action: "needs_review", options: {} },
} as const;

/** The trigger every certification draft starts from. */
export const TRIGGER = { event: "ticket_queued", conditions: { labels: ["bug"] } } as const;

/** A workflow a suite made. */
export interface StagedWorkflow {
  readonly id: string;
  readonly slug: string;
}

/** A conversation's stream, read to its end. */
export interface Exchange {
  /** The HTTP status — `201` for a stream, the refusal's otherwise. */
  readonly status: number;
  /** Every event, in the order it was written. */
  readonly events: CopilotStreamEvent[];
  /** The refusal's envelope, when the request was refused before a stream opened. */
  readonly refusal: { code?: string; message?: string } | null;
}

/** Everything a certification suite is handed. */
export interface CopilotStage {
  readonly api: ApiHarness;
  readonly engine: ScriptedEngine;
  readonly workspace: Workspace;
  readonly people: { readonly owner: Person; readonly member: Person; readonly viewer: Person };
  /** A request as somebody, in the seeded workspace. */
  as(person: Person, method: Method, path: string): request.Test;
  /**
   * Create a workflow the way the rail's dialog does: a name and nothing else. It has no version,
   * and its draft is the service's blank canvas — `{}`, which carries no `dsl_version`, so a
   * draft built on it by operations alone cannot be published or dry-run (#1744).
   */
  workflow(name: string): Promise<StagedWorkflow>;
  /** Start a conversation about a workflow; answers the session's id. */
  session(workflowId: string): Promise<string>;
  /** Say something in a conversation and read the reply's stream to its end. */
  say(workflowId: string, sessionId: string, text: string, as?: Person): Promise<Exchange>;
  /**
   * The workflow's draft as the database holds it: the document and its revision. The slot's
   * etag is not here — a conversation's `done` event hands that out.
   */
  draft(workflowId: string): Promise<{ definition: unknown; draftRev: number }>;
  /** A sized, open ticket of the seeded workspace a dry run may be started against. */
  ticket(): Promise<string>;
  /**
   * Start a dry run and wait for it to end.
   *
   * @returns The run, as `GET …/dry-runs/{id}` answers it once terminal.
   */
  dryRun(workflowId: string, sessionId?: string): Promise<Record<string, unknown>>;
  /** One row of a query, or `undefined`. */
  one<T>(sql: string, values?: unknown[]): Promise<T | undefined>;
  /** Stop the application and the engine. The database is truncated first. */
  close(): Promise<void>;
}

/**
 * Parse a `text/event-stream` body into its events.
 *
 * @param text - The body, as `copilot.stream.ts` wrote it.
 * @returns The events, in order.
 */
export function eventsOf(text: string): CopilotStreamEvent[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice("data: ".length)) as CopilotStreamEvent);
}

/** The kinds of a stream's events, in order — what an ordering assertion reads. */
export function kindsOf(events: readonly CopilotStreamEvent[]): string[] {
  return events.map((event) => event.kind);
}

/** The events of one kind. */
export function ofKind<K extends CopilotStreamEvent["kind"]>(
  events: readonly CopilotStreamEvent[],
  kind: K,
): Extract<CopilotStreamEvent, { kind: K }>[] {
  return events.filter(
    (event): event is Extract<CopilotStreamEvent, { kind: K }> => event.kind === kind,
  );
}

/**
 * Start the application over the seeded workspace and a scripted engine.
 *
 * @returns The stage.
 */
export async function startCopilotStage(): Promise<CopilotStage> {
  const engine = await startScriptedEngine(ENGINE_STUB_SECRET);
  const api = await ApiHarness.start({ OURO_ENGINE_URL: engine.url }, [
    { provide: PinnedCommitReader, useValue: { pin: () => Promise.resolve(PINNED) } },
  ]);

  try {
    return await stageOver(api, engine);
  } catch (error) {
    // A stage that could not be set must not leave a listening application behind it: the
    // suite's `afterAll` has nothing to close, and the run would never end.
    await api.close();
    await engine.stop();
    throw error;
  }
}

/**
 * Seed the workspace, route the copilot and assemble the stage.
 *
 * @param api - The running application.
 * @param engine - The scripted engine it calls.
 * @returns The stage.
 */
async function stageOver(api: ApiHarness, engine: ScriptedEngine): Promise<CopilotStage> {
  await applyDevSeeds(api);

  const found = await api.sql.query<Workspace>(
    `select "id", "slug", "name" from ${SCHEMA_NAME}.organization where "slug" = $1`,
    [SEEDED_WORKSPACE_SLUG],
  );
  const workspace = found.rows[0];
  if (workspace === undefined) {
    throw new Error(`The development seeds did not create the ${SEEDED_WORKSPACE_SLUG} workspace.`);
  }

  const people = {
    owner: await memberOf(api, workspace, "owner"),
    member: await memberOf(api, workspace, "member"),
    viewer: await memberOf(api, workspace, "viewer"),
  };
  const as: CopilotStage["as"] = (person, method, path) =>
    api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);

  // The copilot's kind is every workspace's (V142) and the seed routes it through
  // `copilot-primary` → `${COPILOT_ALIAS}` (#1748), so the stage stages nothing for it.

  const one: CopilotStage["one"] = async <T>(sql: string, values: unknown[] = []) => {
    const { rows } = await api.sql.query(sql, values);

    return rows[0] as T | undefined;
  };

  const stage: CopilotStage = {
    api,
    engine,
    workspace,
    people,
    as,
    one,
    workflow: async (name) => {
      const created = await as(people.owner, "post", "/api/v1/workflows")
        .send({ name })
        .expect(201);

      return created.body as StagedWorkflow;
    },
    session: async (workflowId) => {
      const started = await as(
        people.owner,
        "post",
        `/api/v1/workflows/${workflowId}/copilot/sessions`,
      )
        .send({})
        .expect(201);

      return (started.body as { id: string }).id;
    },
    say: async (workflowId, sessionId, text, person = people.owner) => {
      const answered = await as(
        person,
        "post",
        `/api/v1/workflows/${workflowId}/copilot/sessions/${sessionId}/messages`,
      ).send({ text });
      const streamed = answered.status < 300 && answered.text.startsWith("event: ");

      return {
        status: answered.status,
        events: streamed ? eventsOf(answered.text) : [],
        refusal: streamed ? null : (answered.body as Exchange["refusal"]),
      };
    },
    draft: async (workflowId) => {
      const row = await one<{ definition: unknown; draft_rev: number }>(
        `select v.definition, w.draft_rev
           from ${SCHEMA_NAME}.workflows w
           left join ${SCHEMA_NAME}.workflow_versions v on v.workflow_id = w.id and v.version is null
          where w.id = $1`,
        [workflowId],
      );

      return { definition: row?.definition ?? null, draftRev: row?.draft_rev ?? 0 };
    },
    ticket: async () => {
      const row = await one<{ id: string }>(
        `select t.id from ${SCHEMA_NAME}.tickets t
           join ${SCHEMA_NAME}.ticket_sources s on s.id = t.source_id
          where t.organization_id = $1 and s.kind = 'github'
            and t.state = 'open' and t.sizing_status = 'sized'
          order by t.external_key limit 1`,
        [workspace.id],
      );
      if (row === undefined) throw new Error("The seeds hold no sized, open GitHub ticket.");

      return row.id;
    },
    dryRun: async (workflowId, sessionId) => {
      const { draftRev } = await stage.draft(workflowId);
      const started = await as(people.owner, "post", `/api/v1/workflows/${workflowId}/dry-runs`)
        .send({
          ticketId: await stage.ticket(),
          draftRev,
          ...(sessionId === undefined ? {} : { sessionId }),
        })
        .expect(201);
      const id = (started.body as { id: string }).id;
      const deadline = Date.now() + RUN_SETTLE_MS;

      for (;;) {
        const read = await as(
          people.owner,
          "get",
          `/api/v1/workflows/${workflowId}/dry-runs/${id}`,
        ).expect(200);
        const run = read.body as Record<string, unknown>;

        if (run.status !== "running" && run.status !== "queued") return run;
        if (Date.now() > deadline) {
          throw new Error(
            `Dry run ${id} was still ${String(run.status)} after ${String(RUN_SETTLE_MS)} ms.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    close: async () => {
      await api.truncate();
      await api.close();
      await engine.stop();
    },
  };

  return stage;
}
