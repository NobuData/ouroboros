/**
 * `GithubWriter` — the GitHub provider's half of the write SPI, one repository at a time.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)), decisions **N4** and **N6**.
 * `github.provider.ts` holds the members `WriteCapableProvider` names and turns every failure into
 * the SPI's taxonomy; this file holds what each member *does* against GitHub.
 *
 * ```
 * createTicket         probe(push-key marker) ─▶ POST /repos/{o}/{r}/issues (body + footer + marker)
 * linkDependency       GET …/issues/{n}/dependencies/blocked_by ─▶ POST {issue_id}        native
 *                      └─ that route 404s on an issue that exists ─▶ PATCH body + marker   fallback
 * ensureMilestone      GET …/milestones?state=all ─▶ POST …/milestones
 * ensureEpicContainer  probe(epic marker) ─▶ POST …/issues                    parent tracking issue
 * attachToEpic         GET …/issues/{parent}/sub_issues ─▶ POST {sub_issue_id}
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Idempotency is a marker in the body, found before every create.** GitHub has no idempotency
 * header for issue creation, so the draft's key travels *in* the issue as an HTML comment below a
 * discreet provenance footer — invisible to a reader, and there for the next attempt to find. The
 * probe asks twice, because each question has a blind spot the other covers:
 *
 *   1. **The most recently created issues** in the repository — one request, and the one that
 *      finds an issue created a second ago. GitHub's search index lags a write by up to a minute,
 *      and a push resumed right after a crash is exactly when that lag bites.
 *   2. **Search** for the marker — the one that finds an issue created last week in a busy
 *      repository, long after it has scrolled off the first page.
 *
 * Either answer is read back through {@link hasMarkerLine}, so an issue that merely *quotes* a
 * marker mid-sentence is never mistaken for the one that carries it.
 *
 * **The target is the source's first enabled repository.** A GitHub source enables a list, and a
 * push lands in one place; mockup 09's tenant chip reads `acme-robotics / helios-firmware`, one
 * repository, and the list's order is already observable (see `github.config.ts`).
 *
 * **Why the fallback is decided by a probe rather than by the declaration.** GitHub declares
 * `nativeDependencies: true` because github.com has the relation. An older GitHub Enterprise
 * Server does not, and nothing short of asking can tell the two apart; so `linkDependency` asks
 * the dependency route about an issue it has just read, and a `404` there means *no such API*
 * rather than *no such issue*. The answer then says `fallback`, which is the truth about what ran —
 * the SPI's rule is that a provider never claims `native` for a marker, not that it never falls
 * back.
 *
 * **Why REST and not GraphQL's `addBlockedBy`.** The issue names GraphQL as the alternate. Both
 * record the same relation; REST keeps every call on K.3's client, its rate guard and its failure
 * classification, where a second transport would need its own reading of a `200` carrying errors.
 */

import { z } from "zod";

import type { GithubClient } from "../../github/github.client";
import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import { TicketSourceError } from "../ticket-source.errors";
import {
  MAX_IDEMPOTENCY_KEY,
  hasDependencyMarker,
  withDependencyMarker,
  type DependencyLinkResult,
  type EpicContainerInput,
  type EpicMirrorRef,
  type MilestoneRef,
  type TicketDraftInput,
  type TicketSourceWriteCapabilities,
  type TicketWriteRef,
} from "../ticket-source.write";
import type { GithubSourceConfig } from "./github.config";
import { HTTPS_URL, ISSUES_ROUTE, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./github.mapping";

/**
 * What GitHub can write, as the provider declares it.
 *
 * Every feature: native `blocked_by` relations, milestones, and epics as parent issues with
 * sub-issue links — the pattern this repository's own roadmap is filed under.
 */
export const GITHUB_WRITE_CAPABILITIES = Object.freeze({
  createTicket: true,
  nativeDependencies: true,
  epicMapping: "parent_issue",
  milestones: true,
} as const) satisfies TicketSourceWriteCapabilities;

/** Create an issue. */
export const CREATE_ISSUE_ROUTE = "POST /repos/{owner}/{repo}/issues";

/** Read one issue — for its database id, and for its body on the fallback path. */
export const ISSUE_ROUTE = "GET /repos/{owner}/{repo}/issues/{issue_number}";

/** Replace an issue's body — the fallback's one write. */
export const UPDATE_ISSUE_ROUTE = "PATCH /repos/{owner}/{repo}/issues/{issue_number}";

/** Search issues — the probe's second question. */
export const SEARCH_ISSUES_ROUTE = "GET /search/issues";

/** Every milestone in a repository. */
export const MILESTONES_ROUTE = "GET /repos/{owner}/{repo}/milestones";

/** Create a milestone. */
export const CREATE_MILESTONE_ROUTE = "POST /repos/{owner}/{repo}/milestones";

/** The issues blocking one issue — and the capability probe. */
export const BLOCKED_BY_ROUTE =
  "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by";

/** Record that an issue is blocked by another. */
export const ADD_BLOCKED_BY_ROUTE =
  "POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by";

/** An issue's sub-issues. */
export const SUB_ISSUES_ROUTE = "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues";

/** Make an issue a sub-issue of another. */
export const ADD_SUB_ISSUE_ROUTE = "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues";

/** How many recently created issues the probe's first question reads — one page, GitHub's largest. */
export const RECENT_PROBE_SIZE = 100;

/** How many search hits the probe's second question reads. A key matches one issue, or none. */
export const SEARCH_PROBE_SIZE = 10;

/**
 * The provenance footer every issue this provider creates carries — discreet, and the line a
 * reader sees where the markers below it are invisible.
 */
export const PROVENANCE_FOOTER = "<sub>Filed by Ouroboros</sub>";

/**
 * The grammar a marker's key is held to — an idempotency key or an epic id.
 *
 * Narrower than {@link MAX_IDEMPOTENCY_KEY} alone, for three reasons that are all about where the
 * key goes: no whitespace, so a marker is one line the reader can match whole; no `>` and no `--`,
 * either of which would close the HTML comment early; and no quote, so the search probe's phrase
 * cannot be broken out of. A uuid, a `batch:draft` pair and a slug all fit.
 */
export const MARKER_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

/** A repository a writer acts on. */
export interface GithubTarget {
  /** The account. */
  readonly owner: string;
  /** The repository. */
  readonly repo: string;
}

/** The fields of an issue payload a write reads. */
const writtenIssue = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  html_url: z.string(),
  body: z.string().nullish(),
  repository_url: z.string().optional(),
  pull_request: z.unknown().optional(),
});

/** An issue, as a write reads it. */
export type WrittenIssue = z.infer<typeof writtenIssue>;

/** The fields of a milestone payload a write reads. */
const writtenMilestone = z.object({ number: z.number().int().positive(), title: z.string() });

/** The fields of a relation listing a write reads — both routes answer issues. */
const relatedIssue = z.object({ id: z.number().int().positive() });

/**
 * Where a source's pushes land.
 *
 * @param config - The source's settings, parsed.
 * @returns The first enabled repository — see this file's header.
 */
export function pushTarget(config: GithubSourceConfig): GithubTarget {
  // `readGithubConfig` refuses an empty list, so the first entry exists.
  return { owner: config.login, repo: config.repos[0] };
}

/**
 * The idempotency marker a pushed issue carries.
 *
 * @param key - The draft's idempotency key.
 * @returns `<!-- ouroboros:push-key <key> -->`.
 * @throws {TicketSourceError} `validation`, for a key {@link MARKER_KEY} refuses or longer than
 *   {@link MAX_IDEMPOTENCY_KEY}.
 */
export function pushKeyMarker(key: string): string {
  return marker("push-key", key, "idempotencyKey");
}

/**
 * The marker an epic's parent tracking issue carries — its idempotency key.
 *
 * @param epicId - The planning epic's id.
 * @returns `<!-- ouroboros:epic <id> -->`.
 * @throws {TicketSourceError} `validation`, for an id {@link MARKER_KEY} refuses.
 */
export function epicMarker(epicId: string): string {
  return marker("epic", epicId, "epicId");
}

/**
 * Compose one marker line.
 *
 * @param kind - What the marker records.
 * @param key - The key.
 * @param field - The field the key came from, for the refusal.
 * @returns The line.
 * @throws {TicketSourceError} `validation`, for a key that could not survive the trip.
 */
function marker(kind: string, key: string, field: string): string {
  if (key.length > MAX_IDEMPOTENCY_KEY || !MARKER_KEY.test(key) || key.includes("--")) {
    throw invalid(
      `${field} must be at most ${String(MAX_IDEMPOTENCY_KEY)} characters of ${MARKER_KEY.source}`,
    );
  }

  return `<!-- ouroboros:${kind} ${key} -->`;
}

/**
 * The search the probe's second question sends.
 *
 * @param target - The repository.
 * @param markerLine - The marker.
 * @returns `repo:<owner>/<repo> is:issue in:body "ouroboros:push-key <key>"` — the marker's words
 *   without the comment delimiters, which search does not index as words.
 */
export function searchQuery(target: GithubTarget, markerLine: string): string {
  const phrase = markerLine.replace(/^<!-- /, "").replace(/ -->$/, "");

  return `repo:${target.owner}/${target.repo} is:issue in:body "${phrase}"`;
}

/**
 * Whether a body carries a marker as a whole line.
 *
 * @param body - An issue's body, or null.
 * @param line - The marker, as {@link pushKeyMarker} or {@link epicMarker} composed it.
 * @returns `true` when one line of the body, trimmed, is exactly the marker.
 */
export function hasMarkerLine(body: string | null | undefined, line: string): boolean {
  return (body ?? "").split("\n").some((candidate) => candidate.trim() === line);
}

/**
 * The body a pushed issue is created with.
 *
 * What a person wrote comes first and is never edited — the analyzer's evidence line (#514) and
 * any reference in it survive verbatim — then a rule, the provenance footer, and the marker.
 *
 * @param body - The draft's body, or null for a one-line draft.
 * @param markerLine - The marker to carry.
 * @returns The body.
 * @throws {TicketSourceError} `validation`, when the result would exceed what GitHub stores.
 */
export function composeBody(body: string | null, markerLine: string): string {
  const footer = `---\n${PROVENANCE_FOOTER}\n\n${markerLine}`;
  const composed = body === null || body.trim() === "" ? footer : `${body}\n\n${footer}`;

  if (composed.length > MAX_BODY_LENGTH) {
    throw invalid(`the body exceeds ${String(MAX_BODY_LENGTH)} characters with its footer`);
  }

  return composed;
}

/**
 * An issue number held in an external id or a mirror reference.
 *
 * @param value - The id, as a ref carries it.
 * @param field - What it is, for the refusal.
 * @returns The number.
 * @throws {TicketSourceError} `validation`, for anything that is not a positive whole number —
 *   a ref this provider could not have produced.
 */
export function issueNumberOf(value: string, field: string): number {
  if (!/^[1-9]\d{0,9}$/.test(value)) {
    throw invalid(`${field} is not a GitHub issue number`);
  }

  return Number(value);
}

/**
 * A ref a write member answers, from an issue payload.
 *
 * @param issue - What GitHub answered.
 * @returns `{ externalId: "612", externalKey: "#612", url }` — the identity `mapGithubIssue`
 *   gives the same issue, so the ticket a sync adopts is the ticket the push recorded.
 * @throws {GithubApiError} `upstream_error`, when the link is not an https URL.
 */
export function refOf(issue: WrittenIssue): TicketWriteRef {
  if (!HTTPS_URL.test(issue.html_url)) {
    throw new GithubApiError(
      GITHUB_FAILURES.upstreamError,
      `#${String(issue.number)} answered a link that is not https`,
    );
  }

  return {
    externalId: String(issue.number),
    externalKey: `#${String(issue.number)}`,
    url: issue.html_url,
  };
}

/**
 * The provider's writes against one repository, over K.3's client.
 *
 * Built per call and dropped with it — the client holds the credential, and a writer that
 * outlived the call would be a singleton holding a token.
 *
 * Throws `TicketSourceError` `validation` for an argument it refuses before sending anything, and
 * K.3's `GithubApiError` for anything GitHub refused; `github.provider.ts` classifies the latter.
 */
export class GithubWriter {
  /**
   * @param client - K.3's client for this source's token and budget.
   * @param target - The repository.
   */
  constructor(
    private readonly client: GithubClient,
    private readonly target: GithubTarget,
  ) {}

  /**
   * Create an issue, or answer the one an earlier call with the same key created.
   *
   * @param draft - What to create.
   * @returns The issue's identity.
   */
  async createTicket(draft: TicketDraftInput): Promise<TicketWriteRef> {
    const markerLine = pushKeyMarker(draft.idempotencyKey);
    const title = draft.title.trim();

    if (title === "" || title.length > MAX_TITLE_LENGTH) {
      throw invalid(`a title must be non-blank and at most ${String(MAX_TITLE_LENGTH)} characters`);
    }

    const body = composeBody(draft.body, markerLine);
    const milestone =
      draft.milestone === null
        ? undefined
        : issueNumberOf(draft.milestone.externalRef, "milestone");
    const existing = await this.findByMarker(markerLine);

    if (existing !== undefined) {
      return refOf(existing);
    }

    const created = await this.client.request<unknown>(CREATE_ISSUE_ROUTE, {
      ...this.address(),
      title,
      body,
      ...(draft.labels.length === 0 ? {} : { labels: [...draft.labels] }),
      ...(milestone === undefined ? {} : { milestone }),
    });

    return refOf(parse(writtenIssue, created.data, CREATE_ISSUE_ROUTE));
  }

  /**
   * Record that one issue blocks another — natively, or through the documented fallback.
   *
   * @param blocker - The issue that must be done first.
   * @param blocked - The issue that waits for it.
   * @returns The mode that ran.
   */
  async linkDependency(
    blocker: TicketWriteRef,
    blocked: TicketWriteRef,
  ): Promise<DependencyLinkResult> {
    const blockerNumber = issueNumberOf(blocker.externalId, "blocker.externalId");
    const blockedNumber = issueNumberOf(blocked.externalId, "blocked.externalId");

    if (blockerNumber === blockedNumber) {
      throw invalid("an issue cannot block itself");
    }

    // Both read first, so a missing issue is `not_found` before the probe could read a 404 as a
    // missing API.
    const blockerIssue = await this.issue(blockerNumber);
    const blockedIssue = await this.issue(blockedNumber);
    const existing = await this.relatedIds(BLOCKED_BY_ROUTE, blockedNumber);

    if (existing === undefined) {
      if (!hasDependencyMarker(blockedIssue.body ?? null, blocker.externalId)) {
        await this.client.request<unknown>(UPDATE_ISSUE_ROUTE, {
          ...this.address(),
          issue_number: blockedNumber,
          body: withDependencyMarker(blockedIssue.body ?? null, blocker.externalId),
        });
      }

      return { mode: "fallback" };
    }

    if (!existing.includes(blockerIssue.id)) {
      await this.client.request<unknown>(ADD_BLOCKED_BY_ROUTE, {
        ...this.address(),
        issue_number: blockedNumber,
        issue_id: blockerIssue.id,
      });
    }

    return { mode: "native" };
  }

  /**
   * Find the milestone with this title, or create it.
   *
   * @param name - Its title.
   * @returns The milestone, its number as the reference.
   */
  async ensureMilestone(name: string): Promise<MilestoneRef> {
    const title = name.trim();

    if (title === "") {
      throw invalid("a milestone needs a name");
    }

    for await (const page of this.client.pages<unknown>(MILESTONES_ROUTE, {
      ...this.address(),
      state: "all",
    })) {
      for (const raw of page.items) {
        const milestone = parse(writtenMilestone, raw, MILESTONES_ROUTE);

        if (milestone.title === title) {
          return { externalRef: String(milestone.number), name: milestone.title };
        }
      }
    }

    const created = await this.client.request<unknown>(CREATE_MILESTONE_ROUTE, {
      ...this.address(),
      title,
    });
    const milestone = parse(writtenMilestone, created.data, CREATE_MILESTONE_ROUTE);

    return { externalRef: String(milestone.number), name: milestone.title };
  }

  /**
   * The repository's open milestones.
   *
   * @returns Each open milestone, its number as the reference, in GitHub's order.
   */
  async listMilestones(): Promise<MilestoneRef[]> {
    const found: MilestoneRef[] = [];

    for await (const page of this.client.pages<unknown>(MILESTONES_ROUTE, {
      ...this.address(),
      state: "open",
    })) {
      for (const raw of page.items) {
        const milestone = parse(writtenMilestone, raw, MILESTONES_ROUTE);

        found.push({ externalRef: String(milestone.number), name: milestone.title });
      }
    }

    return found;
  }

  /**
   * Find an epic's parent tracking issue, or create it.
   *
   * @param epic - The planning epic. Its id is the key; its title is only used on creation.
   * @returns The mirror reference — the parent issue's number.
   */
  async ensureEpicContainer(epic: EpicContainerInput): Promise<EpicMirrorRef> {
    const markerLine = epicMarker(epic.epicId);
    const title = epic.title.trim();

    if (title === "" || title.length > MAX_TITLE_LENGTH) {
      throw invalid(
        `an epic's title must be non-blank and at most ${String(MAX_TITLE_LENGTH)} characters`,
      );
    }

    const existing = await this.findByMarker(markerLine);
    const issue =
      existing ??
      parse(
        writtenIssue,
        (
          await this.client.request<unknown>(CREATE_ISSUE_ROUTE, {
            ...this.address(),
            title,
            body: composeBody(epic.description, markerLine),
          })
        ).data,
        CREATE_ISSUE_ROUTE,
      );

    return { mapping: "parent_issue", externalRef: String(issue.number) };
  }

  /**
   * Make an issue a sub-issue of an epic's parent.
   *
   * @param ticket - The issue.
   * @param mirror - The parent, as `ensureEpicContainer` answered it.
   */
  async attachToEpic(ticket: TicketWriteRef, mirror: EpicMirrorRef): Promise<void> {
    if (mirror.mapping !== GITHUB_WRITE_CAPABILITIES.epicMapping) {
      throw invalid(`a ${mirror.mapping} mirror, and GitHub maps epics to parent issues`);
    }

    const parent = issueNumberOf(mirror.externalRef, "mirror.externalRef");
    const child = issueNumberOf(ticket.externalId, "ticket.externalId");

    if (parent === child) {
      throw invalid("an issue cannot be its own sub-issue");
    }

    const childIssue = await this.issue(child);
    const members = await this.relatedIds(SUB_ISSUES_ROUTE, parent);

    if (members === undefined) {
      throw new GithubApiError(
        GITHUB_FAILURES.notFound,
        `${SUB_ISSUES_ROUTE} answered 404`,
        undefined,
        404,
      );
    }

    if (!members.includes(childIssue.id)) {
      await this.client.request<unknown>(ADD_SUB_ISSUE_ROUTE, {
        ...this.address(),
        issue_number: parent,
        sub_issue_id: childIssue.id,
      });
    }
  }

  /**
   * The issue carrying a marker, if one exists — see this file's header for the two questions.
   *
   * @param markerLine - The marker.
   * @returns The issue, or undefined.
   */
  private async findByMarker(markerLine: string): Promise<WrittenIssue | undefined> {
    const recent = await this.client.request<unknown>(ISSUES_ROUTE, {
      ...this.address(),
      state: "all",
      sort: "created",
      direction: "desc",
      per_page: RECENT_PROBE_SIZE,
    });
    const fresh = this.carrying(asArray(recent.data, ISSUES_ROUTE), markerLine);

    if (fresh !== undefined) {
      return fresh;
    }

    const searched = await this.client.request<unknown>(SEARCH_ISSUES_ROUTE, {
      q: searchQuery(this.target, markerLine),
      per_page: SEARCH_PROBE_SIZE,
    });
    const { items } = parse(
      z.object({ items: z.array(z.unknown()) }),
      searched.data,
      SEARCH_ISSUES_ROUTE,
    );

    return this.carrying(items, markerLine);
  }

  /**
   * The first issue in a listing that carries a marker.
   *
   * @param listing - Issue payloads.
   * @param markerLine - The marker.
   * @returns The issue, or undefined. Pull requests and issues of another repository never match.
   */
  private carrying(listing: readonly unknown[], markerLine: string): WrittenIssue | undefined {
    const { owner, repo } = this.target;
    const repositoryUrl = `/repos/${owner}/${repo}`;

    for (const raw of listing) {
      const issue = writtenIssue.safeParse(raw);

      if (
        issue.success &&
        issue.data.pull_request === undefined &&
        (issue.data.repository_url === undefined ||
          issue.data.repository_url.toLowerCase().endsWith(repositoryUrl.toLowerCase())) &&
        hasMarkerLine(issue.data.body, markerLine)
      ) {
        return issue.data;
      }
    }

    return undefined;
  }

  /**
   * Read one issue.
   *
   * @param issueNumber - Its number.
   * @returns The issue.
   */
  private async issue(issueNumber: number): Promise<WrittenIssue> {
    const answered = await this.client.request<unknown>(ISSUE_ROUTE, {
      ...this.address(),
      issue_number: issueNumber,
    });

    return parse(writtenIssue, answered.data, ISSUE_ROUTE);
  }

  /**
   * The database ids of the issues a relation route lists for one issue.
   *
   * @param route - {@link BLOCKED_BY_ROUTE} or {@link SUB_ISSUES_ROUTE}.
   * @param issueNumber - The issue whose relations to list.
   * @returns The ids, or undefined when the route answered `404` — which, for an issue already
   *   read, means this GitHub has no such API.
   */
  private async relatedIds(route: string, issueNumber: number): Promise<number[] | undefined> {
    const ids: number[] = [];

    try {
      for await (const page of this.client.pages<unknown>(route, {
        ...this.address(),
        issue_number: issueNumber,
      })) {
        ids.push(...page.items.map((raw) => parse(relatedIssue, raw, route).id));
      }
    } catch (error) {
      if (error instanceof GithubApiError && error.failure === GITHUB_FAILURES.notFound) {
        return undefined;
      }

      throw error;
    }

    return ids;
  }

  /**
   * The owner and repository, as route parameters.
   *
   * @returns `{ owner, repo }`.
   */
  private address(): { owner: string; repo: string } {
    return { owner: this.target.owner, repo: this.target.repo };
  }
}

/**
 * A response body, read through a schema.
 *
 * @param schema - What the route promises.
 * @param data - What it answered.
 * @param route - The route, for the log line.
 * @returns The parsed value.
 * @throws {GithubApiError} `upstream_error`, when the answer is not what the route promises.
 */
function parse<T>(schema: z.ZodType<T>, data: unknown, route: string): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    throw new GithubApiError(
      GITHUB_FAILURES.upstreamError,
      `${route} answered a body that is not what the route promises`,
    );
  }

  return parsed.data;
}

/**
 * A response body that should be a list.
 *
 * @param data - What the route answered.
 * @param route - The route, for the log line.
 * @returns The list.
 * @throws {GithubApiError} `upstream_error`, when it is not one.
 */
function asArray(data: unknown, route: string): readonly unknown[] {
  return parse(z.array(z.unknown()), data, route);
}

/**
 * A refusal of an argument, before anything is sent.
 *
 * @param detail - What is wrong.
 * @returns The error to throw.
 */
function invalid(detail: string): TicketSourceError {
  return new TicketSourceError("validation", detail);
}
