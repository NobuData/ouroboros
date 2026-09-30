/**
 * `PlaybooksService` — recipes learned from runs, and launched onto issues (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415), decision **K6**).
 *
 * ```
 * CRUD             V072's shapes; the pin must be a published version; refs checked by V072
 * draftFromRun     terminal run ─▶ pin · deriveOverrides(injected, assembly now) · steers ─▶ draft
 * createFromRun    draftFromRun ─▶ named ─▶ insert (source_run_id recorded)
 * issues           the picker — open issues V072's playbook_issue_filter_admits lets through
 * launch           filter ─▶ BacklogQueueService (#112) with the pin (#143) + playbook_id ─▶ receipt
 * counts           count(runs.playbook_id) — no counter column is ever written
 * ```
 *
 * **Run-on-issue is composition, not new machinery.** A launch is the queue write M.3 already
 * performs, handed a {@link QueueLaunch}: the playbook's workflow at its **pinned** version (never
 * the head), and the `playbook_id` every queued row carries. The run that opens for that row under
 * that pin inherits the id (`ingest.service.ts`), and that run is what `run 9×` counts. The preset
 * reaches the run through the same id: its context is {@link PlaybooksService.context} —
 * assembly for the `playbook` consumer with the playbook's overrides, and the preset's steer notes
 * and extra facts — which the receipt carries so the launch is visibly attached.
 *
 * **Create-from-run copies evidence.** The run's workflow pin, its injected skills as a delta
 * against what assembly resolves for its scope today, and the steers someone typed — see
 * `playbooks.derive.ts` for each rule. The draft is served first (`GET …/from-run/{runId}`) so a
 * person can edit and name it; `POST …/from-run` stores it with `source_run_id`.
 */

import { Injectable } from "@nestjs/common";

import { BacklogQueueService } from "../backlog/queue.service";
import { ContextAssemblyService } from "../context-assembly/context-assembly.service";
import { TERMINAL_RUN_STATUSES, type RunStatus } from "../db/schema";
import { violatesConstraint } from "../tenancy/constraints";
import {
  NO_PLAYBOOK_OVERRIDES,
  NO_PLAYBOOK_PRESET,
  deriveOverrides,
  overlapOf,
  readFilter,
  readOverrides,
  readPreset,
  steerPreset,
  storedFilter,
  storedOverrides,
  storedPreset,
  type PlaybookIssueFilter,
  type PlaybookOverrides,
  type PlaybookPreset,
} from "./playbooks.derive";
import {
  DEFAULT_PICKER_LIMIT,
  type CreatePlaybookBody,
  type CreatePlaybookFromRunBody,
  type IssueFilterBody,
  type UpdatePlaybookBody,
} from "./playbooks.dto";
import {
  PLAYBOOK_CONSTRAINTS,
  issueFiltered,
  issueNotFound,
  nameTaken,
  overridesOverlap,
  playbookNotFound,
  referenceUnresolved,
  runNotFound,
  runNotTerminal,
  runUnpinned,
  versionNotPublished,
  workflowNotFound,
} from "./playbooks.errors";
import { PlaybooksRepository, type PlaybookWrite } from "./playbooks.repository";
import {
  launchLinks,
  playbookResource,
  suggestedDescription,
  type PlaybookContextResource,
  type PlaybookCounts,
  type PlaybookDraftResource,
  type PlaybookIssueList,
  type PlaybookLaunchReceipt,
  type PlaybookList,
  type PlaybookResource,
  type PlaybookRow,
} from "./playbooks.resources";

@Injectable()
export class PlaybooksService {
  /**
   * @param store - The statements.
   * @param assembly - BF.5's one resolution — for derived overrides and the attached context.
   * @param queue - M.3's queue write, which a launch composes.
   */
  constructor(
    private readonly store: PlaybooksRepository,
    private readonly assembly: ContextAssemblyService,
    private readonly queue: BacklogQueueService,
  ) {}

  /**
   * The card: every recipe, each with its counted launches.
   *
   * @param organizationId - The workspace.
   * @returns The list, by name.
   */
  async list(organizationId: string): Promise<PlaybookList> {
    return { items: (await this.store.list(organizationId)).map(playbookResource) };
  }

  /**
   * One recipe.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @returns It.
   * @throws {NotFoundError} `playbook_not_found`.
   */
  async read(organizationId: string, id: string): Promise<PlaybookResource> {
    return playbookResource(await this.require(organizationId, id));
  }

  /**
   * Every playbook's launch count — derived from the runs carrying its id.
   *
   * @param organizationId - The workspace.
   * @returns The counts, zero included.
   */
  async counts(organizationId: string): Promise<PlaybookCounts> {
    return { counts: await this.store.counts(organizationId) };
  }

  /**
   * Create a hand-authored recipe.
   *
   * @param organizationId - The workspace.
   * @param body - Name, description, pin, overrides, preset and filter.
   * @returns The playbook.
   * @throws {InvalidRequestError} `playbook_workflow_not_found`,
   *   `playbook_workflow_version_not_published`, `playbook_overrides_overlap`,
   *   `playbook_reference_unresolved`.
   * @throws {ConflictError} `playbook_name_taken`.
   */
  async create(organizationId: string, body: CreatePlaybookBody): Promise<PlaybookResource> {
    const workflowId = await this.pin(organizationId, body.workflow, body.workflowVersion);

    return this.insert(organizationId, {
      name: body.name.trim(),
      description: body.description.trim(),
      workflowId,
      workflowVersion: body.workflowVersion,
      overrides: overridesOf(body.skillOverrides),
      preset: presetOf(body.contextPreset),
      filter: filterOf(body.issueFilter),
      sourceRunId: null,
    });
  }

  /**
   * Change a recipe. Absent fields keep their value; `issueFilter: null` clears the filter.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @param body - The change.
   * @returns The playbook after it.
   * @throws {NotFoundError} `playbook_not_found`.
   * @throws Everything {@link PlaybooksService.create} throws.
   */
  async update(
    organizationId: string,
    id: string,
    body: UpdatePlaybookBody,
  ): Promise<PlaybookResource> {
    const row = await this.require(organizationId, id);
    const repinned = body.workflow !== undefined || body.workflowVersion !== undefined;
    const slug = body.workflow ?? row.workflow_slug;
    const version = body.workflowVersion ?? row.workflow_version;
    const workflowId = repinned ? await this.pin(organizationId, slug, version) : row.workflow_id;
    const overrides =
      body.skillOverrides === undefined
        ? readOverrides(row.skill_overrides)
        : overridesOf(body.skillOverrides);

    refuseOverlap(overrides);

    await this.write(async () => {
      const updated = await this.store.update(organizationId, id, {
        name: body.name?.trim() ?? row.name,
        description: body.description?.trim() ?? row.description,
        workflowId,
        workflowVersion: version,
        skillOverrides: JSON.stringify(storedOverrides(overrides)),
        contextPreset: JSON.stringify(
          storedPreset(
            body.contextPreset === undefined
              ? readPreset(row.context_preset)
              : presetOf(body.contextPreset),
          ),
        ),
        issueFilter: serialiseFilter(
          body.issueFilter === undefined
            ? readFilter(row.issue_filter)
            : filterOf(body.issueFilter),
        ),
      });

      if (!updated) throw playbookNotFound(id);
    }, body.name ?? row.name);

    return this.read(organizationId, id);
  }

  /**
   * Delete a recipe. Its runs and queued items keep their history, with `playbook_id` cleared.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @throws {NotFoundError} `playbook_not_found`.
   */
  async delete(organizationId: string, id: string): Promise<void> {
    if (!(await this.store.delete(organizationId, id))) throw playbookNotFound(id);
  }

  /**
   * What a recipe learned from a run would hold — served before it is named and stored.
   *
   * @param organizationId - The workspace.
   * @param runId - A terminal run.
   * @returns The draft: pin, derived overrides, steer notes and where each came from.
   * @throws {NotFoundError} `playbook_run_not_found`.
   * @throws {ConflictError} `playbook_run_not_terminal`.
   * @throws {InvalidRequestError} `playbook_run_unpinned`.
   */
  async draftFromRun(organizationId: string, runId: string): Promise<PlaybookDraftResource> {
    const run = await this.store.runSource(organizationId, runId);

    if (run === undefined) throw runNotFound(runId);
    if (!isTerminal(run.status)) throw runNotTerminal(runId, run.status);

    const workflowId =
      run.workflowVersionPin === null
        ? undefined
        : await this.store.workflowBySlug(organizationId, run.workflowTag);

    if (
      workflowId === undefined ||
      run.workflowVersionPin === null ||
      !(await this.store.versionPublished(workflowId, run.workflowVersionPin))
    ) {
      throw runUnpinned(runId, run.workflowTag);
    }

    const [injections, steers, resolved] = await Promise.all([
      this.store.runInjections(organizationId, runId),
      this.store.runSteers(organizationId, runId),
      this.assembly.assemble(
        organizationId,
        { repo: run.repo, workflow: run.workflowTag },
        "playbook",
      ),
    ]);

    return {
      sourceRunId: run.id,
      sourceLoopSeq: run.loopSeq,
      workflow: { id: workflowId, slug: run.workflowTag, version: run.workflowVersionPin },
      skillOverrides: deriveOverrides(
        injections.records === 0 ? null : new Set(injections.skillIds),
        resolved.skillVersions,
      ),
      contextPreset: { steerNotes: steerPreset(steers), factIds: [] },
      derivedFrom: { repo: run.repo, injections: injections.records, steers: steers.length },
      suggestedDescription: suggestedDescription(run.loopSeq, run.issueNumber, run.issueTitle),
    };
  }

  /**
   * **+ New playbook from a past run…** — the draft, named, stored with its provenance.
   *
   * @param organizationId - The workspace.
   * @param body - The run, the name, and optionally a description and filter.
   * @returns The playbook, `sourceRunId` set.
   * @throws Everything {@link PlaybooksService.draftFromRun} and {@link PlaybooksService.create}
   *   throw.
   */
  async createFromRun(
    organizationId: string,
    body: CreatePlaybookFromRunBody,
  ): Promise<PlaybookResource> {
    const draft = await this.draftFromRun(organizationId, body.runId);

    return this.insert(organizationId, {
      name: body.name.trim(),
      description: body.description?.trim() ?? draft.suggestedDescription,
      workflowId: draft.workflow.id,
      workflowVersion: draft.workflow.version,
      overrides: draft.skillOverrides,
      preset: draft.contextPreset,
      filter: filterOf(body.issueFilter),
      sourceRunId: draft.sourceRunId,
    });
  }

  /**
   * *Run on issue… ▾*'s list — open issues the playbook's filter admits.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @param query - A title or number match, and a page size.
   * @returns The candidates, newest first, each saying whether it is already queued.
   * @throws {NotFoundError} `playbook_not_found`.
   */
  async issues(
    organizationId: string,
    id: string,
    query: { q?: string; limit?: number } = {},
  ): Promise<PlaybookIssueList> {
    const row = await this.require(organizationId, id);
    const rows = await this.store.issues(organizationId, row.issue_filter, {
      q: query.q,
      limit: query.limit ?? DEFAULT_PICKER_LIMIT,
    });

    return {
      items: rows.map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        repo: issue.repo,
        labels: issue.labels,
        sizingStatus: issue.sizingStatus,
        queued: issue.queued,
      })),
    };
  }

  /**
   * The context a launch of this playbook into a repository attaches.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @param repo - `owner/name`, or undefined for the workspace-wide manifest.
   * @returns Assembly for the `playbook` consumer with the overrides, and the preset.
   * @throws {NotFoundError} `playbook_not_found`.
   */
  async context(
    organizationId: string,
    id: string,
    repo?: string,
  ): Promise<PlaybookContextResource> {
    return this.contextOf(organizationId, await this.require(organizationId, id), repo ?? null);
  }

  /**
   * **Run on issue… ▾** — queue the issue under the playbook's pin, carrying its id.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @param issueId - `github_issues.id`.
   * @returns The receipt: the queued item, its position, the attached context and links.
   * @throws {NotFoundError} `playbook_not_found`, `playbook_issue_not_found`.
   * @throws {InvalidRequestError} `playbook_issue_filtered`, and the queue write's own refusals.
   * @throws {ConflictError} `queue_issues_conflict` — the issue is already queued.
   */
  async launch(
    organizationId: string,
    id: string,
    issueId: string,
  ): Promise<PlaybookLaunchReceipt> {
    const row = await this.require(organizationId, id);
    const issue = await this.store.issue(organizationId, row.issue_filter, issueId);

    if (issue === undefined) throw issueNotFound(issueId);
    if (!issue.admitted) throw issueFiltered(issueId);

    const queued = await this.queue.queueSelection(
      organizationId,
      { issueIds: [issueId] },
      { workflow: row.workflow_slug, version: row.workflow_version, playbookId: row.id },
    );
    const item = queued.items[0];

    return {
      playbookId: row.id,
      item,
      position: item.position,
      context: await this.contextOf(organizationId, row, issue.repo),
      links: launchLinks(row.id, issueId),
    };
  }

  /**
   * The playbook, or `404`.
   *
   * @param organizationId - The workspace.
   * @param id - The playbook.
   * @returns The row.
   */
  private async require(organizationId: string, id: string): Promise<PlaybookRow> {
    const row = await this.store.find(organizationId, id);

    if (row === undefined) throw playbookNotFound(id);

    return row;
  }

  /**
   * Check a pin: a workflow of this workspace, at a published version.
   *
   * @param organizationId - The workspace.
   * @param slug - The workflow.
   * @param version - The version.
   * @returns The workflow's id.
   */
  private async pin(organizationId: string, slug: string, version: number): Promise<string> {
    const workflowId = await this.store.workflowBySlug(organizationId, slug);

    if (workflowId === undefined) throw workflowNotFound(slug);
    if (!(await this.store.versionPublished(workflowId, version))) {
      throw versionNotPublished(slug, version);
    }

    return workflowId;
  }

  /**
   * Store a new playbook and read it back.
   *
   * @param organizationId - The workspace.
   * @param input - The recipe.
   * @returns The playbook.
   */
  private async insert(
    organizationId: string,
    input: {
      name: string;
      description: string;
      workflowId: string;
      workflowVersion: number;
      overrides: PlaybookOverrides;
      preset: PlaybookPreset;
      filter: PlaybookIssueFilter | null;
      sourceRunId: string | null;
    },
  ): Promise<PlaybookResource> {
    refuseOverlap(input.overrides);

    const write: PlaybookWrite = {
      name: input.name,
      description: input.description,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      skillOverrides: JSON.stringify(storedOverrides(input.overrides)),
      contextPreset: JSON.stringify(storedPreset(input.preset)),
      issueFilter: serialiseFilter(input.filter),
      sourceRunId: input.sourceRunId,
    };
    const id = await this.write(() => this.store.insert(organizationId, write), input.name);

    return this.read(organizationId, id);
  }

  /**
   * Run a write, turning V072's named refusals into this service's codes.
   *
   * @param run - The write.
   * @param name - The name written, for the `409`.
   * @returns What the write returned.
   */
  private async write<T>(run: () => Promise<T>, name: string): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (violatesConstraint(error, PLAYBOOK_CONSTRAINTS.nameUnique)) throw nameTaken(name);
      if (violatesConstraint(error, PLAYBOOK_CONSTRAINTS.refsResolve)) {
        throw referenceUnresolved();
      }

      throw error;
    }
  }

  /**
   * The context a playbook attaches in a repository.
   *
   * @param organizationId - The workspace.
   * @param row - The playbook.
   * @param repo - `owner/name`, or null.
   * @returns The manifest and the preset.
   */
  private async contextOf(
    organizationId: string,
    row: PlaybookRow,
    repo: string | null,
  ): Promise<PlaybookContextResource> {
    const preset = readPreset(row.context_preset);
    const manifest = await this.assembly.assemble(
      organizationId,
      { repo, workflow: row.workflow_slug },
      "playbook",
      { overrides: readOverrides(row.skill_overrides) },
    );

    return { manifest, steerNotes: preset.steerNotes, factIds: preset.factIds };
  }
}

/**
 * @param status - A run's status.
 * @returns Whether it is one a run rests at.
 */
function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/**
 * @param overrides - The body's delta.
 * @throws {InvalidRequestError} `playbook_overrides_overlap`.
 */
function refuseOverlap(overrides: PlaybookOverrides): void {
  const overlap = overlapOf(overrides);

  if (overlap.length > 0) throw overridesOverlap(overlap);
}

/**
 * @param body - The body's overrides, if any.
 * @returns The delta; missing halves empty.
 */
function overridesOf(body?: { enable?: string[]; disable?: string[] }): PlaybookOverrides {
  return body === undefined
    ? NO_PLAYBOOK_OVERRIDES
    : { enable: body.enable ?? [], disable: body.disable ?? [] };
}

/**
 * @param body - The body's preset, if any.
 * @returns The preset; missing keys empty.
 */
function presetOf(body?: { steerNotes?: string[]; factIds?: string[] }): PlaybookPreset {
  return body === undefined
    ? NO_PLAYBOOK_PRESET
    : { steerNotes: body.steerNotes ?? [], factIds: body.factIds ?? [] };
}

/**
 * @param body - The body's filter: absent or `null` admits every issue.
 * @returns The filter, or `null`.
 */
function filterOf(body?: IssueFilterBody | null): PlaybookIssueFilter | null {
  return body === undefined || body === null
    ? null
    : { labels: body.labels ?? null, repos: body.repos ?? null };
}

/**
 * @param filter - The filter.
 * @returns The stored jsonb text, or `null` for one admitting every issue.
 */
function serialiseFilter(filter: PlaybookIssueFilter | null): string | null {
  const stored = storedFilter(filter);

  return stored === null ? null : JSON.stringify(stored);
}
