/**
 * The Ollama adapter — the zero-cost lane, and the only provider whose card can *change what
 * models exist*.
 *
 * AC.4 ([#219](https://github.com/NobuData/ouroboros/issues/219)), on AC.1's interface
 * ([#216](https://github.com/NobuData/ouroboros/issues/216)) and AC.3's address policy
 * ([#218](https://github.com/NobuData/ouroboros/issues/218)). It is mockup 07's `OL` card —
 * *Ollama · workstation*, *zero-cost lane — used for docs & commit messages* — as code:
 *
 * ```
 * configSchema   ─▶ { baseUrl, capabilityNote? }            a Host, and no credential at all
 * validate       ─▶ GET  {host}/api/version ─▶ 200 ───────▶ the card foot's  ✓ 200 · 4ms
 *                                           └▶ ECONNREFUSED ▶ network · ken-station.local:11434
 *                                                             unreachable (ECONNREFUSED)
 * discoverModels ─▶ GET  {host}/api/tags ─────────────────▶ qwen3-coder:32b · 19 GB
 *                                                           llama4:scout    · 63 GB
 *                                                           phi4:14b        · 9.1 GB
 * pullModel      ─▶ POST {host}/api/pull  (NDJSON stream) ─▶ pulling manifest → downloading
 *                                                           → verifying → success
 * ```
 *
 * ---------------------------------------------------------------------------
 * **No credential, and the schema says so rather than leaving a field blank.**
 *
 * A local Ollama daemon needs none: it listens on the operator's own machine and authenticates
 * nobody. So there is no `x-ouroboros-secret` field anywhere in {@link OLLAMA_CONFIG_SCHEMA},
 * mockup 07's card draws no key row, and {@link ProviderConnectionContext.secret} arrives
 * `null` on every call this file makes. That is also why AC.4 needs no AD.1
 * ([#222](https://github.com/NobuData/ouroboros/issues/222)) — there is nothing to seal.
 *
 * The adapter still classifies `401` and `429`, because a daemon put behind a reverse proxy is
 * an ordinary deployment and the proxy is what answers those. See
 * `ollama.recordings.fixture.ts`, which records exactly that shape.
 *
 * ---------------------------------------------------------------------------
 * **The same SSRF policy as AC.3, shared rather than copied.**
 *
 * This is the second adapter that takes an address a person typed and then fetches it from
 * inside the control plane. `provider.address.ts` is where the four rules live and
 * `docs/SECURITY_MODEL.md` §6.1 is the same decision written for a reader who is auditing:
 * a scheme allow-list, no redirect following, a response size cap, and no userinfo — with
 * private and loopback ranges **deliberately allowed**, because `http://localhost:11434` is
 * the use case rather than the attack. {@link daemonEndpoint} is the only place a URL is
 * built here, and {@link requestInit} is the only place a request is configured, so there is
 * no path from a stored setting to a socket that skips the policy.
 *
 * ---------------------------------------------------------------------------
 * **Why the pull is a stream and why it must be consumed by the server.**
 *
 * A pull of `llama4:scout` moves 63 GB and takes minutes. The person who started it will
 * navigate away, reload the page, and come back expecting to see where it got to — so the
 * progress cannot live in the browser. This file's job is the *provider* half: turn Ollama's
 * NDJSON into {@link ModelPullProgress} events. `provider.pulls.ts` is the other half — it
 * consumes those events on the server, writes them to a tracked record, and answers *where
 * did it get to* to whatever asks next. Neither half is useful alone, which is why AC.4 ships
 * both.
 *
 * **The deadline is a stall deadline, not a total one.** Every other call in this module
 * carries `AbortSignal.timeout(10_000)`, which is right for a question somebody is watching a
 * spinner for and catastrophic for a transfer that is *supposed* to take twenty minutes. So a
 * pull is bounded by how long it may go **without saying anything** —
 * {@link OLLAMA_PULL_STALL_MS} — measured per read. A daemon that is transferring is a daemon
 * that is talking; one that has stopped talking is one whose socket is worth closing.
 *
 * ---------------------------------------------------------------------------
 * **What is echoed from a response body, and what is not.**
 *
 * Model ids and sizes are, because that is what discovery *is* — a body parsed into a known
 * shape, exactly as AC.3's listing is. {@link ModelPullProgress.status} is, because the SPI
 * names it *"what is happening, in the provider's words"* and the pull row's label has nowhere
 * else to come from; it is capped at {@link OLLAMA_STATUS_MAX_LENGTH} and stripped of control
 * characters on the way through.
 *
 * A **`detail` is not**, ever. `provider.errors.ts` is unambiguous that a card foot never
 * carries a provider's error body, and a `detail` is rendered beside every other provider's on
 * the same page — so a `/api/pull` stream that reports `{"error": …}` becomes *the host
 * reported the pull failed* rather than whatever arrived. The address this adapter fetches is
 * one a person typed, and a `detail` that quoted what came back would turn a reachability
 * probe into a way of reading a slice of any URL the control plane can reach.
 *
 * ---------------------------------------------------------------------------
 * **No tier, no context length, and both are decision P8 rather than omissions.** `/api/tags`
 * publishes neither — a context window is `/api/show`'s, and Ollama has no notion of a service
 * tier at all — so both are `null` on every model this adapter reports. What it *does* publish
 * is a size, which is the one field no cloud adapter can fill in and the one mockup 07's
 * pull-list draws as `19 GB`.
 *
 * **A plain `fetch`, for `anthropic.adapter.ts`'s reason.** Node 24's global `fetch` is undici,
 * this adapter sends no completions, and the `ollama` npm package would buy nothing but a
 * dependency. `.dependency-cruiser.cjs` permits that import here and nowhere else, for the day
 * one is genuinely needed.
 */

import { Injectable } from "@nestjs/common";

import {
  MODEL_ALIAS_TEMPERATURE_MAX,
  MODEL_ALIAS_TEMPERATURE_MIN,
  MODEL_ALIAS_TOKENS_MIN,
} from "../../db/schema";
import type {
  ModelPullProgress,
  NormalizedModel,
  ProviderCapabilities,
  ProviderConnectionContext,
  ProviderValidation,
  PullCapableAdapter,
} from "../provider.adapter";
import {
  PROVIDER_MAX_RESPONSE_BYTES,
  PROVIDER_REDIRECT,
  describeRefusal,
  describeUnreachable,
  discardBody,
  readCappedBody,
  resolveProviderAddress,
} from "../provider.address";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  PLACEHOLDER_ANNOTATION,
  PROVIDER_CONFIG_DIALECT,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
} from "../provider.config";
import { ProviderAdapterError, classifyHttpStatus } from "../provider.errors";
import { MODEL_PARAM_DIALECT, copyParamSchema, type ModelParamSchema } from "../provider.params";

/** What the address row's `<label>` says — mockup 07's **Host**, not *Base URL*. */
export const OLLAMA_HOST_TITLE = "Host";

/**
 * How long the two question-shaped calls wait before they are a timeout.
 *
 * Ten seconds, the same as the other two HTTP adapters and for the same reason: both are
 * user-initiated — somebody pressed **Test connection** or **Refresh models** and is watching a
 * spinner — so the health sweep's five (`provider-health/cadence.ts`) would be this service's
 * impatience rendered as a daemon's fault. A pull does **not** use this; see
 * {@link OLLAMA_PULL_STALL_MS}.
 */
export const OLLAMA_TIMEOUT_MS = 10_000;

/**
 * How long a pull may go without saying anything before its socket is closed.
 *
 * A minute. This is a *stall* deadline rather than a total one — see this file's header for
 * why a total deadline is the wrong instrument for a transfer that is supposed to take twenty
 * minutes. A minute rather than ten seconds because Ollama really is quiet for a while between
 * `pulling manifest` and the first byte of a layer, and because a daemon verifying a 63 GB
 * digest emits nothing while it does so.
 */
export const OLLAMA_PULL_STALL_MS = 60_000;

/**
 * The path segment an Ollama API root ends with.
 *
 * See {@link daemonUrl} for why this file looks for it rather than assuming a bare host.
 */
export const OLLAMA_API_SEGMENT = "/api";

/** The version ping — what **Test connection** asks. */
export const OLLAMA_VERSION_PATH = "/api/version";

/** The model listing — names and, uniquely among the adapters, real on-disk sizes. */
export const OLLAMA_TAGS_PATH = "/api/tags";

/** The pull route. Answers NDJSON, one progress object per line. */
export const OLLAMA_PULL_PATH = "/api/pull";

/**
 * The `status` Ollama's last line carries when a pull finished.
 *
 * The stream's *only* statement of completion. An iterator that simply ran out is what a pull
 * looks like when the daemon died half way through, which is precisely the case
 * {@link ModelPullProgress.done} exists to let a consumer tell apart — so this word, and
 * nothing else, sets it.
 */
export const OLLAMA_PULL_SUCCESS_STATUS = "success";

/**
 * The most of a progress `status` that is carried through.
 *
 * Ollama's transfer lines read `pulling 4d2b0e0f8a1c…`, a status followed by a 64-character
 * digest, and a card's pull row has one line to draw it on. The cap is a rendering bound rather
 * than a security one — but it is also what stops a body from putting an arbitrary quantity of
 * text into a field that reaches a page.
 */
export const OLLAMA_STATUS_MAX_LENGTH = 120;

/**
 * The most one line of a pull stream may be, in decoded characters.
 *
 * A pull stream is unbounded by design — a long transfer is thousands of progress lines — so
 * {@link PROVIDER_MAX_RESPONSE_BYTES} cannot be applied to the whole of it the way it is to a
 * listing. What *can* be bounded is one line, and that is what the reader needs: a stranger's
 * endpoint answering `200` to a `POST /api/pull` with a single endless line of text would
 * otherwise grow the buffer until the process died. 65 536 is three orders of magnitude past
 * the longest line Ollama sends, which is a status and a 64-character digest.
 *
 * **Characters rather than bytes**, because it is applied to the decoded string and that is
 * where the memory actually is. It is deliberately checked *per line* rather than against the
 * whole buffer: a fast local transfer really does deliver several hundred progress lines in one
 * read, and a whole-buffer cap would refuse a daemon that is working perfectly.
 */
export const OLLAMA_PULL_MAX_LINE_CHARS = 65_536;

/**
 * The add-form for mockup 07's Ollama card: a Host, and the card's second line.
 *
 * A module constant rather than a literal inside `configSchema()` so it can be asserted against
 * `card.shapes.fixture.ts` directly. {@link OllamaAdapter.configSchema} still hands out a
 * **copy** — the caller is AE.5, holding the value while somebody fills in a form, and an
 * adapter handing out its own object would have that form's edits land here.
 *
 * The field is `baseUrl` and its title is *Host*, which is the whole of `provider.config.ts`'s
 * reserved-name argument in one place: the vLLM card and this one collect the same column, and
 * only the label differs. A card that had to know which vendor it was rendering in order to
 * find the address is exactly the `switch (kind)` decision **P1** refuses.
 */
const OLLAMA_CONFIG_SCHEMA: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect an Ollama host",
  properties: {
    [BASE_URL_FIELD]: {
      type: "string",
      title: OLLAMA_HOST_TITLE,
      description: "Where the daemon is listening. No credential — it is your own machine.",
      // Drives the `url` widget and the browser's own validation, and nothing else. The address
      // policy is server-side, in `provider.address.ts`, where a form annotation cannot be
      // edited around.
      format: "uri",
      minLength: 1,
      [PLACEHOLDER_ANNOTATION]: "http://ken-station.local:11434",
    },
    [CAPABILITY_NOTE_FIELD]: {
      type: "string",
      title: "Capability note",
      description: "The card's second line — what this host is for, in your own words.",
      maxLength: CAPABILITY_NOTE_MAX_LENGTH,
      [PLACEHOLDER_ANNOTATION]: "zero-cost lane — used for docs & commit messages",
    },
  },
  required: [BASE_URL_FIELD],
  additionalProperties: false,
};

/**
 * Where one of the daemon's routes lives, given an address that has already passed the policy.
 *
 * **A bare host is the spelling this field expects**, and it is the one Ollama itself uses:
 * `OLLAMA_HOST` is `http://127.0.0.1:11434` with no path, and mockup 07's placeholder is
 * `http://ken-station.local:11434`. But an operator who pasted the API root they saw in a
 * README would otherwise be sent to `/api/api/tags` and told their daemon answered `404`, so a
 * trailing `/api` is taken off rather than doubled — the same courtesy AC.3's `listingUrl`
 * extends to a base URL that already ends in `/v1`.
 *
 * A path that is *not* `/api` is left alone, because that is how a daemon behind a reverse
 * proxy is reached: `https://gpu.internal/ollama` + `/api/tags` is the correct join, and
 * "correcting" it would break the deployment this adapter's whole address policy exists to
 * support.
 *
 * @param root - `ProviderAddress.root` — the validated address with trailing slashes, query and
 *   fragment already taken off.
 * @param path - One of {@link OLLAMA_VERSION_PATH}, {@link OLLAMA_TAGS_PATH},
 *   {@link OLLAMA_PULL_PATH}. Each begins with {@link OLLAMA_API_SEGMENT}.
 * @returns The absolute URL to request.
 */
export function daemonUrl(root: string, path: string): string {
  return root.endsWith(OLLAMA_API_SEGMENT)
    ? `${root.slice(0, -OLLAMA_API_SEGMENT.length)}${path}`
    : `${root}${path}`;
}

/**
 * The fields the schema requires that nothing has supplied.
 *
 * Derived from the schema rather than written out, which is the habit `docs/MODEL_PROVIDERS.md`
 * asks an author to copy — **check the configuration before opening a socket**, because a
 * connection with no address is not a daemon being down, and reporting it as `network` sends
 * somebody to check a firewall.
 *
 * There is no `x-ouroboros-secret` branch here, unlike AC.3's, because this schema declares no
 * credential field at all — see this file's header. A `secret` parameter would therefore be one
 * nothing could read.
 *
 * @param config - The settings.
 * @returns The **titles** of the missing fields, because the sentence is printed on a card foot
 *   — `baseUrl required` is a field name leaking into a page.
 */
export function missingConfiguration(config: ProviderConnectionConfig): string[] {
  return OLLAMA_CONFIG_SCHEMA.required
    .filter((name) => (config[name] ?? "").length === 0)
    .map((name) => OLLAMA_CONFIG_SCHEMA.properties[name].title);
}

/**
 * A daemon this connection may be asked something, or the reason it may not.
 *
 * All three calls begin here, so there is exactly one path from a stored configuration to a URL
 * and it is the one that runs the address policy. A second `fetch` built from
 * `config[BASE_URL_FIELD]` directly would be the whole of the SSRF policy, quietly skipped.
 */
export type DaemonEndpoint =
  | {
      readonly ok: true;
      /**
       * The validated address root, for {@link daemonUrl} to hang a path on.
       */
      readonly root: string;
      /**
       * The address's `host:port`, for the sentence an unreachable daemon renders as.
       *
       * Safe to print: it is the operator's own address, already visible in the field it came
       * from, and it carries no credential because `resolveProviderAddress` refuses userinfo.
       */
      readonly host: string;
    }
  | {
      readonly ok: false;
      /** Why not — a `config` failure's `detail`, in all three callers. */
      readonly detail: string;
    };

/**
 * Turn a connection's settings into a daemon address, or into the reason there is none.
 *
 * @param config - The connection's settings.
 * @returns The endpoint, or a `config` failure's detail.
 */
export function daemonEndpoint(config: ProviderConnectionConfig): DaemonEndpoint {
  const missing = missingConfiguration(config);

  if (missing.length > 0) {
    return { ok: false, detail: `${missing.join(", ")} required` };
  }

  const address = resolveProviderAddress(config[BASE_URL_FIELD]);

  if (!address.ok) {
    // A `config` failure rather than a `network` one, and found before any socket exists: an
    // address with the wrong scheme is a field somebody can correct, and no retry fixes it.
    return { ok: false, detail: address.violation };
  }

  return { ok: true, root: address.root, host: address.url.host };
}

/**
 * How every request this adapter makes is configured.
 *
 * One function, so the three calls cannot come to disagree about {@link PROVIDER_REDIRECT}. A
 * `fetch` here that forgot it would follow a redirect out of the address the policy checked,
 * which is the whole of rule 2 undone in one omitted property.
 *
 * @param signal - What aborts the call. `AbortSignal.timeout(…)` for the two question-shaped
 *   calls; a controller's signal for a pull, which is bounded by silence rather than by total
 *   elapsed time.
 * @param body - The request body, for the one call that has one. Its presence is what turns
 *   this into a `POST` — stated as a branch rather than as a parameter, so *this adapter sends
 *   exactly one kind of write* is a property of the code.
 * @returns The init.
 */
function requestInit(signal: AbortSignal, body: string | null = null): RequestInit {
  return body === null
    ? {
        // Stated rather than defaulted. The default *is* GET, and writing it here is what puts
        // "these two calls cannot change anything" on the one line that could ever break it.
        method: "GET",
        headers: { accept: "application/json" },
        redirect: PROVIDER_REDIRECT,
        signal,
      }
    : {
        method: "POST",
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        body,
        redirect: PROVIDER_REDIRECT,
        signal,
      };
}

/**
 * How a daemon that never answered reads on the card foot.
 *
 * `provider.address.ts`'s {@link describeUnreachable} with this adapter's deadline in it — the
 * host echoed, the runtime's own message not, which is what AC.4's *a stopped Ollama produces
 * the designed network state* criterion actually asks for.
 *
 * @param host - The address's `host:port`.
 * @param error - Whatever was caught.
 * @returns The phrase — `ken-station.local:11434 unreachable (ECONNREFUSED)`.
 */
function unreachable(host: string, error: unknown): string {
  return describeUnreachable(host, error, OLLAMA_TIMEOUT_MS);
}

/**
 * How a pull that went quiet reads.
 *
 * Distinct from {@link describeUnreachable}'s timeout phrase on purpose: *timed out after
 * 10000 ms* would be false about a transfer that had been running for eighteen minutes and
 * misleading about what to change. What happened is that the daemon stopped reporting.
 *
 * @param host - The address's `host:port`.
 * @param stallMs - The silence that was tolerated.
 * @returns The phrase.
 */
export function describeStalled(host: string, stallMs: number): string {
  return `${host} stopped reporting progress after ${stallMs.toString()} ms`;
}

/**
 * A number a daemon published, or null.
 *
 * @param value - Whatever was at the field.
 * @returns The number when it is a whole one of at least `floor`, null otherwise. `null` means
 *   *the daemon did not say*, and the floor is what keeps a fabricated zero or a fraction from
 *   reaching a card as a confident-looking measurement.
 * @param floor - The smallest meaningful value.
 */
function wholeNumber(value: unknown, floor: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= floor ? value : null;
}

/**
 * One progress `status`, bounded and made safe to render.
 *
 * @param value - Whatever was at the field.
 * @returns The status, trimmed, stripped of control characters and cut to
 *   {@link OLLAMA_STATUS_MAX_LENGTH}; the empty string when there is nothing usable. Control
 *   characters are taken out rather than escaped because the destination is a text node in a
 *   card, and a carriage return in a progress label is a row that redraws itself wrong.
 */
export function sanitizeStatus(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replaceAll(CONTROL_CHARACTERS, " ").trim().slice(0, OLLAMA_STATUS_MAX_LENGTH);
}

/**
 * Everything below U+0020, plus the delete character.
 *
 * A module constant rather than a literal inside {@link sanitizeStatus}: written with escapes
 * it is a regular expression a reader has to decode, and named it is one they can skip.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * One entry of `/api/tags`, in this product's vocabulary.
 *
 * @param entry - The entry, `unknown` because a provider is not a source of types: a null in
 *   the array, an entry with no `name`, or a `size` that is a string are all cases this has to
 *   survive rather than cases that cannot happen.
 * @returns The model, or null when the entry carried no usable name — a pull row with no id is
 *   one nothing can alias, price or pull.
 */
export function normalizeModel(entry: unknown): NormalizedModel | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  // `name` is what `ollama list` prints and what `/api/pull` takes back; `model` is the same
  // string under a newer key, read as a fallback so a future daemon that drops the older one
  // still lists. Only surrounding whitespace is taken off, which is the question *is there a
  // name here at all* rather than a normalization.
  const named = typeof record.name === "string" ? record.name : record.model;
  const id = typeof named === "string" ? named.trim() : "";

  if (id.length === 0) {
    return null;
  }

  return {
    // The daemon's own spelling, tag included — `qwen3-coder:32b`. It is what `/api/pull` has to
    // be sent back, and `model_aliases.model` and `model_prices.match_model` are written against
    // these strings.
    id,
    // The mockup's pull-list prints the bare tag in mono, so there is nothing to add. Unlike
    // AC.3's `local/` prefix, which distinguishes one operator's endpoint from a cloud model in
    // a mixed registry, an Ollama tag is already unmistakable — the `:32b` says what it is.
    display: id,
    // `/api/tags` publishes no context window; `/api/show` does, one request per model. Decision
    // P8: report what was said, or say nothing. See this file's header.
    contextLength: null,
    // Ollama has no notion of a service tier, so there is no signal to report — and a plausible
    // word invented here would make Anthropic's earned pill unreadable too.
    tier: null,
    // The one field no cloud adapter can fill in, and mockup 07's `19 GB` tag. Bytes, because a
    // number is a fact and `19 GB` is a rendering decision that belongs to AE.4. A floor of one
    // rather than zero: V017's `provider_models_size_bytes_positive` refuses a zero, and a
    // zero-byte model would render as a tag claiming a model that takes no space.
    sizeBytes: wholeNumber(record.size, 1),
  };
}

/**
 * One line of a pull stream, in this product's vocabulary.
 *
 * @param chunk - The parsed line.
 * @returns The event, or null for a line that says nothing this product renders — which is
 *   dropped rather than reported, for the reason an unusable listing entry is: one line a
 *   future daemon added is not a reason to fail a transfer that is working.
 */
export function normalizeProgress(chunk: unknown): ModelPullProgress | null {
  if (typeof chunk !== "object" || chunk === null) {
    return null;
  }

  const record = chunk as Record<string, unknown>;
  const status = sanitizeStatus(record.status);

  if (status.length === 0) {
    return null;
  }

  const totalBytes = wholeNumber(record.total, 0);
  const completed = wholeNumber(record.completed, 0);

  return {
    status,
    // Clamped to the total, because a progress bar cannot go past its own end and the
    // conformance kit refuses the shape outright. A daemon reporting more transferred than
    // there is to transfer is reporting one of the two numbers wrong, and the total is the one
    // the row is already displaying as its size tag.
    completedBytes:
      completed !== null && totalBytes !== null ? Math.min(completed, totalBytes) : completed,
    totalBytes,
    // The stream's own statement of completion, and the only one. See
    // {@link OLLAMA_PULL_SUCCESS_STATUS}.
    done: status === OLLAMA_PULL_SUCCESS_STATUS,
  };
}

/**
 * Race one read against a deadline.
 *
 * The stall deadline's mechanism, in one place so the pull loop reads as a loop. The timer is
 * always cleared — a pull that finishes in ten minutes must not leave six hundred pending
 * timers behind it.
 *
 * @param work - The read.
 * @param stallMs - How long it may take.
 * @returns What the read answered.
 * @throws {StalledError} When the deadline passed first. A private class rather than a
 *   {@link ProviderAdapterError} so the caller — which knows the host — writes the sentence.
 */
async function within<T>(work: Promise<T>, stallMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new StalledError());
        }, stallMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A read that took longer than the stall deadline. Never leaves this module. */
class StalledError extends Error {}

/** How a pull stream may be read. A parameter object so a test can shorten the deadline. */
export interface PullStreamOptions {
  /** How long the stream may go without producing a byte. Defaults to {@link OLLAMA_PULL_STALL_MS}. */
  readonly stallMs?: number;
  /** The `host:port` an error names. */
  readonly host: string;
}

/**
 * Ollama's NDJSON pull stream, as progress events.
 *
 * Exported so it can be exercised directly with a short deadline — a suite that had to wait a
 * real minute to see the stall path is a suite nobody runs. {@link OllamaAdapter.pullModel} is
 * its only other caller.
 *
 * The reader is driven rather than `response.text()`-ed for the reason `readCappedBody` is: the
 * point of a stream is that it is consumed as it arrives, and a pull that buffered to the end
 * before reporting anything would be a progress bar that jumps from nothing to done.
 *
 * @param response - The `200`. Its body is consumed here, and cancelled if the consumer stops
 *   early — which is how a caller aborts a pull: it stops iterating.
 * @param options - The deadline and the host.
 * @returns The events, in order, ending with the one whose `done` is `true`.
 * @throws {ProviderAdapterError} `upstream` when the daemon reported a failure, sent something
 *   that is not NDJSON, sent a line past {@link OLLAMA_PULL_MAX_LINE_CHARS}, or ended without
 *   saying the pull succeeded; `network` when it went quiet for longer than the deadline.
 */
export async function* readPullStream(
  response: Response,
  options: PullStreamOptions,
): AsyncGenerator<ModelPullProgress> {
  const body = response.body;

  if (body === null) {
    throw new ProviderAdapterError("upstream", "the host sent no pull stream");
  }

  const stallMs = options.stallMs ?? OLLAMA_PULL_STALL_MS;
  // Typed explicitly: `Response.body` is a `ReadableStream<any>` in this runtime's types, and an
  // untyped chunk would make every member access below unchecked.
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    for (;;) {
      // Named through the reader rather than as `ReadableStreamReadResult`, which this runtime's
      // types do not publish as a global.
      let read: Awaited<ReturnType<typeof reader.read>>;

      try {
        read = await within(reader.read(), stallMs);
      } catch (error) {
        if (error instanceof StalledError) {
          throw new ProviderAdapterError("network", describeStalled(options.host, stallMs));
        }

        throw new ProviderAdapterError("network", unreachable(options.host, error));
      }

      if (read.done) {
        break;
      }

      // `stream: true` because a multi-byte character can straddle two chunks, and decoding each
      // chunk independently would replace it with U+FFFD in the middle of a status.
      buffer += decoder.decode(read.value, { stream: true });

      const lines = buffer.split("\n");
      // Whatever follows the last newline is an incomplete line — Ollama's writes are not
      // aligned to its lines, and a progress object arriving in two TCP segments is the ordinary
      // case rather than an edge one.
      buffer = lines.pop() ?? "";

      // The tail has no newline yet, so it is a line still arriving. Complete lines are bounded
      // inside `progressFrom`; this is the case that never terminates — an endpoint sending an
      // endless line with no delimiter in it at all.
      if (buffer.length > OLLAMA_PULL_MAX_LINE_CHARS) {
        throw overlongLine();
      }

      for (const line of lines) {
        const event = progressFrom(line);

        if (event === null) {
          continue;
        }

        yield event;

        if (event.done) {
          finished = true;

          return;
        }
      }
    }

    // A daemon that closed the stream without a trailing newline. Rare, and cheap to survive.
    const last = progressFrom(buffer + decoder.decode());

    if (last !== null) {
      yield last;
      finished = last.done;
    }
  } finally {
    // Reached on the ordinary path, on a thrown failure, and — the one that matters — when the
    // consumer stops iterating. That last case is how `provider.pulls.ts` cancels a pull at
    // shutdown: breaking out of a `for await` runs this, which closes the socket instead of
    // leaving a 63 GB transfer running with nobody reading it.
    await reader.cancel().catch(() => {
      // The stream is already gone, which is the outcome this was asking for.
    });
  }

  if (!finished) {
    // Completion is a statement the stream makes, not something inferred from an iterator
    // finishing — see `ModelPullProgress.done`. A stream that just stops is what a pull looks
    // like when the daemon is restarted half way through, and a consumer that could not tell
    // that from a success would report a model as present that is not.
    throw new ProviderAdapterError("upstream", "the pull ended before the host reported success");
  }
}

/**
 * One line of NDJSON, as an event.
 *
 * @param line - The line, possibly blank — Ollama's stream ends with one, and a blank line is
 *   not a malformed object.
 * @returns The event, or null for a line with nothing in it and nothing to render.
 * @throws {ProviderAdapterError} `upstream` when the line is not JSON, or is a JSON object
 *   carrying an `error`. See this file's header on why the daemon's own words do not come with
 *   it.
 */
function progressFrom(line: string): ModelPullProgress | null {
  if (line.trim().length === 0) {
    return null;
  }

  if (line.length > OLLAMA_PULL_MAX_LINE_CHARS) {
    // Checked here as well as on the buffer, because a single read can carry a complete
    // over-long line — one that arrives newline and all — and splitting first would hand it
    // straight to `JSON.parse`.
    throw overlongLine();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    // The commonest real cause is an address pointing at a web server rather than a daemon,
    // which answers `200 text/html` to anything — so the sentence says what was expected rather
    // than quoting what arrived.
    throw new ProviderAdapterError("upstream", "the pull stream was not NDJSON");
  }

  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    throw new ProviderAdapterError("upstream", "the host reported the pull failed");
  }

  return normalizeProgress(parsed);
}

/**
 * A line nobody should have to buffer.
 *
 * One function, so the two places that bound a line — a tail with no delimiter yet, and a
 * complete line that arrived in one read — cannot come to report it differently.
 *
 * @returns The error to throw.
 */
function overlongLine(): ProviderAdapterError {
  return new ProviderAdapterError(
    "upstream",
    `a pull stream line exceeded ${OLLAMA_PULL_MAX_LINE_CHARS.toString()} characters`,
  );
}

/**
 * What a model on an Ollama daemon can be tuned with — the three options that reach
 * `/api/generate`'s `options` object and mean something for every model in a library.
 *
 * `context_clamp` is Ollama's `num_ctx` and `max_output` is its `num_predict`; both are named
 * in this product's vocabulary rather than the daemon's, for the reason
 * {@link import("../provider.config").BASE_URL_FIELD} is: a form that had to know which
 * provider it was drawing in order to find the context control is the `switch (kind)` decision
 * **P1** refuses. The daemon's own spelling belongs in the invocation path (AF.2,
 * [#235](https://github.com/NobuData/ouroboros/issues/235)), where a request body is built.
 *
 * **No `thinking` field.** A local library holds reasoning and non-reasoning models side by
 * side and the tags endpoint does not say which is which, so offering the control on all of
 * them would offer it on the ones that ignore it — mockup 21's `local-docs` is
 * `qwen3-coder:32b`, and the ticket names it as the model a thinking budget must not be
 * offered for.
 *
 * **No ceiling on either token count.** A local model's context is whatever the daemon loaded
 * it with, which discovery reports into `provider_models.meta` and `registry/params.merge.ts`
 * clamps this bound to.
 */
const OLLAMA_PARAM_SCHEMA: ModelParamSchema = {
  $schema: MODEL_PARAM_DIALECT,
  type: "object",
  title: "Ollama model parameters",
  properties: {
    max_output: {
      type: "integer",
      title: "Max output",
      description: "`num_predict` — the most tokens one answer may run to.",
      minimum: MODEL_ALIAS_TOKENS_MIN,
    },
    context_clamp: {
      type: "integer",
      title: "Context clamp",
      description: "`num_ctx` — hold this model to a smaller context than it was loaded with.",
      minimum: MODEL_ALIAS_TOKENS_MIN,
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "Zero is deterministic; two is as varied as the daemon goes.",
      minimum: MODEL_ALIAS_TEMPERATURE_MIN,
      maximum: MODEL_ALIAS_TEMPERATURE_MAX,
    },
  },
  additionalProperties: false,
};

/**
 * The Ollama adapter.
 *
 * `@Injectable()` because `providers.module.ts` registers the class and Nest constructs it. It
 * takes no dependencies and holds no state — one instance serves every workspace, which is only
 * safe because nothing about a connection is remembered between calls. In particular the *pull*
 * is stateless here: what a pull's progress is remembered by is `provider.pulls.ts`, which is a
 * separate object with a separate lifetime and no idea which provider it is watching.
 */
@Injectable()
export class OllamaAdapter implements PullCapableAdapter {
  /** V015's `provider_connections.kind` for this provider, and the registry's key. */
  readonly kind = "ollama" as const;

  /**
   * The add-form: a Host, and the card's second line.
   *
   * @returns A fresh deep copy every call, so a caller holding it while somebody fills in a
   *   form cannot mutate the adapter's own value. The conformance kit tries exactly that.
   */
  configSchema(): ProviderConfigSchema {
    return JSON.parse(JSON.stringify(OLLAMA_CONFIG_SCHEMA)) as ProviderConfigSchema;
  }

  /**
   * What this adapter can do.
   *
   * The only one of the five that answers `pull: true`, and the return type says so — narrowing
   * the flag to `true` is what makes an adapter claiming {@link PullCapableAdapter} while
   * reporting `false` fail to compile.
   *
   * `discovery` is `true` and means more here than anywhere else: what models exist on this
   * host changes when somebody pulls one, which is a thing *this adapter itself* does.
   * `entitlements` is `false` because a daemon on the operator's own machine has nothing to be
   * entitled to — and `invocation` is AF.2's
   * ([#235](https://github.com/NobuData/ouroboros/issues/235)) reservation.
   *
   * @returns All four flags, freshly built and equal on every call.
   */
  capabilities(): ProviderCapabilities & { readonly pull: true } {
    return { discovery: true, pull: true, entitlements: false, invocation: false };
  }

  /**
   * What a model on this daemon can be tuned with — `num_predict`, `num_ctx` and a temperature,
   * in this product's vocabulary.
   *
   * The same three for every model in the library: what differs between them is how the daemon
   * loaded each one, which discovery reports and the merge applies. See
   * {@link OLLAMA_PARAM_SCHEMA} on why there is no thinking field — `qwen3-coder:32b` is the
   * model CH.2 names as the one that must not be offered a budget.
   *
   * @param _modelId - Unread, and named with an underscore to say so: nothing this adapter can
   *   answer offline varies by model.
   * @returns A fresh schema every call, equal on every call.
   */
  paramSchema(_modelId: string): ModelParamSchema {
    return copyParamSchema(OLLAMA_PARAM_SCHEMA);
  }

  /**
   * The **Test connection** button: is the daemon there, and how fast did it answer.
   *
   * `/api/version` rather than `/api/tags`, which is what makes mockup 07's `✓ 200 · 4ms`
   * honest: a version ping is a constant-time answer, while a listing walks a manifest
   * directory and would report a latency that grows with how many models somebody has.
   *
   * @param config - The settings, as `partitionSubmission` produced them.
   * @param _secret - Unread, and named with an underscore to say so: this schema declares no
   *   credential, so a caller has none to open and the daemon would have nowhere to put one.
   * @returns What the check found — `{status: "ok", latencyMs, detail: "200"}` for a success.
   *   **Never rejects**: a refusal, a redirect, a timeout and a closed socket are all results,
   *   because a stopped daemon is the state the card exists to draw.
   */
  async validate(
    config: ProviderConnectionConfig,
    _secret: string | null,
  ): Promise<ProviderValidation> {
    const endpoint = daemonEndpoint(config);

    if (!endpoint.ok) {
      return { status: "failed", errorClass: "config", detail: endpoint.detail };
    }

    const started = performance.now();
    let response: Response;

    try {
      response = await fetch(
        daemonUrl(endpoint.root, OLLAMA_VERSION_PATH),
        requestInit(AbortSignal.timeout(OLLAMA_TIMEOUT_MS)),
      );
    } catch (error) {
      // A stopped daemon, which is AC.4's own acceptance criterion: the designed `network` state
      // rather than a hung request.
      return {
        status: "failed",
        errorClass: "network",
        detail: unreachable(endpoint.host, error),
      };
    }

    // Measured before the body is dealt with, because the round trip is what the card prints and
    // the tidying up afterwards is this service's own time.
    const latencyMs = Math.max(0, Math.round(performance.now() - started));

    // The version string is not read. The question is whether something answered, and a build
    // number on a card foot is a fact nobody asked for. Cancelling returns the socket to the
    // pool.
    await discardBody(response);

    if (!response.ok) {
      return {
        status: "failed",
        errorClass: classifyHttpStatus(response.status),
        detail: describeRefusal(response.status),
      };
    }

    return { status: "ok", latencyMs, detail: response.status.toString() };
  }

  /**
   * The pull-list: every model on this host, with its size.
   *
   * @param connection - The saved connection, opened by its caller.
   * @returns The models, in the order the daemon listed them. An empty list is a legitimate
   *   answer — a freshly installed daemon has pulled nothing — and is not a failure. It is also
   *   the state this adapter's own {@link pullModel} exists to change, which no other adapter
   *   can say.
   * @throws {ProviderAdapterError} `config` for an address the policy refuses or a connection
   *   with none, and the class the refusal or transport failure belongs to otherwise.
   */
  async discoverModels(connection: ProviderConnectionContext): Promise<NormalizedModel[]> {
    const endpoint = daemonEndpoint(connection.config);

    if (!endpoint.ok) {
      throw new ProviderAdapterError("config", endpoint.detail);
    }

    let response: Response;

    try {
      response = await fetch(
        daemonUrl(endpoint.root, OLLAMA_TAGS_PATH),
        requestInit(AbortSignal.timeout(OLLAMA_TIMEOUT_MS)),
      );
    } catch (error) {
      throw new ProviderAdapterError("network", unreachable(endpoint.host, error));
    }

    if (!response.ok) {
      // The body of a refusal is never read. This address is one this service was pointed at
      // rather than one it knows, and a reverse proxy's `401` page quoting the request it
      // received is a real shape.
      await discardBody(response);

      throw new ProviderAdapterError(
        classifyHttpStatus(response.status),
        describeRefusal(response.status),
        response.status,
      );
    }

    return normalizeListing(await readListing(response));
  }

  /**
   * Pull one model onto the host, reporting progress as it goes.
   *
   * The only implementation of {@link PullCapableAdapter.pullModel} that ships. What it is
   * *not* is the thing AE.4 renders: this returns a stream, and a stream lives for one request.
   * `provider.pulls.ts` is what consumes it on the server and turns it into something a page can
   * ask about after a reload — see this file's header.
   *
   * @param connection - The saved connection, opened by its caller.
   * @param modelId - The model's own id, as {@link NormalizedModel.id} gave it —
   *   `qwen3-coder:32b`. Sent to the daemon unchanged, which is why discovery does not prettify
   *   one.
   * @returns The progress events, in order, ending with one whose `done` is `true`.
   * @throws {ProviderAdapterError} `config` for an address the policy refuses or a model with no
   *   name; the refusal's own class when the daemon would not start the pull; `upstream` when it
   *   started one and then failed, and `network` when it went quiet. A failure part way through
   *   is thrown from the iterator, which is where a `for await` catches it.
   */
  async *pullModel(
    connection: ProviderConnectionContext,
    modelId: string,
  ): AsyncIterable<ModelPullProgress> {
    const endpoint = daemonEndpoint(connection.config);

    if (!endpoint.ok) {
      throw new ProviderAdapterError("config", endpoint.detail);
    }

    const model = modelId.trim();

    if (model.length === 0) {
      // Checked here rather than left to the daemon, for the reason a missing address is: it is
      // something this adapter knows before it opens anything, and a `400` from Ollama would be
      // classified `config` anyway with a worse sentence.
      throw new ProviderAdapterError("config", "no model named");
    }

    // A controller rather than `AbortSignal.timeout`, because the deadline a pull is bounded by
    // is silence rather than elapsed time — see this file's header. Aborting it in the `finally`
    // is what closes the socket when a consumer stops iterating.
    const controller = new AbortController();
    let response: Response;

    try {
      response = await fetch(
        daemonUrl(endpoint.root, OLLAMA_PULL_PATH),
        requestInit(controller.signal, JSON.stringify({ model, stream: true })),
      );
    } catch (error) {
      throw new ProviderAdapterError("network", unreachable(endpoint.host, error));
    }

    if (!response.ok) {
      await discardBody(response);

      throw new ProviderAdapterError(
        classifyHttpStatus(response.status),
        describeRefusal(response.status),
        response.status,
      );
    }

    try {
      yield* readPullStream(response, { host: endpoint.host });
    } finally {
      controller.abort();
    }
  }
}

/**
 * A `/api/tags` answer's entries, read from a response.
 *
 * @param response - The `200`. Its body is consumed here.
 * @returns The entries, unread — {@link normalizeModel} is what makes sense of one.
 * @throws {ProviderAdapterError} `upstream` when the body is too large, ends early, is not JSON,
 *   or is JSON that is not a listing. `upstream` rather than `config` because the address
 *   already answered `200` to a tags route: something is at the other end and it is misbehaving,
 *   which is not a field anybody can correct.
 */
async function readListing(response: Response): Promise<readonly unknown[]> {
  const body = await readCappedBody(response, PROVIDER_MAX_RESPONSE_BYTES);

  if (!body.read) {
    throw new ProviderAdapterError("upstream", body.violation);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body.text);
  } catch {
    throw new ProviderAdapterError("upstream", "the model listing was not JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ProviderAdapterError("upstream", "the model listing was not an object");
  }

  const listing = parsed as Record<string, unknown>;

  if (!Array.isArray(listing.models)) {
    // Ollama's key is `models`, where the OpenAI format's is `data`. The sentence says which one
    // was looked for, because the commonest way to see this is a Host field pointed at an
    // OpenAI-compatible server that should have been added as the other kind.
    throw new ProviderAdapterError("upstream", "the model listing carried no models array");
  }

  return listing.models as readonly unknown[];
}

/**
 * A listing's entries, normalized.
 *
 * @param entries - What the daemon listed.
 * @returns The models, in the daemon's own order. Entries with no usable name are dropped rather
 *   than reported: one unusable row is a pull row nothing could do anything with, and failing
 *   the whole discovery over it would leave a card with no list at all. Duplicate ids are
 *   dropped because two rows with the same tag become two **Pull latest** buttons a person
 *   cannot tell apart.
 */
function normalizeListing(entries: readonly unknown[]): NormalizedModel[] {
  const models: NormalizedModel[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const model = normalizeModel(entry);

    if (model !== null && !seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }

  return models;
}
