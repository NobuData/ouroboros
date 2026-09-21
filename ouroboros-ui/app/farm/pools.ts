/**
 * Every decision the pools card and its configuration sheet make, and every sentence they say
 * (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)).
 *
 * Mockup 08's POOLS card is two rows and a `Configure →` link, and what is behind it is the
 * decision that makes the fleet work: a pool's **executor** (decision **B4**) decides what
 * dispatch (AH.4, #252) can send where, and its environment allow-list is what the shell executor
 * (AG.4, #246) enforces. So the sheet is not cosmetic, and each judgement it makes lives here so
 * its acceptance criterion is a unit test on a small value.
 *
 * **Pure**, the way `app/farm/view.ts` is: nothing here renders, routes or reaches the server-only
 * client. Its one import from the primitives is `listEntries` — the list control's own rule for
 * reading its value, so the allow-list is split exactly as the control draws it. The writes are
 * `app/farm/pool-actions.ts`'s, the state is `app/farm/pool-store.tsx`'s, and the drawing is
 * `app/farm/pools-card.tsx`'s and `app/farm/pool-sheet.tsx`'s.
 *
 * ### The meta line is composed, never stored
 *
 * `firmware builds · zephyr-sdk 0.17 image · 3 runners` is three facts — the description, the
 * pinned image and the **live** runner count — joined here ({@link poolMeta}). A shell pool pins no
 * image and so has no middle part, which is how mockup 08 draws `pool-b` (decided with the owner,
 * over the issue diagram's `· shell ·`).
 *
 * ### The auto-scale toggle is stored, inert, and says so
 *
 * Decision **B9**: the preference persists and **nothing acts on it** until cloud runners exist
 * (AJ.1, #263). {@link AUTOSCALE_AFFIX} is what stops a stored intent being mistaken for active
 * behaviour, and it is drawn as text — never a tooltip a reader has to find. The sub-toggle is
 * drawn only where a `queue_threshold` is stored (decided with the owner): the sentence is
 * *when queue > N*, and a pool that stores no `N` has no sentence to compose — this module invents
 * no default.
 */

import type { RunnerPool, RunnerPoolChange, RunnerPoolCreate } from "@/app/api/farm";
import { listEntries } from "@/app/ui/schema-form";

/* ------------------------------------------------------------------ the card's words */

/** The card's title, verbatim from the mockup (the design system draws it in capitals). */
export const POOLS_TITLE = "Pools";

/** The card's link, verbatim from the mockup. It opens the configuration sheet. */
export const CONFIGURE = "Configure →";

/** What the card says over a workspace with no pools. */
export const NO_POOLS_TITLE = "No pools yet.";

/**
 * Why a first pool matters, for a reader who may create one. The way to make it is the control
 * under this line (`CREATE_POOL` in `app/farm/states.ts`, AI.7, #262), so the sentence no longer
 * has to point at another one.
 */
export const NO_POOLS_NOTE =
  "A runner always enrols into a pool, so the first pool comes before the first runner.";

/** The same, for a reader who may not. */
export const NO_POOLS_MEMBER_NOTE = "An owner or an admin creates the first one.";

/** What stands in the card when the page could not be read. The *why* is the banner's, once. */
export const POOLS_UNREAD = "The pools could not be read.";

/** Why a pool control is inert for a reader who may not write. */
export const POOL_MEMBER_REASON = "Changing a pool needs an owner or an admin.";

/**
 * The enable switch's accessible name — what pressing it would do (`app/ui/field.tsx`).
 *
 * @param pool The pool.
 * @returns `Disable pool-a`, or `Enable pool-a`.
 */
export function enableLabel(pool: Pick<RunnerPool, "name" | "enabled">): string {
  return `${pool.enabled ? "Disable" : "Enable"} ${pool.name}`;
}

/* ------------------------------------------------------------------ the meta line */

/** What joins the meta line's parts, verbatim from the mockup. */
const META_SEPARATOR = " · ";

/** The word that closes the image part — mockup 08's `zephyr-sdk 0.17 image`. */
const IMAGE_WORD = "image";

/**
 * A pinned image as the card says it — `ghcr.io/acme-robotics/zephyr-sdk:0.17` reads
 * `zephyr-sdk 0.17 image`.
 *
 * The registry and the organization are dropped because the line is one line and the sheet shows
 * the whole reference. The tag is looked for **in the last path segment only**, so a registry's
 * port (`localhost:5000/sdk`) is not read as one; a digest (`…@sha256:…`, what AJ.5 #267 pins) is
 * dropped whole — sixty-four hex characters are not something a card line can carry.
 *
 * @param image The image reference, as stored.
 * @returns The part, or the reference itself before {@link IMAGE_WORD} when no name can be read
 *   out of it.
 */
export function imageLabel(image: string): string {
  const reference = image.trim();
  const [tagged = ""] = reference.split("@");
  const segment = tagged.slice(tagged.lastIndexOf("/") + 1);
  const colon = segment.indexOf(":");
  const name = colon === -1 ? segment : segment.slice(0, colon);
  const tag = colon === -1 ? "" : segment.slice(colon + 1);

  if (name.length === 0) return `${reference} ${IMAGE_WORD}`;

  return [name, tag, IMAGE_WORD].filter((part) => part.length > 0).join(" ");
}

/**
 * How many runners a pool holds, in words — `3 runners`, `1 runner`, `no runners`.
 *
 * @param runners The pool's live count, retired machines already excluded by the service.
 * @returns The part.
 */
export function runnerCount(runners: number): string {
  if (runners <= 0) return "no runners";

  return `${runners} runner${runners === 1 ? "" : "s"}`;
}

/**
 * The line under a pool's name — mockup 08's `firmware builds · zephyr-sdk 0.17 image · 3 runners`.
 *
 * **Composed from truth**: the description, the image a container pool pins, and the live runner
 * count. A part with nothing to say is left out rather than drawn empty, so a shell pool reads
 * `HIL & macOS jobs · 2 runners` and a pool nobody described still says how many machines it has.
 *
 * @param pool The pool.
 * @returns The line.
 */
export function poolMeta(
  pool: Pick<RunnerPool, "description" | "executor" | "image" | "runners">,
): string {
  const description = pool.description?.trim() ?? "";
  const image = pool.executor === "container" && pool.image !== null ? pool.image.trim() : "";

  return [
    description,
    image.length === 0 ? "" : imageLabel(image),
    runnerCount(pool.runners),
  ]
    .filter((part) => part.length > 0)
    .join(META_SEPARATOR);
}

/* ------------------------------------------------------------------ the auto-scale sub-toggle */

/**
 * The affix the sub-toggle carries, verbatim from decision **B9** — and an acceptance criterion:
 * it is text beside the switch, not a tooltip. AJ.1 (#263) removes it when it stops being true.
 */
export const AUTOSCALE_AFFIX = "arrives with cloud runners (v2)";

/** The sub-toggle's second line, verbatim from the mockup. */
export const AUTOSCALE_KEEP = "keep builds on-prem";

/** The sub-toggle, as the card draws it. */
export interface AutoscaleView {
  /** Whether the stored preference is on. */
  readonly on: boolean;
  /** `Auto-scale to cloud when queue > 5`, with the stored threshold. */
  readonly sentence: string;
}

/**
 * The sub-toggle's accessible name — what pressing it would do (`app/ui/field.tsx`).
 *
 * @param name The pool.
 * @param on Whether the preference is on now.
 * @returns `Turn on auto-scale to cloud for pool-a`, or `Turn off …`.
 */
export function autoscaleLabel(name: string, on: boolean): string {
  return `${on ? "Turn off" : "Turn on"} auto-scale to cloud for ${name}`;
}

/**
 * The auto-scale sub-toggle for a pool, or `null` for a pool that draws none.
 *
 * Drawn **only where a `queue_threshold` is stored**: the sentence names a number, and a pool
 * whose preference is `{}` has none to name. Nothing here reads the preference for any other
 * purpose — it is inert by design until #263.
 *
 * @param pool The pool.
 * @returns What to draw, or `null`.
 */
export function autoscaleView(pool: Pick<RunnerPool, "autoscalePref">): AutoscaleView | null {
  const threshold = pool.autoscalePref.queue_threshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) return null;

  return {
    on: pool.autoscalePref.enabled === true,
    sentence: `Auto-scale to cloud when queue > ${threshold}`,
  };
}

/**
 * The preference a press of the sub-toggle stores.
 *
 * **Everything else in the document is handed back untouched** — the threshold and any
 * `max_runners` — because the service replaces the column with what it is sent, and a switch that
 * silently dropped a threshold would un-draw itself.
 *
 * @param pool The pool as it stands.
 * @param on What the switch is being set to.
 * @returns The whole preference to send.
 */
export function nextAutoscalePref(
  pool: Pick<RunnerPool, "autoscalePref">,
  on: boolean,
): RunnerPool["autoscalePref"] {
  return { ...pool.autoscalePref, enabled: on };
}

/* ------------------------------------------------------------------ what a write left behind */

/**
 * The pools as the reader's own writes left them, until the page catches up.
 *
 * The card draws the farm's one observation (`app/farm/farm-store.tsx`), which is up to ten
 * seconds old. A switch that snapped back to its old position until the next poll would read as
 * a write that failed, so a write's **answer** — the pool as the service stored it — stands in for
 * the page's copy until a read made after the write lands. The store asks for that read at once.
 *
 * Each write carries its own instant, so nothing has to be pruned: one the page has caught up
 * with simply stops applying ({@link mergedPools}).
 */
export interface PoolEdits {
  /** Pools as a create or a change answered them, by id, with when. */
  readonly written: Readonly<Record<string, { readonly pool: RunnerPool; readonly at: number }>>;
  /** When each deleted pool was deleted, by id. */
  readonly removed: Readonly<Record<string, number>>;
}

/** No writes yet. */
export const NO_POOL_EDITS: PoolEdits = Object.freeze({ written: {}, removed: {} });

/**
 * Record a pool as a create or a change answered it.
 *
 * @param edits The writes so far.
 * @param pool The pool, as the service answered it.
 * @param at When it answered, in epoch milliseconds.
 * @returns The writes, with this one.
 */
export function withWrittenPool(edits: PoolEdits, pool: RunnerPool, at: number): PoolEdits {
  return { ...edits, written: { ...edits.written, [pool.id]: { pool, at } } };
}

/**
 * Record a delete.
 *
 * @param edits The writes so far.
 * @param id The pool that is gone.
 * @param at When the service said so, in epoch milliseconds.
 * @returns The writes, with this one.
 */
export function withRemovedPool(edits: PoolEdits, id: string, at: number): PoolEdits {
  return { ...edits, removed: { ...edits.removed, [id]: at } };
}

/**
 * The pools to draw: the page's, with the reader's own outstanding writes over them.
 *
 * A write is **outstanding while the page is no younger than it** — the page was read before the
 * write was answered, so it cannot know. The read the store asks for after a write supersedes any
 * ask already in the air (`app/poll.ts`), so the first page younger than a write was read after it.
 *
 * @param pools The page's pools.
 * @param edits The reader's writes.
 * @param dataAt When the page was last confirmed current, in epoch milliseconds.
 * @returns The pools, by name — the order the service lists them in, so a created pool lands
 *   where the next read will put it.
 */
export function mergedPools(
  pools: readonly RunnerPool[],
  edits: PoolEdits,
  dataAt: number,
): readonly RunnerPool[] {
  const written = Object.values(edits.written).filter((entry) => dataAt <= entry.at);
  const removed = Object.entries(edits.removed).filter(([, at]) => dataAt <= at);
  if (written.length === 0 && removed.length === 0) return pools;

  const answered = new Map(written.map((entry) => [entry.pool.id, entry.pool]));
  const gone = new Set(removed.map(([id]) => id));
  const held = new Set(pools.map((pool) => pool.id));

  return [
    ...pools.map((pool) => answered.get(pool.id) ?? pool),
    ...[...answered.values()].filter((pool) => !held.has(pool.id)),
  ]
    .filter((pool) => !gone.has(pool.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ the sheet's words */

/** The sheet's title, and its accessible name. */
export const SHEET_TITLE = "Configure pools";

/** The eyebrow over it. */
export const SHEET_EYEBROW = "Build Farm";

/** What dismisses the sheet. */
export const SHEET_CLOSE = "Close";

/** The pool picker's label. */
export const PICKER_LABEL = "Pool";

/** The picker's choice that blanks the form for a create. */
export const NEW_POOL = "+ New pool";

/** The picker's value for {@link NEW_POOL}. Not a uuid, so it can never be a pool's id. */
export const NEW_POOL_VALUE = "new";

/** The note a reader who may not write is given, once, above the form. */
export const SHEET_MEMBER_NOTE =
  "You can read how each pool is configured. Changing one needs an owner or an admin.";

/** The form's field labels, as the issue's diagram names them. */
export const FIELD_LABELS = {
  name: "Name",
  description: "Description",
  executor: "Executor",
  image: "Image",
  envAllowlist: "Env allow-list",
  maxConcurrency: "Concurrency",
} as const;

/** What each field is for — the hint under it. */
export const FIELD_HINTS = {
  name: "What --pool says on an enroll command and what a build submission selects by.",
  description: "The first part of the card's line — firmware builds.",
  executor:
    "What this pool's next builds run under, and so which runners dispatch can send them to. " +
    "Builds already submitted keep the executor they recorded.",
  image: "The image every build of this pool runs in — registry, path and tag.",
  envAllowlist:
    "One variable name per line. A build's environment is only these — the runner drops every " +
    "other name.",
  maxConcurrency: "Builds one runner of this pool may run at once — per runner, not per pool.",
} as const;

/** The two executors, in the diagram's order, as the select draws them. */
export const EXECUTOR_CHOICES: readonly { readonly value: PoolExecutor; readonly label: string }[] = [
  { value: "container", label: "container — builds run in a pinned image" },
  { value: "shell", label: "shell — builds run on the machine itself" },
];

/** The save control, over an existing pool. */
export const SAVE = "Save";

/** The save control, over a new one. */
export const CREATE = "Create pool";

/** Either, while the write is in flight. */
export const SAVING = "Saving…";

/** Why save is inert over a form that matches the pool. */
export const NOTHING_TO_SAVE = "Nothing has changed.";

/** What the form says, in a status region, once a save took. */
export const SAVED = "Saved.";

/** The same, for a create. */
export const CREATED = "Created.";

/**
 * What the form says once a delete took.
 *
 * @param name The pool that is gone.
 * @returns The sentence.
 */
export function deletedNote(name: string): string {
  return `${name} was deleted.`;
}

/* ------------------------------------------------------------------ the draft */

/** A pool's executor — decision **B4**'s two worlds. */
export type PoolExecutor = RunnerPool["executor"];

/**
 * The form's state: **strings, as typed**. A number field holding `1e` or nothing is a state a
 * reader passes through, so nothing is parsed until {@link validatePoolDraft} has looked at it.
 */
export interface PoolDraft {
  readonly name: string;
  readonly description: string;
  readonly executor: PoolExecutor;
  /** Kept while the executor is `shell`, so a flip back does not lose what was typed. */
  readonly image: string;
  /** One name per line — `listEntries`' format. */
  readonly envAllowlist: string;
  readonly maxConcurrency: string;
}

/** A field of the form. */
export type PoolField = keyof PoolDraft;

/** What is wrong with which fields. Absent means nothing is. */
export type PoolFieldErrors = Partial<Record<PoolField, string>>;

/**
 * The form a pool opens with — or, for `null`, the form a new pool does.
 *
 * A new pool starts as a `container` pool running one build per runner: the column's own default
 * for the second, and for the first the executor whose one extra requirement — the image — is on
 * the form to be seen.
 *
 * @param pool The pool, or `null` for a create.
 * @returns The draft.
 */
export function draftOf(pool: RunnerPool | null): PoolDraft {
  if (pool === null) {
    return {
      name: "",
      description: "",
      executor: "container",
      image: "",
      envAllowlist: "",
      maxConcurrency: "1",
    };
  }

  return {
    name: pool.name,
    description: pool.description ?? "",
    executor: pool.executor,
    image: pool.image ?? "",
    envAllowlist: pool.envAllowlist.join("\n"),
    maxConcurrency: String(pool.maxConcurrency),
  };
}

/** `fleet.dto.ts`'s `POOL_SHAPE`, restated: a lower-case slug that neither starts nor ends on a dash. */
const NAME_SHAPE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** `fleet.dto.ts`'s `DESCRIPTION_MAX`, restated. */
export const DESCRIPTION_MAX = 200;

/** `fleet.dto.ts`'s `IMAGE_MAX`, restated. */
export const IMAGE_MAX = 512;

/** `fleet.dto.ts`'s `ENV_ALLOWLIST_MAX`, restated. */
export const ENV_ALLOWLIST_MAX = 64;

/** The longest one variable name may be, restated. */
export const ENV_NAME_MAX = 256;

/** `fleet.dto.ts`'s concurrency range, restated. */
export const MAX_CONCURRENCY_MIN = 1;
export const MAX_CONCURRENCY_MAX = 64;

export const NAME_REQUIRED = "Name the pool.";
export const NAME_SHAPE_ERROR =
  "Lower-case letters, digits and dashes, up to 64 — it travels on a command line as --pool.";
export const DESCRIPTION_TOO_LONG = `Keep it to ${DESCRIPTION_MAX} characters — the card prints it on one line.`;
export const IMAGE_REQUIRED = "A container pool pins the image its builds run in.";
export const IMAGE_SHAPE_ERROR = `An image reference has no spaces and at most ${IMAGE_MAX} characters.`;
export const ENV_TOO_MANY = `At most ${ENV_ALLOWLIST_MAX} names.`;
export const CONCURRENCY_ERROR = `A whole number from ${MAX_CONCURRENCY_MIN} to ${MAX_CONCURRENCY_MAX}.`;

/**
 * What is wrong with one allow-list entry, if anything.
 *
 * The service asks only that a name is non-empty, distinct and bounded. This also refuses a name
 * with whitespace or an `=` in it, because the mistake worth catching is a pasted `NAME=value`:
 * the list names what a build **may** carry, and a value typed here would be a name no build
 * ever uses.
 *
 * @param entry The entry.
 * @returns The sentence, or `null`.
 */
function envEntryError(entry: string): string | null {
  if (/[\s=]/.test(entry)) return `${entry} is not a variable name — names only, no values.`;
  if (entry.length > ENV_NAME_MAX) return `A variable name is at most ${ENV_NAME_MAX} characters.`;

  return null;
}

/**
 * What is wrong with the form, before anything is sent.
 *
 * **Every bound restates one in `ouroboros-rest`'s `fleet.dto.ts`**, which restates V040's. The
 * service is what decides; this is what lets a reader fix a field while they are still in it,
 * rather than learn the rule from a `422`.
 *
 * @param draft The form.
 * @returns The errors by field — empty when the form may be sent.
 */
export function validatePoolDraft(draft: PoolDraft): PoolFieldErrors {
  const errors: { -readonly [Field in PoolField]?: string } = {};
  const name = draft.name.trim();

  if (name.length === 0) errors.name = NAME_REQUIRED;
  else if (!NAME_SHAPE.test(name)) errors.name = NAME_SHAPE_ERROR;

  if (draft.description.trim().length > DESCRIPTION_MAX) errors.description = DESCRIPTION_TOO_LONG;

  // A shell pool's image is not on the form and is not sent, so it is not judged.
  if (draft.executor === "container") {
    const image = draft.image.trim();

    if (image.length === 0) errors.image = IMAGE_REQUIRED;
    else if (/\s/.test(image) || image.length > IMAGE_MAX) errors.image = IMAGE_SHAPE_ERROR;
  }

  const entries = listEntries(draft.envAllowlist);
  const repeated = entries.find((entry, index) => entries.indexOf(entry) !== index);
  const malformed = entries.map(envEntryError).find((error) => error !== null);

  if (entries.length > ENV_ALLOWLIST_MAX) errors.envAllowlist = ENV_TOO_MANY;
  else if (malformed) errors.envAllowlist = malformed;
  else if (repeated !== undefined) errors.envAllowlist = `${repeated} is listed twice.`;

  if (concurrencyOf(draft) === null) errors.maxConcurrency = CONCURRENCY_ERROR;

  return errors;
}

/**
 * The form's concurrency, as a number.
 *
 * @param draft The form.
 * @returns The whole number, or `null` when the field does not hold one in range.
 */
function concurrencyOf(draft: PoolDraft): number | null {
  const typed = draft.maxConcurrency.trim();
  if (!/^\d{1,3}$/.test(typed)) return null;

  const value = Number(typed);

  return value >= MAX_CONCURRENCY_MIN && value <= MAX_CONCURRENCY_MAX ? value : null;
}

/**
 * The pool a valid form describes, in the service's shapes.
 *
 * **A shell pool's image is `null`, whatever the field still holds** — V040 refuses a pinned image
 * on a pool that will never pull one, and the form hides the field rather than clearing it.
 *
 * @param draft A form {@link validatePoolDraft} found nothing wrong with.
 * @returns The six fields the sheet edits.
 */
function fieldsOf(draft: PoolDraft): Required<
  Pick<RunnerPoolCreate, "name" | "description" | "executor" | "image" | "envAllowlist" | "maxConcurrency">
> {
  const description = draft.description.trim();

  return {
    name: draft.name.trim(),
    description: description.length === 0 ? null : description,
    executor: draft.executor,
    image: draft.executor === "container" ? draft.image.trim() : null,
    envAllowlist: listEntries(draft.envAllowlist),
    maxConcurrency: concurrencyOf(draft) ?? MAX_CONCURRENCY_MIN,
  };
}

/**
 * The body of a create.
 *
 * The fields the sheet does not edit — `enabled`, `tags`, the default command and the auto-scale
 * preference — are left out, so each takes the column's own default.
 *
 * @param draft A valid form.
 * @returns The pool to create.
 */
export function poolCreate(draft: PoolDraft): RunnerPoolCreate {
  return fieldsOf(draft);
}

/**
 * The body of a save: **only what differs from the pool as it stands**.
 *
 * A `PATCH` leaves alone what it does not name, and the service's audit row lists the columns
 * that moved — so a save that named all six would record a rename as a change to the
 * environment allow-list. Turning a container pool into a shell one names `image: null` beside
 * the executor, which is the pair the service checks against the merged row.
 *
 * @param pool The pool as it stands.
 * @param draft A valid form.
 * @returns The change — empty when the form matches the pool.
 */
export function poolChanges(pool: RunnerPool, draft: PoolDraft): RunnerPoolChange {
  const next = fieldsOf(draft);
  const change: { -readonly [Field in keyof RunnerPoolChange]: RunnerPoolChange[Field] } = {};

  if (next.name !== pool.name) change.name = next.name;
  if (next.description !== pool.description) change.description = next.description;
  if (next.executor !== pool.executor) change.executor = next.executor;
  if (next.image !== pool.image) change.image = next.image;
  if (next.maxConcurrency !== pool.maxConcurrency) change.maxConcurrency = next.maxConcurrency;

  if (
    next.envAllowlist.length !== pool.envAllowlist.length ||
    next.envAllowlist.some((entry, index) => entry !== pool.envAllowlist[index])
  ) {
    change.envAllowlist = next.envAllowlist;
  }

  return change;
}

/**
 * Whether a change names anything.
 *
 * @param change The change.
 * @returns `false` for `{}` — a save with nothing to say.
 */
export function hasChanges(change: RunnerPoolChange): boolean {
  return Object.keys(change).length > 0;
}

/* ------------------------------------------------------------------ the guarded delete */

/** The delete control, over a pool that may be deleted. */
export const DELETE = "Delete pool";

/** The same control while the delete is in flight. */
export const DELETING = "Deleting…";

/** What backs out of the confirmation. */
export const KEEP = "Keep it";

/** What a blocked or a permitted delete looks like before it is pressed. */
export interface DeleteGuard {
  /** The control's label — `Delete — blocked: 3 runners` when it may not be pressed. */
  readonly label: string;
  /** Why it may not, or `null` when it may. */
  readonly reason: string | null;
}

/**
 * Whether a pool may be deleted, and what the control says.
 *
 * **Empty pools only, with the reason on the control** — the issue's `Delete — blocked: 3
 * runners`. This judges what the page knows, the live runner count. The service counts more —
 * retired machines and the builds that ran here — and refuses with both counts
 * ({@link deleteRefusal}); what both refusals offer is the thing the reader usually meant, which
 * is to disable the pool.
 *
 * @param pool The pool.
 * @returns The guard.
 */
export function deleteGuard(pool: Pick<RunnerPool, "name" | "runners">): DeleteGuard {
  if (pool.runners <= 0) return { label: DELETE, reason: null };

  const count = runnerCount(pool.runners);
  const them = pool.runners === 1 ? "it" : "them";

  return {
    label: `Delete — blocked: ${count}`,
    reason:
      `Only an empty pool can be deleted, and ${pool.name} has ${count}. Remove ${them} first — ` +
      "or disable the pool, which stops new work and keeps its history.",
  };
}

/**
 * The confirmation's question.
 *
 * @param name The pool.
 * @returns The sentence.
 */
export function deleteQuestion(name: string): string {
  return `Delete ${name}? Enroll commands and build submissions that name it will stop working.`;
}

/**
 * The confirming control's label.
 *
 * @param name The pool.
 * @returns `Delete pool-c`.
 */
export function deleteConfirmLabel(name: string): string {
  return `Delete ${name}`;
}

/* ------------------------------------------------------------------ outcomes and refusals */

/** What a create, a save or a switch answers. */
export type PoolWriteOutcome =
  | { readonly ok: true; readonly pool: RunnerPool }
  | { readonly ok: false; readonly reason: string; readonly fields: PoolFieldErrors };

/** What a delete answers. */
export type PoolDeleteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The parts of a refusal the mappers read — `ApiError`'s, without importing the class. */
export interface PoolRefusal {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export const FORBIDDEN_CODE = "forbidden";
export const POOL_NOT_FOUND_CODE = "farm_pool_not_found";
export const POOL_NAME_TAKEN_CODE = "farm_pool_name_taken";
export const POOL_IMAGE_MISMATCH_CODE = "farm_pool_image_mismatch";
export const POOL_IN_USE_CODE = "farm_pool_in_use";
export const VALIDATION_FAILED_CODE = "validation_failed";

/** Every refused write ends on this: the pool is as it was. */
const NOTHING_CHANGED = "Nothing was changed.";

export const WRITE_FAILED = `The pool could not be saved. ${NOTHING_CHANGED} Try again.`;
export const WRITE_FORBIDDEN = `${POOL_MEMBER_REASON} ${NOTHING_CHANGED}`;
export const POOL_GONE = "That pool no longer exists.";
export const NAME_TAKEN = "This workspace already has a pool of that name.";
export const FIELDS_REFUSED = `Some fields need attention — see above. ${NOTHING_CHANGED}`;
export const IMAGE_MISMATCH = "A container pool pins an image, and a shell pool pins none.";
export const DELETE_FAILED = "The pool could not be deleted. Try again.";
export const DELETE_FORBIDDEN = "Deleting a pool needs an owner or an admin.";

/** The form's fields, for reading a `validation_failed`'s `details` — which are keyed by them. */
const FIELDS: readonly PoolField[] = [
  "name",
  "description",
  "executor",
  "image",
  "envAllowlist",
  "maxConcurrency",
];

/**
 * The first sentence a field-keyed detail carries.
 *
 * @param value One entry of `details` — a sentence, or a list of them.
 * @returns The sentence, or `null` for anything else.
 */
function firstSentence(value: unknown): string | null {
  const [first] = Array.isArray(value) ? (value as unknown[]) : [value];

  return typeof first === "string" && first.length > 0 ? first : null;
}

/**
 * What a refused create or save turns into: the sentence under the form, and the fields it is
 * about.
 *
 * @param refusal The service's refusal.
 * @returns The sentence and the field errors. **A refusal means nothing was written.**
 */
export function writeRefusal(refusal: PoolRefusal): { reason: string; fields: PoolFieldErrors } {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return { reason: WRITE_FORBIDDEN, fields: {} };
    case POOL_NOT_FOUND_CODE:
      return { reason: POOL_GONE, fields: {} };
    case POOL_NAME_TAKEN_CODE:
      return { reason: FIELDS_REFUSED, fields: { name: NAME_TAKEN } };
    case POOL_IMAGE_MISMATCH_CODE:
      return { reason: FIELDS_REFUSED, fields: { image: IMAGE_MISMATCH } };
    case VALIDATION_FAILED_CODE: {
      const fields: { -readonly [Field in PoolField]?: string } = {};

      for (const field of FIELDS) {
        const sentence = firstSentence(refusal.details[field]);
        if (sentence !== null) fields[field] = sentence;
      }

      // A refusal about something this form does not draw has no field to sit under.
      return Object.keys(fields).length === 0
        ? { reason: WRITE_FAILED, fields }
        : { reason: FIELDS_REFUSED, fields };
    }
    default:
      return { reason: WRITE_FAILED, fields: {} };
  }
}

/**
 * A count from a refusal's `details`.
 *
 * @param value What `details` carried under the key.
 * @returns The count, or `0` for anything that is not one.
 */
function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * What a refused delete says.
 *
 * `farm_pool_in_use` carries the two counts the service took — runners, **retired ones
 * included**, and builds — and the sentence is composed from them, so a pool the page shows as
 * empty still gets the reason it cannot go.
 *
 * @param refusal The service's refusal.
 * @returns The sentence.
 */
export function deleteRefusal(refusal: PoolRefusal): string {
  if (refusal.code === FORBIDDEN_CODE) return DELETE_FORBIDDEN;
  if (refusal.code === POOL_NOT_FOUND_CODE) return POOL_GONE;
  if (refusal.code !== POOL_IN_USE_CODE) return DELETE_FAILED;

  const runners = countOf(refusal.details.runners);
  const builds = countOf(refusal.details.jobs);
  const held = [
    runners === 0 ? "" : `${runners} runner${runners === 1 ? "" : "s"} (retired ones included)`,
    builds === 0 ? "" : `${builds} build${builds === 1 ? "" : "s"}`,
  ].filter((part) => part.length > 0);

  return (
    `Blocked: ${held.length === 0 ? "runners or builds" : held.join(" and ")} still ` +
    `${runners + builds === 1 ? "names" : "name"} this pool. Disable it instead — that stops new ` +
    "work and keeps the history."
  );
}
