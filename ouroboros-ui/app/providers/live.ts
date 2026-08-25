/**
 * The card's live surfaces, decided ([#230](https://github.com/NobuData/ouroboros/issues/230)):
 * what the test note says, what a pull-list row is doing, how many bytes read as `19 GB`, and
 * every sentence the three islands can print. Pure, in the way `keys.ts` is — every outcome is
 * a value, every refusal a mapping, and nothing here renders or fetches.
 *
 * ### The note is the service's sentence, with the card's glyph and latency
 *
 * `ouroboros-rest` composes `503 upstream · retrying` and `key rejected (401)` through the
 * adapter taxonomy, once, for every provider. What this file adds is what the mockup draws
 * around it and the service cannot: the glyph for the tone — `✓`, `△`, `✗` — and the measured
 * latency after a pass. A failure has no latency, by the service's own design, so nothing is
 * appended to one.
 *
 * ### `· retrying` is the taxonomy's word, and the card gives it one bounded retry
 *
 * The suffix says the *condition* is worth trying again. For an `upstream` failure — a `503`
 * while a node rotates — the card acts on it exactly once: a second test after
 * {@link RETRY_DELAY_MS}, drawn as the same note while it waits. One, because a status
 * indicator that kept re-asking a struggling upstream would be a denial-of-service
 * contribution; `upstream` only, because retrying a `429` is precisely what a rate limit asks
 * you not to do, and a closed socket or a refused key are not conditions a five-second wait
 * changes.
 *
 * ### A finished pull is `succeeded`, not `100%`
 *
 * The daemon's last line — `success` — carries no byte counts, and the service reports what
 * the daemon said rather than inventing a figure. So a settled record can have `percent:
 * null`, and the row reads the *state* to know it is done. The bar is for a transfer in
 * flight; a transfer that has not been measured yet draws the indeterminate one.
 */

import { type ApiError, isApiError } from "@/app/api/errors";
import type { ModelPull, ProviderTest, UnlistedModel } from "@/app/api/providers";
import { aliasPath } from "@/app/paths";

/* ----------------------------------------------------------------------------- the test */

/** What the note says while a test is in flight. */
export const TESTING = "testing…";

/** Why a member's button does not act. */
export const TEST_READ_ONLY = "Testing a connection is for workspace owners and admins.";

/** What the note says when the test could not run at all — the service refused the request. */
export const TEST_FAILED = "The test could not run. Nothing was recorded — try again in a moment.";

/** What the note says when the connection has gone underneath the card. */
export const TEST_GONE = "This provider has been removed. Reload the page.";

/** What the note says under a pass when the chips could not be refreshed afterwards. */
export const MODELS_NOT_REFRESHED = "models not refreshed";

/** How long the card waits before its one automatic retry of an `upstream` failure. */
export const RETRY_DELAY_MS = 5_000;

/** The glyph each tone carries — the mockup's `✓ 200 · 38ms` and `△ 503 upstream · retrying`. */
export const GLYPHS = { ok: "✓", warn: "△", err: "✗" } as const;

/** The note the foot draws. */
export interface TestNote {
  readonly tone: ProviderTest["pill"]["tone"];
  /** The glyph before the text. */
  readonly glyph: (typeof GLYPHS)[keyof typeof GLYPHS];
  /** The service's sentence, with the latency after a pass — `200 · 38ms`. */
  readonly text: string;
}

/**
 * The note for what a test found.
 *
 * @param result What the service answered.
 * @returns The note. The latency is appended only where one was measured — which the
 *   service guarantees is only on a pass.
 */
export function testNote(result: ProviderTest): TestNote {
  const latency = result.latencyMs === null ? "" : ` · ${result.latencyMs.toString()}ms`;

  return {
    tone: result.pill.tone,
    glyph: GLYPHS[result.pill.tone],
    text: `${result.note}${latency}`,
  };
}

/**
 * Whether, and after how long, the card retries a result on its own.
 *
 * @param result What the service answered.
 * @returns The delay, or null for every result the card leaves standing — see this file's
 *   header on why only `upstream` earns one.
 */
export function retryDelayFor(result: ProviderTest): number | null {
  return result.errorClass === "upstream" && result.retryable ? RETRY_DELAY_MS : null;
}

/** The service's code for a role that may read the card and not write to it. */
const FORBIDDEN_CODE = "forbidden";

/** The service's code for a connection this workspace no longer has. */
const NOT_FOUND_CODE = "provider_connection_not_found";

/** The service's code for a provider that did not answer its models list. */
export const DISCOVERY_FAILED_CODE = "provider_discovery_failed";

/**
 * Why a test could not run, as a sentence.
 *
 * Every refusal here is about the *request* — the provider being down is not one, because
 * the service answers that as a value.
 *
 * @param error What the service answered.
 * @returns The sentence.
 */
export function testRefusal(error: ApiError): string {
  if (error.code === FORBIDDEN_CODE) return TEST_READ_ONLY;
  if (error.code === NOT_FOUND_CODE) return TEST_GONE;

  return TEST_FAILED;
}

/* ---------------------------------------------------------------------- the models region */

/** The chips' refresh action. */
export const REFRESH_MODELS = "Refresh models";

/** What the action says while it runs. */
export const REFRESHING = "Refreshing…";

/** Why a member's refresh does not act. */
export const REFRESH_READ_ONLY = "Refreshing the models is for workspace owners and admins.";

/** What the region says when a refresh could not run at all. */
export const REFRESH_FAILED = "The models could not be refreshed. The list is unchanged.";

/** How long a chip that discovery removed stays drawn, leaving, before it is dropped. */
export const CHIP_LEAVE_MS = 240;

/** What the flag on a stranded alias's model says, before the alias link. */
export const UNLISTED_FLAG = "not listed upstream";

/** …and after it. */
export const UNLISTED_POINTS_HERE = "still points here";

/**
 * Why a refresh did not happen, as a sentence.
 *
 * @param error What the service answered.
 * @returns The sentence. A provider that did not answer says so with the provider's own
 *   phrase, because *the list is unchanged* is only reassuring if the reader knows why.
 */
export function discoverRefusal(error: ApiError): string {
  if (error.code === FORBIDDEN_CODE) return REFRESH_READ_ONLY;
  if (error.code === NOT_FOUND_CODE) return TEST_GONE;
  if (error.code === DISCOVERY_FAILED_CODE) {
    const detail = error.details.detail;

    return typeof detail === "string" && detail.length > 0
      ? `The provider did not answer its models list (${detail}). The list is unchanged.`
      : REFRESH_FAILED;
  }

  return REFRESH_FAILED;
}

/**
 * Why any live action did not happen, when the caller has no better mapping.
 *
 * @param error What went wrong.
 * @param map The mapping for an `ApiError`.
 * @param fallback What to say about anything else.
 * @returns The sentence.
 */
export function refusalOf(error: unknown, map: (error: ApiError) => string, fallback: string): string {
  return isApiError(error) ? map(error) : fallback;
}

/** The link the flag draws to the alias that names a vanished model. */
export interface AliasLink {
  readonly name: string;
  readonly href: string;
}

/**
 * The links for one flagged model, in the service's order.
 *
 * @param unlisted The flag.
 * @returns One link per alias.
 */
export function aliasLinks(unlisted: UnlistedModel): readonly AliasLink[] {
  return unlisted.aliases.map((alias) => ({ name: alias.alias, href: aliasPath(alias.alias) }));
}

/** What changed between two renders of a chip list, for the enter and leave animations. */
export interface ChipDiff {
  /** Ids drawn now that were not drawn before. */
  readonly entering: ReadonlySet<string>;
  /** Ids drawn before that are not drawn now, in their previous order. */
  readonly leaving: readonly string[];
}

/**
 * Diff two chip lists by id.
 *
 * @param previous The ids drawn before.
 * @param next The ids drawn now.
 * @returns What entered and what left.
 */
export function chipDiff(previous: readonly string[], next: readonly string[]): ChipDiff {
  const was = new Set(previous);
  const now = new Set(next);

  return {
    entering: new Set(next.filter((id) => !was.has(id))),
    leaving: previous.filter((id) => !now.has(id)),
  };
}

/* -------------------------------------------------------------------------- the pull-list */

/** The row's action. */
export const PULL_LATEST = "Pull latest";

/** Why a member's pull does not act. */
export const PULL_READ_ONLY = "Pulling a model is for workspace owners and admins.";

/** What a row says when its pull could not be started. */
export const PULL_FAILED = "The pull could not be started. Try again in a moment.";

/** What a row says while its pull waits behind another. */
export const PULL_QUEUED = "queued…";

/** What a row says once its pull landed. */
export const PULLED = "pulled";

/** What a row says while the daemon has not yet said how big the transfer is. */
export const PULL_STARTING = "starting…";

/** How often the list asks where a transfer has got to, while one is moving. */
export const PULL_POLL_MS = 1_500;

/** How long the list waits after a pull lands before re-reading the catalog it refreshed. */
export const PULL_SETTLE_MS = 1_000;

/** The unit `ollama list` prints sizes in — decimal, not binary: `19 GB` for 18 997 469 184. */
const GB = 1_000_000_000;

const MB = 1_000_000;

/**
 * Bytes as the size tag the mockup draws — `19 GB`, `63 GB`, `9.1 GB`.
 *
 * Decimal units, as the daemon prints them, so the tag agrees with `ollama list` on the
 * operator's own terminal. One decimal below ten gigabytes, none above, and megabytes for
 * anything smaller — which is rounded to a whole number for the same reason.
 *
 * @param bytes The size, or null.
 * @returns The tag, or null for a model that has no size — a chip, not a pull-list row.
 */
export function sizeTag(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;

  if (bytes >= 10 * GB) return `${Math.round(bytes / GB).toString()} GB`;
  if (bytes >= GB) return `${(Math.round((bytes / GB) * 10) / 10).toString()} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB).toString()} MB`;

  return `${Math.max(1, Math.round(bytes / 1_000)).toString()} KB`;
}

/** What one row's trailing edge draws. */
export type PullRowState =
  /** Nothing in flight: the action. */
  | { readonly kind: "idle" }
  /** Behind another pull; nothing asked of the daemon yet. */
  | { readonly kind: "queued" }
  /** Moving — or not yet measured, when `percent` is null. */
  | { readonly kind: "running"; readonly percent: number | null; readonly status: string }
  /** Landed. The action stays, because *Pull latest* is an instruction. */
  | { readonly kind: "done" }
  /** Stopped. The sentence, and the action to try again. */
  | { readonly kind: "failed"; readonly detail: string };

/**
 * What a row is doing, from the record the service holds for it.
 *
 * @param pull The record, or undefined for a model nothing has pulled.
 * @returns The state.
 */
export function pullRowState(pull: ModelPull | undefined): PullRowState {
  if (pull === undefined) return { kind: "idle" };

  switch (pull.state) {
    case "queued":
      return { kind: "queued" };
    case "running":
      return { kind: "running", percent: pull.percent, status: pull.status };
    case "succeeded":
      return { kind: "done" };
    case "failed":
      return { kind: "failed", detail: pull.detail ?? PULL_FAILED };
  }
}

/**
 * What the progress bar announces — `llama4:scout · 61%`, or the daemon's own word before a
 * size is known.
 *
 * @param modelId The model.
 * @param state The row's state.
 * @returns The text.
 */
export function pullValueText(modelId: string, state: PullRowState): string {
  if (state.kind !== "running") return modelId;

  return state.percent === null
    ? `${modelId} · ${state.status}`
    : `${modelId} · ${state.percent.toString()}%`;
}

/**
 * Whether any record is still moving — what decides whether the list keeps polling.
 *
 * @param pulls The records.
 * @returns True while one is queued or running.
 */
export function anyInFlight(pulls: readonly ModelPull[]): boolean {
  return pulls.some((pull) => pull.state === "queued" || pull.state === "running");
}

/**
 * The models whose pulls landed between two polls — what triggers a re-read of the catalog.
 *
 * @param previous The records before.
 * @param next The records now.
 * @returns The model ids that reached `succeeded` since.
 */
export function newlyPulled(previous: readonly ModelPull[], next: readonly ModelPull[]): string[] {
  const before = new Map(previous.map((pull) => [pull.modelId, pull.state]));

  return next
    .filter((pull) => pull.state === "succeeded" && before.get(pull.modelId) !== "succeeded")
    .map((pull) => pull.modelId);
}

/**
 * Why a pull did not start, as a sentence.
 *
 * @param error What the service answered.
 * @returns The sentence.
 */
export function pullRefusal(error: ApiError): string {
  if (error.code === FORBIDDEN_CODE) return PULL_READ_ONLY;
  if (error.code === NOT_FOUND_CODE) return TEST_GONE;

  return PULL_FAILED;
}
