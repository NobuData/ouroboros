/**
 * A recorded GitHub that **writes** — issues, milestones, `blocked_by` relations and sub-issues —
 * so the write conformance kit and the push service's suites drive the real provider with nothing
 * standing in but the network.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)). `github.recordings.fixture.ts`
 * answers the read routes a sync walks; this one holds the state a push changes and answers the
 * routes `github.write.ts` sends, in the shapes GitHub's REST API documents:
 *
 * ```
 * GET  /repos/{o}/{r}/issues?sort=created&direction=desc   newest first
 * GET  /search/issues?q=repo:{o}/{r} … "phrase"             body contains the phrase
 * POST /repos/{o}/{r}/issues · GET · PATCH …/issues/{n}
 * GET · POST /repos/{o}/{r}/milestones
 * GET · POST …/issues/{n}/dependencies/blocked_by            404 on a GitHub without the API
 * GET · POST …/issues/{n}/sub_issues
 * ```
 *
 * **Its ledger is read off its own state**, never through the provider, for the kit's reason: an
 * idempotency claim is a claim about what the tracker holds. Fallback markers are counted with the
 * SPI's own `dependencyMarkersIn`, exactly as a person reading the issue would count them.
 */

import type { OctokitLike, OctokitResponseLike } from "../../github/github.client";
import { budgetHeaders, httpError, response } from "../../github/github.fixture";
import type { WriteLedger } from "../conformance.write.fixture";
import { dependencyMarkersIn } from "../ticket-source.write";
import { SOURCE_LOGIN, SOURCE_REPO } from "./github.provider.fixture";
import {
  ADD_BLOCKED_BY_ROUTE,
  ADD_SUB_ISSUE_ROUTE,
  BLOCKED_BY_ROUTE,
  CREATE_ISSUE_ROUTE,
  CREATE_MILESTONE_ROUTE,
  ISSUE_ROUTE,
  MILESTONES_ROUTE,
  SEARCH_ISSUES_ROUTE,
  SUB_ISSUES_ROUTE,
  UPDATE_ISSUE_ROUTE,
} from "./github.write";
import { ISSUES_ROUTE } from "./github.mapping";

/** An issue, as the recording holds it. */
export interface RecordedIssue {
  /** GitHub's database id — what the relation routes take. */
  readonly id: number;
  /** The number — what a person and the provider's refs use. */
  readonly number: number;
  /** The title. */
  readonly title: string;
  /** The body, as last written. */
  body: string | null;
  /** Label names. */
  readonly labels: readonly string[];
  /** The milestone's number, or null. */
  readonly milestone: number | null;
}

/** A milestone, as the recording holds it. */
export interface RecordedMilestone {
  /** The number — the provider's reference. */
  readonly number: number;
  /** The title. */
  readonly title: string;
}

/** How a recording is set up. */
export interface WriteRecordingOptions {
  /**
   * Whether this GitHub has the dependency API. `false` is an older GitHub Enterprise Server:
   * the `blocked_by` routes answer `404`, and the provider must fall back to body markers.
   */
  readonly nativeDependencies?: boolean;
  /** The repository the routes serve. Every other repository is `404`. */
  readonly repo?: string;
  /**
   * How many issues the newest-first listing answers. GitHub's is a page of up to 100; a smaller
   * number stands in for a busy repository, where the probe has to reach for search.
   */
  readonly recentPageSize?: number;
}

/** A recorded GitHub that writes. */
export interface WriteRecording {
  /** What the provider's factory hands out. */
  readonly octokit: OctokitLike;
  /** Every request, in order — a page of a listing is one request. */
  readonly calls: { route: string; params: Readonly<Record<string, unknown>> }[];
  /** The issues it holds, in creation order. */
  readonly issues: RecordedIssue[];
  /** The milestones it holds, in creation order. */
  readonly milestones: RecordedMilestone[];
  /** Native relations, as `[blockerNumber, blockedNumber]`. */
  readonly relations: [number, number][];
  /** Sub-issue links, as `[parentNumber, childNumber]`. */
  readonly subIssues: [number, number][];
  /** What the tracker holds, in the write kit's shape — identities as the provider's refs spell them. */
  ledger(): WriteLedger;
  /**
   * Refuse every later request.
   *
   * @param error - What to reject with — `httpError(403)` and its relatives.
   */
  refuse(error: Error): void;
  /**
   * Refuse only the requests to one route, from the `after`-th one on.
   *
   * @param route - The route to refuse.
   * @param error - What to reject with.
   * @param after - How many requests to that route still succeed first.
   */
  refuseRoute(route: string, error: Error, after?: number): void;
  /** Answer again. */
  recover(): void;
}

/** Healthy budget headers, so a case about writing is not a case about the rate guard. */
const HEALTHY = budgetHeaders({ remaining: 4999 });

/**
 * A recorded GitHub, empty until the provider writes to it.
 *
 * @param options - The dependency API's presence, the repository, the listing's page size.
 * @returns The recording.
 */
export function writeRecording(options: WriteRecordingOptions = {}): WriteRecording {
  const repo = options.repo ?? SOURCE_REPO;
  const native = options.nativeDependencies ?? true;
  const recentPageSize = options.recentPageSize ?? 100;
  const calls: { route: string; params: Readonly<Record<string, unknown>> }[] = [];
  const issues: RecordedIssue[] = [];
  const milestones: RecordedMilestone[] = [];
  const relations: [number, number][] = [];
  const subIssues: [number, number][] = [];
  const routeRefusals = new Map<string, { error: Error; after: number }>();
  let refusal: Error | null = null;

  const payload = (issue: RecordedIssue): Record<string, unknown> => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: "open",
    labels: issue.labels.map((name) => ({ name })),
    milestone: issue.milestone === null ? null : { number: issue.milestone },
    user: { login: "ouroboros-bot" },
    // Numbered minutes past a fixed instant, so a sync over the recording maps every issue and
    // walks them in the order they were created.
    created_at: new Date(Date.UTC(2026, 8, 16, 9, issue.number)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 8, 16, 9, issue.number)).toISOString(),
    html_url: `https://github.com/${SOURCE_LOGIN}/${repo}/issues/${String(issue.number)}`,
    repository_url: `https://api.github.com/repos/${SOURCE_LOGIN}/${repo}`,
  });

  const find = (issueNumber: unknown): RecordedIssue => {
    const issue = issues.find((candidate) => candidate.number === issueNumber);

    if (issue === undefined) {
      throw httpError(404, HEALTHY);
    }

    return issue;
  };

  const answer = (route: string, params: Readonly<Record<string, unknown>>): unknown => {
    calls.push({ route, params });

    const refusedRoute = routeRefusals.get(route);

    if (refusedRoute !== undefined) {
      if (refusedRoute.after <= 0) {
        throw refusedRoute.error;
      }

      refusedRoute.after -= 1;
    }

    if (refusal !== null) {
      throw refusal;
    }

    if (route !== SEARCH_ISSUES_ROUTE && (params.owner !== SOURCE_LOGIN || params.repo !== repo)) {
      throw httpError(404, HEALTHY);
    }

    switch (route) {
      case ISSUES_ROUTE:
        return [...issues].reverse().slice(0, recentPageSize).map(payload);

      case SEARCH_ISSUES_ROUTE: {
        const query = String(params.q);
        const phrase = /"([^"]*)"/.exec(query)?.[1] ?? "";
        const inRepo = query.includes(`repo:${SOURCE_LOGIN}/${repo} `);

        return {
          total_count: 0,
          items: inRepo
            ? issues.filter((issue) => (issue.body ?? "").includes(phrase)).map(payload)
            : [],
        };
      }

      case CREATE_ISSUE_ROUTE: {
        if (typeof params.title !== "string" || params.title.trim() === "") {
          throw httpError(422, HEALTHY);
        }

        const milestone = typeof params.milestone === "number" ? params.milestone : null;

        if (milestone !== null && !milestones.some((known) => known.number === milestone)) {
          throw httpError(422, HEALTHY);
        }

        const issue: RecordedIssue = {
          id: 9_000_000 + issues.length + 1,
          number: issues.length + 1,
          title: params.title,
          body: typeof params.body === "string" ? params.body : null,
          labels: Array.isArray(params.labels) ? params.labels.map(String) : [],
          milestone,
        };

        issues.push(issue);

        return payload(issue);
      }

      case ISSUE_ROUTE:
        return payload(find(params.issue_number));

      case UPDATE_ISSUE_ROUTE: {
        const issue = find(params.issue_number);

        issue.body = typeof params.body === "string" ? params.body : issue.body;

        return payload(issue);
      }

      case MILESTONES_ROUTE:
        return milestones.map((milestone) => ({ ...milestone, state: "open" }));

      case CREATE_MILESTONE_ROUTE: {
        const title = String(params.title);

        // GitHub refuses a second milestone with the same title, which is exactly the duplicate a
        // provider that never listed first would run into.
        if (milestones.some((milestone) => milestone.title === title)) {
          throw httpError(422, HEALTHY);
        }

        const milestone = { number: milestones.length + 1, title };

        milestones.push(milestone);

        return { ...milestone, state: "open" };
      }

      case BLOCKED_BY_ROUTE:
      case ADD_BLOCKED_BY_ROUTE: {
        if (!native) {
          throw httpError(404, HEALTHY);
        }

        const blocked = find(params.issue_number);

        if (route === BLOCKED_BY_ROUTE) {
          return relations
            .filter(([, to]) => to === blocked.number)
            .map(([from]) => payload(find(from)));
        }

        const blocker = issues.find((issue) => issue.id === params.issue_id);

        if (blocker === undefined || blocker.number === blocked.number) {
          throw httpError(422, HEALTHY);
        }

        if (relations.some(([from, to]) => from === blocker.number && to === blocked.number)) {
          throw httpError(422, HEALTHY);
        }

        relations.push([blocker.number, blocked.number]);

        return payload(blocked);
      }

      case SUB_ISSUES_ROUTE:
        return subIssues
          .filter(([parent]) => parent === find(params.issue_number).number)
          .map(([, child]) => payload(find(child)));

      case ADD_SUB_ISSUE_ROUTE: {
        const parent = find(params.issue_number);
        const child = issues.find((issue) => issue.id === params.sub_issue_id);

        if (child === undefined || subIssues.some(([, known]) => known === child.number)) {
          // GitHub allows one parent per issue, and refuses a second link to the same one.
          throw httpError(422, HEALTHY);
        }

        subIssues.push([parent.number, child.number]);

        return payload(parent);
      }

      default:
        throw httpError(404, HEALTHY);
    }
  };

  const respond = (
    route: string,
    params: Readonly<Record<string, unknown>> = {},
  ): OctokitResponseLike<unknown> => {
    const data = answer(route, params);

    return response(data, HEALTHY, route.startsWith("POST ") ? 201 : 200);
  };

  const octokit: OctokitLike = {
    request(route, params) {
      return Promise.resolve().then(() => respond(route, params));
    },
    paginate: {
      iterator(route, params) {
        // One page holding everything: the recording's lists are a handful long, and pagination is
        // K.3's client's subject, not this recording's.
        const walk = async function* (): AsyncGenerator<OctokitResponseLike<unknown>> {
          yield await Promise.resolve().then(() => respond(route, params));
        };

        return { [Symbol.asyncIterator]: walk };
      },
    },
  };

  return {
    octokit,
    calls,
    issues,
    milestones,
    relations,
    subIssues,
    ledger: () => ({
      tickets: issues
        .filter((issue) => (issue.body ?? "").includes("ouroboros:push-key "))
        .map((issue) => String(issue.number)),
      dependencies: [
        ...relations.map(([from, to]): [string, string] => [String(from), String(to)]),
        ...issues.flatMap((issue) =>
          dependencyMarkersIn(issue.body).map((from): [string, string] => [
            from,
            String(issue.number),
          ]),
        ),
      ],
      milestones: milestones.map((milestone) => String(milestone.number)),
      containers: issues
        .filter((issue) => (issue.body ?? "").includes("ouroboros:epic "))
        .map((issue) => String(issue.number)),
      memberships: subIssues.map(([parent, child]): [string, string] => [
        String(parent),
        String(child),
      ]),
    }),
    refuse(error) {
      refusal = error;
    },
    refuseRoute(route, error, after = 0) {
      routeRefusals.set(route, { error, after });
    },
    recover() {
      refusal = null;
      routeRefusals.clear();
    },
  };
}
