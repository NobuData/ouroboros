import "server-only";

/**
 * The readiness probe — whether `ouroboros-rest`'s dependencies are answering.
 *
 * `GET /health/ready` reports two of them, `database` and `engine`, each independently,
 * and it is the only operation in the contract that tells a caller anything about the
 * database at all. The dashboard's system card (#45) is drawn from it.
 *
 * ### Why this does not go through the typed client
 *
 * Every other resource file in this directory is one line over `api()`, and this one is
 * not, for a reason particular to this route: **its failure is its answer.** The contract
 * has it reply `200` when every dependency answered and `503` when one did not, carrying
 * *the same body* either way — the `503` is the response that names which dependency is
 * down and why.
 *
 * `app/api/client.ts`'s middleware turns every non-`ok` response into a thrown
 * {@link ApiError}, and `ApiError.fromResponse` reads a body that is not the contract's
 * error envelope — which a `HealthReport` is not — as `client_unreadable_error`. So a
 * client call would convert the one response the card exists to render into a rejection
 * carrying none of its content. Tolerating a `503` is not something the middleware can be
 * asked for per call, and adding an exception to it for one route would put a hole in the
 * property every other call depends on: *either the body the contract describes, or a
 * throw*.
 *
 * Reading it with `fetch` costs nothing else, because this route needs nothing the client
 * adds. It answers **without authentication**, so there is no session cookie to forward
 * and no workspace header to set; there is no `401` to route to the login screen. What the
 * client does contribute — that a renamed path or a changed body shape is a failed
 * typecheck — is kept: {@link READINESS_PATH} is typed as a path the contract publishes and
 * {@link HealthReport} is the generated schema type, so `yarn api:sync` still breaks this
 * file rather than a browser.
 *
 * Server-side only. `OURO_REST_URL` carries no `NEXT_PUBLIC_` prefix and does not exist in
 * the browser bundle (`app/env.ts`), and the `server-only` import above is what makes a
 * Client Component importing this a build error rather than a confusing fetch to nowhere.
 */

import type { components, paths } from "@/app/api/schema";
import { restUrl } from "@/app/env";

/** The body of both probes: an overall status, and every dependency three ways. */
export type HealthReport = components["schemas"]["HealthReport"];

/** What one dependency reported when it was asked, and — when down — a reason. */
export type DependencyStatus = components["schemas"]["DependencyStatus"];

/**
 * The readiness probe's path.
 *
 * Typed as a path the contract describes, so a rename in `openapi.yaml` is a failed
 * typecheck here after `yarn api:sync` rather than a `404` behind a status pill. The same
 * technique `app/login/sign-in.ts` uses for the sign-in request, and for the same reason.
 */
export const READINESS_PATH: keyof paths = "/health/ready";

/**
 * How long to wait for the probe before giving up, in milliseconds.
 *
 * The service bounds each of its own dependency checks at two seconds and answers whether
 * or not they do, so a reply is due at roughly that mark. This is a little longer, which
 * makes a timeout here mean *the service itself is not answering* rather than *the service
 * is still waiting on Postgres* — the second of those is a `503` with a message, and the
 * card should render it rather than race it.
 */
export const READINESS_TIMEOUT_MS = 3_000;

/**
 * What this module needs of a `fetch`. Narrower than the global, so a test's stub does not
 * have to satisfy every overload of it.
 */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Read the readiness probe.
 *
 * **This does not throw.** Every failure it can meet — the service unreachable, a timeout,
 * a body that is not a report, a status the contract does not describe — means the same
 * thing to its one caller: *nothing can be said about the dependencies right now*. Which of
 * them it was is a distinction only an operator can act on, and it goes to the log rather
 * than into a return type the card would have to branch on four ways to draw two pills.
 *
 * A `503` is **not** one of those failures. It is the probe answering, and its body is
 * returned exactly as a `200`'s is.
 *
 * @param fetcher How to make the request. Defaults to the runtime's `fetch`; tests pass a
 *   stub, which is what lets this be covered without a network.
 * @param baseUrl Base URL of `ouroboros-rest`, without a trailing slash. Defaults to the
 *   configured one.
 * @returns The report, or `null` when the probe could not be read.
 */
export async function readReadiness(
  fetcher: Fetcher = (input, init) => fetch(input, init),
  baseUrl: string = restUrl(),
): Promise<HealthReport | null> {
  try {
    const response = await fetcher(`${baseUrl}${READINESS_PATH}`, {
      // A status pill is a claim about this moment. A cached one is a pill that says the
      // engine is up because it was up when some earlier request asked.
      cache: "no-store",
      signal: AbortSignal.timeout(READINESS_TIMEOUT_MS),
    });

    const body: unknown = await response.json();
    return isHealthReport(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Whether a parsed body is a readiness report.
 *
 * Structural rather than exhaustive, the same way `isErrorEnvelope` is: what a caller acts
 * on is `status` and the `details` map, and a body carrying both is a report for every
 * purpose this module has. Checking it at all is the boundary between "the contract's
 * type" and "whatever answered on that URL" — a proxy, a captive portal or a
 * misconfigured base URL can all reply `200` with something else entirely.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link HealthReport}.
 */
export function isHealthReport(value: unknown): value is HealthReport {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<HealthReport>;
  return (
    typeof candidate.status === "string" &&
    typeof candidate.details === "object" &&
    candidate.details !== null
  );
}

/**
 * What one dependency reported, out of a report that may not mention it.
 *
 * `details` holds every dependency whatever it reported, which is why it is read here
 * rather than `info` and `error` — those are the same rows partitioned, and a caller that
 * consulted one of them would have to consult the other to learn nothing new.
 *
 * @param report The report, or `null` when the probe could not be read.
 * @param name The dependency's key — `"database"` or `"engine"` on this route.
 * @returns What it reported, or `undefined` when the report is absent or does not name it.
 *   Those two are one answer on purpose: a dependency the service has stopped reporting on
 *   is as unknown as one nobody could ask about.
 */
export function dependency(
  report: HealthReport | null,
  name: string,
): DependencyStatus | undefined {
  return report?.details[name];
}
