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

/**
 * Controller path of the run ingestion surface, below the origin root.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)), decision **R2**: one
 * contract every executor reports through — the simulated driver (AP.5) today and real
 * execution (AR.1) tomorrow. Six routes rather than two, and the reason they are here rather
 * than under `/api/v1/runs` is the reason the lease is: their caller is a worker inside the
 * network holding a shared secret, not a browser holding a session, and a generated browser
 * client with methods for *opening a run* would be `docs/ARCHITECTURE.md` § 8's first
 * invariant written as a hole.
 */
export const RUNS_PATH = `${INTERNAL_PATH}/runs`;

/** Route segment of a run's stage transitions, relative to {@link RUNS_PATH}. */
export const STAGE_TRANSITIONS_ROUTE = ":id/stage-transitions";

/** Route segment of a run's transcript appends, relative to {@link RUNS_PATH}. */
export const EVENTS_ROUTE = ":id/events";

/** Route segment of a run's change-set report, relative to {@link RUNS_PATH}. */
export const FILES_ROUTE = ":id/files";

/** Route segment of a run's commit reports, relative to {@link RUNS_PATH}. */
export const COMMITS_ROUTE = ":id/commits";

/** Route segment of a run's resource reports, relative to {@link RUNS_PATH}. */
export const RESOURCES_ROUTE = ":id/resources";

/** The lease, as the engine calls it: `/internal/credentials/lease`. */
export const INTERNAL_LEASE_PATH = `/${CREDENTIALS_PATH}/${LEASE_ROUTE}`;

/** The proxy, as the engine will call it: `/internal/llm/invoke`. */
export const INTERNAL_INVOKE_PATH = `/${LLM_PATH}/${INVOKE_ROUTE}`;

/** Opening a run, as an executor calls it: `/internal/runs`. */
export const INTERNAL_RUNS_PATH = `/${RUNS_PATH}`;

/** One run's stage transitions: `/internal/runs/:id/stage-transitions`. */
export const INTERNAL_RUN_STAGE_TRANSITIONS_PATH = `/${RUNS_PATH}/${STAGE_TRANSITIONS_ROUTE}`;

/** One run's transcript: `/internal/runs/:id/events`. */
export const INTERNAL_RUN_EVENTS_PATH = `/${RUNS_PATH}/${EVENTS_ROUTE}`;

/** One run's change-set: `/internal/runs/:id/files`. */
export const INTERNAL_RUN_FILES_PATH = `/${RUNS_PATH}/${FILES_ROUTE}`;

/** One run's commits: `/internal/runs/:id/commits`. */
export const INTERNAL_RUN_COMMITS_PATH = `/${RUNS_PATH}/${COMMITS_ROUTE}`;

/** One run's resource reports: `/internal/runs/:id/resources`. */
export const INTERNAL_RUN_RESOURCES_PATH = `/${RUNS_PATH}/${RESOURCES_ROUTE}`;

/**
 * Every internal path.
 *
 * The list `src/application.ts` adds to `setGlobalPrefix`'s exclusions, and the list the
 * specification suite allows outside the versioned base path — so the routes that escape
 * `/api/v1` stay enumerated in two files rather than being whatever a controller happened
 * to opt out of.
 *
 * The parameterised ones are written with their `:id` still on, which is the form
 * `setGlobalPrefix` matches against: it is handed the same pattern the router holds, not the
 * URL a client writes. `openapi.internal.yaml` spells the same routes `{id}`, because that is
 * what a specification's reader expects and what `SwaggerModule` produces from the router —
 * the two notations are compared in `openapi.spec.ts` rather than assumed equal here.
 */
export const INTERNAL_PATHS = [
  INTERNAL_LEASE_PATH,
  INTERNAL_INVOKE_PATH,
  INTERNAL_RUNS_PATH,
  INTERNAL_RUN_STAGE_TRANSITIONS_PATH,
  INTERNAL_RUN_EVENTS_PATH,
  INTERNAL_RUN_FILES_PATH,
  INTERNAL_RUN_COMMITS_PATH,
  INTERNAL_RUN_RESOURCES_PATH,
] as const;

/**
 * One of these paths, spelled the way a specification spells it.
 *
 * The router holds `:id` and OpenAPI writes `{id}`, and both spellings are authoritative for
 * their own reader: `setGlobalPrefix`'s exclusion list is matched against the router's, and
 * `openapi.internal.yaml` is read by people and by generators that expect the other. Rather
 * than keep two lists — which is two places for a route to be forgotten — there is one list
 * and this converts it.
 *
 * `openapi.spec.ts` is what makes the conversion load-bearing: it compares the document's
 * paths to the routes Nest actually registered, in this notation, in both directions.
 *
 * @param path - A path from {@link INTERNAL_PATHS}, carrying `:name` parameters.
 * @returns The same path with each `:name` written `{name}`.
 */
export function openApiPath(path: string): string {
  return path.replaceAll(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

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
