/**
 * Every decision the submit-build dialog makes, and every word it and its toast say
 * (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * Decision **B6** scoped the MVP's workloads to API and UI submissions, which makes this dialog
 * the farm's honest workload source: without it the page is a fleet console with nothing to
 * dispatch, and the live log card has nothing to stream.
 *
 * **Framework-free and pure**, as `app/farm/pools.ts` is. The drawing is
 * `app/farm/submit-dialog.tsx`'s and `app/farm/submit-toast.tsx`'s; the write is
 * `app/farm/submit-actions.ts`'s, which imports its outcome type and its sentences from here.
 *
 * ### *Pool, repo ref, command* is five fields
 *
 * The service's submission (`ouroboros-rest`'s `dispatch/jobs.dto.ts`) expands *repo ref* into a
 * repository, a ref **and the exact commit** — *an offer pins the exact commit it builds, so a
 * moving ref cannot change what was built after the fact* — and there is no operation that
 * resolves a ref to a commit. So the dialog asks for all three rather than guessing one.
 *
 * ### The pool's default command is prefilled, and left to the service when it is kept
 *
 * A pool's `defaultCommand` fills the command field. If the reader submits it unchanged the body
 * carries **no command at all**, and the service falls back to the pool's default itself — so
 * what runs is the pool's command as the service holds it, not this dialog's reading of it.
 *
 * ### Validation here is a courtesy
 *
 * The shapes below are the service's own, so a mistake is said under its field before a round
 * trip. `fleet`'s DTO is still what validates, and its refusals land under the same fields
 * ({@link submitRefusal}).
 */

import type { BuildJob, BuildJobSubmission, RunnerPool } from "@/app/api/farm";

import { parseCommandLine, renderCommandLine } from "./command-line";

/* ------------------------------------------------------------------ copy */

/** The head's button, the pool row's control, and the dialog's heading. */
export const SUBMIT_BUILD = "Submit build";

/**
 * A pool row's control, named for its pool — several controls answering to one name cannot be
 * told apart by a reader moving between them.
 *
 * @param pool The pool's name.
 * @returns `Submit build to pool-a`.
 */
export function submitToPoolLabel(pool: string): string {
  return `${SUBMIT_BUILD} to ${pool}`;
}

/** Under the dialog's heading. */
export const SUBMIT_NOTE =
  "The build is queued in its pool and offered to a runner that can take it. The pool's " +
  "executor, image and command are recorded on the build, so editing the pool later does not " +
  "change what this one runs.";

export const SUBMIT = "Submit build";
export const SUBMITTING = "Submitting…";
export const CANCEL = "Cancel";

/** Why the control cannot act while the page has not been read. */
export const SUBMIT_UNREAD = "The farm could not be read, so there is no pool to submit to.";

/** Why it cannot act in a workspace with no pool. */
export const SUBMIT_NO_POOLS = "Create a pool first — a build is submitted to one.";

/** Why a disabled pool's own control cannot act. The service would refuse it the same way. */
export const SUBMIT_POOL_DISABLED = "This pool is disabled and accepts no new builds.";

/** The fields, as the dialog labels them and the service names them. */
export type SubmitField = "pool" | "repository" | "ref" | "commit" | "command";

/** What each field is called, and the line under it. */
export const SUBMIT_FIELDS: Readonly<
  Record<SubmitField, { readonly label: string; readonly hint: string }>
> = {
  pool: {
    label: "Pool",
    hint: "Where it runs. A disabled pool accepts no new builds.",
  },
  repository: {
    label: "Repository",
    hint: "GitHub's owner/name — one this workspace mirrors.",
  },
  ref: {
    label: "Ref",
    hint: "The ref the commit was taken from — refs/heads/main.",
  },
  commit: {
    label: "Commit",
    hint: "The exact commit, all 40 characters. A moving ref cannot change what was built.",
  },
  command: {
    label: "Command",
    hint: "Sent as words, never run through a shell. Single-quote a word that has spaces.",
  },
};

/** Placeholders — examples of the shape, in the mockup's own workspace. */
export const SUBMIT_PLACEHOLDERS: Readonly<Record<Exclude<SubmitField, "pool">, string>> = {
  repository: "acme-robotics/helios-firmware",
  ref: "refs/heads/main",
  commit: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
  command: "west build -b helios_mainboard app",
};

/** What introduces the words the command splits into. */
export const ARGV_PREVIEW = "Sent as";

/** Under a blank command, for a pool that has a default. */
export const USES_POOL_DEFAULT = "Left blank — the pool's default command runs.";

/* ------------------------------------------------------------------ the draft */

/** What the dialog holds while it is open — every field as the text in its control. */
export interface SubmitDraft {
  readonly pool: string;
  readonly repository: string;
  readonly ref: string;
  readonly commit: string;
  readonly command: string;
}

/**
 * The pool a draft names, if the workspace has it.
 *
 * @param pools The workspace's pools.
 * @param name The pool's name.
 * @returns The pool, or `undefined`.
 */
function poolNamed(pools: readonly RunnerPool[], name: string): RunnerPool | undefined {
  return pools.find((pool) => pool.name === name);
}

/**
 * The draft the dialog opens on.
 *
 * @param pools The workspace's pools.
 * @param requested The pool whose row opened the dialog, or `null` from the head.
 * @returns The draft: the requested pool — else the first enabled one, else the first — with
 *   **that pool's default command prefilled**, and everything else blank.
 */
export function draftFor(pools: readonly RunnerPool[], requested: string | null): SubmitDraft {
  const pool =
    (requested === null ? undefined : poolNamed(pools, requested)) ??
    pools.find((candidate) => candidate.enabled) ??
    pools[0];

  return {
    pool: pool?.name ?? "",
    repository: "",
    ref: "",
    commit: "",
    command: pool?.defaultCommand ?? "",
  };
}

/**
 * The draft after the pool was changed.
 *
 * @param draft The draft.
 * @param pools The workspace's pools.
 * @param name The pool now chosen.
 * @returns The draft with the new pool — and **the new pool's default command, unless the
 *   reader has typed one of their own**: a command that is still the old pool's default (or
 *   blank) was never theirs, and one they edited is not overwritten.
 */
export function withPool(
  draft: SubmitDraft,
  pools: readonly RunnerPool[],
  name: string,
): SubmitDraft {
  const before = poolNamed(pools, draft.pool)?.defaultCommand ?? "";
  const untouched = draft.command.trim() === "" || draft.command === before;

  return {
    ...draft,
    pool: name,
    command: untouched ? (poolNamed(pools, name)?.defaultCommand ?? "") : draft.command,
  };
}

/* ------------------------------------------------------------------ validation */

/** The sentence under each field that needs attention. */
export type SubmitFieldErrors = Readonly<Partial<Record<SubmitField, string>>>;

/** A GitHub `owner/name` — the service's `REPOSITORY_SHAPE`. */
const REPOSITORY_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** A git ref as an offer carries it: non-empty, no whitespace. */
const REF_SHAPE = /^\S+$/;

/** The longest ref the service takes. */
const REF_MAX_LENGTH = 256;

/** The exact commit. The service wants lower case; {@link submissionOf} folds it. */
const COMMIT_SHAPE = /^[0-9a-fA-F]{40}$/;

export const POOL_REQUIRED = "Choose a pool.";
export const REPOSITORY_INVALID = "Enter the repository as GitHub's owner/name.";
export const REF_INVALID = "Enter a git ref, with no spaces — refs/heads/main.";
export const COMMIT_INVALID = "Enter the full commit: 40 hexadecimal characters.";
export const COMMAND_REQUIRED = "This pool has no default command, so the build needs one.";

/**
 * What is wrong with a draft, field by field.
 *
 * @param draft The draft.
 * @param pools The workspace's pools.
 * @returns The sentences — none for a draft the service's shapes accept.
 */
export function validateDraft(draft: SubmitDraft, pools: readonly RunnerPool[]): SubmitFieldErrors {
  const errors: { -readonly [Field in SubmitField]?: string } = {};
  const pool = poolNamed(pools, draft.pool);
  const ref = draft.ref.trim();
  const command = parseCommandLine(draft.command);

  if (pool === undefined) errors.pool = POOL_REQUIRED;
  else if (!pool.enabled) errors.pool = SUBMIT_POOL_DISABLED;

  if (!REPOSITORY_SHAPE.test(draft.repository.trim())) errors.repository = REPOSITORY_INVALID;
  if (!REF_SHAPE.test(ref) || ref.length > REF_MAX_LENGTH) errors.ref = REF_INVALID;
  if (!COMMIT_SHAPE.test(draft.commit.trim())) errors.commit = COMMIT_INVALID;

  if (!command.ok) errors.command = command.reason;
  else if (command.argv.length === 0 && (pool?.defaultCommand ?? null) === null) {
    errors.command = COMMAND_REQUIRED;
  }

  return errors;
}

/**
 * The body a valid draft submits.
 *
 * @param draft A draft {@link validateDraft} found nothing wrong with.
 * @param pools The workspace's pools.
 * @returns The submission. **`command` is left out when the draft's is blank or is still the
 *   pool's default**, so the service's own fallback decides what runs; the commit is folded to
 *   the lower case the service requires.
 */
export function submissionOf(draft: SubmitDraft, pools: readonly RunnerPool[]): BuildJobSubmission {
  const parsed = parseCommandLine(draft.command);
  const argv = parsed.ok ? parsed.argv : [];
  const fallback = poolNamed(pools, draft.pool)?.defaultCommand ?? null;
  const isDefault = argv.length === 0 || renderCommandLine(argv) === fallback;

  return {
    pool: draft.pool,
    repository: draft.repository.trim(),
    ref: draft.ref.trim(),
    commit: draft.commit.trim().toLowerCase(),
    ...(isDefault ? {} : { command: [...argv] }),
  };
}

/* ------------------------------------------------------------------ outcomes and refusals */

/** What the toast needs from a submitted build. */
export type SubmittedJob = Pick<BuildJob, "id" | "number" | "pool">;

/** What a submission answers. */
export type SubmitOutcome =
  | { readonly ok: true; readonly job: SubmittedJob }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly fields: SubmitFieldErrors;
    };

/** The parts of a refusal the mapper reads — `ApiError`'s, without importing the class. */
export interface SubmitRefusal {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export const FORBIDDEN_CODE = "forbidden";
export const POOL_NOT_FOUND_CODE = "farm_pool_not_found";
export const POOL_DISABLED_CODE = "farm_pool_disabled";
export const REPOSITORY_NOT_FOUND_CODE = "farm_repository_not_found";
export const COMMAND_REQUIRED_CODE = "farm_command_required";
export const VALIDATION_FAILED_CODE = "validation_failed";

/** Every refused submission ends on this. */
const NOTHING_QUEUED = "Nothing was queued.";

export const SUBMIT_FAILED = `The build could not be submitted. ${NOTHING_QUEUED} Try again.`;
export const SUBMIT_FORBIDDEN = `You may not submit builds in this workspace. ${NOTHING_QUEUED}`;
export const FIELDS_REFUSED = `Some fields need attention — see above. ${NOTHING_QUEUED}`;
export const POOL_GONE = "That pool no longer exists.";
export const REPOSITORY_NOT_MIRRORED =
  "This workspace does not mirror that repository — a build can only be submitted for one " +
  "it does.";

/** The dialog's fields, for reading a `validation_failed`'s `details` — keyed by them. */
const FIELDS: readonly SubmitField[] = ["pool", "repository", "ref", "commit", "command"];

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
 * What a refused submission turns into: the sentence under the form, and the fields it is about.
 *
 * @param refusal The service's refusal.
 * @returns The sentence and the field errors. **A refusal means nothing was queued.**
 */
export function submitRefusal(refusal: SubmitRefusal): {
  reason: string;
  fields: SubmitFieldErrors;
} {
  switch (refusal.code) {
    case FORBIDDEN_CODE:
      return { reason: SUBMIT_FORBIDDEN, fields: {} };
    case POOL_NOT_FOUND_CODE:
      return { reason: FIELDS_REFUSED, fields: { pool: POOL_GONE } };
    case POOL_DISABLED_CODE:
      return { reason: FIELDS_REFUSED, fields: { pool: SUBMIT_POOL_DISABLED } };
    case REPOSITORY_NOT_FOUND_CODE:
      return {
        reason: FIELDS_REFUSED,
        fields: { repository: REPOSITORY_NOT_MIRRORED },
      };
    case COMMAND_REQUIRED_CODE:
      return { reason: FIELDS_REFUSED, fields: { command: COMMAND_REQUIRED } };
    case VALIDATION_FAILED_CODE: {
      const fields: { -readonly [Field in SubmitField]?: string } = {};

      for (const field of FIELDS) {
        const sentence = firstSentence(refusal.details[field]);
        if (sentence !== null) fields[field] = sentence;
      }

      // A refusal about something this form does not draw has no field to sit under.
      return Object.keys(fields).length === 0
        ? { reason: SUBMIT_FAILED, fields }
        : { reason: FIELDS_REFUSED, fields };
    }
    default:
      return { reason: SUBMIT_FAILED, fields: {} };
  }
}

/* ------------------------------------------------------------------ the toast */

/**
 * What the toast says once a build is queued.
 *
 * *Queued*, not *running*: the job waits in its pool until a runner that can take it accepts,
 * and the live card picks it up by itself the moment it starts (`app/farm/live.ts`).
 *
 * @param job The build.
 * @returns `Queued #483 in pool-a. The live log follows it once a runner starts it.`
 */
export function queuedToast(job: SubmittedJob): string {
  return `Queued #${job.number} in ${job.pool}. The live log follows it once a runner starts it.`;
}

/** The toast's way to the live log card. */
export const GO_TO_LIVE_LOG = "Go to the live log ↓";

/** The toast's dismissal. */
export const DISMISS_TOAST = "Dismiss";
