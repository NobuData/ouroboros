/**
 * The competitor registry — rivals and their watches, and the change feed (CL.3,
 * [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * **Who may do what.** Every member reads the registry and the feed; owners and admins add,
 * edit and remove rivals and watches (the controller's `@Roles`). The workspace is always the
 * session's — a rival or watch of another workspace is a `404`.
 *
 * **What a watch may become.** Its kind, URL and selector are fixed once created: the snapshot
 * chain diffs one source in one region, and moving either would make the next diff describe the
 * move rather than a change. To watch something else, add a watch — and disable the old one if an
 * investigation cites it, since a cited watch cannot be removed. Cadence and `enabled` change
 * freely, and `renderRequired: false` asks for a page the tracker marked JS-rendered to be tried
 * again.
 */

import { Injectable } from "@nestjs/common";

import type { CompetitorSourceKind } from "../../db/schema";
import { violatesConstraint } from "../../tenancy/constraints";
import { acceptsSelector, githubRepoOf } from "./competitor.kinds";
import { SelectorError, parseSelector } from "./competitor.selector";
import type {
  ChangeFeedQuery,
  CreateCompetitorDto,
  CreateWatchDto,
  UpdateCompetitorDto,
  UpdateWatchDto,
} from "./competitors.dto";
import { DEFAULT_CHANGE_LIMIT } from "./competitors.dto";
import {
  MAX_WATCHES_PER_COMPETITOR,
  cited,
  competitorNotFound,
  nameTaken,
  selectorInvalid,
  tooManyWatches,
  urlInvalid,
  watchExists,
  watchNotFound,
} from "./competitors.errors";
import { CompetitorsRepository, type CompetitorRow } from "./competitors.repository";
import {
  changeResource,
  competitorResource,
  summaryResource,
  watchResource,
  type CompetitorChangeFeedResource,
  type CompetitorListResource,
  type CompetitorResource,
  type CompetitorWatchResource,
} from "./competitors.resources";

/** The constraint that keeps a cited snapshot — and so its watch and rival — in place. */
const CITED_SNAPSHOT_FK = "source_records_snapshot_fk";

@Injectable()
export class CompetitorsService {
  /** @param competitors - The registry's tables. */
  constructor(private readonly competitors: CompetitorsRepository) {}

  /**
   * The workspace's rivals with their watches, and the tracker's summary.
   *
   * @param organizationId - The workspace.
   * @returns The registry.
   */
  async list(organizationId: string): Promise<CompetitorListResource> {
    const [rivals, watches, summary] = await Promise.all([
      this.competitors.listCompetitors(organizationId),
      this.competitors.listWatches(organizationId),
      this.competitors.summary(organizationId),
    ]);

    return {
      items: rivals.map((rival) =>
        competitorResource(
          rival,
          watches.filter((watch) => watch.competitorId === rival.id),
        ),
      ),
      summary: summaryResource(summary),
    };
  }

  /**
   * Add a rival.
   *
   * @param organizationId - The workspace.
   * @param body - Its name and details.
   * @returns The rival, with no watches.
   * @throws {ConflictError} `competitor_name_taken`.
   */
  async create(organizationId: string, body: CreateCompetitorDto): Promise<CompetitorResource> {
    const name = body.name.trim();

    try {
      const row = await this.competitors.createCompetitor(organizationId, {
        name,
        meta: metaOf({}, body),
      });
      return competitorResource(row, []);
    } catch (error) {
      if (violatesConstraint(error, "competitors_organization_name_key")) throw nameTaken(name);
      throw error;
    }
  }

  /**
   * Edit a rival.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @param body - What to change.
   * @returns The rival after the change.
   * @throws {NotFoundError} `competitor_not_found`.
   * @throws {ConflictError} `competitor_name_taken`.
   */
  async update(
    organizationId: string,
    competitorId: string,
    body: UpdateCompetitorDto,
  ): Promise<CompetitorResource> {
    const current = await this.rival(organizationId, competitorId);
    const name = body.name?.trim();

    try {
      const row = await this.competitors.updateCompetitor(organizationId, competitorId, {
        ...(name === undefined ? {} : { name }),
        meta: metaOf(current.meta, body),
      });
      if (row === undefined) throw competitorNotFound(competitorId);

      return competitorResource(
        row,
        await this.competitors.listWatches(organizationId, competitorId),
      );
    } catch (error) {
      if (violatesConstraint(error, "competitors_organization_name_key"))
        throw nameTaken(name ?? "");
      throw error;
    }
  }

  /**
   * Remove a rival and its watches.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @returns When it is gone.
   * @throws {NotFoundError} `competitor_not_found`.
   * @throws {ConflictError} `competitor_cited` when an investigation cites one of its changes.
   */
  async remove(organizationId: string, competitorId: string): Promise<void> {
    let removed: boolean;

    try {
      removed = await this.competitors.deleteCompetitor(organizationId, competitorId);
    } catch (error) {
      if (violatesConstraint(error, CITED_SNAPSHOT_FK)) throw cited("rival");
      throw error;
    }
    if (!removed) throw competitorNotFound(competitorId);
  }

  /**
   * Add a watch to a rival.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @param body - What to watch.
   * @returns The watch, due at the scheduler's next tick.
   * @throws {NotFoundError} `competitor_not_found`.
   * @throws {InvalidRequestError} `competitor_selector_invalid`, `competitor_watch_url_invalid`.
   * @throws {ConflictError} `competitor_watch_exists`, `competitor_watch_limit`.
   */
  async addWatch(
    organizationId: string,
    competitorId: string,
    body: CreateWatchDto,
  ): Promise<CompetitorWatchResource> {
    await this.rival(organizationId, competitorId);

    const selector = body.selector?.trim() ?? null;
    validateWatch(body.sourceKind, body.url, selector === "" ? null : selector);

    if ((await this.competitors.countWatches(competitorId)) >= MAX_WATCHES_PER_COMPETITOR) {
      throw tooManyWatches();
    }

    try {
      const row = await this.competitors.createWatch(competitorId, {
        sourceKind: body.sourceKind,
        url: body.url,
        selector: selector === "" ? null : selector,
        cadence: body.cadence ?? "daily",
        enabled: body.enabled ?? true,
      });
      return watchResource(row);
    } catch (error) {
      if (violatesConstraint(error, "competitor_watches_target_key")) throw watchExists();
      if (violatesConstraint(error, "competitor_watches_url_valid")) {
        throw urlInvalid("it is not an absolute http(s) URL");
      }
      throw error;
    }
  }

  /**
   * Edit a watch's schedule.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @param watchId - The watch.
   * @param body - What to change.
   * @returns The watch after the change.
   * @throws {NotFoundError} `competitor_not_found`, `competitor_watch_not_found`.
   */
  async updateWatch(
    organizationId: string,
    competitorId: string,
    watchId: string,
    body: UpdateWatchDto,
  ): Promise<CompetitorWatchResource> {
    await this.watch(organizationId, competitorId, watchId);

    const row = await this.competitors.updateWatch(watchId, {
      ...(body.cadence === undefined ? {} : { cadence: body.cadence }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.renderRequired === false ? { renderRequired: false as const } : {}),
    });
    if (row === undefined) throw watchNotFound(watchId);

    return watchResource(row);
  }

  /**
   * Remove a watch and its snapshots.
   *
   * @param organizationId - The workspace.
   * @param competitorId - The rival.
   * @param watchId - The watch.
   * @returns When it is gone.
   * @throws {NotFoundError} `competitor_not_found`, `competitor_watch_not_found`.
   * @throws {ConflictError} `competitor_cited` when an investigation cites one of its changes.
   */
  async removeWatch(organizationId: string, competitorId: string, watchId: string): Promise<void> {
    await this.watch(organizationId, competitorId, watchId);

    try {
      await this.competitors.deleteWatch(watchId);
    } catch (error) {
      if (violatesConstraint(error, CITED_SNAPSHOT_FK)) throw cited("watch");
      throw error;
    }
  }

  /**
   * The workspace's archived changes, newest first — the read surface v2's matrix-staleness
   * alerts subscribe to.
   *
   * @param organizationId - The workspace.
   * @param query - Rival, kind, window and page size.
   * @returns One page of changes and the cursor for the next.
   */
  async feed(
    organizationId: string,
    query: ChangeFeedQuery,
  ): Promise<CompetitorChangeFeedResource> {
    const limit = query.limit ?? DEFAULT_CHANGE_LIMIT;
    const rows = await this.competitors.changes(organizationId, {
      ...(query.competitor === undefined ? {} : { competitorId: query.competitor }),
      ...(query.sourceKind === undefined ? {} : { sourceKind: query.sourceKind }),
      ...(query.since === undefined ? {} : { since: new Date(query.since) }),
      ...(query.before === undefined ? {} : { before: new Date(query.before) }),
      limit,
    });
    const last = rows[rows.length - 1];

    return {
      items: rows.map(changeResource),
      nextBefore: rows.length === limit && last !== undefined ? last.takenAt.toISOString() : null,
    };
  }

  private async rival(organizationId: string, competitorId: string): Promise<CompetitorRow> {
    const row = await this.competitors.findCompetitor(organizationId, competitorId);
    if (row === undefined) throw competitorNotFound(competitorId);
    return row;
  }

  private async watch(
    organizationId: string,
    competitorId: string,
    watchId: string,
  ): Promise<void> {
    await this.rival(organizationId, competitorId);
    const row = await this.competitors.findWatch(organizationId, competitorId, watchId);
    if (row === undefined) throw watchNotFound(watchId);
  }
}

/**
 * A rival's meta after a create or an edit: given fields replace, `null` removes, omitted keep.
 *
 * @param current - The stored meta (`{}` for a new rival).
 * @param body - The request.
 * @returns The meta to store.
 */
export function metaOf(
  current: Readonly<Record<string, unknown>>,
  body: { site?: string | null; aliases?: string[]; notes?: string | null },
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...current };

  if (body.site !== undefined) {
    if (body.site === null) delete meta.site;
    else meta.site = body.site;
  }
  if (body.aliases !== undefined) {
    const aliases = [
      ...new Map(body.aliases.map((alias) => [alias.trim().toLowerCase(), alias.trim()])).values(),
    ];
    if (aliases.length === 0) delete meta.aliases;
    else meta.aliases = aliases;
  }
  if (body.notes !== undefined) {
    if (body.notes === null) delete meta.notes;
    else meta.notes = body.notes.trim();
  }
  return meta;
}

/**
 * Refuse a watch whose URL or selector does not suit its kind.
 *
 * @param kind - The source kind.
 * @param url - The URL.
 * @param selector - The selector, or null.
 * @throws {InvalidRequestError} `competitor_selector_invalid` or `competitor_watch_url_invalid`.
 */
export function validateWatch(
  kind: CompetitorSourceKind,
  url: string,
  selector: string | null,
): void {
  if (kind === "github_releases" && githubRepoOf(url) === null) {
    throw urlInvalid(
      "a github_releases watch names a repository, as https://github.com/<owner>/<repo>",
    );
  }
  if (selector === null) return;
  if (!acceptsSelector(kind)) {
    throw selectorInvalid(`a ${kind} watch is scoped by its shape and takes no selector`);
  }
  try {
    parseSelector(selector);
  } catch (error) {
    if (error instanceof SelectorError) throw selectorInvalid(error.message);
    throw error;
  }
}
