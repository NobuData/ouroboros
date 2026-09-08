/**
 * The stand-ins K.4's suites share ([#102](https://github.com/NobuData/ouroboros/issues/102)).
 *
 * Three kinds of thing, together because five suites want the same ones: a repository to poll
 * and the workspace it belongs to, GitHub's issue JSON in the shapes that matter — an issue, a
 * pull request, a bot's issue, one with nothing on it — and an {@link EstimationIntake} that
 * writes down what it was handed instead of doing anything with it.
 *
 * **The payloads are GitHub's shape, not this mirror's.** `labels` are objects with a `name`,
 * timestamps are ISO strings, the author is under `user`, and a pull request is an issue
 * carrying a `pull_request` key — because a fixture written in the shape the code *wants*
 * would test the code against itself. Anything a spec does not name takes a default here, so
 * a spec reads as the one field it is about.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { SyncTarget } from "./backlog-sync.repository";
import type { EstimableIssue, EstimationIntake } from "./estimation.intake";

/** The workspace every unit suite here polls for. */
export const FIXTURE_WORKSPACE = "org-backlog";

/** The repository row's id. */
export const FIXTURE_REPO_ID = "dfff0000-0000-0000-0000-00000000000a";

/** The GitHub organisation's login — the `owner` in the route. */
export const FIXTURE_OWNER = "acme-robotics";

/** The repository name within it. */
export const FIXTURE_REPO = "helios-firmware";

/** `owner/name`, as a log line writes it. */
export const FIXTURE_SLUG = `${FIXTURE_OWNER}/${FIXTURE_REPO}`;

/** The cycle's clock, so a freshness assertion can name the instant it expects. */
export const FIXTURE_NOW = new Date("2026-09-08T10:00:00.000Z");

/**
 * A repository to poll.
 *
 * @param overrides - What differs from a repository that has never been synced — a `cursor`
 *   and a `syncedAt` are what make a poll incremental rather than an initial import.
 * @returns The target.
 */
export function target(overrides: Partial<SyncTarget> = {}): SyncTarget {
  return {
    githubRepoId: FIXTURE_REPO_ID,
    organizationId: FIXTURE_WORKSPACE,
    owner: FIXTURE_OWNER,
    name: FIXTURE_REPO,
    syncedAt: null,
    cursor: null,
    ...overrides,
  };
}

/** What {@link issuePayload} accepts, in GitHub's own field names. */
export interface IssueOptions {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  labels?: unknown;
  login?: string | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  /** Anything at all here makes the payload a pull request. */
  pullRequest?: unknown;
}

/**
 * One row of GitHub's issues listing.
 *
 * @param options - What differs from mockup 03's `#485`.
 * @returns The payload, as a `JSON.parse` of GitHub's answer would produce it.
 */
export function issuePayload(options: IssueOptions = {}): Record<string, unknown> {
  const number = options.number ?? 485;

  return {
    number,
    title: options.title ?? "Watchdog reset on I²C bus lockup",
    body:
      options.body === undefined ? "Unit 07 in the Fremont pilot rebooted 14 times." : options.body,
    state: options.state ?? "open",
    labels: options.labels ?? [{ name: "bug" }, { name: "i2c" }, { name: "watchdog" }],
    user: options.login === null ? null : { login: options.login ?? "field-support" },
    created_at: options.createdAt ?? "2026-09-06T10:00:00Z",
    updated_at: options.updatedAt ?? "2026-09-08T07:00:00Z",
    html_url: options.url ?? `https://github.com/${FIXTURE_SLUG}/issues/${String(number)}`,
    ...(options.pullRequest === undefined ? {} : { pull_request: options.pullRequest }),
  };
}

/**
 * A pull request, as the issues endpoint returns one.
 *
 * @param options - What differs. The `pull_request` key is supplied here and is the only thing
 *   that distinguishes it — see `issue.mapping.ts`.
 * @returns The payload.
 */
export function pullRequestPayload(options: IssueOptions = {}): Record<string, unknown> {
  return issuePayload({
    number: 900,
    title: "Fix the watchdog timer",
    ...options,
    pullRequest: { url: `https://api.github.com/repos/${FIXTURE_SLUG}/pulls/900` },
  });
}

/** An {@link EstimationIntake} that records instead of estimating. */
export interface RecordingIntake extends EstimationIntake {
  /** Every batch it was handed, in order. A poll that handed nothing over adds no entry. */
  readonly batches: (readonly EstimableIssue[])[];
  /** Every issue across every batch, flattened — what most assertions actually want. */
  issues(): EstimableIssue[];
}

/**
 * An intake that writes down what it is given.
 *
 * @param fail - When given, what {@link EstimationIntake.accept} rejects with — for the case
 *   where the pipeline refuses and the poll must keep its rows anyway.
 * @returns The recorder.
 */
export function recordingIntake(fail?: Error): RecordingIntake {
  const batches: (readonly EstimableIssue[])[] = [];

  return {
    batches,
    issues: () => batches.flat(),
    accept(issues) {
      batches.push(issues);

      return fail === undefined ? Promise.resolve() : Promise.reject(fail);
    },
  };
}

/** Where GitHub's issues listing lives. The route Octokit resolves `GET /repos/…/issues` to. */
export const ISSUES_URL = `https://api.github.com/repos/${FIXTURE_SLUG}/issues`;

/** One request the stub answered, as an assertion reads it. */
export interface IssuesCall {
  /** The full URL, query string included — where `since`, `state` and `sort` are asserted. */
  readonly url: string;
  /** The query parameters, parsed. */
  readonly query: Readonly<Record<string, string>>;
}

/** The installed stub, and what a suite asserts through it. */
export interface IssuesStub {
  /** Every issues request the application made, in order. */
  readonly calls: readonly IssuesCall[];
  /** What the next walk answers with — one entry per page, replaced between polls. */
  answer(...pages: (readonly unknown[])[]): void;
  /** Make the next walk fail with a status, for the freshness-on-failure case. */
  fail(status: number): void;
  /** Put the process's own `fetch` back. Safe to call twice. */
  restore(): void;
}

/**
 * Answer GitHub's issues listing from a script, for the length of an integration suite.
 *
 * `src/testing/github.fixture.ts` does the same job for the three OAuth endpoints and gives
 * the reason: a suite that needed a real token could not run in CI, and one that needed the
 * internet could not run on an aeroplane. This is that, for the one route the sync walks —
 * and it answers with **GitHub's** JSON so that the mapping, the pagination and the
 * classification under test are the real ones.
 *
 * Anything that is not `api.github.com` goes to the process's own `fetch`: this stub replaces
 * a global, and refusing calls it knows nothing about would make it the reason an unrelated
 * part of the application failed. Anything on `api.github.com` that is *not* the issues route
 * throws, because that is a request the sync should not be making.
 *
 * @returns The stub.
 */
export function stubIssues(): IssuesStub {
  const calls: IssuesCall[] = [];
  const original = globalThis.fetch;
  let pages: (readonly unknown[])[] = [[]];
  let status: number | undefined;
  let restored = false;

  // Typed off `fetch` itself rather than with `RequestInfo`, for `github.fixture.ts`'s reason:
  // the DOM lib is not loaded here and Node's own `fetch` types do not export that name.
  globalThis.fetch = (...[input, init]: Parameters<typeof fetch>) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname !== "api.github.com") {
      return original(input, init);
    }

    if (!request.url.startsWith(ISSUES_URL)) {
      throw new Error(
        `The application under test called ${request.method} ${request.url}, which the backlog ` +
          "sync has no reason to ask for. Integration suites reach no network.",
      );
    }

    calls.push({
      url: request.url,
      query: Object.fromEntries(url.searchParams),
    });

    if (status !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: "stubbed failure" }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    const requested = Number(url.searchParams.get("page") ?? "1");
    const body = pages[requested - 1] ?? [];
    const headers: Record<string, string> = { "content-type": "application/json" };

    // The `Link` header is how the library walks: a page that does not advertise a next one
    // ends the walk, which is what makes the pagination under test GitHub's own mechanism
    // rather than a count this fixture agreed with the code about.
    if (requested < pages.length) {
      const next = new URL(request.url);

      next.searchParams.set("page", String(requested + 1));
      headers.link = `<${next.toString()}>; rel="next"`;
    }

    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers }));
  };

  return {
    calls,
    answer(...next) {
      pages = next.length === 0 ? [[]] : next;
      status = undefined;
    },
    fail(next) {
      status = next;
    },
    restore() {
      if (restored) {
        return;
      }

      restored = true;
      globalThis.fetch = original;
    },
  };
}
