/**
 * Server-side configuration for the product UI.
 *
 * There is exactly one variable, because there is exactly one service this module may
 * call: `OURO_REST_URL`, the base URL of `ouroboros-rest`. The UI reaches nothing else —
 * not the database, not the engine — and that boundary is what keeps tenancy enforcement
 * in one place (docs/ARCHITECTURE.md § 2).
 *
 * Conventions this follows (docs/CONVENTIONS.md § 4): everything Ouroboros-specific is
 * prefixed `OURO_`; `PORT` stays unprefixed and is read by Next.js itself, not here;
 * a malformed value fails loudly and names the variable rather than surfacing as a
 * confusing fetch error on the first request.
 *
 * Nothing calls `restUrl()` yet — the typed API client (#43) is its first consumer.
 * That is why the check is a function rather than a module-level constant: a constant
 * would throw while `next build` prerenders, failing the build on a machine that has no
 * reason to know the address of a service it is not calling.
 *
 * **This is server-side configuration.** `OURO_REST_URL` carries no `NEXT_PUBLIC_`
 * prefix, so Next.js never inlines it into the browser bundle — which is deliberate: an
 * address the browser can read is an address a tenant can point elsewhere. A Client
 * Component that imported this would therefore find nothing and get the "is not set"
 * error by name rather than a silent fetch to the wrong host. When #43 adds real
 * server-only code here, `server-only` is the import that turns that runtime error into
 * a build error.
 */

/** The environment variable holding the base URL of `ouroboros-rest`. */
export const REST_URL_VAR = "OURO_REST_URL";

/**
 * What this module needs of an environment: names to optional values.
 *
 * `process.env` satisfies it. Deliberately not `NodeJS.ProcessEnv`, which Next.js
 * augments with required keys of its own — a caller supplying an environment should not
 * have to supply `NODE_ENV` to be read for a variable that is not it.
 */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Read and validate the base URL of `ouroboros-rest`.
 *
 * @param env Environment to read from. Defaults to `process.env`; tests pass their own.
 * @returns The base URL, with any trailing slash removed so callers can join paths by
 *   concatenation without producing a double slash.
 * @throws {Error} If the variable is missing, blank, unparseable as a URL, or carries a
 *   scheme other than `http:`/`https:`. The message names the variable and what it got.
 */
export function readRestUrl(env: Environment = process.env): string {
  const raw = env[REST_URL_VAR]?.trim();

  if (!raw) {
    throw new Error(
      `${REST_URL_VAR} is not set. It is the base URL of ouroboros-rest, ` +
        `e.g. http://localhost:4000 — see .env.example.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${REST_URL_VAR} is not a valid URL: ${raw}. Expected an absolute URL, ` +
        `e.g. http://localhost:4000.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${REST_URL_VAR} must be an http or https URL, got ${parsed.protocol}//… ` +
        `in ${raw}.`,
    );
  }

  return raw.replace(/\/+$/, "");
}

/** Memoised result of the first successful {@link readRestUrl} call. */
let cachedRestUrl: string | undefined;

/**
 * The base URL of `ouroboros-rest`, validated once per process.
 *
 * @returns The base URL, without a trailing slash.
 * @throws {Error} Whatever {@link readRestUrl} throws, on every call until it is fixed —
 *   only a successful read is cached.
 */
export function restUrl(): string {
  cachedRestUrl ??= readRestUrl();
  return cachedRestUrl;
}

/**
 * Forget the memoised value.
 *
 * Exported for tests, which need each case to re-read the environment. Production code
 * has no reason to call it: the environment of a running process does not change.
 */
export function resetRestUrlCache(): void {
  cachedRestUrl = undefined;
}
