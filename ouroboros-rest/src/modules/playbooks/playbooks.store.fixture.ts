/**
 * An in-memory playbooks world for the service and controller suites (#415): the fake
 * `PlaybooksRepository`, a real `ContextAssemblyService` over `AssemblyWorld`, and a real
 * `BacklogQueueService` over a queue double — so a launch runs the actual queue write rules and
 * the actual assembly, and only the statements are doubles.
 */

import type { QueueAppendRow, QueueCandidate } from "../backlog/queue.repository";
import { BacklogQueueService } from "../backlog/queue.service";
import { ContextAssemblyService } from "../context-assembly/context-assembly.service";
import {
  HELIOS,
  STANDARD_FIX,
  STANDARD_FIX_ID,
  WORKSPACE,
  repoSkill,
  skill,
} from "../context-assembly/context-assembly.fixture";
import { AssemblyWorld } from "../context-assembly/context-assembly.store.fixture";
import type { CandidateSkill } from "../context-assembly/context-assembly.resolve";
import type { QueueItem, SizingStatus } from "../db/schema";
import type { WorkflowRegistryService } from "../workflows/registry.service";
import type { TriggerService } from "../workflows/trigger.service";
import { readFilter } from "./playbooks.derive";
import type {
  IssueQuery,
  IssueRow,
  PlaybookWrite,
  PlaybooksRepository,
  RunInjections,
  RunSource,
} from "./playbooks.repository";
import type { PlaybookRow } from "./playbooks.resources";
import { PlaybooksService } from "./playbooks.service";

export { HELIOS, STANDARD_FIX, STANDARD_FIX_ID, WORKSPACE };

/** The seeded terminal run — mockup 14's *Flaky test hunt* was learned from Loop #1791. */
export const SOURCE_RUN = "5eed0009-0000-4000-8000-000000001791";

/** A run still going. */
export const LIVE_RUN = "5eed0009-0000-4000-8000-000000001847";

/** The issues the picker may offer. */
export const ISSUE_485 = "5eed0018-0000-4000-8000-000000000485";
export const ISSUE_491 = "5eed0018-0000-4000-8000-000000000491";
export const ISSUE_OTHER_REPO = "5eed0018-0000-4000-8000-000000000302";

/** One issue of the world. */
interface WorldIssue {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly repo: string;
  readonly labels: string[];
  readonly sizingStatus: SizingStatus;
  readonly state: "open" | "closed";
}

/** A stored playbook. */
interface StoredPlaybook extends PlaybookWrite {
  readonly id: string;
  readonly createdAt: Date;
  updatedAt: Date;
}

/** The world. */
export class PlaybookWorld {
  readonly assembly = new AssemblyWorld();
  readonly playbooks: StoredPlaybook[] = [];
  /** `runs.playbook_id` of every run — the only thing a count is derived from. */
  readonly runs: { id: string; playbookId: string | null }[] = [];
  /** Every queue append, as the queue repository received it. */
  readonly appended: QueueAppendRow[][] = [];
  /** The trigger service's calls — a launch must make none. */
  readonly triggered: unknown[] = [];
  /** Every write the store received, by column, so a spec can assert no counter was written. */
  readonly writes: Record<string, unknown>[] = [];
  /** Published versions per workflow slug. */
  readonly published = new Map<string, number[]>([[STANDARD_FIX, [13, 14]]]);
  readonly workflowIds = new Map<string, string>([[STANDARD_FIX, STANDARD_FIX_ID]]);
  /** The skills assembly resolves: a required one, one repo skill, one org skill. */
  readonly hil: CandidateSkill = repoSkill({ slug: "hil-safety", required: true });
  readonly zephyr: CandidateSkill = repoSkill({ slug: "zephyr-conventions" });
  readonly commit: CandidateSkill = skill({ slug: "commit-style" });
  readonly legacy: CandidateSkill = skill({ slug: "legacy-timer", enabled: false });

  readonly runSources = new Map<string, RunSource>([
    [
      SOURCE_RUN,
      {
        id: SOURCE_RUN,
        status: "merged",
        loopSeq: 1791,
        issueNumber: 402,
        issueTitle: "CAN bus flake in hil suite",
        workflowTag: STANDARD_FIX,
        workflowVersionPin: 14,
        repo: HELIOS,
      },
    ],
    [
      LIVE_RUN,
      {
        id: LIVE_RUN,
        status: "coding",
        loopSeq: 1847,
        issueNumber: 482,
        issueTitle: "Watchdog",
        workflowTag: STANDARD_FIX,
        workflowVersionPin: 14,
        repo: HELIOS,
      },
    ],
  ]);
  /** The skills each run was injected with; absent is a run with no injection record. */
  readonly injected = new Map<string, string[]>();
  /** Each run's steers, oldest first. */
  readonly steers = new Map<string, string[]>([
    [SOURCE_RUN, ["focus the flakiest suite first", "rerun each failure 5×"]],
  ]);

  readonly issues: WorldIssue[] = [
    {
      id: ISSUE_485,
      number: 485,
      title: "Watchdog reset on I²C bus lockup",
      repo: HELIOS,
      labels: ["bug", "flaky"],
      sizingStatus: "sized",
      state: "open",
    },
    {
      id: ISSUE_491,
      number: 491,
      title: "Add CRC32 to config persistence layer",
      repo: HELIOS,
      labels: ["enhancement"],
      sizingStatus: "sized",
      state: "open",
    },
    {
      id: ISSUE_OTHER_REPO,
      number: 302,
      title: "Ground station flake",
      repo: "acme-robotics/ground-station",
      labels: ["flaky"],
      sizingStatus: "sized",
      state: "open",
    },
  ];
  /** Issue numbers the queue holds. */
  readonly queued = new Set<number>();

  constructor() {
    const rows = this.assembly.workspace(WORKSPACE);

    rows.workflows.set(STANDARD_FIX, STANDARD_FIX_ID);
    rows.skills.push(this.hil, this.zephyr, this.commit, this.legacy);
  }

  /** The service over this world. */
  service(): PlaybooksService {
    return new PlaybooksService(
      this.store(),
      new ContextAssemblyService(this.assembly.store()),
      this.queue(),
    );
  }

  /**
   * A run launched through a playbook opened — what ingest does when a run claims the queued row.
   *
   * @param playbookId - The playbook it inherited.
   */
  openRun(playbookId: string | null): void {
    this.runs.push({ id: `run-${String(this.runs.length + 1)}`, playbookId });
  }

  /** The fake statements. */
  store(): PlaybooksRepository {
    return {
      list: (organizationId: string) =>
        Promise.resolve(
          organizationId === WORKSPACE
            ? [...this.playbooks]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => this.row(p))
            : [],
        ),
      find: (organizationId: string, id: string) => {
        const found = this.playbooks.find((p) => p.id === id);
        return Promise.resolve(
          organizationId === WORKSPACE && found !== undefined ? this.row(found) : undefined,
        );
      },
      counts: () =>
        Promise.resolve(
          this.playbooks.map((p) => ({ playbookId: p.id, runs: this.countOf(p.id) })),
        ),
      insert: (_organizationId: string, write: PlaybookWrite) => {
        this.writes.push({ ...write });
        if (this.playbooks.some((p) => p.name === write.name)) {
          return Promise.reject(
            Object.assign(new Error("dup"), {
              code: "23505",
              constraint: "playbooks_organization_name_key",
            }),
          );
        }
        const refused = this.refusedRefs(write);
        if (refused) {
          return Promise.reject(
            Object.assign(new Error("refs"), {
              code: "23503",
              constraint: "playbooks_refs_resolve",
            }),
          );
        }
        const id = `5eed0046-0000-4000-8000-${String(this.playbooks.length + 1).padStart(12, "0")}`;
        this.playbooks.push({ ...write, id, createdAt: new Date(0), updatedAt: new Date(0) });
        return Promise.resolve(id);
      },
      update: (_organizationId: string, id: string, write: Omit<PlaybookWrite, "sourceRunId">) => {
        this.writes.push({ ...write });
        const found = this.playbooks.find((p) => p.id === id);
        if (found === undefined) return Promise.resolve(false);
        Object.assign(found, write, { updatedAt: new Date(1) });
        return Promise.resolve(true);
      },
      delete: (_organizationId: string, id: string) => {
        const index = this.playbooks.findIndex((p) => p.id === id);
        if (index < 0) return Promise.resolve(false);
        this.playbooks.splice(index, 1);
        // V072: SET NULL — the runs keep their history.
        for (const run of this.runs) if (run.playbookId === id) run.playbookId = null;
        return Promise.resolve(true);
      },
      workflowBySlug: (_organizationId: string, slug: string) =>
        Promise.resolve(this.workflowIds.get(slug)),
      workflowSlug: (_organizationId: string, id: string) =>
        Promise.resolve([...this.workflowIds].find(([, value]) => value === id)?.[0]),
      versionPublished: (workflowId: string, version: number) => {
        const slug = [...this.workflowIds].find(([, value]) => value === workflowId)?.[0];
        return Promise.resolve(
          slug !== undefined && (this.published.get(slug) ?? []).includes(version),
        );
      },
      runSource: (organizationId: string, runId: string) =>
        Promise.resolve(organizationId === WORKSPACE ? this.runSources.get(runId) : undefined),
      runInjections: (_organizationId: string, runId: string): Promise<RunInjections> => {
        const skills = this.injected.get(runId);
        return Promise.resolve(
          skills === undefined ? { records: 0, skillIds: [] } : { records: 2, skillIds: skills },
        );
      },
      runSteers: (_organizationId: string, runId: string) =>
        Promise.resolve(this.steers.get(runId) ?? []),
      issues: (_organizationId: string, filter: unknown, query: IssueQuery) =>
        Promise.resolve(
          this.issueRows(filter)
            .filter((issue) => issue.admitted)
            .filter((issue) => query.q === undefined || issue.title.includes(query.q))
            .slice(0, query.limit),
        ),
      issue: (_organizationId: string, filter: unknown, issueId: string) =>
        Promise.resolve(this.issueRows(filter).find((issue) => issue.id === issueId)),
    } as unknown as PlaybooksRepository;
  }

  /** The launch count of a playbook — counted from the runs, never stored. */
  countOf(playbookId: string): number {
    return this.runs.filter((run) => run.playbookId === playbookId).length;
  }

  /**
   * M.3's queue write over doubles: the real rules, fake statements.
   *
   * @returns The service.
   */
  private queue(): BacklogQueueService {
    const repository = {
      selection: (_organizationId: string, ids: readonly string[]): Promise<QueueCandidate[]> =>
        Promise.resolve(
          this.issues
            .filter((issue) => ids.includes(issue.id))
            .map((issue) => ({
              id: issue.id,
              number: issue.number,
              title: issue.title,
              githubRepoId: `repo-of-${issue.repo}`,
              sizingStatus: issue.sizingStatus,
              labels: issue.labels,
              effort: "m",
              suggestedWorkflow: "docs-loop",
              estMinutes: 45,
            })),
        ),
      queuedNumbers: (_organizationId: string, numbers: readonly number[]) =>
        Promise.resolve(numbers.filter((number) => this.queued.has(number))),
      append: (organizationId: string, rows: readonly QueueAppendRow[]): Promise<QueueItem[]> => {
        this.appended.push([...rows]);
        return Promise.resolve(
          rows.map((row, index) => {
            this.queued.add(row.issueNumber);
            return {
              id: `b0b0b0b0-0000-4000-8000-${String(row.issueNumber).padStart(12, "0")}`,
              organization_id: organizationId,
              github_repo_id: row.githubRepoId,
              issue_number: row.issueNumber,
              issue_title: row.issueTitle,
              effort: row.effort,
              workflow_tag: row.workflowTag,
              workflow_version: row.workflowVersion,
              workflow_pin_reason: row.workflowPinReason,
              playbook_id: row.playbookId ?? null,
              position: this.queued.size + index,
              est_minutes: row.estMinutes,
              enqueued_at: new Date("2026-09-30T12:00:00.000Z"),
              created_at: new Date("2026-09-30T12:00:00.000Z"),
              updated_at: new Date("2026-09-30T12:00:00.000Z"),
            };
          }),
        );
      },
    };
    const registry = {
      offered: () => Promise.resolve({ slugs: [STANDARD_FIX, "docs-loop"], source: "workflows" }),
    } as unknown as WorkflowRegistryService;
    const triggers = {
      pin: (...args: unknown[]) => {
        this.triggered.push(args);
        return Promise.resolve([]);
      },
    } as unknown as TriggerService;

    return new BacklogQueueService(repository as never, registry, triggers);
  }

  private row(p: StoredPlaybook): PlaybookRow {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      workflow_id: p.workflowId,
      workflow_slug: [...this.workflowIds].find(([, id]) => id === p.workflowId)?.[0] ?? "?",
      workflow_version: p.workflowVersion,
      skill_overrides: JSON.parse(p.skillOverrides),
      context_preset: JSON.parse(p.contextPreset),
      issue_filter: p.issueFilter === null ? null : JSON.parse(p.issueFilter),
      source_run_id: p.sourceRunId,
      run_count: String(this.countOf(p.id)),
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  /** V072's trigger: every skill id a skill of the workspace, no required skill disabled. */
  private refusedRefs(write: PlaybookWrite): boolean {
    const overrides = JSON.parse(write.skillOverrides) as { enable?: string[]; disable?: string[] };
    const known = new Set(this.assembly.workspace(WORKSPACE).skills.map((s) => s.id));
    const ids = [...(overrides.enable ?? []), ...(overrides.disable ?? [])];

    return ids.some((id) => !known.has(id)) || (overrides.disable ?? []).includes(this.hil.id);
  }

  /** V072's `playbook_issue_filter_admits`, mirrored for the fake. */
  private issueRows(filter: unknown): IssueRow[] {
    const read = readFilter(filter);

    return this.issues
      .filter((issue) => issue.state === "open")
      .map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        repo: issue.repo,
        labels: issue.labels,
        sizingStatus: issue.sizingStatus,
        queued: this.queued.has(issue.number),
        admitted:
          read === null ||
          ((read.repos === null || read.repos.includes(issue.repo)) &&
            (read.labels === null || issue.labels.some((label) => read.labels?.includes(label)))),
      }));
  }
}
