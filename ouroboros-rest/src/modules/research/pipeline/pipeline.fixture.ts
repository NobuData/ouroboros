/**
 * Stand-ins for the roadmap pipeline's suites (CM.5, #624): a store held in memory, a repository
 * that is a map of branches, a skill runner that answers from a script, and a Planning that
 * drafts, sizes and pushes without a tracker. RS-124's roadmap is the running example.
 */

import type { EngineRoadmap, EngineSkillRunResult } from "../../engine/engine.skills";
import type { ComposedBatchInput } from "../../planning/batches.service";
import type { BatchResource, DraftResource } from "../../planning/planning.resources";
import { TicketSourceError } from "../../ticket-sources/ticket-source.errors";
import type { HostPrState } from "../../ticket-sources/ticket-source.pr";
import type { SyncSource } from "../../ticket-sources/ticket-sources.repository";
import type { RepoGateway, RoadmapRepo } from "./pipeline.repo";
import {
  VersionRaceError,
  pendingProjection,
  type DocRow,
  type IssueRow,
  type NewDoc,
  type NewSuggestion,
  type NewVersion,
  type PipelineInvestigation,
  type PipelineSettings,
  type PipelineSource,
  type PipelineStore,
  type RepoProjection,
  type SuggestionRow,
  type VersionRow,
  type WatchedDoc,
} from "./pipeline.repository";
import type { ResolvedSkill } from "./pipeline.skill-registry";
import type { SkillRun, SkillRunRequest, SkillRunning } from "./pipeline.skill-runner";
import type { PipelineSkillSlug } from "./pipeline.skills";

export const ORG = "org-acme";
export const USER = "user-ken";
export const INVESTIGATION = "5eed0091-0000-4000-8000-000000000124";
export const SOURCE = "5eed0020-0000-4000-8000-000000000001";
export const DOC = "5eed0097-0000-4000-8000-000000000124";

/** RS-124's roadmap as `create-roadmap` answers it: two milestones, six items. */
export function rs124Roadmap(): EngineRoadmap {
  return {
    title: "Helios — Q4 Improvement Roadmap",
    milestones: [
      {
        key: "m1",
        name: "Docking parity",
        targetDate: "2026-10-15",
        items: [
          {
            key: "dock-mpc",
            title: "Wind-feedforward MPC in final approach",
            mvp: true,
            effort: "l",
          },
          { key: "dock-retry", title: "Re-planned abort & retry vectors", mvp: true, effort: "m" },
          { key: "dock-gust", title: "Gust estimator from IMU residuals", mvp: false, effort: "m" },
        ],
      },
      {
        key: "m2",
        name: "Fleet reliability",
        targetDate: "2026-11-20",
        items: [
          { key: "fleet-battery", title: "Battery health model v2", mvp: false, effort: "m" },
          { key: "fleet-gaps", title: "Telemetry gap alerts", mvp: false, effort: "s" },
          {
            key: "fleet-playbook",
            title: "Operator recovery playbook docs",
            mvp: false,
            effort: "xs",
          },
        ],
      },
    ],
  };
}

/** The same roadmap with the human suggestion applied: the gust estimator joins the MVP set. */
export function rs124RoadmapWithGustInMvp(): EngineRoadmap {
  const roadmap = rs124Roadmap();
  const gust = roadmap.milestones[0]?.items[2];

  if (gust !== undefined) gust.mvp = true;

  return roadmap;
}

/** A run's answer around a roadmap. */
export function roadmapRun(roadmap: EngineRoadmap, slug = "create-roadmap"): EngineSkillRunResult {
  return {
    skill: slug,
    version: 1,
    output: "roadmap",
    roadmap,
    issues: null,
    attempts: 1,
    usage: [],
  };
}

/** A run's answer describing each key. */
export function issuesRun(keys: readonly string[]): EngineSkillRunResult {
  return {
    skill: "create-issues",
    version: 1,
    output: "issue_bodies",
    roadmap: null,
    issues: keys.map((key) => ({ key, body: `## Problem\nWhat ${key} fixes.` })),
    attempts: 1,
    usage: [],
  };
}

/** A skill runner that answers from a queue, and remembers what it was asked. */
export class ScriptedSkills implements SkillRunning {
  readonly calls: SkillRunRequest[] = [];
  private readonly queue: (EngineSkillRunResult | Error)[] = [];

  /** The version each skill is at in this workspace. */
  versions: Record<PipelineSkillSlug, number> = { "create-roadmap": 1, "create-issues": 1 };

  /**
   * @param answers - What the next runs answer, in order; an `Error` is thrown.
   * @returns This, for chaining.
   */
  answer(...answers: (EngineSkillRunResult | Error)[]): this {
    this.queue.push(...answers);

    return this;
  }

  /** @inheritdoc */
  current(_organizationId: string, slug: PipelineSkillSlug): Promise<ResolvedSkill> {
    return Promise.resolve({ slug, version: this.versions[slug], body: `# ${slug}` });
  }

  /** @inheritdoc */
  async run(organizationId: string, request: SkillRunRequest): Promise<SkillRun> {
    this.calls.push(structuredClone(request));

    const next = this.queue.shift();

    if (next === undefined) throw new Error(`no scripted answer for ${request.slug}`);
    if (next instanceof Error) throw next;

    return { skill: await this.current(organizationId, request.slug), result: next };
  }
}

/** A repository: branches of files, pull requests, and a log of what was done to it. */
export class FakeRepo implements RepoGateway, RoadmapRepo {
  /** `branch → path → file`. */
  readonly branches = new Map<string, Map<string, { content: string; sha: string }>>([
    ["main", new Map()],
  ]);
  readonly prs: {
    number: number;
    branch: string;
    base: string;
    title: string;
    body: string | null;
    draft: boolean;
    state: HostPrState;
  }[] = [];
  readonly log: string[] = [];

  /** False for a tracker with no repository: `open` answers undefined. */
  supported = true;
  /** When set, every `open` is refused with it. */
  refusal: TicketSourceError | null = null;

  private commits = 0;
  private nextPr = 88;

  /** @inheritdoc */
  async open<T>(
    _source: SyncSource,
    work: (repo: RoadmapRepo) => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.supported) return undefined;
    if (this.refusal !== null) throw this.refusal;

    return work(this);
  }

  /** @inheritdoc */
  defaultBranch(): Promise<string> {
    return Promise.resolve("main");
  }

  /** @inheritdoc */
  fileAt(path: string, ref: string) {
    const file = this.branches.get(ref)?.get(path);

    return Promise.resolve(
      file === undefined
        ? null
        : { content: file.content, blobSha: `blob-${file.sha}`, commitSha: file.sha },
    );
  }

  /** @inheritdoc */
  commitFile(input: {
    path: string;
    content: string;
    message: string;
    branch: string;
    base: string;
  }) {
    let branch = this.branches.get(input.branch);

    if (branch === undefined) {
      branch = new Map(this.branches.get(input.base));
      this.branches.set(input.branch, branch);
    }

    const existing = branch.get(input.path);

    if (existing?.content === input.content) {
      return Promise.resolve({ commitSha: existing.sha, changed: false });
    }

    const sha = this.sha();

    branch.set(input.path, { content: input.content, sha });
    this.log.push(`commit ${input.branch} ${input.path}`);

    return Promise.resolve({ commitSha: sha, changed: true });
  }

  /** @inheritdoc */
  openPR(input: {
    branch: string;
    base: string;
    title: string;
    body: string | null;
    draft?: boolean;
  }) {
    const open = this.prs.find(
      (pr) => pr.branch === input.branch && pr.base === input.base && pr.state === "open",
    );

    if (open !== undefined) {
      return Promise.resolve({
        number: open.number,
        url: `https://git.example/pr/${String(open.number)}`,
        draft: open.draft,
      });
    }

    const pr = {
      number: this.nextPr,
      branch: input.branch,
      base: input.base,
      title: input.title,
      body: input.body,
      draft: input.draft === true,
      state: "open" as HostPrState,
    };

    this.nextPr += 1;
    this.prs.push(pr);
    this.log.push(`pr #${String(pr.number)} opened`);

    return Promise.resolve({
      number: pr.number,
      url: `https://git.example/pr/${String(pr.number)}`,
      draft: pr.draft,
    });
  }

  /** @inheritdoc */
  updatePR(prNumber: number, input: { title?: string; body?: string }): Promise<void> {
    const pr = this.prs.find((candidate) => candidate.number === prNumber);

    if (pr !== undefined) {
      pr.title = input.title ?? pr.title;
      pr.body = input.body ?? pr.body;
    }

    return Promise.resolve();
  }

  /** @inheritdoc */
  prState(prNumber: number): Promise<HostPrState> {
    return Promise.resolve(this.prs.find((pr) => pr.number === prNumber)?.state ?? "closed");
  }

  /**
   * Merge a PR: its branch's files land on its base.
   *
   * @param prNumber - The PR.
   */
  merge(prNumber: number): void {
    const pr = this.prs.find((candidate) => candidate.number === prNumber);

    if (pr === undefined) throw new Error(`no PR #${String(prNumber)}`);

    const base = this.branches.get(pr.base) ?? new Map<string, { content: string; sha: string }>();

    for (const [path, file] of this.branches.get(pr.branch) ?? []) {
      base.set(path, { content: file.content, sha: this.sha() });
    }

    this.branches.set(pr.base, base);
    pr.state = "merged";
  }

  /**
   * Edit a file on the default branch by hand.
   *
   * @param path - The file.
   * @param content - Its new text.
   * @returns The commit's sha.
   */
  handEdit(path: string, content: string): string {
    const sha = this.sha();

    this.branches.get("main")?.set(path, { content, sha });

    return sha;
  }

  /** @returns The next commit sha — forty lower-case hex characters. */
  private sha(): string {
    this.commits += 1;

    return this.commits.toString(16).padStart(40, "a");
  }
}

/** A refusal a repository makes. */
export function refused(
  errorClass: "auth" | "permission" | "not_found" = "auth",
): TicketSourceError {
  return new TicketSourceError(errorClass, "the token was refused");
}

/** The pipeline's tables, in memory. */
export class MemoryPipelineStore implements PipelineStore {
  readonly investigations = new Map<string, PipelineInvestigation & { organizationId: string }>();
  readonly inputs = new Map<string, Record<string, unknown>>();
  readonly sourceRows: (PipelineSource & { organizationId: string })[] = [];
  readonly docs = new Map<string, DocRow>();
  readonly versions: VersionRow[] = [];
  readonly suggestionRows: SuggestionRow[] = [];
  readonly tickets = new Map<string, IssueRow & { organizationId: string }>();
  readonly policy = new Map<string, PipelineSettings>();
  readonly gapBatches = new Map<string, { batchId: string; epicId: string | null }>();
  readonly filed: string[] = [];

  /** When true, the next `addVersion` loses a race. */
  raceNext = false;

  private sequence = 0;
  private clock = Date.parse("2026-10-01T09:00:00.000Z");

  constructor() {
    this.investigations.set(INVESTIGATION, {
      id: INVESTIGATION,
      organizationId: ORG,
      displayId: "RS-124",
      question: "What should Helios ship next quarter?",
      status: "brief_ready",
    });
    this.sourceRows.push({
      id: SOURCE,
      organizationId: ORG,
      kind: "github",
      displayName: "GitHub · acme-robotics",
    });
  }

  /** @returns A fresh id. */
  private id(prefix: string): string {
    this.sequence += 1;

    return `${prefix}-${String(this.sequence)}`;
  }

  /** @returns The next instant — each write is a minute after the last. */
  private now(): Date {
    this.clock += 60_000;

    return new Date(this.clock);
  }

  /** @inheritdoc */
  investigation(organizationId: string, investigationId: string) {
    const row = this.investigations.get(investigationId);

    return Promise.resolve(row?.organizationId === organizationId ? row : undefined);
  }

  /** @inheritdoc */
  roadmapInput(investigationId: string) {
    return Promise.resolve(this.inputs.get(investigationId) ?? null);
  }

  /** @inheritdoc */
  sources(organizationId: string) {
    return Promise.resolve(this.sourceRows.filter((row) => row.organizationId === organizationId));
  }

  /** @inheritdoc */
  source(organizationId: string, sourceId: string): Promise<SyncSource | undefined> {
    const row = this.sourceRows.find(
      (candidate) => candidate.organizationId === organizationId && candidate.id === sourceId,
    );

    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            sourceId: row.id,
            organizationId,
            kind: row.kind,
            displayName: row.displayName,
            config: {},
            cursor: null,
            syncedAt: null,
          },
    );
  }

  /** @inheritdoc */
  doc(organizationId: string, investigationId: string) {
    return Promise.resolve(
      [...this.docs.values()].find(
        (doc) => doc.organizationId === organizationId && doc.investigationId === investigationId,
      ),
    );
  }

  /** @inheritdoc */
  version(docId: string, version: number) {
    const row = this.versions.find(
      (candidate) => candidate.docId === docId && candidate.version === version,
    );

    return Promise.resolve(row === undefined ? undefined : structuredClone(row));
  }

  /** @inheritdoc */
  createDoc(input: NewDoc): Promise<string> {
    const id = this.docs.size === 0 ? DOC : this.id("doc");
    const createdAt = this.now();

    this.docs.set(id, {
      id,
      organizationId: input.organizationId,
      investigationId: input.investigationId,
      title: input.title,
      currentVersion: 1,
      targetSourceId: input.targetSourceId,
      batchId: null,
      createdAt,
    });
    this.write(id, 1, input.version, createdAt);

    return Promise.resolve(id);
  }

  /** @inheritdoc */
  addVersion(
    doc: DocRow,
    title: string,
    version: NewVersion,
    applied: { readonly suggestionId: string; readonly userId: string } | null,
  ): Promise<number> {
    const stored = this.docs.get(doc.id);

    if (this.raceNext || stored === undefined || stored.currentVersion !== doc.currentVersion) {
      this.raceNext = false;

      return Promise.reject(new VersionRaceError(doc.id));
    }

    const next = (doc.currentVersion ?? 0) + 1;
    const at = this.now();

    if (applied !== null) {
      const suggestion = this.suggestionRows.find((row) => row.id === applied.suggestionId);

      if (suggestion === undefined || suggestion.status !== "open") {
        return Promise.reject(new VersionRaceError(doc.id));
      }

      this.replace(suggestion, { status: "applied", appliedVersion: next, appliedAt: at });
    }

    this.write(doc.id, next, version, at);
    this.docs.set(doc.id, { ...stored, title, currentVersion: next });

    return Promise.resolve(next);
  }

  /** @inheritdoc */
  setProjection(docId: string, version: number, projection: RepoProjection): Promise<void> {
    const index = this.versions.findIndex(
      (candidate) => candidate.docId === docId && candidate.version === version,
    );
    const row = this.versions[index];

    if (row !== undefined) this.versions[index] = { ...row, projection: { ...projection } };

    return Promise.resolve();
  }

  /** @inheritdoc */
  setBatch(docId: string, batchId: string): Promise<void> {
    const doc = this.docs.get(docId);

    if (doc !== undefined) this.docs.set(docId, { ...doc, batchId });

    return Promise.resolve();
  }

  /** @inheritdoc */
  suggestions(docId: string) {
    return Promise.resolve(this.suggestionRows.filter((row) => row.docId === docId));
  }

  /** @inheritdoc */
  addSuggestion(docId: string, suggestion: NewSuggestion): Promise<SuggestionRow> {
    const row: SuggestionRow = {
      id: this.id("suggestion"),
      docId,
      authorKind: suggestion.authorKind,
      authorUserId: suggestion.userId,
      authorName: suggestion.userId === null ? null : "Ken Suenobu",
      authorAgent: suggestion.agent,
      text: suggestion.text,
      hint: suggestion.hint,
      status: "open",
      appliedVersion: null,
      appliedAt: null,
      dismissedAt: null,
      createdAt: this.now(),
    };

    this.suggestionRows.push(row);

    return Promise.resolve(row);
  }

  /** @inheritdoc */
  dismissSuggestion(docId: string, suggestionId: string): Promise<boolean> {
    const row = this.suggestionRows.find(
      (candidate) => candidate.id === suggestionId && candidate.docId === docId,
    );

    if (row === undefined || row.status !== "open") return Promise.resolve(false);

    this.replace(row, { status: "dismissed", dismissedAt: this.now() });

    return Promise.resolve(true);
  }

  /** @inheritdoc */
  issues(organizationId: string, ticketIds: readonly string[]) {
    return Promise.resolve(
      ticketIds.flatMap((id) => {
        const ticket = this.tickets.get(id);

        return ticket?.organizationId === organizationId ? [ticket] : [];
      }),
    );
  }

  /** @inheritdoc */
  settings(organizationId: string) {
    return Promise.resolve(this.policy.get(organizationId) ?? { directCommit: false });
  }

  /** @inheritdoc */
  saveSettings(organizationId: string, settings: PipelineSettings): Promise<void> {
    this.policy.set(organizationId, settings);

    return Promise.resolve();
  }

  /** @inheritdoc */
  markIssuesFiled(investigationId: string): Promise<void> {
    const row = this.investigations.get(investigationId);

    if (row?.status === "brief_ready") {
      this.investigations.set(investigationId, { ...row, status: "issues_filed" });
      this.filed.push(investigationId);
    }

    return Promise.resolve();
  }

  /** @inheritdoc */
  gapBatch(_organizationId: string, investigationId: string) {
    return Promise.resolve(this.gapBatches.get(investigationId));
  }

  /** @inheritdoc */
  watchedDocs(limit: number): Promise<WatchedDoc[]> {
    return Promise.resolve(
      [...this.docs.values()]
        .filter((doc) => doc.investigationId !== null && doc.targetSourceId !== null)
        .filter((doc) => this.current(doc.id)?.projection.state !== "drift_detected")
        .slice(0, limit)
        .map((doc) => ({
          organizationId: doc.organizationId,
          investigationId: doc.investigationId as string,
        })),
    );
  }

  /**
   * A document's current version, as stored.
   *
   * @param docId - The document.
   * @returns It, or undefined.
   */
  current(docId: string = DOC): VersionRow | undefined {
    const doc = this.docs.get(docId);

    return this.versions.find(
      (candidate) => candidate.docId === docId && candidate.version === doc?.currentVersion,
    );
  }

  /**
   * Change a ticket in the tracker's mirror — what a sync would bring in.
   *
   * @param key - `#744`.
   * @param change - The fields that moved.
   */
  trackerChange(key: string, change: Partial<Pick<IssueRow, "title" | "state" | "labels">>): void {
    for (const [id, ticket] of this.tickets) {
      if (ticket.key === key) this.tickets.set(id, { ...ticket, ...change });
    }
  }

  private write(docId: string, version: number, input: NewVersion, at: Date): void {
    this.versions.push({
      docId,
      version,
      structure: structuredClone(input.structure),
      markdown: input.markdown,
      generatedBy: input.generatedBy,
      projection: pendingProjection(input.path),
      createdAt: at,
    });
  }

  private replace(row: SuggestionRow, change: Partial<SuggestionRow>): void {
    this.suggestionRows[this.suggestionRows.indexOf(row)] = { ...row, ...change };
  }
}

/** One draft as the fake Planning holds it. */
interface FakeDraft {
  id: string;
  input: ComposedBatchInput["drafts"][number];
  sized: boolean;
  ticketId: string | null;
  ticketKey: string | null;
}

/** A Planning that drafts, sizes and pushes into the store's tracker mirror. */
export class FakePlanning {
  readonly batches = new Map<
    string,
    { input: ComposedBatchInput; status: BatchResource["status"]; drafts: FakeDraft[] }
  >();
  readonly pushes: string[] = [];
  /** The milestone and due date each pushed issue was filed under, by issue key. */
  readonly milestones = new Map<string, { name: string; dueOn: string | null } | null>();

  /** How many drafts the next push files before stopping short; null files them all. */
  pushLimit: number | null = null;

  private nextNumber = 742;
  private sequence = 0;

  /** @param store - Where pushed tickets are mirrored. */
  constructor(private readonly store: MemoryPipelineStore) {}

  /**
   * `BatchesService.compose`.
   *
   * @param _organizationId - The workspace.
   * @param _userId - Who asked.
   * @param input - The batch.
   * @returns The batch, drafting.
   */
  compose(
    _organizationId: string,
    _userId: string | null,
    input: ComposedBatchInput,
  ): Promise<BatchResource> {
    this.sequence += 1;

    const id = `batch-${String(this.sequence)}`;

    this.batches.set(id, {
      input,
      status: "drafting",
      drafts: input.drafts.map((draft, index) => ({
        id: `${id}-draft-${String(index + 1)}`,
        input: draft,
        sized: false,
        ticketId: null,
        ticketKey: null,
      })),
    });

    return this.read(_organizationId, id);
  }

  /**
   * The estimator finishing: every draft sized, the batch `sized`.
   *
   * @param batchId - The batch.
   */
  size(batchId: string): void {
    const batch = this.batches.get(batchId);

    if (batch === undefined) throw new Error(`no batch ${batchId}`);

    for (const draft of batch.drafts) draft.sized = true;
    if (batch.status === "drafting") batch.status = "sized";
  }

  /**
   * `BatchesService.read`.
   *
   * @param _organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The batch.
   */
  read(_organizationId: string, batchId: string): Promise<BatchResource> {
    const batch = this.batches.get(batchId);

    if (batch === undefined) return Promise.reject(new Error(`no batch ${batchId}`));

    return Promise.resolve({
      id: batchId,
      status: batch.status,
      planner: batch.input.planner,
      prompt: batch.input.prompt,
      outline: null,
      targetSourceId: batch.input.targetSourceId,
      milestone: null,
      epicId: batch.input.epicId ?? null,
      autoSize: true,
      queueSmall: false,
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
      drafts: batch.drafts.map((draft) => this.draft(draft)),
      summary: {} as BatchResource["summary"],
    });
  }

  /**
   * `BatchesService.push`.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns Nothing the pipeline reads.
   */
  push(organizationId: string, batchId: string): Promise<never> {
    const batch = this.batches.get(batchId);

    if (batch === undefined) return Promise.reject(new Error(`no batch ${batchId}`));

    this.pushes.push(batchId);

    let budget = this.pushLimit ?? Number.POSITIVE_INFINITY;

    for (const draft of batch.drafts) {
      if (draft.ticketId !== null) continue;
      if (budget <= 0) break;

      budget -= 1;

      const number = this.nextNumber;

      this.nextNumber += 1;
      draft.ticketId = `ticket-${String(number)}`;
      draft.ticketKey = `#${String(number)}`;
      this.milestones.set(draft.ticketKey, draft.input.milestone ?? null);
      this.store.tickets.set(draft.ticketId, {
        id: draft.ticketId,
        organizationId,
        key: draft.ticketKey,
        url: `https://github.com/acme-robotics/helios-firmware/issues/${String(number)}`,
        title: draft.input.title,
        state: "open",
        labels: [...(draft.input.labels ?? [])],
        estimate: draft.sized ? { effort: "m", risk: "medium", estMinutes: 2160 } : null,
      });
    }

    batch.status = batch.drafts.every((draft) => draft.ticketId !== null) ? "pushed" : "pushing";
    this.pushLimit = null;

    return Promise.resolve(undefined as never);
  }

  /**
   * `BatchesService.resume` — the same walk over what is left.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns Nothing the pipeline reads.
   */
  resume(organizationId: string, batchId: string): Promise<never> {
    return this.push(organizationId, batchId);
  }

  private draft(draft: FakeDraft): DraftResource {
    const research = draft.input.research ?? null;

    return {
      id: draft.id,
      localKey: draft.input.localKey,
      title: draft.input.title,
      body: draft.input.body,
      selected: true,
      suggestedWorkflow: null,
      provenance: "planned",
      milestone: draft.input.milestone ?? null,
      labels: draft.input.labels ?? [],
      research:
        research === null
          ? null
          : {
              investigationId: research.investigation_id,
              origin: research.origin,
              capability: research.capability,
              severity: research.severity,
              itemKey: research.item_key,
              effort: research.effort,
              sources: research.sources,
            },
      dependencies: [],
      blockedByTicketIds: [],
      pushState: draft.ticketId === null ? "pending" : "pushed",
      pushedTicketId: draft.ticketId,
      pushedTicket:
        draft.ticketId === null || draft.ticketKey === null
          ? null
          : {
              externalId: draft.ticketKey.slice(1),
              externalKey: draft.ticketKey,
              url: "https://example.test",
            },
      pushError: null,
      estimate: draft.sized ? ({ effort: "m" } as DraftResource["estimate"]) : null,
    };
  }
}
