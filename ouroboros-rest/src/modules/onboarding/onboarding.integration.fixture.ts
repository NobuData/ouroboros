/**
 * The onboarding plane's integration bench — what every BB.6 suite
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)) starts from, so a suite spends its
 * lines on the claim it certifies rather than on arranging a workspace.
 *
 * ```
 * shipTemplates   V068's four shipped tiles, put back by the migration's own statement
 * wizardBench     a workspace mid-wizard: enabled repository, mockup 03's nine issues, a GitHub
 *                 source covering it, and the canonical ticket of #488
 * wizardIn        the same, in a workspace another fixture already stood up
 * connectGithub   step 1's subsystem truth      mirrorTicket   a source's read of one issue
 * inWorkspace     a request as somebody, carrying the workspace
 * selectTemplate · pickIssue · launchFirstLoop   the wizard's own routes, status left to the caller
 * wizardRow · launchFootprint                    what a refusal must leave untouched
 * ```
 *
 * **Why the templates are shipped rather than captured.** `ApiHarness.truncate` empties every
 * table, and `workflow_templates` holds product rows a migration wrote — so after any suite's
 * first truncate the four tiles are gone. A suite that reads them back out of the table in
 * `beforeAll` and restores that copy works only when it is the first suite of the run to touch
 * the database; after any other, the copy is empty and the restore fails. {@link shipTemplates}
 * re-runs V068's own `insert`, read from the migration, so a suite is right whatever ran before
 * it.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { readFileSync } from "node:fs";

import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import type { ApiHarness, Method, Person, SignedIn } from "../../testing/harness.fixture";
import { seedIntake } from "../../testing/intake.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { TEMPLATES_PATH } from "../workflows/dsl.seed.fixture";

/** The issue mockup 13's first-issue card picks — the seeded backlog's safest. */
export const FIRST_ISSUE_NUMBER = 488;

/** Its title, as `intake.fixture.ts` mirrors it. */
export const FIRST_ISSUE_TITLE = "Typo sweep in operator manual + pairing guide";

/** The tile mockup 13 draws selected. */
export const STARTER_TEMPLATE = "quick-fixes";

/** Where V068's shipped rows begin in its migration — the file's last statement. */
const SHIPPED_TEMPLATES_STATEMENT = `insert into ${SCHEMA_NAME}.workflow_templates`;

/** V068's `insert`, once read. */
let shippedTemplates: string | undefined;

/**
 * V068's own statement shipping the four template tiles.
 *
 * @returns The `insert`, from its first word to the end of the migration.
 * @throws {Error} When the migration no longer ends with that statement — the fixture would
 *   otherwise run whatever followed it.
 */
function shippedTemplatesStatement(): string {
  if (shippedTemplates === undefined) {
    const migration = readFileSync(TEMPLATES_PATH, "utf8");
    const start = migration.lastIndexOf(SHIPPED_TEMPLATES_STATEMENT);

    if (start === -1 || migration.indexOf(";", start) !== migration.trimEnd().length - 1) {
      throw new Error(
        `${TEMPLATES_PATH} no longer ends with one "${SHIPPED_TEMPLATES_STATEMENT}" statement; ` +
          "onboarding.integration.fixture.ts reads the shipped tiles from it.",
      );
    }

    shippedTemplates = migration.slice(start);
  }

  return shippedTemplates;
}

/**
 * Put V068's shipped template rows back when a truncate emptied them.
 *
 * Call it in `beforeEach` — and in `afterAll`, after the suite's last truncate, so a suite that
 * runs next finds the database as the migrations left it.
 *
 * @param api - The started harness.
 * @returns When the four global rows exist. A database that still has them is left alone.
 */
export async function shipTemplates(api: ApiHarness): Promise<void> {
  const { rows } = await api.sql.query(
    `select 1 from ${SCHEMA_NAME}.workflow_templates where organization_id is null limit 1`,
  );

  if (rows.length === 0) {
    await api.sql.query(shippedTemplatesStatement());
  }
}

/**
 * A repository reference as the wizard's routes take it.
 *
 * @param workspace - The workspace, whose GitHub account `workspaceWithRepo` names after its slug.
 * @param name - The repository. Defaults to the mirrored one.
 * @returns `owner/name`.
 */
export function repoRef(workspace: Pick<SeededWorkspace, "slug">, name = PRIMARY_REPO): string {
  return `${workspace.slug}/${name}`;
}

/**
 * An onboarding route for one repository.
 *
 * @param repo - `owner/name`.
 * @param tail - The route under `/api/v1/onboarding` — `/launch`, `/detection/scan`. Empty for
 *   the wizard itself.
 * @returns The path, with the repository as its query.
 */
export function wizardRoute(repo: string, tail = ""): string {
  return `/api/v1/onboarding${tail}?repo=${encodeURIComponent(repo)}`;
}

/**
 * A request builder for somebody, in a workspace.
 *
 * @param api - The started harness.
 * @param person - Who is asking.
 * @param workspace - Whose workspace the tenant header names.
 * @returns The builder — `(method, path)`, already carrying the session and the workspace.
 */
export function inWorkspace(
  api: ApiHarness,
  person: Person,
  workspace: Pick<SeededWorkspace, "slug">,
): SignedIn {
  return (method: Method, path: string) =>
    api.as(person)(method, path).set(TENANT_HEADER, workspace.slug);
}

/** How {@link connectGithub} writes a source. */
export interface GithubSourceOptions {
  /** The account its config names. Defaults to the workspace's own. */
  readonly login?: string;
  /** The repositories its config lists. Defaults to the mirrored one. */
  readonly repos?: readonly string[];
  /** What the sources screen calls it. */
  readonly displayName?: string;
}

/**
 * Step 1's subsystem truth: a GitHub ticket source whose config covers the repository.
 *
 * Written through the harness's connection, as a source's own management API would leave it —
 * the wizard never writes one.
 *
 * @param api - The started harness.
 * @param workspace - The workspace.
 * @param options - What the source names.
 * @returns `ticket_sources.id`.
 */
export async function connectGithub(
  api: ApiHarness,
  workspace: Pick<SeededWorkspace, "id" | "slug">,
  options: GithubSourceOptions = {},
): Promise<string> {
  const login = options.login ?? workspace.slug;
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
     values ($1, 'github', $2, $3::jsonb) returning id`,
    [
      workspace.id,
      options.displayName ?? `GitHub · ${login}`,
      JSON.stringify({ login, repos: options.repos ?? [PRIMARY_REPO] }),
    ],
  );

  return rows[0].id;
}

/** The issue {@link mirrorTicket} writes a canonical ticket for. */
export interface MirroredTicket {
  /** The issue's number — the ticket's `external_id`, and `#n` its key. */
  readonly number: number;
  /** Its title. */
  readonly title?: string;
  /** The repository `meta.github` names. Defaults to the mirrored one. */
  readonly repo?: string;
  /** The account `meta.github` names. Defaults to the workspace's own. */
  readonly owner?: string;
}

/**
 * The canonical ticket a GitHub source would have read for one issue (Q.3's mapper).
 *
 * @param api - The started harness.
 * @param workspace - The workspace.
 * @param sourceId - The source that read it.
 * @param issue - The issue.
 * @returns `tickets.id`.
 */
export async function mirrorTicket(
  api: ApiHarness,
  workspace: Pick<SeededWorkspace, "id" | "slug">,
  sourceId: string,
  issue: MirroredTicket,
): Promise<string> {
  const repo = issue.repo ?? PRIMARY_REPO;
  const owner = issue.owner ?? workspace.slug;
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.tickets
       (organization_id, source_id, external_id, external_key, external_url, title, state,
        source_created_at, source_updated_at, meta)
     values ($1, $2, $3::int::text, '#' || $3::int::text,
             'https://github.com/' || $5 || '/' || $6 || '/issues/' || $3::int::text,
             $4, 'open', now(), now(), $7::jsonb)
     returning id`,
    [
      workspace.id,
      sourceId,
      issue.number,
      issue.title ?? FIRST_ISSUE_TITLE,
      owner,
      repo,
      JSON.stringify({ github: { owner, repo } }),
    ],
  );

  return rows[0].id;
}

/** A workspace mid-wizard, and its owner. */
export interface WizardBench {
  readonly owner: Person;
  readonly workspace: SeededWorkspace;
  /** `owner/name` of the mirrored repository. */
  readonly repo: string;
  /** The GitHub source covering it. */
  readonly sourceId: string;
  /** `tickets.id` of `#488` — what the wizard stores as the pick. */
  readonly ticketId: string;
  /** `github_issues.id` of `#488` — what the picker answers. */
  readonly issueId: string;
}

/**
 * Steps 1 and 2 made true by their own subsystems, and the seeded backlog mirrored: an enabled
 * repository, mockup 03's nine issues with their estimates, a GitHub source covering the
 * repository, and the canonical ticket that source would have read for `#488`.
 *
 * @param api - The started harness.
 * @param owner - Who owns the workspace. Signed in when omitted.
 * @returns The bench.
 */
export async function wizardBench(api: ApiHarness, owner?: Person): Promise<WizardBench> {
  const person = owner ?? (await api.signIn());

  return wizardIn(api, person, await workspaceWithRepo(api, person));
}

/**
 * {@link wizardBench} in a workspace another fixture already stood up — the PR plane's scene, for
 * the suite whose subject is the join between the two.
 *
 * @param api - The started harness.
 * @param owner - The workspace's owner.
 * @param workspace - A workspace whose repository is mirrored and enabled.
 * @returns The bench.
 */
export async function wizardIn(
  api: ApiHarness,
  owner: Person,
  workspace: SeededWorkspace,
): Promise<WizardBench> {
  await seedIntake(api, workspace);

  const sourceId = await connectGithub(api, workspace);
  const ticketId = await mirrorTicket(api, workspace, sourceId, { number: FIRST_ISSUE_NUMBER });

  return {
    owner,
    workspace,
    repo: repoRef(workspace),
    sourceId,
    ticketId,
    issueId: await issueIdOf(api, workspace, FIRST_ISSUE_NUMBER),
  };
}

/**
 * A mirrored issue's id — what BB.4's picker answers and `pickedIssueId` takes.
 *
 * @param api - The started harness.
 * @param workspace - The workspace.
 * @param issueNumber - The issue's number.
 * @returns `github_issues.id`.
 */
export async function issueIdOf(
  api: ApiHarness,
  workspace: Pick<SeededWorkspace, "id">,
  issueNumber: number,
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `select id from ${SCHEMA_NAME}.github_issues where organization_id = $1 and number = $2`,
    [workspace.id, issueNumber],
  );

  return rows[0].id;
}

/**
 * Step 3 through the wizard's own route: instantiate and publish a template. Needs the engine
 * stub — selecting publishes, and publishing asks the engine.
 *
 * @param api - The started harness.
 * @param at - The bench.
 * @param slug - The template. Defaults to mockup 13's selected tile.
 * @returns The pending request, for the caller to expect a status on.
 */
export function selectTemplate(
  api: ApiHarness,
  at: Pick<WizardBench, "owner" | "workspace" | "repo">,
  slug: string = STARTER_TEMPLATE,
): ReturnType<SignedIn> {
  return inWorkspace(
    api,
    at.owner,
    at.workspace,
  )("post", wizardRoute(at.repo, "/select-template")).send({ slug });
}

/**
 * Store the pick the way the first-issue card does: by the picker's `issueId`.
 *
 * @param api - The started harness.
 * @param at - The bench.
 * @param issueId - `github_issues.id`. Defaults to the bench's `#488`.
 * @returns The pending request.
 */
export function pickIssue(
  api: ApiHarness,
  at: Pick<WizardBench, "owner" | "workspace" | "repo" | "issueId">,
  issueId: string = at.issueId,
): ReturnType<SignedIn> {
  return inWorkspace(
    api,
    at.owner,
    at.workspace,
  )("patch", wizardRoute(at.repo)).send({ pickedIssueId: issueId });
}

/**
 * *Run my first loop*.
 *
 * @param api - The started harness.
 * @param at - The bench.
 * @param person - Who presses it. Defaults to the owner.
 * @returns The pending request.
 */
export function launchFirstLoop(
  api: ApiHarness,
  at: Pick<WizardBench, "owner" | "workspace" | "repo">,
  person: Person = at.owner,
): ReturnType<SignedIn> {
  return inWorkspace(api, person, at.workspace)("post", wizardRoute(at.repo, "/launch"));
}

/**
 * The wizard's stored row for one repository — what a read, a refusal and a derived step must
 * never change.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @param repo - `owner/name`; compared lower-case, as the wizard stores it.
 * @returns The row, or `undefined` when the wizard was never written for the repository.
 */
export async function wizardRow(
  api: ApiHarness,
  organizationId: string,
  repo: string,
): Promise<Record<string, unknown> | undefined> {
  const { rows } = await api.sql.query<Record<string, unknown>>(
    `select * from ${SCHEMA_NAME}.onboarding_state where organization_id = $1 and repo_ref = $2`,
    [organizationId, repo.toLowerCase()],
  );

  return rows[0];
}

/** Everything a launch writes, counted — what a refused launch must leave at zero. */
export interface LaunchFootprint {
  /** Queue items in the workspace. */
  readonly queued: number;
  /** Wizards stamped completed. */
  readonly completed: number;
  /** Dry-run policy rows — one once the workspace has answered, or completion answered for it. */
  readonly policies: number;
}

/**
 * What a launch has written in a workspace so far.
 *
 * @param api - The started harness.
 * @param organizationId - The workspace.
 * @returns The counts, read straight from the three tables a launch writes.
 */
export async function launchFootprint(
  api: ApiHarness,
  organizationId: string,
): Promise<LaunchFootprint> {
  const { rows } = await api.sql.query<LaunchFootprint>(
    `select (select count(*) from ${SCHEMA_NAME}.queue_items where organization_id = $1)::int
              as queued,
            (select count(*) from ${SCHEMA_NAME}.onboarding_state
              where organization_id = $1 and completed_at is not null)::int as completed,
            (select count(*) from ${SCHEMA_NAME}.org_policies where organization_id = $1)::int
              as policies`,
    [organizationId],
  );

  return rows[0];
}

/** A launch that wrote nothing. */
export const NO_FOOTPRINT: LaunchFootprint = { queued: 0, completed: 0, policies: 0 };
