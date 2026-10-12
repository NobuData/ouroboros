/**
 * What the dry-run certification suites share (CD.6,
 * [#564](https://github.com/NobuData/ouroboros/issues/564)): a draft a dry run accepts, the
 * routes under a workflow's dry runs, and the footprint a dry run must not leave.
 *
 * **Drafts are created whole.** `POST /api/v1/workflows` takes the document the canvas opens on,
 * so a suite that certifies what happens *after* the draft exists sends the document it wants
 * tested rather than holding a conversation to build it; the conversation is
 * `sessions.certification`'s subject.
 */

import request from "supertest";

import type { Person } from "../../../testing/harness.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import type { DryRunResource } from "../../dry-runs/dry-runs.resources";
import type { DryRunSuggestionResource } from "../../dry-runs/suggestions.resources";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import {
  IMPLEMENT_NODE,
  TRIGGER,
  ofKind,
  type CopilotStage,
  type StagedWorkflow,
} from "./certification.fixture";
import { done, toolCall, usage, type WireEvent } from "./scripted-engine.fixture";

/** A node of a certification draft. */
export type DraftNode = Readonly<Record<string, unknown>> & { readonly id: string };

/** An edge of a certification draft. */
export interface DraftEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "default" | "branch" | "loop";
}

/** An ending the vocabulary accepts whole: the pull request waits for a person. */
export const NEEDS_REVIEW: DraftNode = {
  id: "needs-review",
  type: "term",
  title: "Needs review",
  position: { x: 1100, y: 200 },
  config: { action: "needs_review", options: {} },
};

/** The trigger node every document carries; what it fires on is the document's `trigger`. */
export const TRIGGER_NODE: DraftNode = {
  id: "trigger",
  type: "trigger",
  title: "Ticket queued",
  position: { x: 40, y: 200 },
  config: {},
};

/**
 * A model stage, on {@link IMPLEMENT_NODE}'s configuration.
 *
 * @param id - The stage's id.
 * @param x - Where it sits on the canvas.
 * @param config - What to change in the configuration — a skill, say.
 * @returns The node.
 */
export function modelStage(id: string, x: number, config: Record<string, unknown> = {}): DraftNode {
  return {
    ...IMPLEMENT_NODE,
    id,
    title: id,
    position: { x, y: 200 },
    config: { ...IMPLEMENT_NODE.config, ...config },
  };
}

/**
 * A document whose stages run one after another, from the trigger to {@link NEEDS_REVIEW}.
 *
 * @param stages - The stages between the trigger and the ending, in order.
 * @returns The document, as the draft slot stores it.
 */
export function chain(...stages: readonly DraftNode[]): Record<string, unknown> {
  const nodes = [TRIGGER_NODE, ...stages, NEEDS_REVIEW];

  return {
    dsl_version: "1.0",
    trigger: TRIGGER,
    nodes,
    edges: nodes
      .slice(1)
      .map((node, index): DraftEdge => ({ from: nodes[index].id, to: node.id, kind: "default" })),
  };
}

/**
 * Create a workflow whose draft is a document.
 *
 * @param stage - The stage.
 * @param name - The workflow's name; unique within a suite.
 * @param definition - The draft.
 * @returns The workflow.
 */
export async function drafted(
  stage: CopilotStage,
  name: string,
  definition: Record<string, unknown>,
): Promise<StagedWorkflow> {
  const created = await stage
    .as(stage.people.owner, "post", "/api/v1/workflows")
    .send({ name, definition })
    .expect(201);

  return created.body as StagedWorkflow;
}

/**
 * The routes under a workflow's dry runs.
 *
 * @param workflowId - The workflow.
 * @param rest - What follows `…/dry-runs`.
 * @returns The path.
 */
export function dryRunsPath(workflowId: string, rest = ""): string {
  return `/api/v1/workflows/${workflowId}/dry-runs${rest}`;
}

/**
 * Start a dry run of a workflow's draft and wait for it to end.
 *
 * @param stage - The stage.
 * @param workflowId - The workflow.
 * @param sessionId - The conversation it is started from, when there is one.
 * @returns The dry run, terminal.
 */
export async function ran(
  stage: CopilotStage,
  workflowId: string,
  sessionId?: string,
): Promise<DryRunResource> {
  return (await stage.dryRun(workflowId, sessionId)) as unknown as DryRunResource;
}

/**
 * A dry run's suggestions, as any member reads them.
 *
 * @param stage - The stage.
 * @param workflowId - The workflow.
 * @param dryRunId - The dry run.
 * @param reader - Who is reading; the viewer unless a suite says otherwise.
 * @returns The callouts, in card order.
 */
export async function suggestionsOf(
  stage: CopilotStage,
  workflowId: string,
  dryRunId: string,
  reader: Person = stage.people.viewer,
): Promise<DryRunSuggestionResource[]> {
  const read = await stage
    .as(reader, "get", dryRunsPath(workflowId, `/${dryRunId}/suggestions`))
    .expect(200);

  return (read.body as { suggestions: DryRunSuggestionResource[] }).suggestions;
}

/**
 * Have the copilot make tool calls in a conversation, and read the exchange to its end.
 *
 * @param stage - The stage.
 * @param workflowId - The workflow.
 * @param sessionId - The conversation.
 * @param calls - `[tool, arguments]`, in order.
 * @returns The outcome of each call, in order — `applied`, `proposed` or `bounced`.
 */
export async function called(
  stage: CopilotStage,
  workflowId: string,
  sessionId: string,
  ...calls: readonly (readonly [tool: string, args: Record<string, unknown>])[]
): Promise<string[]> {
  const turn: WireEvent[] = [
    ...calls.map(([tool, args], index) => toolCall(`call-${String(index)}`, tool, args)),
    usage(100, 20, 1),
    done("tool_use"),
  ];

  stage.engine.script(turn);

  const exchange = await stage.say(workflowId, sessionId, "Make the change.");

  return ofKind(exchange.events, "operation").map((event) => event.outcome);
}

/**
 * A request to an internal route, the way the engine makes it.
 *
 * @param stage - The stage.
 * @param path - The route, from `/internal`.
 * @param body - What is sent.
 * @returns The request, with the internal key set.
 */
export function internalPost(stage: CopilotStage, path: string, body: object): request.Test {
  return request(stage.api.baseUrl)
    .post(path)
    .set(INTERNAL_KEY_HEADER, stage.api.configuration.engineSharedSecret)
    .send(body);
}

/** The tables a dry run may write: its own records, and nothing else. */
export const DRY_RUN_TABLES: readonly string[] = [
  "dry_runs",
  "dry_run_stages",
  "dry_run_artifacts",
  "dry_run_suggestions",
];

/** A table whose rows are watched: the workspace's own where it says whose they are, else all. */
export interface WatchedTable {
  readonly name: string;
  /** Whether the table carries `organization_id`; one that does not is watched whole. */
  readonly scoped: boolean;
}

/** One table's state: how many rows, and a digest of every one of them. */
export interface TableState {
  readonly rows: number;
  readonly digest: string;
}

/**
 * Every table of the schema, less the ones named.
 *
 * Read from the catalogue rather than listed, so a table a later migration adds is watched
 * without anybody remembering to add it here.
 *
 * @param stage - The stage.
 * @param except - Tables to leave out.
 * @returns The tables, by name.
 */
export async function watchedTables(
  stage: CopilotStage,
  except: readonly string[] = [],
): Promise<WatchedTable[]> {
  const { rows } = await stage.api.sql.query<WatchedTable>(
    `select t.table_name as name,
            exists (select 1 from information_schema.columns c
                     where c.table_schema = t.table_schema and c.table_name = t.table_name
                       and c.column_name = 'organization_id') as scoped
       from information_schema.tables t
      where t.table_schema = $1 and t.table_type = 'BASE TABLE'
        and t.table_name <> all($2::text[])
      order by t.table_name`,
    [SCHEMA_NAME, except],
  );

  return rows;
}

/**
 * The same tables as {@link DRY_RUN_TABLES}, as watched tables.
 *
 * @returns The four, each scoped to the workspace.
 */
export function dryRunTables(): WatchedTable[] {
  return DRY_RUN_TABLES.map((name) => ({ name, scoped: true }));
}

/**
 * The rows of a list of tables — counted and digested, so an insert, a delete and an update
 * each show.
 *
 * @param stage - The stage.
 * @param tables - The tables.
 * @returns Each table's state, by name.
 */
export async function footprint(
  stage: CopilotStage,
  tables: readonly WatchedTable[],
): Promise<Record<string, TableState>> {
  const state: Record<string, TableState> = {};

  for (const table of tables) {
    const row = await stage.one<TableState>(
      `select count(*)::int as rows,
              md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as digest
         from ${SCHEMA_NAME}."${table.name}" t
        where ${table.scoped ? "t.organization_id = $1" : "$1::text is not null"}`,
      [stage.workspace.id],
    );
    if (row === undefined) throw new Error(`The footprint of ${table.name} answered no row.`);
    state[table.name] = row;
  }

  return state;
}

/**
 * The tables that hold a string anywhere in a row.
 *
 * @param stage - The stage.
 * @param needle - What to look for.
 * @param tables - Where to look.
 * @returns The names of the tables holding it; empty when none does.
 */
export async function holding(
  stage: CopilotStage,
  needle: string,
  tables: readonly WatchedTable[],
): Promise<string[]> {
  const found: string[] = [];

  for (const table of tables) {
    const hit = await stage.one<{ hits: number }>(
      `select count(*)::int as hits from ${SCHEMA_NAME}."${table.name}" t
        where position($1 in t::text) > 0`,
      [needle],
    );
    if ((hit?.hits ?? 0) > 0) found.push(table.name);
  }

  return found;
}

/**
 * The tables whose state differs between two footprints.
 *
 * @param before - The earlier footprint.
 * @param after - The later one.
 * @returns The names of the tables that changed; empty when nothing did.
 */
export function changedTables(
  before: Readonly<Record<string, TableState>>,
  after: Readonly<Record<string, TableState>>,
): string[] {
  return Object.keys({ ...before, ...after }).filter(
    (table) =>
      before[table]?.rows !== after[table]?.rows || before[table]?.digest !== after[table]?.digest,
  );
}
