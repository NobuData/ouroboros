/**
 * **The only file in this service that imports Octokit.**
 *
 * K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)), and the amendment posted
 * on it on 2026-08-09: the GitHub SDK lives behind one seam, and the boundary is *"lint-
 * enforced in CI"* rather than a convention — `.dependency-cruiser.cjs`'s
 * `no-octokit-outside-the-seam` rule is that sentence, and `yarn lint` is where it fires.
 *
 * What crosses the seam is {@link OctokitLike}: a request, a page iterator, and nothing
 * else. `github.client.ts` is written against that interface and is therefore unit-testable
 * with a plain object, while this file's own spec drives the **real** library over a stub
 * `fetch` — which is what makes the claims that belong to the library (auth injection, the
 * `Link` header walk, the `304` on a matching ETag) assertions about the library rather than
 * about a stand-in written to agree.
 *
 * The seam is also what Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140))
 * inherits: when the GitHub provider becomes the first `TicketSourceProvider` behind the Q.2
 * SPI ([#139](https://github.com/NobuData/ouroboros/issues/139)), the module that may name
 * `@octokit/rest` moves, and the rule's `pathNot` moves with it. Nothing else has to change,
 * because nothing else ever knew.
 *
 * ---------------------------------------------------------------------------
 * **Every call is bounded, and the deadline is here rather than per-call.**
 *
 * `engine.client.ts` bounds its calls at five seconds and argues that a third-party hop
 * deserves longer. This is that hop. {@link GITHUB_TIMEOUT_MS} is what stops a sync tick
 * holding a connection open against an API that has stopped answering — a poller with no
 * deadline does not fail, it accumulates.
 *
 * There is **no retry here**, and that is deliberate: the failure this client meets most
 * often is a rate limit, and retrying one immediately is the exact behaviour
 * `github.rate-limit.ts` exists to prevent. What is worth retrying is a poll, on the sync's
 * own schedule, which is K.4's ([#102](https://github.com/NobuData/ouroboros/issues/102))
 * decision to make with the whole tick in view.
 */

import { Octokit } from "@octokit/rest";

import type { OctokitLike } from "./github.client";

/**
 * How long any single call to GitHub may take, in milliseconds.
 *
 * Ten seconds — twice `engine.client.ts`'s deadline, for the reason that file gives: this is
 * a hop to a third party over the public internet rather than one inside the cluster. It is
 * still a deadline: a poller that waits indefinitely for a page is a poller whose next tick
 * arrives while the last one is still open.
 */
export const GITHUB_TIMEOUT_MS = 10_000;

/** What this service calls itself to GitHub. */
export const USER_AGENT = "ouroboros-rest";

/** What {@link createOctokit} needs. */
export interface OctokitOptions {
  /**
   * The workspace's GitHub token, decrypted.
   *
   * Handed to the library and **never read back**: nothing in this module holds it in a
   * field, puts it in a log line or returns it. The one copy that exists after this call is
   * the one inside Octokit's auth strategy, which is what makes the client usable at all.
   */
  readonly token: string;
  /**
   * Where GitHub is. Defaults to the public API; a GitHub Enterprise Server installation is
   * the reason this is a parameter rather than a constant.
   */
  readonly baseUrl?: string;
  /**
   * The `fetch` to use. Defaults to the runtime's. Injected by
   * `github.octokit.spec.ts`, which is how the library's real behaviour is asserted without
   * a network.
   */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Build a client for one workspace's token.
 *
 * @param options - The token, and the two things a test or an Enterprise deployment
 *   overrides.
 * @returns The client, as the narrow interface the rest of the service sees. The return type
 *   is the widening, and it is the only one: `Octokit` satisfies {@link OctokitLike}
 *   structurally, so no assertion is needed — and that is worth knowing rather than casting
 *   past, because it means the interface really is a subset of the library's own shape rather
 *   than a wish about it.
 */
export function createOctokit(options: OctokitOptions): OctokitLike {
  const octokit = new Octokit({
    auth: options.token,
    baseUrl: options.baseUrl,
    userAgent: USER_AGENT,
    log: SILENT_LOG,
    request: { fetch: bounded(options.fetchImpl ?? fetch) },
  });

  return octokit;
}

/**
 * The library's own logger, turned off.
 *
 * `@octokit/plugin-request-log` writes a `console` line for every `4xx` and `5xx` — the
 * method, the URL and the status. None of that is secret, and it is still switched off, for
 * two reasons that are both about this module's claims rather than about noise. Every one of
 * those failures is already classified and reported by `github.client.ts` with more context
 * than the library has, so the line is a duplicate; and *"nothing in this module logs"* is a
 * sentence `github.secrecy.spec.ts` has to be able to prove, which it cannot do about a sink
 * inside a dependency that this file did not close.
 *
 * A no-op rather than a route into Nest's `Logger`: forwarding would put a second, unaudited
 * writer on the path a credential travels, which is the thing being avoided.
 */
const SILENT_LOG = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

/**
 * Wrap a `fetch` so every request it makes carries a deadline.
 *
 * Applied here rather than as a per-request `signal`, so that a call site cannot forget it —
 * which is the same argument `engine.client.ts` makes for putting the deadline in the
 * client instead of at each route.
 *
 * @param inner - The `fetch` to bound.
 * @returns A `fetch` that aborts after {@link GITHUB_TIMEOUT_MS}.
 */
function bounded(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(GITHUB_TIMEOUT_MS);

    // Combined rather than replaced: Octokit passes its own signal when a caller supplied
    // one, and overwriting it would make a cancelled request keep running. `AbortSignal.any`
    // fires on whichever comes first, which is exactly the intent.
    const signal =
      init?.signal === null || init?.signal === undefined
        ? deadline
        : AbortSignal.any([deadline, init.signal]);

    return inner(input, { ...init, signal });
  };
}
