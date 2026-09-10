/**
 * What `GET /api/v1/backlog` accepts — the filter bar, as a query string
 * (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)).
 *
 * Decision **K8** is that the filter bar *is* a query-string editor: every control on mockup
 * 03's `.filter-bar` card writes one parameter here, so a filtered view is a URL somebody can
 * paste to a colleague. That is what makes this file the contract rather than a convenience —
 * the shape below is what a shared link carries, and widening it later is easy where narrowing
 * it breaks somebody's bookmark.
 *
 * **Every parameter is optional and the defaults are the mockup's**: `Open ▾` and
 * *Sort: estimated effort ▾*. A request with no query string at all is therefore the screen as
 * it first draws, which is what N.1 ([#115](https://github.com/NobuData/ouroboros/issues/115))
 * renders before anybody has touched a control.
 *
 * **Paging is the #31 convention's `limit`/`offset` rather than the ticket's `page=`.** The
 * ticket names a paging slot and this service already has one — `PageQuery`, extended here as
 * every other listing extends it — so a second spelling would give the backlog its own dialect
 * for the one thing five endpoints already agree about. `page` is recoverable from the two at
 * any time; two conventions in one API are not.
 */

import { Transform } from "class-transformer";
import { ArrayMaxSize, IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

import { PageQuery } from "../tenancy/pagination";

/**
 * The *State* select's three, which are GitHub's two plus *everything*.
 *
 * `all` is a real member rather than the absence of the parameter, because the absence already
 * means something here: {@link DEFAULT_BACKLOG_STATE}, the mockup's `Open ▾`. A backlog screen
 * that wanted every issue would otherwise have no way to say so.
 */
export const BACKLOG_STATES = ["open", "closed", "all"] as const;

/** One of {@link BACKLOG_STATES}. */
export type BacklogStateFilter = (typeof BACKLOG_STATES)[number];

/** What the *State* select opens on, and what a request that names no state means. */
export const DEFAULT_BACKLOG_STATE: BacklogStateFilter = "open";

/**
 * The four orderings the ticket names.
 *
 * `effort` is the chip order XS→XL with **unsized last** — the mockup's default, and the one
 * ordering that is about the estimate rather than about the issue. `confidence` is the
 * estimator's own certainty, most certain first. `updated` is GitHub's `updated_at`, newest
 * first, which is what a person watching a busy repository wants. `number` is newest issue
 * first, which is how GitHub itself lists a backlog.
 *
 * **The mockup's own row order is none of these four**, and that is written down rather than
 * implemented: `R__dev_seed_intake.sql` says the page is hand-laid — M, M, S, L, M, L, XS,
 * unsized, XL — so reproducing it would mean a fifth ordering that answers no question.
 */
export const BACKLOG_SORTS = ["effort", "confidence", "updated", "number"] as const;

/** One of {@link BACKLOG_SORTS}. */
export type BacklogSort = (typeof BACKLOG_SORTS)[number];

/** What the *Sort* select opens on: the mockup's *Sort: estimated effort ▾*. */
export const DEFAULT_BACKLOG_SORT: BacklogSort = "effort";

/**
 * The most labels one request may AND together.
 *
 * GitHub's own cap on labels per issue, which `github_issues_labels_shape` (V014) mirrors — so
 * a request naming 101 labels is asking for a row the database cannot hold. Refusing it is
 * cheaper than proving the intersection empty, and the ceiling is the schema's rather than a
 * number invented here.
 */
export const MAX_LABEL_FILTERS = 100;

/** The longest one label name may be — GitHub's own limit on the field. */
export const MAX_LABEL_LENGTH = 50;

/**
 * The longest search a request may carry.
 *
 * Long enough for a pasted issue title and short enough that the `ilike` it becomes is bounded.
 * A search box is the one parameter a person holds a key down in.
 */
export const MAX_SEARCH_LENGTH = 200;

/**
 * Read a repeatable query parameter as a list of names.
 *
 * Two spellings reach this, and both are things a real client sends: `?labels=bug,tech-debt`,
 * which is what a URL-writing filter bar produces and what a person editing the address bar
 * types, and `?labels=bug&labels=tech-debt`, which is what Express hands over as an array and
 * what most HTTP libraries emit for a list. Accepting one and silently ignoring the other
 * would make a shared link work in one client and filter nothing in another.
 *
 * Blank entries are dropped rather than refused: `?labels=` is how a filter bar spells *no
 * chips selected*, and a trailing comma is a person mid-edit. Neither is a mistake worth a
 * `422`, and neither can match a row — `github_issues_labels_shape` refuses the empty name.
 *
 * @param value - The raw parameter, as Express parsed it: a string, an array of them when the
 *   name repeated, or `undefined` when it is absent.
 * @returns The names, in the order given, or `undefined` when nothing usable was sent — which
 *   is the same as not filtering, and is what keeps `?labels=` from meaning *match nothing*.
 */
export function labelList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : [value];
  const names = raw
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return names.length === 0 ? undefined : names;
}

/** The query string of `GET /api/v1/backlog`. */
export class ListBacklogQuery extends PageQuery {
  /**
   * Narrow to one repository — `github_repos.id`, the *Repository* select's value.
   *
   * The **id**, not the name, for `runs.dto.ts`' reason: a repository name is unique only
   * within its GitHub organisation, and a workspace may enable two organisations that both own
   * a `tools`. It is also what the #77 focus-repo preference already holds, so a screen that
   * remembers a repository has the right value in hand.
   *
   * A repository belonging to another workspace narrows to an empty page rather than erroring:
   * under the workspace scope this is a predicate, and *"your backlog, in a repository that is
   * not yours"* is honestly empty.
   */
  @IsOptional()
  @IsUUID()
  repo?: string;

  /**
   * The chip set, ANDed — `?labels=bug,tech-debt` is *both*, not *either*.
   *
   * AND is the ticket's own word and it is the behaviour the chips imply: turning on a second
   * chip should narrow what is on screen, which is the only reading under which a chip set is
   * a filter rather than a union. It is served by `github_issues_labels_idx`, the `jsonb_ops`
   * GIN index V014 chose over the smaller `jsonb_path_ops` precisely so that an *any-of* read
   * stays possible for whoever files that ticket.
   *
   * Matched **exactly** rather than by substring: these are the names the chip set was built
   * from — the listing's own `labelFacets` — so a client sends back a name it was given.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => labelList(value))
  @IsString({ each: true })
  @MaxLength(MAX_LABEL_LENGTH, { each: true })
  @ArrayMaxSize(MAX_LABEL_FILTERS)
  labels?: string[];

  /** The *State* select. Defaults to {@link DEFAULT_BACKLOG_STATE} — the mockup's `Open ▾`. */
  @IsOptional()
  @IsIn(BACKLOG_STATES)
  state?: BacklogStateFilter;

  /** The *Sort* select. Defaults to {@link DEFAULT_BACKLOG_SORT}. */
  @IsOptional()
  @IsIn(BACKLOG_SORTS)
  sort?: BacklogSort;

  /**
   * The search box — *"Filter by title, #number, or label…"*, which is three matches under one
   * parameter because that placeholder promises one box: a substring of the title, a label the
   * issue carries, or the issue's number with or without the `#`.
   *
   * Trimmed before it is judged, and an empty search is *no search*: a person who clears the
   * box sends `?q=`, and a filter that then matched nothing would empty the screen at the
   * moment they asked to see all of it.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  q?: string;
}
