/**
 * Where the engine-facing surface answers — written once, because five things agree about
 * it.
 *
 * The two controllers declare these routes, `src/application.ts` excludes them from the
 * global `/api` prefix, `openapi.internal.yaml` describes them, `route.table.fixture.ts`
 * recognises them, and `ouroboros-engine`'s client stub calls them. A path that moved in one
 * of those places and not the others is a worker that cannot reach the control plane, so
 * there is one definition and everything reads it — exactly as `health.paths.ts` does for
 * the probes and as the engine hands its own `HEALTH_PATH` to the middleware that exempts
 * it.
 *
 * **They sit at the origin root, outside `/api/v1`, and that is the load-bearing decision
 * here.** `/api` is the browser's boundary: it is CORS-configured, session-authenticated,
 * tenant-resolved and published in the document `ouroboros-ui` generates a client from.
 * These paths are none of those things. They answer to one caller inside the network,
 * authenticated by a shared secret, and putting them under the same prefix would mean the
 * generated browser client had methods for them — which is `docs/ARCHITECTURE.md` § 8's
 * first invariant written as a hole rather than as a boundary.
 *
 * They are unversioned for the reason the probes are: their only caller is deployed
 * alongside this service and upgraded with it, so the version that would appear in the path
 * is one nobody could ever be on a different side of. When that stops being true the
 * contract changes shape, not the URL — see `openapi.internal.yaml`'s own note on
 * compatibility.
 */

/** Path segment every internal route sits under. */
export const INTERNAL_PATH = "internal";

/** Controller path of the credential surface, below the origin root. */
export const CREDENTIALS_PATH = `${INTERNAL_PATH}/credentials`;

/** Controller path of the invocation surface, below the origin root. */
export const LLM_PATH = `${INTERNAL_PATH}/llm`;

/** Route segment of the scoped lease, relative to {@link CREDENTIALS_PATH}. */
export const LEASE_ROUTE = "lease";

/** Route segment of the proxied invocation, relative to {@link LLM_PATH}. */
export const INVOKE_ROUTE = "invoke";

/** The lease, as the engine calls it: `/internal/credentials/lease`. */
export const INTERNAL_LEASE_PATH = `/${CREDENTIALS_PATH}/${LEASE_ROUTE}`;

/** The proxy, as the engine will call it: `/internal/llm/invoke`. */
export const INTERNAL_INVOKE_PATH = `/${LLM_PATH}/${INVOKE_ROUTE}`;

/**
 * Both internal paths.
 *
 * The list `src/application.ts` adds to `setGlobalPrefix`'s exclusions, and the list the
 * specification suite allows outside the versioned base path — so the routes that escape
 * `/api/v1` stay enumerated in two files rather than being whatever a controller happened
 * to opt out of.
 */
export const INTERNAL_PATHS = [INTERNAL_LEASE_PATH, INTERNAL_INVOKE_PATH] as const;

/**
 * Is this path part of the engine-facing surface?
 *
 * Matched on the prefix rather than against {@link INTERNAL_PATHS}, because two callers ask
 * it of things that are not exactly a path: the route-table fixture asks it of a
 * controller's base segment, and the specification suite asks it of an operation key —
 * `"POST /internal/llm/invoke"`. A prefix test answers all three the same way.
 *
 * @param candidate - A path, a controller base segment, or a `"METHOD path"` operation key.
 * @returns `true` when it names something under `/internal`.
 */
export function isInternalPath(candidate: string): boolean {
  return candidate.startsWith(INTERNAL_PATH) || candidate.includes(`/${INTERNAL_PATH}/`);
}
