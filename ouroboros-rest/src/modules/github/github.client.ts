/**
 * `GithubClient` — everything that is true of *every* call this product makes to GitHub,
 * decided once.
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)). `engine.client.ts` opens
 * with the same sentence about the engine, and the shape here is deliberately its sibling:
 * one place holds the auth, the deadline, the failure mapping and the budget, so that K.4's
 * sync ([#102](https://github.com/NobuData/ouroboros/issues/102)) is a loop over issues
 * rather than a loop over HTTP concerns.
 *
 * ```
 * forOrganization(ws) ─▶ token, decrypted for this call only
 *      │
 *      ├─ guard   remaining < floor ──▶ rate_limited, before the request is sent
 *      ├─ request auth injected, ETag optional
 *      ├─ observe x-ratelimit-* off every response, success or failure
 *      └─ classify 401 → unauthorized · 404 → not_found · 403/429 → rate_limited · … → upstream_error
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Octokit is not imported here, and that is the point.**
 *
 * This file is written against {@link OctokitLike} — the four things the product actually
 * uses. `github.octokit.ts` is the only file in the service that names `@octokit/rest`, and
 * `.dependency-cruiser.cjs` makes that a lint error rather than a convention. Two things
 * follow, and both were asked for:
 *
 *   * The **amendment on #101** (2026-08-09, mockup 04) requires that Octokit not be
 *     imported outside the provider module and that the boundary be enforced in CI. When
 *     Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140)) turns this into the
 *     first `TicketSourceProvider`, the seam it needs already exists and the rule it needs
 *     is already failing builds.
 *   * The whole of this file is unit-testable against a fake, with no network and no ES
 *     module transform, while `github.octokit.spec.ts` drives the **real** client over a
 *     stub `fetch` — so link-header pagination and auth injection are asserted against the
 *     library rather than against a stand-in that agrees with this file by construction.
 *
 * ---------------------------------------------------------------------------
 * **Every response is observed, including the failures.** A `404` spends a request exactly
 * as a `200` does, and its headers carry the budget. A guard that only learned from
 * successes would be most wrong at precisely the moment things were going worst.
 *
 * **Nothing here logs, and nothing here holds the token.** The token is handed to
 * `createOctokit` at construction and is never read back; the failures this file throws name
 * a route, a status and a workspace. `github.secrecy.spec.ts` is what proves that over the
 * real code paths rather than by inspection.
 */

import { GITHUB_FAILURES, GithubApiError } from "./github.errors";
import { GithubRateLimiter, type HeaderReader } from "./github.rate-limit";

/** HTTP statuses this file branches on, named so the mapping reads as prose. */
const STATUS = {
  notModified: 304,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  tooManyRequests: 429,
  serverErrorFloor: 500,
} as const;

/**
 * One response, as this module needs to read it.
 *
 * Headers as a plain record because that is what Octokit produces; {@link headerReader}
 * turns one into the accessor the rate guard takes.
 */
export interface OctokitResponseLike<T> {
  /** The HTTP status. */
  readonly status: number;
  /** The response headers, lower-cased by the library. */
  readonly headers: Readonly<Record<string, string | number | undefined>>;
  /** The body. */
  readonly data: T;
}

/**
 * The part of Octokit this product uses.
 *
 * Four members, and no more: a request, a page iterator, and nothing else. Keeping the
 * surface this small is what makes the boundary rule above meaningful — a seam that exposed
 * the whole library would be a re-export rather than a boundary.
 */
export interface OctokitLike {
  /**
   * Make one request.
   *
   * @param route - `"GET /repos/{owner}/{repo}/issues"` — Octokit's route syntax.
   * @param params - Path, query and header parameters.
   */
  request(
    route: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<OctokitResponseLike<unknown>>;

  /** Octokit's pagination, which follows the `Link` header. */
  readonly paginate: {
    /**
     * Walk a paginated route one response at a time.
     *
     * An `AsyncIterable` rather than an `AsyncIterableIterator`, which is what the library
     * actually returns: its object carries `[Symbol.asyncIterator]` and no `next` of its own.
     * Declaring the wider type here would compile and then fail at run time on the first
     * page — which is exactly what it did until `github.octokit.spec.ts` drove the real
     * library through this interface.
     *
     * @param route - The route.
     * @param params - Path and query parameters, including `per_page`.
     */
    iterator(
      route: string,
      params?: Readonly<Record<string, unknown>>,
    ): AsyncIterable<OctokitResponseLike<unknown>>;
  };
}

/** One page of a walk, or the news that there was nothing to walk. */
export interface GithubPage<T> {
  /** The page's rows. Empty when {@link notModified}. */
  readonly items: readonly T[];
  /**
   * `true` when GitHub answered `304` to a conditional first request — *"nothing has changed
   * since the ETag you sent"*.
   *
   * Yielded as a page of its own rather than as an empty walk, because an empty walk is
   * ambiguous: a repository whose backlog is genuinely empty produces one too, and a poller
   * that could not tell them apart would clear its mirror the first time nothing changed.
   */
  readonly notModified: boolean;
  /** The first page's `ETag`, to send on the next poll. Absent when GitHub sent none. */
  readonly etag: string | undefined;
}

/** One response, as a caller of {@link GithubClient.request} reads it. */
export interface GithubResult<T> {
  /** The HTTP status. `304` when the conditional request matched. */
  readonly status: number;
  /** `true` when GitHub answered `304`. */
  readonly notModified: boolean;
  /** The body — `undefined` exactly when {@link notModified}. */
  readonly data: T | undefined;
  /** The response's `ETag`, to send next time. */
  readonly etag: string | undefined;
}

/** What a conditional request sends. Octokit passes unknown keys through as headers. */
export const IF_NONE_MATCH = "if-none-match";

/** The header a conditional request is answered with. */
export const ETAG_HEADER = "etag";

/**
 * How many rows a page asks for.
 *
 * GitHub's maximum, and the right choice for a mirror: the budget is counted in *requests*,
 * not rows, so a hundred-per-page walk of a thousand issues costs ten requests where the
 * default thirty would cost thirty-four.
 */
export const PER_PAGE = 100;

/**
 * Turn Octokit's header record into the accessor the rate guard reads.
 *
 * @param headers - The response's headers.
 * @returns A reader that answers `undefined` for anything absent, and stringifies the
 *   numbers the library sometimes parses for us.
 */
export function headerReader(
  headers: Readonly<Record<string, string | number | undefined>>,
): HeaderReader {
  return (name) => {
    const value = headers[name.toLowerCase()];

    return value === undefined ? undefined : String(value);
  };
}

/**
 * An error with an HTTP status on it — what Octokit throws for a non-2xx answer.
 *
 * Recognised structurally rather than by importing `@octokit/request-error`: that package is
 * a transitive dependency this workspace does not declare, and a `status` number is the only
 * part of it this file reads. It is also what keeps `github.client.ts` free of the library
 * altogether — see this file's header.
 */
interface HttpErrorLike {
  readonly status: number;
  readonly response?: { readonly headers?: Readonly<Record<string, string | number | undefined>> };
}

/**
 * Does this look like an HTTP failure from the client library?
 *
 * @param error - Whatever was thrown.
 * @returns `true` when it carries a numeric `status`.
 */
function isHttpError(error: unknown): error is HttpErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    // `in` has already narrowed `error` to something carrying `status`, so no assertion is
    // needed to read it — which is the narrowing TypeScript added for exactly this shape.
    typeof error.status === "number"
  );
}

export class GithubClient {
  /**
   * @param organizationId - The workspace this client acts for. Every rate-limit
   *   observation and every failure is attributed to it, and it is never the *caller's*
   *   workspace by accident: the factory resolves it from the token it decrypted.
   * @param octokit - The configured client, with the token already injected.
   * @param limiter - The shared rate guard. Shared rather than per-client, because the
   *   budget belongs to the token and a second client for the same workspace is spending the
   *   same one.
   */
  constructor(
    readonly organizationId: string,
    private readonly octokit: OctokitLike,
    private readonly limiter: GithubRateLimiter,
  ) {}

  /**
   * One request, with the budget respected on the way in and learned from on the way out.
   *
   * @param route - Octokit's route syntax, e.g. `"GET /repos/{owner}/{repo}"`.
   * @param params - Path and query parameters.
   * @param etag - A previous response's `ETag`, to make this a conditional request. A `304`
   *   comes back as {@link GithubResult.notModified} — and, on GitHub, **does not spend a
   *   request from the hourly budget**, which is the entire reason conditional requests are
   *   worth the bookkeeping.
   * @returns The status, the body where there is one, and the `ETag` to send next time.
   * @throws {GithubApiError} For every way the call can fail, classified.
   */
  async request<T>(
    route: string,
    params: Readonly<Record<string, unknown>> = {},
    etag?: string,
  ): Promise<GithubResult<T>> {
    const response = await this.call(route, this.withConditional(params, etag));

    if (response.status === STATUS.notModified) {
      return { status: response.status, notModified: true, data: undefined, etag };
    }

    return {
      status: response.status,
      notModified: false,
      // The route decides the shape; this file does not know it and does not pretend to.
      // The cast is the one place that is true, and it is why `T` is the caller's to name.
      data: response.data as T,
      etag: this.etagOf(response),
    };
  }

  /**
   * Walk a paginated route, one page at a time.
   *
   * **Nothing accumulates.** The generator yields a page and forgets it, so a repository
   * with ten thousand issues costs one page of memory rather than ten thousand rows — the
   * acceptance criterion, and the reason this is a generator rather than a method returning
   * an array. A caller that wants everything in memory can still say so; a caller that wants
   * to upsert a page and move on, which is what the sync does, never has to.
   *
   * @param route - The paginated route.
   * @param params - Path and query parameters. `per_page` defaults to {@link PER_PAGE}; a
   *   `since` value is an ordinary parameter and is what makes an incremental poll
   *   incremental (decision **K2**).
   * @param etag - A previous walk's ETag. When GitHub answers `304` to the first page, the
   *   walk yields one {@link GithubPage} with `notModified` set and stops — the cheapest
   *   possible answer to *"has anything changed"*.
   * @returns The pages, in order.
   * @throws {GithubApiError} For every way the walk can fail, classified.
   */
  async *pages<T>(
    route: string,
    params: Readonly<Record<string, unknown>> = {},
    etag?: string,
  ): AsyncGenerator<GithubPage<T>> {
    // The guard runs before the first page for the reason it runs before any request; the
    // loop below re-checks before each subsequent one, because a long walk can cross the
    // floor partway through and the pages after that point are the ones worth not sending.
    this.limiter.assertMayCall(this.organizationId);

    const iterator = this.octokit.paginate
      .iterator(route, {
        per_page: PER_PAGE,
        ...this.withConditional(params, etag),
      })
      [Symbol.asyncIterator]();

    let first = true;

    for (;;) {
      if (!first) {
        this.limiter.assertMayCall(this.organizationId);
      }

      const step = await this.step(iterator, route);

      if (step === undefined) {
        return;
      }

      this.limiter.observe(this.organizationId, headerReader(step.headers));

      if (step.status === STATUS.notModified) {
        yield { items: [], notModified: true, etag };
        return;
      }

      yield {
        // Octokit's paginate normalises every paginated shape to an array here — the plain
        // list routes and the `{total_count, items}` search routes alike. See this file's
        // header on why the shape is the caller's to name.
        items: step.data as readonly T[],
        notModified: false,
        etag: first ? this.etagOf(step) : undefined,
      };

      first = false;
    }
  }

  /**
   * What is known about this workspace's remaining budget.
   *
   * @returns The last snapshot, or `undefined` if nothing has been observed yet.
   */
  rateLimit(): ReturnType<GithubRateLimiter["snapshot"]> {
    return this.limiter.snapshot(this.organizationId);
  }

  /**
   * Pull one page off the iterator, classifying whatever it throws.
   *
   * A method rather than a `try` inside the loop, so that the loop reads as the walk it is.
   *
   * @param iterator - The page iterator.
   * @param route - The route, for the failure's log line.
   * @returns The next response, or `undefined` when the walk is done.
   */
  private async step(
    iterator: AsyncIterator<OctokitResponseLike<unknown>>,
    route: string,
  ): Promise<OctokitResponseLike<unknown> | undefined> {
    try {
      const next = await iterator.next();

      return next.done === true ? undefined : next.value;
    } catch (error: unknown) {
      return this.conditionalMiss(error) ?? this.raise(error, route);
    }
  }

  /**
   * Make one call: guard, send, observe, classify.
   *
   * @param route - The route.
   * @param params - The parameters, conditional header included.
   * @returns The response.
   */
  private async call(
    route: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<OctokitResponseLike<unknown>> {
    this.limiter.assertMayCall(this.organizationId);

    try {
      const response = await this.octokit.request(route, params);

      this.limiter.observe(this.organizationId, headerReader(response.headers));

      return response;
    } catch (error: unknown) {
      const unchanged = this.conditionalMiss(error);

      if (unchanged !== undefined) {
        this.limiter.observe(this.organizationId, headerReader(unchanged.headers));

        return unchanged;
      }

      throw this.classify(error, route);
    }
  }

  /**
   * Recognise the answer a conditional request hopes for.
   *
   * **`304` arrives as a thrown error, not as a response**, and that is the library's doing
   * rather than an oddity worth working around: `@octokit/request` treats every non-2xx as a
   * failure, so *"nothing has changed"* — the outcome a poller wants most — reaches this
   * file down the same path as a `500`. Translating it back into a response here is what
   * keeps that from being a surprise anywhere else, and it is the reason this method exists
   * at all rather than a `case` in {@link classify}: a caller asked a question and got an
   * answer, so it must not come back as an exception.
   *
   * A `304` also costs **nothing from the hourly budget** on GitHub, which is what makes the
   * ETag bookkeeping worth doing at all.
   *
   * @param error - Whatever was thrown.
   * @returns A response standing in for the `304`, or `undefined` when this was a real
   *   failure.
   */
  private conditionalMiss(error: unknown): OctokitResponseLike<unknown> | undefined {
    if (!isHttpError(error) || error.status !== STATUS.notModified) {
      return undefined;
    }

    return {
      status: STATUS.notModified,
      headers: error.response?.headers ?? {},
      // There is no body on a `304` by definition, and `undefined` is what every caller
      // above turns into `notModified` rather than into data.
      data: undefined,
    };
  }

  /**
   * Throw the classified failure, as an expression.
   *
   * `step` has to either return a response or throw, and TypeScript will not let a `throw`
   * be the right-hand side of a `??`. A `never`-returning method is the readable way to say
   * *"or fail"* in that position.
   *
   * @param error - Whatever was thrown.
   * @param route - The route, for the log line.
   * @returns Never.
   * @throws {GithubApiError} Always.
   */
  private raise(error: unknown, route: string): never {
    throw this.classify(error, route);
  }

  /**
   * Add the conditional header when there is an ETag to send.
   *
   * @param params - The caller's parameters.
   * @param etag - The ETag, or `undefined`.
   * @returns The parameters Octokit is given. Unchanged when there is no ETag, so an
   *   unconditional request carries no empty header — GitHub treats `If-None-Match: ""` as a
   *   condition that can never match, which would silently disable caching rather than skip
   *   it.
   */
  private withConditional(
    params: Readonly<Record<string, unknown>>,
    etag: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return etag === undefined ? params : { ...params, headers: { [IF_NONE_MATCH]: etag } };
  }

  /**
   * The `ETag` off a response.
   *
   * @param response - The response.
   * @returns The header, or `undefined` when GitHub sent none.
   */
  private etagOf(response: OctokitResponseLike<unknown>): string | undefined {
    const value = response.headers[ETAG_HEADER];

    return value === undefined ? undefined : String(value);
  }

  /**
   * Turn whatever the library threw into one of the five reasons.
   *
   * **The budget is read off the failure too**, before it is classified: a refusal carries
   * `x-ratelimit-*` like any other response, and a `403` carrying `retry-after` is a
   * secondary limit the guard has to record or it will let the very next call through.
   *
   * @param error - Whatever was thrown.
   * @param route - The route, for the log line.
   * @returns The failure to throw. A {@link GithubApiError} that arrives here — the rate
   *   guard's own refusal, thrown from inside the `try` — is passed through unchanged rather
   *   than re-wrapped as an upstream error.
   */
  private classify(error: unknown, route: string): GithubApiError {
    if (error instanceof GithubApiError) {
      return error;
    }

    if (!isHttpError(error)) {
      // A socket error, a DNS failure, an abort. Nothing was answered, so there are no
      // headers to learn from.
      return new GithubApiError(
        GITHUB_FAILURES.upstreamError,
        `${route} failed before an answer: ${describe(error)}`,
      );
    }

    const headers = headerReader(error.response?.headers ?? {});

    this.limiter.observe(this.organizationId, headers);

    switch (error.status) {
      case STATUS.unauthorized:
        return new GithubApiError(
          GITHUB_FAILURES.unauthorized,
          `${route} was refused: GitHub rejected this workspace's token`,
        );

      case STATUS.notFound:
        return new GithubApiError(GITHUB_FAILURES.notFound, `${route} answered 404`);

      case STATUS.forbidden:
      case STATUS.tooManyRequests:
        return this.rateOrForbidden(error, headers, route);

      default:
        return new GithubApiError(
          GITHUB_FAILURES.upstreamError,
          `${route} answered ${String(error.status)}`,
        );
    }
  }

  /**
   * Separate a rate limit from an ordinary refusal, both of which GitHub sends as `403`.
   *
   * GitHub uses `403` for *"you may not"* and for *"not so fast"*, and the two are told apart
   * by the headers: a spent primary limit has `x-ratelimit-remaining: 0`, and a secondary
   * limit has `retry-after`. Anything else with a `403` is a scope the token does not have,
   * which is a credential problem and is reported as one — an administrator who has to widen
   * a token's scopes should not be told to wait for a limit that will never lift.
   *
   * @param error - The refusal.
   * @param headers - Its headers.
   * @param route - The route, for the log line.
   * @returns The failure to throw.
   */
  private rateOrForbidden(
    error: HttpErrorLike,
    headers: HeaderReader,
    route: string,
  ): GithubApiError {
    const remaining = headers("x-ratelimit-remaining");
    const retryAfter = headers("retry-after");
    const exhausted = remaining === "0";

    if (error.status === STATUS.tooManyRequests || retryAfter !== undefined || exhausted) {
      // Recorded on the guard, not only reported: the next call must be refused locally,
      // otherwise this response has cost a request and taught nothing.
      const seconds = this.limiter.pause(this.organizationId, headers);

      return new GithubApiError(
        GITHUB_FAILURES.rateLimited,
        `${route} answered ${String(error.status)}; standing down for ${String(seconds)}s`,
        seconds,
      );
    }

    return new GithubApiError(
      GITHUB_FAILURES.unauthorized,
      `${route} answered 403 with budget remaining — the token is missing a scope`,
    );
  }
}

/**
 * A thrown value, as a log line.
 *
 * @param error - Whatever was thrown.
 * @returns Its message, or a stringified copy for something that is not an `Error`.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
