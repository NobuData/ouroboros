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
 * The only interfaces `OURO_LISTEN_HOST` may name — the two this module already binds.
 *
 * An enum rather than a free-form address, so the override can choose between the
 * postures this service understands but cannot become a general-purpose bind knob: an
 * arbitrary address here would be a way to point the service at an interface nobody has
 * reasoned about, validated by nothing.
 */
export const LISTEN_HOSTS = [LOOPBACK_HOST, ALL_INTERFACES_HOST] as const;

/** One of {@link LISTEN_HOSTS}. */
export type ListenHost = (typeof LISTEN_HOSTS)[number];

/**
 * Shortest signing key or shared secret this service will start with.
 *
 * Sixteen characters is not a strength guarantee — it is a floor low enough that every
 * development default in `.env.example` clears it and high enough that a value somebody
 * typed by hand does not. The secrets themselves are generated, not typed.
 */
export const MINIMUM_SECRET_LENGTH = 16;

/**
 * Bytes the vault's key-encryption key must be — 32, which is what AES-256 means.
 *
 * Not a minimum. A KEK is generated rather than typed, and a value that is nearly the
 * right length is a value somebody edited by hand or truncated in transit; accepting it
 * and stretching it would turn a mistake an operator can fix at boot into ciphertext
 * nobody can open afterwards.
 */
export const VAULT_MASTER_KEY_BYTES = 32;

/**
 * Seconds between dashboard polls when `OURO_DASHBOARD_POLL_SECONDS` is not set.
 *
 * Fifteen: the interval the polling contract documents for a visible tab
 * (`docs/ARCHITECTURE.md` § 5.4, [#75](https://github.com/NobuData/ouroboros/issues/75)),
 * agreed with the UI hook that honours it (#87). Slow enough that a workspace of pollers
 * costs the server four aggregate subqueries a minute each, fast enough that the page and
 * the topbar pills read as live.
 */
export const DEFAULT_DASHBOARD_POLL_SECONDS = 15;

/**
 * Longest wait `OURO_DASHBOARD_POLL_SECONDS` may ask a client for — one hour.
 *
 * The header is a *backoff hint*, not an off switch: above this a dashboard would simply
 * never refresh while somebody is looking at it, which is an outage spelled as a number.
 * An operator who wants polling stopped stops the service, where the failure is visible.
 */
export const MAX_DASHBOARD_POLL_SECONDS = 3600;

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
   * The vault's key-encryption key, base64. From `OURO_VAULT_MASTER_KEY`.
   *
   * The KEK of the envelope-encryption service — roadmap decision **P2**,
   * [#222](https://github.com/NobuData/ouroboros/issues/222). It seals every workspace's
   * data-encryption key in `ouroboros.tenant_keys` and encrypts nothing else, which is what
   * makes moving custody to KMS or Vault (AF.3,
   * [#236](https://github.com/NobuData/ouroboros/issues/236)) a re-wrap of that table rather
   * than a re-encryption of every credential in the system.
   *
   * Validated at boot to decode to exactly {@link VAULT_MASTER_KEY_BYTES} bytes, so a
   * missing or malformed key stops the process while it is starting rather than at the first
   * request that needed a secret — by which time the failure is a 500 on a credential page
   * and not a line an operator can act on.
   *
   * **Losing this value loses every stored credential**, and the honest cost of the default
   * deployment is that its custody is the operator's problem. `docs/SECURITY_MODEL.md`
   * (AD.5, [#226](https://github.com/NobuData/ouroboros/issues/226)) is where that is
   * written down rather than glossed as "KMS-backed"; rotating it is a re-wrap, which
   * `VaultService.rewrap` performs without touching a single data ciphertext.
   */
  readonly vaultMasterKey: string;
  /**
   * Browser origins allowed to call this API with credentials — the origins the session
   * cookie is permitted to travel to. From `OURO_CORS_ORIGINS`, which is a comma-separated
   * list; never empty, and never a wildcard, because a credentialed request cannot use one.
   */
  readonly corsOrigins: readonly string[];
  /**
   * Seconds a dashboard client should wait between polls — the value of every
   * `X-Ouro-Poll-After` header. From `OURO_DASHBOARD_POLL_SECONDS`,
   * {@link DEFAULT_DASHBOARD_POLL_SECONDS} when unset.
   *
   * This is the server's half of the polling contract
   * ([#75](https://github.com/NobuData/ouroboros/issues/75), `docs/ARCHITECTURE.md`
   * § 5.4): the client polls at whatever the last answer said, so raising this value is
   * how an operator slows every dashboard consumer under load — within one poll cycle,
   * with no client change and no deploy on the client's side.
   */
  readonly dashboardPollSeconds: number;
  /**
   * The interface to bind, when explicitly chosen. From `OURO_LISTEN_HOST`; `undefined`
   * when unset, which is the normal case — {@link listenHost} then derives the interface
   * from {@link nodeEnv} exactly as it did before this variable existed.
   *
   * It exists for one caller: the e2e compose override (repo-root
   * `docker-compose.e2e.yml`, [#647](https://github.com/NobuData/ouroboros/issues/647)),
   * where the stack runs non-production so #705's password sign-in answers, and the
   * loopback interface that non-production otherwise binds is one Docker's port
   * publishing cannot route to. The override moves the *interface only* — the sign-in
   * gate stays `NODE_ENV`'s and gains no second switch (`src/auth/password.provider.ts`
   * § "Where the line is drawn") — and that stack still publishes its host ports on
   * `127.0.0.1`, so nothing leaves the machine running the suite.
   */
  readonly listenHostOverride?: ListenHost;
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
  vaultMasterKey: "OURO_VAULT_MASTER_KEY",
  corsOrigins: "OURO_CORS_ORIGINS",
  dashboardPollSeconds: "OURO_DASHBOARD_POLL_SECONDS",
  listenHostOverride: "OURO_LISTEN_HOST",
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
 * Decode a base64 key, in either alphabet, refusing anything that is not exactly base64.
 *
 * `Buffer.from(value, "base64")` cannot be used as the test on its own: it is deliberately
 * lenient, and skips over any character it does not recognise — so `"not a key at all!"`
 * decodes happily to a short buffer rather than failing, and a value with a typo in the
 * middle decodes to *different bytes* rather than to an error. That is the one failure mode
 * this validation exists to prevent, because the resulting key is wrong and nothing says so
 * until the ciphertext it sealed will not open.
 *
 * So the alphabet is checked first and the length after. Both alphabets are accepted —
 * `openssl rand -base64 32` produces the standard one, and a value that has been through a
 * URL or a Kubernetes secret may arrive in the URL-safe one; the two differ in two
 * characters and never in what they decode to.
 *
 * @param value - The raw string from the environment, already known to be non-blank.
 * @param bytes - How many bytes the decoded key must be, exactly.
 * @returns `true` when the value is well-formed base64 of exactly that length. Never throws,
 *   and never reports what it saw — see this file's header on echoing values.
 */
export function isBase64Key(value: string, bytes: number): boolean {
  // One alphabet or the other, never a mixture: a value carrying both `+` and `-` did not
  // come out of an encoder, it came out of something that edited one.
  if (!/^(?:[A-Za-z0-9+/]+|[A-Za-z0-9_-]+)={0,2}$/.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").byteLength === bytes;
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

  // The vault's KEK (#222). Not validated by `secret` above, and the difference is the
  // whole of this ticket's "boot fails cleanly on a bad master key" criterion: the others
  // are shared strings whose only requirement is that both sides carry the same one, while
  // this is key material of a fixed size. A 31-byte value is not a weak key, it is not a
  // key — and accepting it would produce a service that starts, seals credentials with
  // something derived from a mistake, and cannot open them once the mistake is fixed.
  OURO_VAULT_MASTER_KEY: z
    .string({ error: "is required" })
    .refine(
      (value) => isBase64Key(value, VAULT_MASTER_KEY_BYTES),
      `expected exactly ${VAULT_MASTER_KEY_BYTES} bytes of base64, as produced by: openssl rand -base64 ${VAULT_MASTER_KEY_BYTES}`,
    ),

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

  // Read by the same rules as PORT — anchored digits, then a range — and for the same
  // reason: `Number()` would accept "15s" and answer with something plausible.
  OURO_DASHBOARD_POLL_SECONDS: z
    .string()
    .regex(
      /^\d+$/,
      `expected a whole number of seconds between 1 and ${MAX_DASHBOARD_POLL_SECONDS}`,
    )
    .transform(Number)
    .refine(
      (value) => value >= 1 && value <= MAX_DASHBOARD_POLL_SECONDS,
      `expected between 1 and ${MAX_DASHBOARD_POLL_SECONDS} seconds`,
    )
    .default(DEFAULT_DASHBOARD_POLL_SECONDS),

  // The bind-interface override (#647) — optional, no default, and an enum of the two
  // interfaces this module already names rather than a free-form address. Unset is the
  // only posture a deployment should ever be in; see the field's documentation on
  // `Configuration` for the one stack that sets it.
  OURO_LISTEN_HOST: z
    .enum(LISTEN_HOSTS, { error: `expected ${LOOPBACK_HOST} or ${ALL_INTERFACES_HOST}` })
    .optional(),
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
    vaultMasterKey: values.OURO_VAULT_MASTER_KEY,
    corsOrigins: Object.freeze(values.OURO_CORS_ORIGINS),
    dashboardPollSeconds: values.OURO_DASHBOARD_POLL_SECONDS,
    listenHostOverride: values.OURO_LISTEN_HOST,
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
 * `OURO_LISTEN_HOST` overrides the derivation when set — see
 * {@link Configuration.listenHostOverride} for the one stack that sets it and why. It
 * moves the interface and nothing else: the development sign-in still turns on `NODE_ENV`
 * alone (`src/auth/password.provider.ts`).
 *
 * @param configuration - The validated environment name and, when set, the override.
 * @returns The override when present; otherwise {@link ALL_INTERFACES_HOST} in
 *   production and {@link LOOPBACK_HOST} anywhere else.
 */
export function listenHost(
  configuration: Pick<Configuration, "nodeEnv" | "listenHostOverride">,
): string {
  return (
    configuration.listenHostOverride ??
    (configuration.nodeEnv === "production" ? ALL_INTERFACES_HOST : LOOPBACK_HOST)
  );
}
