/**
 * A planning workspace for the harness suites (AL.6,
 * [#282](https://github.com/NobuData/ouroboros/issues/282)): somebody in every role, a GitHub
 * source with a sealed credential, and batches, epics and tickets written straight to the tables.
 *
 * Straight to the tables where the route that would write them is not the subject — a role-matrix
 * case needs *a* batch to push, not a generation — so a suite can afford a fresh fixture per call
 * and still stay inside AL.6's runtime budget. Generation itself is proved over HTTP by
 * `planning.integration-spec.ts` and `push.guarantees.integration-spec.ts`.
 */

import type { ApiHarness, Method, Person } from "../../testing/harness.fixture";
import { SCHEMA_NAME, type DraftBatchStatus, type OrganizationRole } from "../db/schema";
import { seedRoutingBench, type RoutingBench } from "../routing/workspace.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import {
  SOURCE_CONFIG,
  SOURCE_LOGIN,
  SOURCE_REPO,
  SOURCE_TOKEN,
} from "../ticket-sources/providers/github.provider.fixture";
import { VaultService } from "../vault/vault.service";

/** Every workspace role, from the most to the least trusted. */
export const EVERY_ROLE: readonly OrganizationRole[] = ["owner", "admin", "member", "viewer"];

/** A workspace the planning page can work in. */
export interface PlanningWorkspace {
  /** The routed workspace — routing is what sizing needs. */
  readonly bench: RoutingBench;
  /** Somebody holding each role there. */
  readonly people: Readonly<Record<OrganizationRole, Person>>;
  /** The GitHub source, credential sealed. */
  readonly sourceId: string;
}

/**
 * Seed a routed workspace with a person in every role and a writable GitHub source.
 *
 * @param api - The running harness.
 * @returns The workspace.
 */
export async function planningWorkspace(api: ApiHarness): Promise<PlanningWorkspace> {
  const owner = await api.signIn();
  const bench = await seedRoutingBench(api, owner);
  const admin = await api.signIn();
  const member = await api.signIn();
  const viewer = await api.signIn();

  await api.join(bench.id, admin, "admin");
  await api.join(bench.id, member, "member");
  await api.join(bench.id, viewer, "viewer");

  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
     values ($1, 'github', 'GitHub · acme-robotics', $2::jsonb) returning id`,
    [bench.id, JSON.stringify(SOURCE_CONFIG)],
  );
  const sourceId = rows[0].id;
  const sealed = await api.nest.get(VaultService).encryptText(bench.id, sourceId, SOURCE_TOKEN);

  await api.sql.query(
    `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
    [sourceId, sealed],
  );

  return { bench, people: { owner, admin, member, viewer }, sourceId };
}

/**
 * A request as somebody, in a workspace.
 *
 * @param api - The running harness.
 * @param slug - The workspace's slug — the tenant header.
 * @param person - Who.
 * @param method - The verb.
 * @param path - The path.
 * @returns The Supertest request.
 */
export function callAs(
  api: ApiHarness,
  slug: string,
  person: Person,
  method: Method,
  path: string,
) {
  return api.as(person)(method, path).set(TENANT_HEADER, slug);
}

/** How {@link insertBatch} shapes a batch. */
export interface BatchShape {
  /** Local keys, in key order. Defaults to `OTA-1`…`OTA-6`. */
  readonly keys?: readonly string[];
  /** `[blocker, blocked]` local keys. Defaults to none. */
  readonly blocks?: readonly (readonly [string, string])[];
  /** The batch's status. Defaults to `sized`. */
  readonly status?: DraftBatchStatus;
  /** The epic it belongs to. Defaults to none. */
  readonly epicId?: string | null;
  /** The milestone. Defaults to none. */
  readonly milestone?: string | null;
}

/** A batch the fixture wrote. */
export interface InsertedBatch {
  /** `draft_batches.id`. */
  readonly id: string;
  /** Draft ids by local key. */
  readonly drafts: ReadonlyMap<string, string>;
}

/** Mockup 09's six keys. */
const OTA_KEYS = ["OTA-1", "OTA-2", "OTA-3", "OTA-4", "OTA-5", "OTA-6"] as const;

/**
 * Write a batch, its drafts and their dependencies.
 *
 * @param api - The running harness.
 * @param workspace - The workspace; the batch targets its source.
 * @param shape - The batch.
 * @returns The batch and its draft ids.
 */
export async function insertBatch(
  api: ApiHarness,
  workspace: PlanningWorkspace,
  shape: BatchShape = {},
): Promise<InsertedBatch> {
  const organizationId = workspace.bench.id;
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.draft_batches
       (organization_id, source_prompt, planner, target_source_id, target_milestone, status, epic_id)
     values ($1, 'OTA power-loss safety', 'outline-v0', $2, $3, $4, $5)
     returning id`,
    [
      organizationId,
      workspace.sourceId,
      shape.milestone ?? null,
      shape.status ?? "sized",
      shape.epicId ?? null,
    ],
  );
  const id = rows[0].id;
  const drafts = new Map<string, string>();

  for (const key of shape.keys ?? OTA_KEYS) {
    const draft = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_drafts (batch_id, local_key, title, body)
       values ($1, $2, $3, $4) returning id`,
      [id, key, `${key}: planned work`, `Evidence for ${key}.`],
    );

    drafts.set(key, draft.rows[0].id);
  }

  for (const [blocker, blocked] of shape.blocks ?? []) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.ticket_dependencies
         (organization_id, blocker_draft_id, blocked_draft_id)
       values ($1, $2, $3)`,
      [organizationId, drafts.get(blocker), drafts.get(blocked)],
    );
  }

  return { id, drafts };
}

/**
 * Write a planning epic at the end of the workspace's lanes.
 *
 * @param api - The running harness.
 * @param organizationId - The workspace.
 * @param name - Its name.
 * @returns Its id.
 */
export async function insertEpic(
  api: ApiHarness,
  organizationId: string,
  name = "OTA power-loss safety",
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.planning_epics (organization_id, name, sort_order)
     select $1, $2, coalesce(max(sort_order), 0) + 1
       from ${SCHEMA_NAME}.planning_epics where organization_id = $1
     returning id`,
    [organizationId, name],
  );

  return rows[0].id;
}

/** One canonical ticket to write. */
export interface TicketRow {
  /** The issue number — also its external id. */
  readonly number: number;
  /** Open or closed. Defaults to open. */
  readonly state?: "open" | "closed";
}

/**
 * Write canonical tickets into the workspace's source.
 *
 * @param api - The running harness.
 * @param workspace - The workspace.
 * @param tickets - The tickets.
 * @returns Their ids, in the order given.
 */
export async function insertTickets(
  api: ApiHarness,
  workspace: PlanningWorkspace,
  tickets: readonly TicketRow[],
): Promise<string[]> {
  const ids: string[] = [];

  for (const ticket of tickets) {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.tickets
         (organization_id, source_id, external_id, external_key, external_url, title, state,
          source_created_at, source_updated_at)
       values ($1, $2, $3::text, '#' || $3::text,
               'https://github.com/acme-robotics/helios-firmware/issues/' || $3::text,
               'Seeded ticket #' || $3::text, $4, now(), now())
       returning id`,
      [workspace.bench.id, workspace.sourceId, ticket.number, ticket.state ?? "open"],
    );

    ids.push(rows[0].id);
  }

  return ids;
}

/**
 * One count off the database.
 *
 * @param api - The running harness.
 * @param query - A `select count(*)::int as count …`.
 * @param values - Its parameters.
 * @returns The count.
 */
export async function countOf(api: ApiHarness, query: string, values: unknown[]): Promise<number> {
  const { rows } = await api.sql.query<{ count: number }>(query, values);

  return rows[0].count;
}

/**
 * Mirror GitHub issues the way the backlog sync would, each with an estimate in force — what
 * INTAKE-M.3 queues from, and what the queue-small hook matches pushed drafts against.
 *
 * @param api - The running harness.
 * @param organizationId - The workspace.
 * @param issues - Issue numbers, each with the sizing status its mirror row holds.
 * @returns The mirror rows' ids by issue number.
 */
export async function mirrorIssues(
  api: ApiHarness,
  organizationId: string,
  issues: readonly (readonly [number, "sized" | "unsized"])[],
): Promise<Map<number, string>> {
  const s = SCHEMA_NAME;
  const { rows: orgs } = await api.sql.query<{ id: string }>(
    `insert into ${s}.github_orgs (organization_id, login, enabled) values ($1, $2, true) returning id`,
    [organizationId, SOURCE_LOGIN],
  );
  const { rows: repos } = await api.sql.query<{ id: string }>(
    `insert into ${s}.github_repos (org_id, name, enabled) values ($1, $2, true) returning id`,
    [orgs[0].id, SOURCE_REPO],
  );
  const ids = new Map<number, string>();

  for (const [number, sizingStatus] of issues) {
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ${s}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       values ($1, $2, $3::int, 'Pushed ticket', null, 'open', '[]'::jsonb, now(), now(),
               'https://github.com/acme-robotics/helios-firmware/issues/' || $3::int::text, $4)
       returning id`,
      [organizationId, repos[0].id, number, sizingStatus],
    );

    ids.set(number, rows[0].id);

    if (sizingStatus === "sized") {
      await api.sql.query(
        `insert into ${s}.issue_estimates
                (github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
                 breakdown, risk, risk_note, trace)
         values ($1, 1, 'xs', 90, 'feature-loop', 'claude-fable-5',
                 '{"files":[],"est_tokens":1000,"cycle_min":5,"cycle_max":10,"est_minutes":20}'::jsonb,
                 'low', 'Small.',
                 '{"estimator":"heuristic-v0","sized_at":"2026-09-16T15:00:00.000Z","tokens_used":0,"signals":[]}'::jsonb)`,
        [rows[0].id],
      );
    }
  }

  return ids;
}
