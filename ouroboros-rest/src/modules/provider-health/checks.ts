/**
 * Which question this service is allowed to ask each provider kind, and which kinds it has
 * no honest question for.
 *
 * Z.3 ([#196](https://github.com/NobuData/ouroboros/issues/196)), roadmap decision **M8**.
 * The whole of the passive-first policy is the table at the bottom of this file, and it is a
 * table rather than a chain of `if`s because the interesting content is the *gaps* in it: two
 * of the six kinds map to `null`, and a reader should be able to see that without following
 * a control flow to the place where nothing happens.
 *
 * ---------------------------------------------------------------------------
 * **The rejected alternative, named so it stays rejected.** The obvious way to fill a health
 * strip is to send a one-token completion to every provider every minute. It measures real
 * end-to-end latency, it lights every dot green, and it bills a workspace forever for the
 * privilege of decorating a status bar. That is option **2-B** and decision **M8** refuses
 * it. **No completion request is issued anywhere in this module** — there is no path from
 * here to one, the request builder in `probe.client.ts` is `GET`-only and body-less, and
 * `probe.client.spec.ts` asserts it against every entry below rather than against a
 * representative one.
 *
 * ---------------------------------------------------------------------------
 * **What each kind gets, and why.**
 *
 * | Kind | Check | Costs | Yields |
 * |---|---|---|---|
 * | `ollama` | `GET /api/tags` | nothing | reachable, and the daemon's model count |
 * | `openai_compatible` | `GET /v1/models` | nothing | reachable, and the served models |
 * | `anthropic` | `GET /v1/models?limit=1` | nothing | *is this credential still good*, and a measured latency |
 * | `copilot` | — | — | `unknown`, until traffic exists |
 * | `cursor` | — | — | `unknown`, until traffic exists |
 * | `custom` | — | — | `unknown`, always |
 *
 * The first two are free because they are somebody's own machine. The third is free because
 * listing models is not a metered operation, and it answers a question worth asking on its
 * own terms: a rotated or revoked key is the single most common way a cloud provider stops
 * working, and it is the one failure a request that sends no tokens can still see.
 *
 * **Copilot and Cursor have nothing that is both cheap and meaningful**, and inventing
 * something would mean sending traffic to find out whether traffic works. They stay at
 * whatever their row says — `unknown` out of V015's default — until AB.2
 * ([#208](https://github.com/NobuData/ouroboros/issues/208)) derives their state from real
 * invocations. An `unknown` chip that looks deliberate beats a green one that is guessing.
 *
 * **`custom` is `null` for a different reason and permanently.** It means an endpoint this
 * product has no adapter opinion about, so there is no path this service could know is
 * cheap — a `GET /v1/models` against somebody's gateway might be free, might be a `404`, and
 * might be the expensive one. Guessing on a stranger's endpoint is the worst version of the
 * mistake this file exists to avoid.
 */

import type { ProviderConnectionKind } from "../db/schema";

/**
 * Which question a check answers — stored as `health.check`, and the reason the strip can
 * say `key valid` and `reachable` without those being the same word.
 *
 * The distinction is load-bearing for honesty rather than decorative. *Reachable* is a
 * statement about a socket and says nothing about a credential; *the key is valid* is a
 * statement about a credential and says almost nothing about whether a completion would
 * succeed. A strip that rendered both as a green dot with no way to tell them apart would be
 * making the stronger claim on the weaker evidence.
 */
export type ProviderCheckKind = "reachability" | "key_validation";

/**
 * How often a check of this class runs.
 *
 * Two classes rather than a number per kind, because the difference that matters is *whose
 * machine answers*. A local daemon is on the operator's own network and can be asked every
 * minute without anybody minding. A vendor's key-validation endpoint is somebody else's
 * rate-limited service being asked by every self-hosted Ouroboros in the world, so it is
 * asked on a slow cadence and a jittered one — see `cadence.ts`.
 */
export type CadenceClass = "local" | "cloud";

/** The version header every Anthropic API request carries. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** Where Anthropic is, for a connection that names no address of its own. */
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * One provider kind's check, as a description rather than as code.
 *
 * Data rather than a method per kind so that the two rules this module is judged on — *no
 * completions* and *no latency without a measurement* — can be asserted against the whole
 * table at once. A method per kind would have to be audited one at a time, which is the
 * shape of a rule that eventually grows an exception nobody notices.
 */
export interface ProviderCheck {
  /** Which question it answers. Written to `health.check` so a reader can tell them apart. */
  readonly check: ProviderCheckKind;
  /**
   * The path appended to the connection's address, leading slash included.
   *
   * Always a listing route, and that is the invariant rather than a coincidence: a listing is
   * the one thing every one of these vendors serves for free.
   */
  readonly path: string;
  /** Whose cadence it runs on — see {@link CadenceClass}. */
  readonly cadence: CadenceClass;
  /**
   * The response field whose array length is the model count, or `null` when this check does
   * not report one.
   *
   * `models` for Ollama's `/api/tags`, `data` for the OpenAI-compatible `/v1/models`. Null
   * for Anthropic: the mockup's chip for a cloud provider reads `42ms`, and *how many models
   * Anthropic publishes* is a fact about Anthropic rather than about this workspace's
   * connection to it. It is also what lets the key-validation probe throw the body away
   * unread, which returns its socket to the pool immediately.
   */
  readonly inventory: string | null;
  /**
   * Whether the measured round trip is worth *storing*, or only worth having measured.
   *
   * `probe.client.ts` times every check — it is free — and this decides which of those
   * numbers reaches the row. It is `true` for the key validation and `false` for the two
   * reachability checks, which is the split the ticket's own table draws: Ollama yields
   * *reachable and a model count*, Anthropic yields *valid and a measured latency*.
   *
   * The reason is that a chip's number should be able to change for a reason. A local
   * daemon's round trip is dominated by a loopback interface and reads `0ms` or `1ms`
   * forever, and a strip that prints an unvarying number beside a real one teaches its reader
   * to ignore both. Real per-hop latency for every provider is AB.2's
   * ([#208](https://github.com/NobuData/ouroboros/issues/208)) — measured from traffic that
   * actually did something, which is the only place it means anything.
   *
   * It is deliberately *not* a rule about honesty: nothing here fabricates a latency, and the
   * one this suppresses is one that was genuinely measured. It is a rule about what is worth
   * publishing.
   */
  readonly reportsLatency: boolean;
  /**
   * The address to use when the row carries none, or `null` when a row without one cannot be
   * checked at all.
   *
   * V015 requires a `base_url` for exactly `ollama` and `openai_compatible` — they have no
   * public endpoint to fall back on — so those two are `null` here and the requirement is the
   * column's rather than this file's. Anthropic has a well-known address and a row may still
   * override it, for a proxy or a regional endpoint.
   */
  readonly defaultBaseUrl: string | null;
  /**
   * The headers that authenticate a key-validation check, given the opened credential.
   *
   * A function rather than a header template with a placeholder in it, so the plaintext is a
   * parameter that exists for the length of one call rather than a value spliced into a
   * string that something might later log. `null` for a reachability check, which carries no
   * credential and must not learn to: a local daemon needs none, and a check that could
   * attach one would be a check that could send one to the wrong address.
   */
  readonly authorize: ((apiKey: string) => Record<string, string>) | null;
}

/**
 * Every provider kind, and the check it gets.
 *
 * A total `Record` rather than a partial one: a seventh kind added to
 * {@link ProviderConnectionKind} by a later migration will not compile until somebody has
 * decided what this service may ask it, which is the decision that should not be made by
 * default. `null` is that decision, made explicitly, three times.
 */
export const PROVIDER_CHECKS: Readonly<Record<ProviderConnectionKind, ProviderCheck | null>> =
  Object.freeze({
    // The daemon's own tag listing. Free, local, and the only check here that yields the
    // mockup's `workstation · 3 models` — the count is the response, not a second call.
    ollama: {
      check: "reachability",
      path: "/api/tags",
      cadence: "local",
      inventory: "models",
      reportsLatency: false,
      defaultBaseUrl: null,
      authorize: null,
    },
    // vLLM, llama.cpp, LM Studio, or anything else fronting the OpenAI shape. Unauthenticated
    // in the deployments this kind exists for — the operator's own GPU — and a server that
    // does want a key answers `401`, which is a state this module renders rather than hides.
    openai_compatible: {
      check: "reachability",
      path: "/v1/models",
      cadence: "local",
      inventory: "data",
      reportsLatency: false,
      defaultBaseUrl: null,
      authorize: null,
    },
    // `limit=1` because nothing here reads the body: the question is whether the credential
    // is honoured, and asking for one row is the smallest way to ask it.
    anthropic: {
      check: "key_validation",
      path: "/v1/models?limit=1",
      cadence: "cloud",
      inventory: null,
      reportsLatency: true,
      defaultBaseUrl: ANTHROPIC_DEFAULT_BASE_URL,
      authorize: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }),
    },
    // Nothing cheap and meaningful exists for either. See this file's header, and AB.2 (#208).
    copilot: null,
    cursor: null,
    custom: null,
  });

/**
 * The check for one kind, if this service has one for it.
 *
 * @param kind - The connection's kind, as V015 stores it.
 * @returns The check, or `null` when there is nothing cheap and truthful to ask. `null` is an
 *   answer rather than a gap: a caller receiving it leaves the row exactly as it found it,
 *   which is what makes `unknown` a state this service respects instead of one it overwrites.
 */
export function checkFor(kind: ProviderConnectionKind): ProviderCheck | null {
  return PROVIDER_CHECKS[kind];
}

/**
 * Where to send this kind's check, given whatever address the row carries.
 *
 * @param check - The kind's check.
 * @param baseUrl - The connection's `base_url`, or null.
 * @returns The absolute URL to `GET`, or `undefined` when the row names no address and the
 *   kind has no default — a connection nothing can reach, which is a row mockup 07 has not
 *   finished rather than a provider that is down.
 */
export function checkUrl(check: ProviderCheck, baseUrl: string | null): string | undefined {
  const base = baseUrl ?? check.defaultBaseUrl;

  if (base === null) {
    return undefined;
  }

  // Trailing slashes are stripped rather than tolerated: `http://host:11434/` joined to
  // `/api/tags` by concatenation gives a double slash, which Ollama answers and a stricter
  // server does not. The path always begins with one, so this is the only place the two
  // halves can disagree.
  return `${base.replace(/\/+$/, "")}${check.path}`;
}

/**
 * The kinds whose check runs on one cadence class.
 *
 * Derived from {@link PROVIDER_CHECKS} rather than written out a second time, so moving a
 * kind between cadences is one edit in the table above and the sweep's query follows. Kinds
 * with no check appear in neither list, which is what keeps them out of the sweep's read
 * entirely — an unqueried row cannot be accidentally overwritten with a state nobody observed.
 *
 * @param cadence - The class.
 * @returns The kinds, in the order the table declares them.
 */
export function kindsOnCadence(cadence: CadenceClass): ProviderConnectionKind[] {
  return Object.entries(PROVIDER_CHECKS)
    .filter(([, check]) => check !== null && check.cadence === cadence)
    .map(([kind]) => kind as ProviderConnectionKind);
}
