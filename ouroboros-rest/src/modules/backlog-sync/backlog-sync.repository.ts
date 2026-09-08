/**
 * Every statement the backlog sync issues — the cross-workspace read that starts a cycle, and
 * the one transaction that ends a poll.
 *
 * K.4 ([#102](https://github.com/NobuData/ouroboros/issues/102)).
 *
 * ## The read is unscoped, and that is the one place in this module that is
 *
 * {@link BacklogSyncRepository.enabledRepositories} takes no workspace. Every other repository
 * in this service takes an `organizationId` first, and the rule exists because the caller is a
 * request; this module's caller is a timer. Nobody is signed in, there is no tenant context to
 * read, and the work is *every configured workspace's enabled repositories*. What keeps that
 * safe is written into the statement — it selects no credential, and its rows are consumed
 * only by a poll that writes back to the repository they came from and answers nobody.
 * `provider-health.repository.ts` makes the same call for the same reason.
 *
 * ## A repository is in scope only when its own `enabled` and its org's are both true
 *
 * V003's rule, and it is a join rather than a column here because that is where the rule
 * lives: `github_repos.enabled` is *"watch this repo"* and `github_orgs.enabled` is *"watch
 * this GitHub organisation at all"*, and a workspace that turned an org off expects every
 * repository under it to stop being read.
 *
 * ## The whole poll is one transaction, because freshness must never outrun the rows
 *
 * Decision **K2** asks for `issues_synced_at` and `issues_sync_cursor` to move *with* the row
 * writes. {@link BacklogSyncRepository.applyPoll} is that: the existing rows are read, the
 * changed ones are written, and the repository's stamp and watermark are set, all inside one
 * transaction that either happens or does not. A poll that failed on its last page leaves the
 * mirror and the freshness tag exactly as they were, which is the difference between a tag
 * that means *"we looked"* and one that means *"we started looking"*.
 *
 * It is also why the read of the existing rows is *inside* the transaction rather than a
 * separate call: the comparison that decides *"has this row changed"* has to be against the
 * rows the write will land on.
 *
 * ## An unchanged issue is not written, and that is a rule about `updated_at`
 *
 * `github_issues_touch_updated_at` is an unconditional `BEFORE UPDATE` trigger, so the only
 * way to keep V014's promise — *"`updated_at` moves only when something in the row actually
 * changed"* — is to not issue the update. That is what makes the acceptance criterion *"a
 * second poll with no upstream changes … touches no rows"* true rather than approximately
 * true: GitHub's `since` is inclusive, so every incremental poll re-reads the one issue
 * sitting exactly on the watermark, and writing it would move a timestamp nothing had changed.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, GithubIssueState } from "../db/schema";
import { DEFAULT_SIZING_STATUS } from "../db/schema";
import type { EstimableIssue } from "./estimation.intake";
import type { MirroredIssue } from "./issue.mapping";

/** One repository a cycle is about to poll. */
export interface SyncTarget {
  /** `github_repos.id` — what the issues hang off and what the cursor is stored on. */
  readonly githubRepoId: string;
  /** The workspace, resolved through `github_orgs`; the issues' `organization_id`. */
  readonly organizationId: string;
  /** The GitHub organisation's login — the `owner` in the route. */
  readonly owner: string;
  /** The repository name within it — the `repo` in the route. */
  readonly name: string;
  /** When it was last polled, or null when it never has been. */
  readonly syncedAt: Date | null;
  /**
   * The `since` watermark to send, or null on a repository that has never been polled.
   *
   * Null is what makes a poll an **initial import** rather than an incremental one, and the
   * two ask GitHub different questions — see `backlog-sync.service.ts`.
   */
  readonly cursor: string | null;
}

/** What one poll asks to be written. */
export interface PollWrite {
  /** Which repository. */
  readonly target: SyncTarget;
  /** The issues GitHub returned, mapped, in the order it listed them. */
  readonly issues: readonly MirroredIssue[];
  /** The watermark to store, or null to leave the stored one alone. */
  readonly cursor: string | null;
  /** The cycle's clock — the freshness stamp every repository in one cycle shares. */
  readonly syncedAt: Date;
}

/** What the transaction did. */
export interface PollWritten {
  /** Rows inserted. */
  readonly imported: number;
  /** Rows rewritten because something GitHub owns had changed. */
  readonly updated: number;
  /** Rows GitHub returned that were identical to what was stored — and were not written. */
  readonly unchanged: number;
  /**
   * The issues to hand to the estimation pipeline: everything imported, and everything that
   * reopened.
   *
   * Returned rather than handed over here, because the handoff must happen **after** this
   * transaction has committed — an issue announced to a queue and then rolled back is a queue
   * holding a row that does not exist.
   */
  readonly estimable: readonly EstimableIssue[];
}

/** The mirrored columns, as a comparison reads them. */
interface StoredIssue {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: GithubIssueState;
  labels: string[];
  author_login: string | null;
  gh_created_at: Date;
  gh_updated_at: Date;
  gh_url: string;
}

@Injectable()
export class BacklogSyncRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every repository a cycle should poll, across every workspace.
   *
   * @returns The targets, ordered oldest-poll-first so a repository that has never been synced
   *   — `issues_synced_at is null` — is reached before one that was synced a minute ago. The
   *   order is what keeps a workspace that adds a repository from waiting behind the ones
   *   already up to date.
   */
  async enabledRepositories(): Promise<SyncTarget[]> {
    const rows = await this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select([
        "github_repos.id as githubRepoId",
        "github_orgs.organization_id as organizationId",
        "github_orgs.login as owner",
        "github_repos.name as name",
        "github_repos.issues_synced_at as syncedAt",
        "github_repos.issues_sync_cursor as cursor",
      ])
      // Both flags, because a repository is in scope only when the workspace has said yes
      // twice — see this file's header.
      .where("github_repos.enabled", "=", true)
      .where("github_orgs.enabled", "=", true)
      // Nulls first: a repository nobody has ever polled is the one with nothing on the page.
      .orderBy("github_repos.issues_synced_at", (order) => order.asc().nullsFirst())
      .orderBy("github_repos.id", "asc")
      .execute();

    return rows;
  }

  /**
   * Store one poll: the rows it changed, and the freshness it earned.
   *
   * @param write - What the poll read, and the stamps to record with it.
   * @returns What was written, and which issues the estimation pipeline should be told about.
   */
  async applyPoll(write: PollWrite): Promise<PollWritten> {
    return this.database.transaction(async (trx) => {
      const stored = await this.storedIssues(
        trx,
        write.target.githubRepoId,
        write.issues.map((issue) => issue.number),
      );

      let imported = 0;
      let updated = 0;
      let unchanged = 0;
      const estimable: EstimableIssue[] = [];

      for (const issue of write.issues) {
        const previous = stored.get(issue.number);

        if (previous === undefined) {
          // A closed issue this mirror has never seen is **not** imported. The mirror is of a
          // workspace's *backlog*, and an incremental poll asks for `state=all` only so that a
          // close it has been watching comes back — see `backlog-sync.service.ts`. Inserting
          // every issue that happened to be closed since the last poll would grow the table
          // with rows the default view never renders and nothing ever asked for.
          if (issue.state === "closed") {
            continue;
          }

          const row = await this.insert(trx, write.target, issue, write.syncedAt);

          imported += 1;
          estimable.push({
            organizationId: write.target.organizationId,
            issueId: row.id,
            githubRepoId: write.target.githubRepoId,
            number: issue.number,
            reason: "imported",
          });

          continue;
        }

        if (!differs(previous, issue)) {
          unchanged += 1;
          continue;
        }

        await this.update(trx, previous.id, issue, write.syncedAt);

        updated += 1;

        // A reopen is the one update that is also new work: the issue left the backlog when it
        // closed, and it is back with whatever estimate it had — which the pipeline is entitled
        // to redo. A close is the opposite and enqueues nothing.
        if (previous.state === "closed" && issue.state === "open") {
          estimable.push({
            organizationId: write.target.organizationId,
            issueId: previous.id,
            githubRepoId: write.target.githubRepoId,
            number: issue.number,
            reason: "reopened",
          });
        }
      }

      await this.stampRepository(trx, write);

      return { imported, updated, unchanged, estimable };
    });
  }

  /**
   * The rows a poll's issues will land on.
   *
   * @param trx - The poll's transaction.
   * @param githubRepoId - The repository.
   * @param numbers - The issue numbers GitHub returned.
   * @returns The stored rows by number. Empty for an initial import, and for a poll whose
   *   issues are all new.
   */
  private async storedIssues(
    trx: Transaction<Database>,
    githubRepoId: string,
    numbers: readonly number[],
  ): Promise<Map<number, StoredIssue>> {
    if (numbers.length === 0) {
      return new Map();
    }

    const rows = await trx
      .selectFrom("github_issues")
      .select([
        "id",
        "number",
        "title",
        "body",
        "state",
        "labels",
        "author_login",
        "gh_created_at",
        "gh_updated_at",
        "gh_url",
      ])
      .where("github_repo_id", "=", githubRepoId)
      .where("number", "in", numbers)
      .execute();

    return new Map(rows.map((row) => [row.number, row]));
  }

  /**
   * Insert one mirrored issue.
   *
   * @param trx - The poll's transaction.
   * @param target - The repository, which is also where `organization_id` comes from.
   * @param issue - The mirrored values.
   * @param syncedAt - The cycle's clock.
   * @returns The new row's id, for the estimation handoff.
   */
  private async insert(
    trx: Transaction<Database>,
    target: SyncTarget,
    issue: MirroredIssue,
    syncedAt: Date,
  ): Promise<{ id: string }> {
    return trx
      .insertInto("github_issues")
      .values({
        organization_id: target.organizationId,
        github_repo_id: target.githubRepoId,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels),
        author_login: issue.authorLogin,
        gh_created_at: issue.ghCreatedAt,
        gh_updated_at: issue.ghUpdatedAt,
        gh_url: issue.ghUrl,
        synced_at: syncedAt,
        // Spelled rather than left to the column default, because it is the sync's claim
        // rather than the schema's convenience: a freshly mirrored issue has no estimate, and
        // this is the value the estimation pipeline claims work by.
        sizing_status: DEFAULT_SIZING_STATUS,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  /**
   * Rewrite one mirrored issue.
   *
   * Only ever called for a row that actually differs — see this file's header on why an
   * unchanged row is left alone. `sizing_status` is **not** in the set: it is the one column
   * this product owns, and a sync that reset it would undo the pipeline's work every time
   * somebody edited a title.
   *
   * @param trx - The poll's transaction.
   * @param id - The stored row.
   * @param issue - The mirrored values, as GitHub now has them.
   * @param syncedAt - The cycle's clock.
   */
  private async update(
    trx: Transaction<Database>,
    id: string,
    issue: MirroredIssue,
    syncedAt: Date,
  ): Promise<void> {
    await trx
      .updateTable("github_issues")
      .set({
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels),
        author_login: issue.authorLogin,
        gh_created_at: issue.ghCreatedAt,
        gh_updated_at: issue.ghUpdatedAt,
        gh_url: issue.ghUrl,
        synced_at: syncedAt,
      })
      .where("id", "=", id)
      .execute();
  }

  /**
   * Move the repository's freshness stamp and watermark.
   *
   * The last statement of the transaction, and the one the whole *"freshness can never claim a
   * sync that partly failed"* argument rests on.
   *
   * @param trx - The poll's transaction.
   * @param write - The poll.
   */
  private async stampRepository(trx: Transaction<Database>, write: PollWrite): Promise<void> {
    await trx
      .updateTable("github_repos")
      .set({
        issues_synced_at: write.syncedAt,
        // Null leaves the stored cursor alone rather than clearing it: a poll that saw no
        // issues has no watermark to record, and `github_repos_issues_cursor_after_sync` reads
        // that as the legitimate state it is — synced, with nothing to resume from.
        ...(write.cursor === null ? {} : { issues_sync_cursor: write.cursor }),
      })
      .where("id", "=", write.target.githubRepoId)
      .execute();
  }
}

/**
 * Has anything GitHub owns changed?
 *
 * Compared field by field rather than by `gh_updated_at` alone. GitHub does bump that column
 * on every change, so the cheaper test would usually agree — but *usually* is the wrong
 * standard for the predicate that decides whether a row is written at all, and a field-wise
 * comparison also heals a row that a previous poll stored wrongly or a seed wrote by hand.
 *
 * @param stored - The row as it is.
 * @param issue - The issue as GitHub now has it.
 * @returns `true` when the two differ in any mirrored column.
 */
function differs(stored: StoredIssue, issue: MirroredIssue): boolean {
  return (
    stored.title !== issue.title ||
    stored.body !== issue.body ||
    stored.state !== issue.state ||
    stored.author_login !== issue.authorLogin ||
    stored.gh_url !== issue.ghUrl ||
    stored.gh_created_at.getTime() !== issue.ghCreatedAt.getTime() ||
    stored.gh_updated_at.getTime() !== issue.ghUpdatedAt.getTime() ||
    // Order is part of the value: GitHub lists an issue's labels in a stable order and the
    // tags render in it, so a reordering is a change a reader would see.
    JSON.stringify(stored.labels) !== JSON.stringify(issue.labels)
  );
}
