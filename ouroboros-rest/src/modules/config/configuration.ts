/**
 * Every variable this service reads, validated once, before anything is built.
 *
 * `docs/CONVENTIONS.md` § 4 asks two things of configuration: that everything
 * Ouroboros-specific carries the `OURO_` prefix while platform standards (`PORT`,
 * `NODE_ENV`) and a library's own canonical names (`BETTER_AUTH_*`) do not, and that a
 * missing or malformed value **stops the process while it is starting, naming the
 * variable**, rather than surfacing as a stack trace on the first request that happens to
 * need it. This file is where the second half of that is decided for `ouroboros-rest`,
 * the way `settings.py` decides it for `ouroboros-engine`.
 *
 * Three things about the shape are deliberate:
 *
 *   * **The schema is keyed by environment-variable name, not by field name.** The whole
 *     value of a boot-time failure is the line it prints, and zod reports the key it was
 *     parsing — so keying the schema `OURO_DATABASE_URL` rather than `databaseUrl` is
 *     what makes that line name the thing an operator has to go and fix. The camel-case
 *     {@link Configuration} the application consumes is derived afterwards.
 *   * **No message ever echoes a value.** Three of these variables are secrets, and a
 *     formatter that prints what it was given is one classification mistake away from
 *     writing a signing key into a log. A rule that cannot leak is worth more than a list
 *     of exceptions somebody has to maintain, so every message states the *expectation*
 *     instead — which is the part that tells you what to type anyway.
 *   * **Configuration is read from the process environment only.** There is no dotenv
 *     loading here, matching `ouroboros-engine`: what a container is started with is
 *     exactly what the service runs with, and there is no file that can disagree with it.
 *
 * The values themselves are documented, with development defaults, in the repo-root
 * `.env.example` — which `scripts/verify-dev-env.sh` keeps in lockstep with this module's
 * README.
 */

import { z } from "zod";

/**
 * A required environment variable is missing or malformed.
 *
 * Carries a message naming every offending variable and what was wrong with it, ready to
 * print before exiting non-zero. It is a distinct class so `main` can tell a
 * configuration mistake — which is the operator's to fix, and deserves one line rather
 * than a stack — from a genuine failure, which does not.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Values `NODE_ENV` accepts. Anything else is a configuration error, not a fallback. */
export const NODE_ENVIRONMENTS = ["development", "test", "production"] as const;

/** One of {@link NODE_ENVIRONMENTS}. */
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/** Listen port when `PORT` is not set — `docs/CONVENTIONS.md` § 4's port map. */
export const DEFAULT_PORT = 4000;

/** Highest port number a socket can be bound to. */
export const MAX_PORT = 65535;

/** Interface bound when the service is not running in production. */
export const LOOPBACK_HOST = "127.0.0.1";

/** Interface bound in production, where the platform routes to the container. */
export const ALL_INTERFACES_HOST = "0.0.0.0";

/**
 * Shortest signing key or shared secret this service will start with.
 *
 * Sixteen characters is not a strength guarantee — it is a floor low enough that every
 * development default in `.env.example` clears it and high enough that a value somebody
 * typed by hand does not. The secrets themselves are generated, not typed.
 */
export const MINIMUM_SECRET_LENGTH = 16;

/**
 * The service's validated configuration.
 *
 * Every field is derived from exactly one environment variable — {@link VARIABLES} is the
 * mapping — and the object handed out by {@link loadConfiguration} is frozen, so nothing
 * can reconfigure the service after it has started.
 */
export interface Configuration {
  /** TCP port to listen on. From `PORT`, {@link DEFAULT_PORT} when unset. */
  readonly port: number;
  /**
   * Which environment this is. From `NODE_ENV`, `development` when unset.
   *
   * Two things turn on it, and since
   * [#705](https://github.com/NobuData/ouroboros/issues/705) one of them is a security
   * boundary rather than a deployment detail: {@link listenHost} picks the interface to
   * bind, and `src/auth/password.provider.ts` enables the development email/password
   * sign-in **only when this is not `production`**. `ouroboros-rest`'s Dockerfile pins it to
   * `production` in the image, so the off position is what any deployment inherits without
   * having to be told.
   */
  readonly nodeEnv: NodeEnvironment;
  /** PostgreSQL connection string for `ouroboros-db`. From `OURO_DATABASE_URL`. */
  readonly databaseUrl: string;
  /**
   * The origin a *browser* reaches this service at. From `OURO_REST_URL`.
   *
   * Read for one thing: the `redirect_uri` the GitHub OAuth handshake carries
   * ([#33](https://github.com/NobuData/ouroboros/issues/33)), which has to be the URL
   * GitHub has registered against the application rather than whatever `Host` header a
   * request happened to arrive with — a value an attacker controls, and the one input that
   * could send an authorization code somewhere else.
   */
  readonly restUrl: string;
  /**
   * Where a browser is sent once it is signed in, or signed out. From `OURO_UI_URL`.
   *
   * `ouroboros-ui`'s origin. The OAuth callback is a redirect a browser follows rather
   * than a fetch a script made, so it has to end somewhere a person can see, and this
   * service serves no pages.
   */
  readonly uiUrl: string;
  /** Base URL of `ouroboros-engine`. From `OURO_ENGINE_URL`. */
  readonly engineUrl: string;
  /** Value sent as `X-Ouro-Internal-Key`. From `OURO_ENGINE_SHARED_SECRET`. */
  readonly engineSharedSecret: string;
  /**
   * BetterAuth's signing and encryption key. From `BETTER_AUTH_SECRET`.
   *
   * Unprefixed because it is BetterAuth's own canonical name, which the library reads
   * from the environment by itself when it is not handed one — roadmap decision **A9**,
   * `docs/ROADMAP_MOCKUP_01_BETTERAUTH.md`. Renaming it to `OURO_BETTER_AUTH_SECRET`
   * would buy consistency at the price of a variable the library's own documentation,
   * its CLI and every answer on the internet call something else.
   *
   * Rotating it invalidates every session and makes every stored OAuth token
   * undecryptable ([#700](https://github.com/NobuData/ouroboros/issues/700)).
   */
  readonly betterAuthSecret: string;
  /**
   * The origin BetterAuth builds its own URLs from. From `BETTER_AUTH_URL`.
   *
   * The same origin as {@link restUrl} — this service's public address — spelled in
   * BetterAuth's vocabulary, because it is what the library reads and what its CLI reads.
   * Keep the two in step: nothing derives one from the other, deliberately, so that a
   * deployment that terminates somewhere unexpected can say so once rather than have a
   * value inferred for it.
   */
  readonly betterAuthUrl: string;
  /** GitHub OAuth application, client id. From `OURO_GITHUB_CLIENT_ID`. */
  readonly githubClientId: string;
  /** GitHub OAuth application, client secret. From `OURO_GITHUB_CLIENT_SECRET`. */
  readonly githubClientSecret: string;
  /**
   * Browser origins allowed to call this API with credentials — the origins the session
   * cookie is permitted to travel to. From `OURO_CORS_ORIGINS`, which is a comma-separated
   * list; never empty, and never a wildcard, because a credentialed request cannot use one.
   */
  readonly corsOrigins: readonly string[];
}

/**
 * Which environment variable each field is read from.
 *
 * `satisfies` rather than a plain object: it is a compile error to add a field to
 * {@link Configuration} without saying which variable feeds it, which is what keeps the
 * boot-time summary and the redaction rules complete as this module grows.
 */
export const VARIABLES = {
  port: "PORT",
  nodeEnv: "NODE_ENV",
  databaseUrl: "OURO_DATABASE_URL",
  restUrl: "OURO_REST_URL",
  uiUrl: "OURO_UI_URL",
  engineUrl: "OURO_ENGINE_URL",
  engineSharedSecret: "OURO_ENGINE_SHARED_SECRET",
  betterAuthSecret: "BETTER_AUTH_SECRET",
  betterAuthUrl: "BETTER_AUTH_URL",
  githubClientId: "OURO_GITHUB_CLIENT_ID",
  githubClientSecret: "OURO_GITHUB_CLIENT_SECRET",
  corsOrigins: "OURO_CORS_ORIGINS",
} as const satisfies Record<keyof Configuration, string>;

/**
 * Is this an absolute URL on one of the given schemes, with a host?
 *
 * `new URL()` is the parser rather than a regular expression because it is the same one
 * the clients built on these values use — anything it rejects here would have failed at
 * connect time instead, which is the failure this module exists to move forward.
 *
 * @param value - The raw string from the environment.
 * @param protocols - Accepted schemes, written the way `URL` reports them: with a colon.
 * @returns `true` when the value parses and carries one of those schemes and a hostname.
 */
function isAbsoluteUrl(value: string, protocols: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return protocols.includes(url.protocol) && url.hostname !== "";
}

/**
 * Is this a browser *origin* — a scheme, a host and an optional port, and nothing else?
 *
 * The comparison against `URL.origin` is what rejects the near misses: a trailing slash,
 * a path, a query, credentials, and the `*` wildcard that a credentialed cross-origin
 * request is not allowed to be answered with in the first place.
 *
 * @param value - One entry from `OURO_CORS_ORIGINS`, already trimmed.
 * @returns `true` when the value is exactly the origin it parses to.
 */
function isOrigin(value: string): boolean {
  if (!isAbsoluteUrl(value, ["http:", "https:"])) {
    return false;
  }

  return new URL(value).origin === value;
}

/**
 * `PORT` — a whole number a socket can be bound to.
 *
 * Anchored and digits-only rather than `Number()`/`parseInt()`: both of those accept
 * `"4000abc"`, `" 4000"`, `"0x4000"` or `"4e3"` and answer with something plausible. `0`
 * is rejected with the rest — to the operating system it means "any free port", which is
 * never what someone deploying a service meant to write.
 */
const port = z
  .string()
  .regex(/^\d+$/, `expected a whole number between 1 and ${MAX_PORT}`)
  .transform(Number)
  .refine((value) => value >= 1 && value <= MAX_PORT, `expected a port between 1 and ${MAX_PORT}`)
  .default(DEFAULT_PORT);

/** A secret or signing key: present, and long enough not to have been typed by hand. */
const secret = z
  .string({ error: "is required" })
  .min(MINIMUM_SECRET_LENGTH, `expected at least ${MINIMUM_SECRET_LENGTH} characters`);

/**
 * The environment, as this service requires it to be.
 *
 * Unknown variables are ignored rather than rejected — the environment of a container
 * carries plenty that has nothing to do with this service — which is zod's default for an
 * object schema and is stated here because it is a decision rather than an accident.
 */
const environmentSchema = z.object({
  PORT: port,

  NODE_ENV: z
    .enum(NODE_ENVIRONMENTS, { error: `expected one of ${NODE_ENVIRONMENTS.join(", ")}` })
    .default("development"),

  OURO_DATABASE_URL: z
    .string({ error: "is required" })
    .refine(
      (value) => isAbsoluteUrl(value, ["postgresql:", "postgres:"]),
      "expected a PostgreSQL connection string, such as postgresql://user:password@host:5432/database",
    ),

  OURO_REST_URL: z
    .string({ error: "is required" })
    .refine(isOrigin, "expected this service's own browser origin, such as http://localhost:4000"),

  OURO_UI_URL: z
    .string({ error: "is required" })
    .refine(isOrigin, "expected ouroboros-ui's browser origin, such as http://localhost:3000"),

  OURO_ENGINE_URL: z
    .string({ error: "is required" })
    .refine(
      (value) => isAbsoluteUrl(value, ["http:", "https:"]),
      "expected an absolute http:// or https:// URL, such as http://localhost:8000",
    ),

  OURO_ENGINE_SHARED_SECRET: secret,

  // BetterAuth's two canonical variables (roadmap decision A9). They are validated by the
  // same rules as their OURO_ counterparts rather than by the library's own defaults,
  // because BetterAuth falls back to reading the environment itself and would start
  // without a secret in development — which is a service that boots and then hands out
  // sessions signed with a key nobody chose.
  BETTER_AUTH_SECRET: secret,

  BETTER_AUTH_URL: z
    .string({ error: "is required" })
    .refine(isOrigin, "expected this service's own browser origin, such as http://localhost:4000"),

  OURO_GITHUB_CLIENT_ID: z.string({ error: "is required" }),
  OURO_GITHUB_CLIENT_SECRET: z.string({ error: "is required" }),

  OURO_CORS_ORIGINS: z
    .string({ error: "is required" })
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    )
    .refine((origins) => origins.length > 0, "expected at least one browser origin")
    .refine(
      (origins) => origins.every(isOrigin),
      "expected a comma-separated list of browser origins, such as http://localhost:3000 — " +
        "an origin is a scheme, a host and an optional port, with no path and no wildcard",
    ),
});

/**
 * Drop the variables that are set but empty, so they read as unset.
 *
 * `BETTER_AUTH_SECRET=` in an env file is an unfilled line rather than a deliberate
 * empty string, and "is required" is a better answer to it than "expected at least 16
 * characters". A value that is only whitespace is treated the same way; one that has
 * whitespace *around* something is left alone, so a padded value is still rejected rather
 * than silently trimmed into working.
 *
 * @param env - Environment to read, normally `process.env`.
 * @returns The same variables, minus every blank one.
 */
function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  const present: Record<string, string> = {};

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== "") {
      present[name] = value;
    }
  }

  return present;
}

/**
 * Render a validation failure as advice about environment variables.
 *
 * zod reports the key it was parsing, and every key in {@link environmentSchema} is an
 * environment variable's own name — so this is a list of the variables to go and fix,
 * which is the only thing an operator reading a failed boot wants. Values are never
 * echoed; see this file's header.
 *
 * @param error - The failure {@link environmentSchema} reported.
 * @returns A multi-line message: a summary, then one `VARIABLE: reason` line per problem.
 */
function describeFailure(error: z.ZodError): string {
  const problems = error.issues.map((issue) => {
    // Every issue an object schema reports is keyed by the property it was parsing, so
    // the fallback is unreachable today and nothing covers it. It is here because the
    // alternative — printing `undefined: expected …` — would turn a schema change into a
    // boot failure that names nothing, which is the one thing this message must not do.
    const variable = issue.path[0];
    return `  ${typeof variable === "string" ? variable : "(unknown variable)"}: ${issue.message}`;
  });

  const noun = problems.length === 1 ? "problem" : "problems";
  return [`ouroboros-rest: invalid configuration (${problems.length} ${noun})`, ...problems].join(
    "\n",
  );
}

/**
 * Read and validate the environment.
 *
 * @param env - Environment to read, normally `process.env`. Passed in rather than reached
 *   for so a test can exercise a value without mutating the process, and so the one place
 *   that touches `process.env` is the process entry point.
 * @returns The frozen {@link Configuration}. Frozen because configuration is read once:
 *   nothing that receives it can reconfigure the service after it has started.
 * @throws {ConfigurationError} If any variable is missing or malformed. The message names
 *   every offending variable and the reason, one per line.
 */
export function loadConfiguration(env: NodeJS.ProcessEnv): Configuration {
  const result = environmentSchema.safeParse(withoutBlanks(env));
  if (!result.success) {
    throw new ConfigurationError(describeFailure(result.error));
  }

  const values = result.data;
  return Object.freeze({
    port: values.PORT,
    nodeEnv: values.NODE_ENV,
    databaseUrl: values.OURO_DATABASE_URL,
    restUrl: values.OURO_REST_URL,
    uiUrl: values.OURO_UI_URL,
    engineUrl: values.OURO_ENGINE_URL,
    engineSharedSecret: values.OURO_ENGINE_SHARED_SECRET,
    betterAuthSecret: values.BETTER_AUTH_SECRET,
    betterAuthUrl: values.BETTER_AUTH_URL,
    githubClientId: values.OURO_GITHUB_CLIENT_ID,
    githubClientSecret: values.OURO_GITHUB_CLIENT_SECRET,
    corsOrigins: Object.freeze(values.OURO_CORS_ORIGINS),
  });
}

/**
 * Decide which interface to bind.
 *
 * Development binds the loopback interface only. A service that answers on every
 * interface of a developer's machine is reachable from whatever network that machine is
 * on, and this one holds session cookies and a database connection long before it holds
 * an authorization rule. In production the platform is what decides who can reach the
 * container, and a process bound to loopback inside one is a process nothing can route
 * to — so there, every interface is the only workable answer.
 *
 * @param nodeEnv - The validated environment name.
 * @returns {@link ALL_INTERFACES_HOST} in production, {@link LOOPBACK_HOST} otherwise.
 */
export function listenHost(nodeEnv: NodeEnvironment): string {
  return nodeEnv === "production" ? ALL_INTERFACES_HOST : LOOPBACK_HOST;
}
