/**
 * A ticket by the number people type — two reads, and no writes (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * `/ouro queue #485` names an issue the way a person does, and every route here addresses one by
 * `github_issues.id`. The listing's `q` cannot stand in: it is a *search* — `485` also finds
 * `#1485` and any title containing it — and a command that queued the first hit would queue the
 * wrong issue. {@link TicketLookupRepository.byNumber} is the exact read: one number, optionally
 * one repository, every mirrored issue of the workspace that carries it. More than one row is the
 * caller's to refuse by naming them, never this statement's to pick from.
 *
 * **The canonical twin rides along.** A dry run is started against `tickets.id` (#562), not the
 * mirror row. The twin is the GitHub-sourced ticket whose `external_key` is `#<number>` and whose
 * `meta.github` names the same repository, matched case-insensitively exactly as
 * `dry-runs.repository.ts` joins the other way. `null` when the canonical sync has not stored one.
 *
 * {@link TicketLookupRepository.open} is the completion list: open issues by number prefix or
 * title prefix.
 *
 * **It is exported, and it can only read** — see `runs/loop.lookup.repository.ts` for the argument;
 * the queue write stays `BacklogQueueService`'s.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type GithubIssueState } from "../db/schema";
import { escapeLike } from "./listing.search";

/** One mirrored issue, as a typed number resolves to it. */
export interface TicketLookupRow {
  /** `github_issues.id`. */
  readonly issueId: string;
  readonly number: number;
  readonly title: string;
  readonly state: GithubIssueState;
  /** `github_orgs.login` — `acme-robotics`. */
  readonly owner: string;
  /** `github_repos.name` — `helios-firmware`. */
  readonly repository: string;
  /** The canonical `tickets.id` for the same issue, or `null` when none is stored. */
  readonly ticketId: string | null;
}

/** Which repository a number was typed against. Names are matched case-insensitively. */
export interface TicketRepositoryFilter {
  /** `github_orgs.login`, when the text carried an owner. */
  readonly owner?: string;
  /** `github_repos.name`. */
  readonly name: string;
}

@Injectable()
export class TicketLookupRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every mirrored issue of the workspace carrying this number.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param number - The issue number, exactly.
   * @param repository - Narrow to one repository, or `undefined` for the whole workspace.
   * @returns The issues, ordered by owner then repository. Empty when none carries the number.
   */
  async byNumber(
    organizationId: string,
    number: number,
    repository?: TicketRepositoryFilter,
  ): Promise<TicketLookupRow[]> {
    const filters = [sql`i.number = ${number}`];

    if (repository !== undefined) {
      filters.push(sql`lower(r.name) = lower(${repository.name})`);
      if (repository.owner !== undefined) {
        filters.push(sql`lower(o.login) = lower(${repository.owner})`);
      }
    }

    return this.issues(organizationId, sql.join(filters, sql` and `), sql`o.login, r.name`, 0);
  }

  /**
   * The open issues whose number or title starts with what has been typed.
   *
   * @param organizationId - The workspace.
   * @param prefix - The text so far, without a leading `#`; empty for the most recently updated.
   * @param limit - The most to return.
   * @returns The issues, most recently updated first.
   */
  async open(organizationId: string, prefix: string, limit: number): Promise<TicketLookupRow[]> {
    const pattern = `${escapeLike(prefix)}%`;
    const filter =
      prefix === ""
        ? sql`i.state = 'open'`
        : sql`i.state = 'open' and (i.number::text like ${pattern} or i.title ilike ${pattern})`;

    return this.issues(organizationId, filter, sql`i.gh_updated_at desc, i.number desc`, limit);
  }

  /**
   * Mirrored issues of one workspace matching a filter, each with its canonical twin.
   *
   * @param organizationId - The workspace.
   * @param filter - A boolean SQL fragment over `i` (issues), `r` (repos) and `o` (orgs).
   * @param order - The `order by` list.
   * @param limit - How many rows, or `0` for all of them.
   * @returns The rows.
   */
  private async issues(
    organizationId: string,
    filter: ReturnType<typeof sql>,
    order: ReturnType<typeof sql>,
    limit: number,
  ): Promise<TicketLookupRow[]> {
    const schema = sql.id(SCHEMA_NAME);
    const { rows } = await sql<TicketLookupRow>`
      select i.id as "issueId", i.number, i.title, i.state, o.login as owner,
             r.name as repository,
             (select t.id
                from ${schema}.tickets t
                join ${schema}.ticket_sources src on src.id = t.source_id
               where t.organization_id = i.organization_id
                 and src.kind = 'github'
                 and t.external_key = '#' || i.number::text
                 and lower(t.meta #>> '{github,owner}') = lower(o.login)
                 and lower(t.meta #>> '{github,repo}') = lower(r.name)
               order by t.created_at, t.id
               limit 1) as "ticketId"
        from ${schema}.github_issues i
        join ${schema}.github_repos r on r.id = i.github_repo_id
        join ${schema}.github_orgs o on o.id = r.org_id
       where i.organization_id = ${organizationId}
         and ${filter}
       order by ${order}
       ${limit > 0 ? sql`limit ${limit}` : sql``}
    `.execute(this.database.db);

    return rows;
  }
}
