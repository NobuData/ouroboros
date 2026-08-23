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

import {
  LOCAL_PROVIDER_KINDS,
  isCloudProvider,
  type LocalProviderKind,
} from "../internal/providers";

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
 * Seconds between provider health sweeps when `OURO_PROVIDER_HEALTH_INTERVAL_SECONDS` is
 * not set, and the age at which a *local* provider's last check is stale.
 *
 * Sixty. Z.3 ([#196](https://github.com/NobuData/ouroboros/issues/196)) promises that a
 * stopped Ollama shows on the strip *within one check cycle*, which is only a promise worth
 * making if a cycle is short — and the checks it governs are `GET`s against a daemon on the
 * operator's own network, so a minute costs a loopback interface nothing. The actual delay
 * is this value jittered by ±25% (`provider-health/cadence.ts`), so a fleet does not
 * synchronise.
 */
export const DEFAULT_PROVIDER_HEALTH_INTERVAL_SECONDS = 60;

/**
 * Shortest sweep interval an operator may ask for — ten seconds.
 *
 * Below this the sweep stops being a background job and becomes a load generator against
 * whatever local daemons a workspace has declared. An operator who wants health *now* has a
 * page that polls; what this value controls is how often this service knocks.
 */
export const MIN_PROVIDER_HEALTH_INTERVAL_SECONDS = 10;

/**
 * Seconds before a cloud provider's key validation is redone when
 * `OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS` is not set — fifteen minutes.
 *
 * Deliberately far slower than the local cadence, and the reason is in
 * `provider-health/cadence.ts`: this one is a request to somebody else's rate-limited
 * service, made by every self-hosted Ouroboros in the world. What it detects is a rotated or
 * revoked key, which is a thing that happens on a human timescale — fifteen minutes is well
 * inside "before anybody files a ticket about it" and well outside "often enough to matter to
 * the vendor".
 */
export const DEFAULT_PROVIDER_HEALTH_KEY_CHECK_SECONDS = 900;

/**
 * Shortest key-validation cadence an operator may ask for — one minute.
 *
 * A floor rather than a preference. Anything faster is this deployment behaving badly towards
 * a provider it does not own, on a schedule nobody watching the page asked for.
 */
export const MIN_PROVIDER_HEALTH_KEY_CHECK_SECONDS = 60;

/** Longest either health cadence may be set to — one day. */
export const MAX_PROVIDER_HEALTH_SECONDS = 86400;

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
  /**
   * Seconds between provider health sweeps, and the age at which a local provider's last
   * check is stale. From `OURO_PROVIDER_HEALTH_INTERVAL_SECONDS`,
   * {@link DEFAULT_PROVIDER_HEALTH_INTERVAL_SECONDS} when unset.
   *
   * The nominal interval rather than the actual one: `src/modules/provider-health/` jitters
   * every delay by ±25%, so a fleet of self-hosted instances does not arrive at a provider's
   * endpoint in the same second. Raising it is how an operator makes this service knock less
   * often; there is no value that turns it off, because a strip that stops updating and a
   * strip that says `unknown` look different to a person and only one of them is true.
   */
  readonly providerHealthIntervalSeconds: number;
  /**
   * Seconds before a cloud provider's key validation is redone. From
   * `OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS`,
   * {@link DEFAULT_PROVIDER_HEALTH_KEY_CHECK_SECONDS} when unset.
   *
   * Separate from {@link providerHealthIntervalSeconds} because the two cadences are asking
   * different people: a local daemon is the operator's own machine, and a vendor's
   * key-validation endpoint is not. The sweep still runs on the shorter interval — this is
   * how old a *cloud* row's `last_checked_at` has to be before that sweep touches it.
   */
  readonly providerHealthKeyCheckSeconds: number;
  /**
   * Where this deployment's local model providers are — `OURO_LOCAL_PROVIDER_URLS`.
   *
   * A map of provider kind to base URL, from a comma-separated list of `kind=url` pairs, and
   * empty when the variable is unset — which is the normal case, because most installations
   * run no local model server at all.
   *
   * It is the deployment's answer to a question no table can answer yet. Decision **P3**
   * ([#224](https://github.com/NobuData/ouroboros/issues/224)) makes local providers the one
   * exception to *workers never hold credentials*: an engine worker calling an Ollama daemon
   * on the same box gains nothing from proxying through this service, because there is no key
   * on that path to protect. Something still has to say where that daemon is, and until Y.1
   * ([#189](https://github.com/NobuData/ouroboros/issues/189)) brings `provider_connections`
   * the only thing that can say it is the operator.
   *
   * **Only leasable kinds may appear.** A value naming `anthropic`, `copilot` or `cursor`
   * stops the process at boot rather than being ignored — see `src/modules/internal/` for
   * why the policy lives in two places, and why neither one is enough on its own.
   *
   * It holds no secret. Every value is an address, and the whole point of the lease surface
   * is that an address is all a worker is ever given.
   */
  readonly localProviderUrls: Readonly<Partial<Record<LocalProviderKind, string>>>;
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
  providerHealthIntervalSeconds: "OURO_PROVIDER_HEALTH_INTERVAL_SECONDS",
  providerHealthKeyCheckSeconds: "OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS",
  localProviderUrls: "OURO_LOCAL_PROVIDER_URLS",
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
 * What separates one `kind=url` pair from the next in `OURO_LOCAL_PROVIDER_URLS`.
 *
 * A comma, matching `OURO_CORS_ORIGINS`, because a variable that already has a list in this
 * file should not introduce a second way of writing one. A URL cannot contain an unescaped
 * comma, so nothing here has to be quoted.
 */
const PROVIDER_SEPARATOR = ",";

/** What separates a provider kind from its address. */
const PROVIDER_ASSIGNMENT = "=";

/** One entry of `OURO_LOCAL_PROVIDER_URLS`, before it is known to be valid. */
interface ProviderEntry {
  /** Everything before the first `=`, trimmed. */
  readonly kind: string;
  /** Everything after it, trimmed — a URL cannot be split on `=` again, so `split` is not it. */
  readonly url: string;
}

/**
 * Split `OURO_LOCAL_PROVIDER_URLS` into entries, without judging any of them.
 *
 * Blank entries are dropped, so a trailing comma is a formatting habit rather than a boot
 * failure — the same tolerance `OURO_CORS_ORIGINS` extends. Everything else is left exactly
 * as written for the refinements below to complain about by name.
 *
 * @param value - The raw variable.
 * @returns One entry per pair. An entry with no `=` keeps its whole text as the kind, which
 *   is what makes the error message name what the operator actually typed.
 */
function providerEntries(value: string): ProviderEntry[] {
  return value
    .split(PROVIDER_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const at = entry.indexOf(PROVIDER_ASSIGNMENT);
      return at === -1
        ? { kind: entry, url: "" }
        : { kind: entry.slice(0, at).trim(), url: entry.slice(at + 1).trim() };
    });
}

/**
 * Why this list of providers cannot be accepted, or `undefined` when it can.
 *
 * One function returning one message rather than a chain of `refine`s, because the messages
 * have to *name the entry* — `expected kind=url` is useless advice about a variable holding
 * four pairs, and zod reports the key it was parsing, which is the variable rather than the
 * pair.
 *
 * @param entries - The parsed entries.
 * @returns The complaint, or `undefined`.
 */
function providerProblem(entries: readonly ProviderEntry[]): string | undefined {
  const seen = new Set<string>();

  for (const { kind, url } of entries) {
    if (isCloudProvider(kind)) {
      // The boot-time half of decision P3, and the reason this is a configuration error
      // rather than an entry that is quietly dropped: an operator who wrote it believes
      // their workers can reach that provider directly, and a service that started anyway
      // would leave them believing it until something failed at three in the morning.
      return `${kind} is a cloud provider and is never leased to a worker — its credentials stay in the control plane (issue #224). Remove it`;
    }

    if (!(LOCAL_PROVIDER_KINDS as readonly string[]).includes(kind)) {
      // The one branch that does **not** name what it was given, and the reason is this
      // file's own rule: every other message here names a *constant* — one of the three
      // cloud kinds, or a leasable kind already matched — while this one would echo whatever
      // an operator typed into the boot log. What they need is the list of what is accepted.
      return `an entry names something that is not a provider kind — expected one of ${LOCAL_PROVIDER_KINDS.join(", ")}`;
    }

    if (seen.has(kind)) {
      return `${kind} is listed twice, and nothing here decides which address wins`;
    }

    seen.add(kind);

    if (!isAbsoluteUrl(url, ["http:", "https:"])) {
      return `${kind} needs an absolute http:// or https:// URL, such as ${kind}=http://localhost:11434`;
    }
  }

  return undefined;
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
 * One of the two provider-health cadences — a whole number of seconds inside a range.
 *
 * A factory rather than two near-identical schemas, because the pair differ only in their
 * floor and their default and the *rules* are the same ones `PORT` and
 * `OURO_DASHBOARD_POLL_SECONDS` are read by: anchored digits, then a range. Writing them
 * twice would be two places for "a cadence is a whole number of seconds" to drift.
 *
 * @param minimum - The floor. See `Configuration` for why each has one.
 * @param fallback - The value when the variable is unset.
 * @returns The schema.
 */
function healthCadence(minimum: number, fallback: number) {
  const range = `expected between ${minimum} and ${MAX_PROVIDER_HEALTH_SECONDS} seconds`;

  return z
    .string()
    .regex(/^\d+$/, range)
    .transform(Number)
    .refine((value) => value >= minimum && value <= MAX_PROVIDER_HEALTH_SECONDS, range)
    .default(fallback);
}

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

  // The two provider-health cadences (#196), read by the same rules as PORT and the
  // dashboard's poll: anchored digits, then a range. Two variables rather than one because
  // they govern requests to two different people — see `Configuration` for which is which.
  //
  // Both have a floor as well as a ceiling, and the floors are the interesting half: a
  // one-second sweep is a load generator against an operator's own daemons, and a
  // one-second key check is this deployment behaving badly towards a provider it does not
  // own. Neither has an off value, deliberately — a strip that has stopped updating and a
  // strip that honestly says `unknown` look different to a person, and only one of them is
  // true.
  OURO_PROVIDER_HEALTH_INTERVAL_SECONDS: healthCadence(
    MIN_PROVIDER_HEALTH_INTERVAL_SECONDS,
    DEFAULT_PROVIDER_HEALTH_INTERVAL_SECONDS,
  ),

  OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS: healthCadence(
    MIN_PROVIDER_HEALTH_KEY_CHECK_SECONDS,
    DEFAULT_PROVIDER_HEALTH_KEY_CHECK_SECONDS,
  ),

  // Where this deployment's local model providers are (#224, decision P3) — `kind=url`
  // pairs, comma-separated. Optional, and its default is *no local providers*: an
  // installation that runs none is the normal one, and a default address would be this
  // service guessing that something is listening on a port nobody mentioned.
  //
  // Validated into the map the application consumes rather than into a string, so the
  // parsing happens once at boot and a malformed pair is a named variable in the boot
  // failure rather than a `404` on a lease six hours later.
  OURO_LOCAL_PROVIDER_URLS: z
    .string()
    .default("")
    .refine((value) => providerProblem(providerEntries(value)) === undefined, {
      // A function rather than a sentence, because the useful message names the pair that
      // is wrong — and which pair that is cannot be known when the schema is built.
      error: (issue) => providerProblem(providerEntries(String(issue.input))),
    })
    .transform(
      (value) =>
        Object.fromEntries(providerEntries(value).map(({ kind, url }) => [kind, url])) as Partial<
          Record<LocalProviderKind, string>
        >,
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
    vaultMasterKey: values.OURO_VAULT_MASTER_KEY,
    corsOrigins: Object.freeze(values.OURO_CORS_ORIGINS),
    dashboardPollSeconds: values.OURO_DASHBOARD_POLL_SECONDS,
    listenHostOverride: values.OURO_LISTEN_HOST,
    providerHealthIntervalSeconds: values.OURO_PROVIDER_HEALTH_INTERVAL_SECONDS,
    providerHealthKeyCheckSeconds: values.OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS,
    localProviderUrls: Object.freeze(values.OURO_LOCAL_PROVIDER_URLS),
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
