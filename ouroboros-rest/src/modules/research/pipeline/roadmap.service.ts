/**
 * The roadmap document: generated from a brief, changed only by re-running the skill, and read as
 * the pipeline card (CM.5, [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * ```
 * brief ─create-roadmap─▶ v1 ─▶ repo PR
 *            ▲                    suggestions {user | ai}
 *            └── Apply = re-run ◀─┘            ─▶ vN+1 (suggestion → applied@vN+1)
 * ```
 *
 * **Applying a suggestion is a re-run, never a patch.** The skill is run again with the version
 * before it as `previous` and every suggestion applied so far — this one last — as
 * `suggestions`. What comes back is stored as the next version; the suggestion records that
 * version in the same transaction. Nothing in this file edits a structure by hand, and V113
 * would refuse it if something did.
 *
 * **What the skill owns and what it does not.** The answer says what the roadmap *is*; the
 * draft and issue each item became, and whether that issue is closed, are carried over by item
 * key and refreshed from the tracker (`roadmap.structure.ts`).
 *
 * **The version is stored before the repository is touched.** A document whose repository
 * cannot be reached still exists, `pending`, and says why.
 */

import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/audit.service";
import {
  ROADMAP_POLICY_UPDATED_EVENT,
  ROADMAP_SUGGESTION_DISMISSED_EVENT,
} from "../../audit/audit.events";
import { BriefsService } from "../briefs/briefs.service";
import {
  investigationNotFound,
  outputInvalid,
  roadmapExists,
  roadmapNotFound,
  sourceNotFound,
  suggestionNotFound,
  suggestionSettled,
  targetRequired,
  versionConflict,
} from "./pipeline.errors";
import {
  PipelineRepository,
  VersionRaceError,
  type DocRow,
  type NewSuggestion,
  type PipelineInvestigation,
  type PipelineStore,
  type SuggestionRow,
  type VersionRow,
} from "./pipeline.repository";
import {
  roadmapResource,
  settingsResource,
  suggestionResource,
  type PipelineSettingsResource,
  type RoadmapResource,
  type SuggestionResource,
} from "./pipeline.resources";
import { skillStamp } from "./pipeline.skill-registry";
import { PipelineSkillRunner, type SkillRunning } from "./pipeline.skill-runner";
import { DEFAULT_ROADMAP_PATH, RoadmapProjector } from "./roadmap.projector";
import {
  canonical,
  itemsOf,
  mergeRoadmap,
  refreshStates,
  renderRoadmap,
  roadmapProblems,
  type RoadmapStructure,
} from "./roadmap.structure";

/** A document with everything a request needs loaded. */
export interface LoadedRoadmap {
  readonly investigation: PipelineInvestigation;
  readonly doc: DocRow;
  readonly version: VersionRow;
}

/** What generating a document may be told. */
export interface GenerateRequest {
  /** The source to project to and file in; absent to use the workspace's only one. */
  readonly targetSourceId?: string;
  /** Where the file goes; absent for `docs/ROADMAP.md`. */
  readonly path?: string;
}

/** A suggestion a person writes. */
export interface SuggestRequest {
  readonly text: string;
  readonly hint?: Record<string, unknown> | null;
}

/**
 * A version as the skill is shown it: what the roadmap says, and which items are filed and done —
 * never an internal id.
 *
 * @param title - The document's title.
 * @param structure - The version's structure.
 * @returns The `previous` input.
 */
export function previousView(title: string, structure: RoadmapStructure): Record<string, unknown> {
  return {
    title,
    milestones: structure.milestones.map((milestone) => ({
      key: milestone.key,
      name: milestone.name,
      target_date: milestone.target_date,
      items: milestone.items.map((item) => ({
        key: item.key,
        title: item.title,
        mvp: item.mvp,
        effort: item.effort,
        issue: item.ticket_key,
        done: item.checked,
      })),
    })),
  };
}

/**
 * A suggestion as the skill is shown it.
 *
 * @param suggestion - The stored suggestion.
 * @returns Who asked, what for, and the structured hint when there is one.
 */
export function suggestionInput(suggestion: SuggestionRow): Record<string, unknown> {
  return {
    from: suggestion.authorKind === "ai" ? (suggestion.authorAgent ?? "ai") : "a person",
    text: suggestion.text,
    ...(suggestion.hint === null ? {} : { hint: suggestion.hint }),
  };
}

@Injectable()
export class RoadmapService {
  /** The collaborators, behind their seams. */
  private readonly store: PipelineStore;
  private readonly skills: SkillRunning;

  /** The clock — the run's `today`. A test sets its own. */
  clock: () => Date = () => new Date();

  /**
   * @param repository - Documents, versions, suggestions and the policy.
   * @param briefs - The brief export a roadmap is generated from.
   * @param runner - Runs `create-roadmap`.
   * @param projector - Puts a version into the repository.
   * @param audit - Where a dismissal and a policy change are recorded.
   */
  constructor(
    repository: PipelineRepository,
    private readonly briefs: BriefsService,
    runner: PipelineSkillRunner,
    private readonly projector: RoadmapProjector,
    private readonly audit: AuditService,
  ) {
    this.store = repository;
    this.skills = runner;
  }

  /**
   * Generate an investigation's roadmap from its brief — version 1, then a pull request.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @param request - Where it goes.
   * @returns The card.
   * @throws {NotFoundError} `investigation_not_found`, `brief_not_found`, `roadmap_source_not_found`.
   * @throws {ConflictError} `roadmap_exists`, `roadmap_no_researcher`, `roadmap_skill_unpublished`.
   * @throws {InvalidRequestError} `roadmap_target_required`.
   * @throws {UpstreamError} `roadmap_skill_failed`, `roadmap_output_invalid`, `engine_unavailable`.
   */
  async generate(
    organizationId: string,
    investigationId: string,
    request: GenerateRequest = {},
  ): Promise<RoadmapResource> {
    const investigation = await this.investigation(organizationId, investigationId);

    if ((await this.store.doc(organizationId, investigationId)) !== undefined) {
      throw roadmapExists(investigation.displayId);
    }

    const targetSourceId = await this.target(organizationId, request.targetSourceId);
    const brief = await this.briefs.export(organizationId, investigationId);
    const { skill, result } = await this.skills.run(organizationId, {
      slug: "create-roadmap",
      output: "roadmap",
      run: investigationId,
      input: {
        investigation: investigation.displayId,
        question: investigation.question,
        today: this.today(),
        brief: brief.markdown,
        outline: await this.store.roadmapInput(investigationId),
        previous: null,
        suggestions: [],
      },
    });
    const answered = this.checked(result.roadmap);
    const structure = canonical(mergeRoadmap(answered, null));
    const title = answered.title.trim();

    try {
      await this.store.createDoc({
        organizationId,
        investigationId,
        title,
        targetSourceId,
        version: {
          structure,
          markdown: renderRoadmap(title, structure),
          generatedBy: skillStamp(skill),
          path: request.path ?? DEFAULT_ROADMAP_PATH,
        },
      });
    } catch (error) {
      // Two requests generated at once: `roadmap_docs_investigation_key` kept one.
      if ((error as { constraint?: unknown }).constraint === "roadmap_docs_investigation_key") {
        throw roadmapExists(investigation.displayId);
      }
      throw error;
    }

    return this.projected(await this.load(organizationId, investigationId));
  }

  /**
   * The pipeline card.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The document, its projection, milestones, issues and suggestions.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`.
   */
  async card(organizationId: string, investigationId: string): Promise<RoadmapResource> {
    return this.resource(await this.load(organizationId, investigationId));
  }

  /**
   * Suggest a change — a person's, from the card.
   *
   * @param organizationId - The workspace.
   * @param userId - Who suggests it.
   * @param investigationId - The investigation.
   * @param request - The text, and an optional structured hint for the re-run.
   * @returns The suggestion, open.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`.
   */
  async suggest(
    organizationId: string,
    userId: string,
    investigationId: string,
    request: SuggestRequest,
  ): Promise<SuggestionResource> {
    const { doc } = await this.load(organizationId, investigationId);

    return suggestionResource(
      await this.store.addSuggestion(doc.id, {
        authorKind: "user",
        userId,
        agent: null,
        text: request.text.trim(),
        hint: request.hint ?? null,
      }),
    );
  }

  /**
   * Raise a suggestion on the product's behalf — the estimator's, the analyzer's, the drift
   * detector's. There is no route for this: another plane calls it.
   *
   * @param docId - The document.
   * @param agent - Who raises it — `drift-detector`, `estimator`.
   * @param text - What is proposed.
   * @param hint - A structured hint for the re-run, or null.
   * @returns The suggestion, open.
   */
  async raise(
    docId: string,
    agent: string,
    text: string,
    hint: Record<string, unknown> | null = null,
  ): Promise<SuggestionRow> {
    const suggestion: NewSuggestion = { authorKind: "ai", userId: null, agent, text, hint };

    return this.store.addSuggestion(docId, suggestion);
  }

  /**
   * Apply a suggestion: re-run `create-roadmap` with it appended, and store what comes back as
   * the next version.
   *
   * @param organizationId - The workspace.
   * @param userId - Who applies it.
   * @param investigationId - The investigation.
   * @param suggestionId - The suggestion.
   * @returns The card, on the new version.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`,
   *   `roadmap_suggestion_not_found`.
   * @throws {ConflictError} `roadmap_suggestion_settled`, `roadmap_version_conflict`,
   *   `roadmap_no_researcher`, `roadmap_skill_unpublished`.
   * @throws {UpstreamError} `roadmap_skill_failed`, `roadmap_output_invalid`, `engine_unavailable`.
   */
  async apply(
    organizationId: string,
    userId: string,
    investigationId: string,
    suggestionId: string,
  ): Promise<RoadmapResource> {
    const loaded = await this.load(organizationId, investigationId);
    const { investigation, doc, version } = loaded;
    const suggestions = await this.store.suggestions(doc.id);
    const suggestion = this.open(suggestions, suggestionId);
    const earlier = suggestions
      .filter((candidate) => candidate.status === "applied")
      .sort((left, right) => (left.appliedVersion ?? 0) - (right.appliedVersion ?? 0));
    const brief = await this.briefs.export(organizationId, investigationId);
    const { skill, result } = await this.skills.run(organizationId, {
      slug: "create-roadmap",
      output: "roadmap",
      run: doc.id,
      input: {
        investigation: investigation.displayId,
        question: investigation.question,
        today: this.today(),
        brief: brief.markdown,
        outline: await this.store.roadmapInput(investigationId),
        previous: previousView(doc.title, version.structure),
        suggestions: [...earlier, suggestion].map(suggestionInput),
      },
    });
    const answered = this.checked(result.roadmap);
    const structure = await this.mirrored(
      organizationId,
      mergeRoadmap(answered, version.structure),
    );
    const title = answered.title.trim();

    try {
      await this.store.addVersion(
        doc,
        title,
        {
          structure,
          markdown: renderRoadmap(title, structure),
          generatedBy: `${skillStamp(skill)} · suggestion ${suggestion.id}`,
          path: version.projection.path,
        },
        { suggestionId: suggestion.id, userId },
      );
    } catch (error) {
      if (error instanceof VersionRaceError) throw versionConflict(doc.id);
      throw error;
    }

    return this.projected(await this.load(organizationId, investigationId));
  }

  /**
   * Dismiss a suggestion. Recorded in the audit log, with what was turned down.
   *
   * @param organizationId - The workspace.
   * @param userId - Who dismisses it.
   * @param investigationId - The investigation.
   * @param suggestionId - The suggestion.
   * @returns The card.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`,
   *   `roadmap_suggestion_not_found`.
   * @throws {ConflictError} `roadmap_suggestion_settled`.
   */
  async dismiss(
    organizationId: string,
    userId: string,
    investigationId: string,
    suggestionId: string,
  ): Promise<RoadmapResource> {
    const loaded = await this.load(organizationId, investigationId);
    const suggestion = this.open(await this.store.suggestions(loaded.doc.id), suggestionId);

    if (!(await this.store.dismissSuggestion(loaded.doc.id, suggestionId, userId))) {
      throw suggestionSettled(suggestionId, "settled");
    }

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: ROADMAP_SUGGESTION_DISMISSED_EVENT,
      subjectType: "roadmap_doc",
      subjectId: loaded.doc.id,
      at: new Date(),
      detail: {
        suggestionId,
        authorKind: suggestion.authorKind,
        authorAgent: suggestion.authorAgent,
        text: suggestion.text,
        version: loaded.version.version,
      },
    });

    return this.resource(loaded);
  }

  /**
   * The workspace's pipeline policy.
   *
   * @param organizationId - The workspace.
   * @returns Whether direct commit is on.
   */
  async settings(organizationId: string): Promise<PipelineSettingsResource> {
    return settingsResource(await this.store.settings(organizationId));
  }

  /**
   * Change the policy. Turning direct commit on or off is recorded in the audit log.
   *
   * @param organizationId - The workspace.
   * @param userId - Who decided.
   * @param directCommit - Whether `ROADMAP.md` may be committed without a pull request.
   * @returns The policy as it now stands.
   */
  async saveSettings(
    organizationId: string,
    userId: string,
    directCommit: boolean,
  ): Promise<PipelineSettingsResource> {
    const before = await this.store.settings(organizationId);

    await this.store.saveSettings(organizationId, { directCommit }, userId);

    if (before.directCommit !== directCommit) {
      await this.audit.record({
        organizationId,
        actorId: userId,
        action: ROADMAP_POLICY_UPDATED_EVENT,
        subjectType: "roadmap_pipeline_settings",
        subjectId: organizationId,
        at: new Date(),
        detail: { previousDirectCommit: before.directCommit, directCommit },
      });
    }

    return settingsResource({ directCommit });
  }

  /**
   * An investigation's document and its current version.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The three rows every request works on.
   * @throws {NotFoundError} `investigation_not_found`, `roadmap_not_found`.
   */
  async load(organizationId: string, investigationId: string): Promise<LoadedRoadmap> {
    const investigation = await this.investigation(organizationId, investigationId);
    const doc = await this.store.doc(organizationId, investigationId);
    const version =
      doc?.currentVersion === null || doc === undefined
        ? undefined
        : await this.store.version(doc.id, doc.currentVersion);

    if (doc === undefined || version === undefined) throw roadmapNotFound(investigation.displayId);

    return { investigation, doc, version };
  }

  /**
   * The card for a loaded document.
   *
   * @param loaded - The document.
   * @param problem - Why its projection could not be moved just now, or null.
   * @returns The card.
   */
  async resource(loaded: LoadedRoadmap, problem: string | null = null): Promise<RoadmapResource> {
    const ticketIds = itemsOf(loaded.version.structure).flatMap(({ item }) =>
      item.ticket_id === null ? [] : [item.ticket_id],
    );
    const [issues, suggestions] = await Promise.all([
      this.store.issues(loaded.doc.organizationId, ticketIds),
      this.store.suggestions(loaded.doc.id),
    ]);

    return roadmapResource(
      loaded.investigation,
      loaded.doc,
      loaded.version,
      issues,
      suggestions,
      problem,
    );
  }

  /**
   * Project a freshly written version, and answer the card with where that got to.
   *
   * @param loaded - The document, on its new version.
   * @returns The card.
   */
  async projected(loaded: LoadedRoadmap): Promise<RoadmapResource> {
    const outcome = await this.projector.settle(loaded.doc, loaded.version);

    return this.resource(
      { ...loaded, version: { ...loaded.version, projection: outcome.projection } },
      outcome.problem,
    );
  }

  /**
   * A structure with each filed item's done state taken from the tracker.
   *
   * @param organizationId - The workspace.
   * @param structure - The structure.
   * @returns It, mirrored and in canonical key order.
   */
  async mirrored(organizationId: string, structure: RoadmapStructure): Promise<RoadmapStructure> {
    const ticketIds = itemsOf(structure).flatMap(({ item }) =>
      item.ticket_id === null ? [] : [item.ticket_id],
    );
    const tickets = await this.store.issues(organizationId, ticketIds);

    return canonical(
      refreshStates(structure, new Map(tickets.map((ticket) => [ticket.id, ticket]))),
    );
  }

  /**
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns Its head.
   * @throws {NotFoundError} `investigation_not_found`.
   */
  private async investigation(
    organizationId: string,
    investigationId: string,
  ): Promise<PipelineInvestigation> {
    const investigation = await this.store.investigation(organizationId, investigationId);

    if (investigation === undefined) throw investigationNotFound(investigationId);

    return investigation;
  }

  /**
   * The source a new document goes to.
   *
   * @param organizationId - The workspace.
   * @param asked - The source the request named, if it named one.
   * @returns The source's id.
   * @throws {NotFoundError} `roadmap_source_not_found` for a named source the workspace lacks.
   * @throws {InvalidRequestError} `roadmap_target_required` when none was named and the workspace
   *   has none, or more than one.
   */
  private async target(organizationId: string, asked: string | undefined): Promise<string> {
    const sources = await this.store.sources(organizationId);

    if (asked !== undefined) {
      if (!sources.some((source) => source.id === asked)) throw sourceNotFound(asked);

      return asked;
    }

    const only = sources.length === 1 ? sources[0] : undefined;

    if (only === undefined) throw targetRequired(sources.length);

    return only.id;
  }

  /**
   * The open suggestion a request names.
   *
   * @param suggestions - The document's suggestions.
   * @param suggestionId - The one asked for.
   * @returns It.
   * @throws {NotFoundError} `roadmap_suggestion_not_found`.
   * @throws {ConflictError} `roadmap_suggestion_settled`.
   */
  private open(suggestions: readonly SuggestionRow[], suggestionId: string): SuggestionRow {
    const suggestion = suggestions.find((candidate) => candidate.id === suggestionId);

    if (suggestion === undefined) throw suggestionNotFound(suggestionId);
    if (suggestion.status !== "open") throw suggestionSettled(suggestionId, suggestion.status);

    return suggestion;
  }

  /**
   * A skill's roadmap, refused when it cannot be stored.
   *
   * @param roadmap - What the run answered.
   * @returns It.
   * @throws {UpstreamError} `roadmap_output_invalid`.
   */
  private checked<T extends Parameters<typeof roadmapProblems>[0]>(roadmap: T | null): T {
    if (roadmap === null) throw outputInvalid(["the run answered no roadmap"]);

    const problems = roadmapProblems(roadmap);

    if (problems.length > 0) throw outputInvalid(problems);

    return roadmap;
  }

  /** @returns The run's date, `YYYY-MM-DD`, in UTC. */
  private today(): string {
    return this.clock().toISOString().slice(0, 10);
  }
}
