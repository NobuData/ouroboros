/**
 * The Workspace card's copy, fields and rules, as values
 * (BS.2, [#492](https://github.com/NobuData/ouroboros/issues/492), decision **S6**).
 *
 * Mockup 17's `c-5` card: the workspace name, its tenant domain with the `SSO enforced` tag, the
 * data region, the data retention select (with the advanced per-class editor behind it), and the
 * training-data row. The card itself is `app/settings/workspace-card.tsx`; everything it decides
 * is decided here, framework-free and pure, so a suite can hold each rule still.
 *
 * ### The rule the card keeps
 *
 * **A control the reader cannot operate renders as text with its reason, never as a control that
 * does nothing.** Region and training data are facts about this deployment, so on a self-hosted
 * install they are sentences — no dropdown, no switch, no plan lock. A field the reader's role may
 * not change is the value and the sentence that says who can.
 *
 * ### One section, two resources
 *
 * Name and domain are `PATCH /api/v1/settings/workspace`; the tiers are
 * `PATCH /api/v1/settings/retention`. The save model wants one write per section, so
 * {@link workspacePatches} splits the section's changes into the two bodies and
 * `app/settings/workspace-actions.ts` sends them in order — see there for what a refusal of the
 * second means for the first.
 *
 * ### The select and the advanced editor are one set of tiers
 *
 * The select (`loopDays`) is a view over the three loop-data classes. Choosing in it puts all
 * three back to what is saved and records **one** change — one control moved, one unsaved field —
 * which the service receives as `{loopDays}`. Editing a loop class in the advanced editor while
 * the select holds an unsaved choice turns that choice into the three per-class values first
 * ({@link classEdit}), so the two controls can never disagree about what will be saved.
 */

import { ageOfSeconds } from "@/app/format";
import type {
  RetentionPatch,
  RetentionSettings,
  RetentionTier,
  WorkspaceControlReason,
  WorkspaceSettings,
  WorkspaceSettingsPatch,
  WorkspaceTrainingData,
} from "@/app/api/settings-workspace";

/* ------------------------------------------------------------------ the classes */

/** The four retention classes the card edits, in the order the advanced editor lists them. */
export const CORE_CLASSES = ["transcripts", "build_logs", "artifacts", "audit"] as const;

/** One of {@link CORE_CLASSES}. */
export type CoreClass = (typeof CORE_CLASSES)[number];

/** The three classes the simple select governs — the mockup's *"transcripts, logs, artifacts"*. */
export const LOOP_CLASSES = ["transcripts", "build_logs", "artifacts"] as const;

/** One of {@link LOOP_CLASSES}. */
export type LoopClass = (typeof LOOP_CLASSES)[number];

/** What each class is called in the advanced editor. */
export const CLASS_LABELS: Readonly<Record<CoreClass, string>> = {
  transcripts: "Transcripts",
  build_logs: "Build logs",
  artifacts: "Artifacts",
  audit: "Audit log",
};

/**
 * Whether a class is one of the three the select governs.
 *
 * @param dataClass A class.
 * @returns `true` for transcripts, build logs and artifacts.
 */
export function isLoopClass(dataClass: CoreClass): dataClass is LoopClass {
  return (LOOP_CLASSES as readonly string[]).includes(dataClass);
}

/* ------------------------------------------------------------------ the fields */

/**
 * The section's fields, as the save model holds them.
 *
 * Every value is the control's own string — an `<input>`'s and a `<select>`'s value is text — so
 * an edit back to the saved value compares equal and the field is clean again. `loopDays` is `""`
 * when the saved loop classes differ (the service's `loopDays: null`).
 */
export interface WorkspaceCardValues {
  readonly name: string;
  readonly domain: string;
  readonly loopDays: string;
  readonly transcripts: string;
  readonly build_logs: string;
  readonly artifacts: string;
  readonly audit: string;
}

/** A field of the section. */
export type WorkspaceField = keyof WorkspaceCardValues;

/** What each field is called, for the sentence that reports a refusal. */
export const FIELD_LABELS: Readonly<Record<WorkspaceField, string>> = {
  name: "Workspace name",
  domain: "Tenant domain",
  loopDays: "Data retention",
  transcripts: "Transcripts retention",
  build_logs: "Build logs retention",
  artifacts: "Artifacts retention",
  audit: "Audit log retention",
};

/**
 * A class's tier from the read, or `undefined` when the service did not list it.
 *
 * @param retention The tiers as read.
 * @param dataClass The class.
 * @returns The tier.
 */
export function tierOf(retention: RetentionSettings, dataClass: CoreClass): RetentionTier | undefined {
  return retention.classes.find((tier) => tier.dataClass === dataClass);
}

/**
 * The section's saved values, from the two reads.
 *
 * @param settings The workspace card as read.
 * @param retention The tiers as read.
 * @returns The baseline the save model compares edits with.
 */
export function workspaceBaseline(
  settings: WorkspaceSettings,
  retention: RetentionSettings,
): WorkspaceCardValues {
  const days = (dataClass: CoreClass): string => {
    const tier = tierOf(retention, dataClass);
    return tier === undefined ? "" : String(tier.days);
  };

  return {
    name: settings.name.value,
    domain: settings.domain.value ?? "",
    loopDays: retention.loopDays === null ? "" : String(retention.loopDays),
    transcripts: days("transcripts"),
    build_logs: days("build_logs"),
    artifacts: days("artifacts"),
    audit: days("audit"),
  };
}

/**
 * The tier each class will have once the section is saved.
 *
 * A class's own field wins when it is unsaved; otherwise a loop class follows an unsaved choice
 * in the select; otherwise it is what is saved.
 *
 * @param draft Every field as it stands.
 * @param baseline What is saved.
 * @returns The days per class, as the controls' text.
 */
export function effectiveTiers(
  draft: WorkspaceCardValues,
  baseline: WorkspaceCardValues,
): Readonly<Record<CoreClass, string>> {
  const selectMoved = draft.loopDays !== baseline.loopDays && draft.loopDays !== "";

  const tier = (dataClass: CoreClass): string => {
    if (draft[dataClass] !== baseline[dataClass]) return draft[dataClass];
    if (selectMoved && isLoopClass(dataClass)) return draft.loopDays;
    return baseline[dataClass];
  };

  return {
    transcripts: tier("transcripts"),
    build_logs: tier("build_logs"),
    artifacts: tier("artifacts"),
    audit: tier("audit"),
  };
}

/**
 * What the select shows: the days the three loop classes will share, or `""` when they will
 * differ — the *Set per class* option.
 *
 * @param tiers The effective tiers ({@link effectiveTiers}).
 * @returns The select's value.
 */
export function selectValue(tiers: Readonly<Record<CoreClass, string>>): string {
  const [first, ...rest] = LOOP_CLASSES.map((dataClass) => tiers[dataClass]);
  return rest.every((value) => value === first) ? first : "";
}

/** The fields an edit sets, and their new values. */
export type FieldEdits = Partial<WorkspaceCardValues>;

/**
 * Choosing in the select: the choice, and the three loop classes put back to what is saved, so
 * one choice is one unsaved field.
 *
 * @param value The option chosen — `""` (*Set per class*) changes nothing.
 * @param baseline What is saved.
 * @returns The fields to set.
 */
export function loopDaysEdit(value: string, baseline: WorkspaceCardValues): FieldEdits {
  if (value === "") return {};

  return {
    loopDays: value,
    transcripts: baseline.transcripts,
    build_logs: baseline.build_logs,
    artifacts: baseline.artifacts,
  };
}

/**
 * Editing one class in the advanced editor.
 *
 * When the select holds an unsaved choice and the class is a loop class, the choice becomes the
 * three per-class values first and the select goes back to what is saved — so the two controls
 * stay one set of tiers and the other two loop classes keep the value the reader chose.
 *
 * @param dataClass The class edited.
 * @param value Its new days, as typed.
 * @param draft Every field as it stands.
 * @param baseline What is saved.
 * @returns The fields to set.
 */
export function classEdit(
  dataClass: CoreClass,
  value: string,
  draft: WorkspaceCardValues,
  baseline: WorkspaceCardValues,
): FieldEdits {
  if (!isLoopClass(dataClass) || draft.loopDays === baseline.loopDays) return { [dataClass]: value };

  const tiers = effectiveTiers(draft, baseline);

  return {
    transcripts: tiers.transcripts,
    build_logs: tiers.build_logs,
    artifacts: tiers.artifacts,
    [dataClass]: value,
    loopDays: baseline.loopDays,
  };
}

/* ------------------------------------------------------------------ the select's options */

/** The select's usual choices, in days — the mockup draws `30 days`. */
export const LOOP_DAY_CHOICES: readonly number[] = [7, 14, 30, 60, 90, 180, 365];

/** The option shown when the loop classes differ. */
export const PER_CLASS_OPTION = "Set per class";

/**
 * The select's options: the usual choices within the loop classes' bounds, plus any value the
 * select must be able to show that is not one of them — the saved tier (set through the advanced
 * editor or the API) and the tier the advanced editor has just given all three classes — so the
 * select never shows a value it cannot hold, and the saved value can always be chosen again.
 *
 * @param carry Values to include: whole days as text; `""` and anything else is ignored.
 * @param floor The loop classes' floor.
 * @param ceiling Their ceiling.
 * @returns The days, ascending, each once.
 */
export function loopDayOptions(
  carry: readonly string[],
  floor: number,
  ceiling: number,
): readonly number[] {
  const choices = LOOP_DAY_CHOICES.filter((days) => days >= floor && days <= ceiling);
  const extra = carry
    .filter((value) => value.trim() !== "")
    .map(Number)
    .filter((days) => Number.isSafeInteger(days) && days > 0);

  return [...new Set([...choices, ...extra])].sort((a, b) => a - b);
}

/**
 * A tier as text — `30 days`, `1 day`.
 *
 * @param days The days.
 * @returns The phrase.
 */
export function daysLabel(days: number | string): string {
  return `${String(days)} ${Number(days) === 1 ? "day" : "days"}`;
}

/* ------------------------------------------------------------------ the copy */

/**
 * What the Workspace seat says when the card could not be drawn — which read failed, and the
 * service's own words for it.
 *
 * @param workspace Why the workspace card could not be read, or `null` when it was.
 * @param retention Why the tiers could not be read, or `null` when they were.
 * @returns The sentence.
 */
export function workspaceUnread(workspace: string | null, retention: string | null): string {
  const reasons = [workspace, retention].filter((reason): reason is string => reason !== null);
  const what =
    workspace !== null && retention !== null
      ? "The workspace settings and retention tiers"
      : workspace !== null
        ? "The workspace settings"
        : "The retention tiers";

  return `${what} could not be read, so this card is not drawn. ${[...new Set(reasons)].join(" ")}`.trim();
}

/** The name field's label — mockup 17's. */
export const NAME_LABEL = "Workspace name";
/** The domain field's label — mockup 17's. */
export const DOMAIN_LABEL = "Tenant domain";
/** The region row's label — mockup 17's. */
export const REGION_LABEL = "Data region";
/** The retention field's label — mockup 17's. */
export const RETENTION_LABEL = "Data retention";
/** The hint under the select — mockup 17's: which classes it governs. */
export const RETENTION_HINT = "transcripts, logs, artifacts";
/** The disclosure that opens the per-class editor. */
export const ADVANCED_LABEL = "Advanced: set each class";
/** The training row's label — what the mockup's switch was about, without the switch. */
export const TRAINING_LABEL = "Training on this workspace's data";
/** The `SSO enforced` tag — mockup 17's, shown only when it is true. */
export const SSO_ENFORCED_TAG = "SSO enforced";
/** The link to the security model's residency section. */
export const RESIDENCY_LINK = "Data residency";
/** What a domain field says when the workspace has none. */
export const NO_DOMAIN = "No tenant domain";

/**
 * Why a field cannot be changed, as a sentence.
 *
 * @param reason The payload's reason.
 * @returns The sentence the card prints with the value.
 */
export function reasonSentence(reason: WorkspaceControlReason | null): string {
  switch (reason) {
    case "deployment":
      return "Set by this deployment, not from this page.";
    case "plan":
      return "Set by your plan.";
    default:
      return "Changing it takes an owner or an admin.";
  }
}

/**
 * The region row's reason — S6's *"self-hosted — single region"*.
 *
 * @param source Whether the operator named the region or the label is the fallback.
 * @returns The sentence.
 */
export function regionReason(source: "configured" | "default"): string {
  return source === "configured"
    ? "Self-hosted — single region, chosen by the operator when this deployment was installed."
    : "Self-hosted — single region. The operator has not named it (OURO_DATA_REGION).";
}

/**
 * The training-data row, as a sentence.
 *
 * A self-hosted deployment answers only the first variant, and it is said plainly: nothing here
 * trains, so there is nothing to lock and no plan to credit. The other two are the SaaS tier's
 * (#500); the service takes no write for either, so both are text too and say so.
 *
 * @param training The payload's row.
 * @returns The sentence.
 */
export function trainingSentence(training: WorkspaceTrainingData): string {
  const state = training.enabled ? "On" : "Off";
  if (training.changeable) return `${state} — this card has no control for it yet.`;
  if (training.reason === "deployment") return "Off — this deployment never trains on your data.";

  return `${state} — set by your plan.`;
}

/**
 * The note shown while the domain holds an unsaved change — its consequence, before commit.
 *
 * @param consequence The payload's sentence.
 * @param saved The saved domain, or `""`.
 * @param next The domain about to be saved.
 * @returns The note.
 */
export function domainChangeNote(consequence: string, saved: string, next: string): string {
  const move =
    saved === ""
      ? `After saving, sign-in finds this workspace at ${next}.`
      : `After saving, sign-in finds this workspace at ${next} instead of ${saved}.`;

  return `${consequence} ${move}`;
}

/* ------------------------------------------------------------------ the sweep */

/**
 * When a class's next sweep runs, relative to the page's read — `in 4h`, `due now`.
 *
 * @param at The sweep's instant, or `null` when nothing sweeps the class here.
 * @param now When the page was read, in ms.
 * @returns The phrase, or `null` for no scheduled sweep.
 */
export function sweepWhen(at: string | null, now: number): string | null {
  if (at === null) return null;

  const then = Date.parse(at);
  if (Number.isNaN(then)) return null;

  const seconds = (then - now) / 1000;
  return seconds < 60 ? "due now" : `in ${ageOfSeconds(seconds)}`;
}

/**
 * The note under the select: saving deletes nothing, and when the next sweep applies the change.
 *
 * @param retention The tiers as read — `effect` is the service's sentence.
 * @param now When the page was read, in ms.
 * @returns The note. The soonest of the loop classes' sweeps is named, because that is when the
 *   select's change first removes anything.
 */
export function sweepNote(retention: RetentionSettings, now: number): string {
  const next = LOOP_CLASSES.map((dataClass) => tierOf(retention, dataClass)?.nextSweepAt ?? null)
    .filter((at): at is string => at !== null && !Number.isNaN(Date.parse(at)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

  const when = sweepWhen(next ?? null, now);

  return when === null
    ? `${retention.effect} No sweep is scheduled in this deployment yet.`
    : `${retention.effect} Next sweep ${when}.`;
}

/**
 * One class's hint in the advanced editor: its bounds and its sweep, and for audit why the floor
 * is where it is.
 *
 * @param tier The class's tier.
 * @param now When the page was read, in ms.
 * @returns The hint.
 */
export function classHint(tier: RetentionTier, now: number): string {
  const when = sweepWhen(tier.nextSweepAt, now);
  const sweep = when === null ? "no sweep scheduled yet" : `next sweep ${when}`;
  const bounds = `${String(tier.floor)}–${String(tier.ceiling)} days · ${sweep}`;

  return tier.dataClass === "audit" ? `${bounds}. ${auditFloorReason(tier.floor)}` : bounds;
}

/**
 * Why the audit log cannot be kept for less than its floor — explained, not merely refused.
 *
 * @param floor The audit floor, in days.
 * @returns The sentence.
 */
export function auditFloorReason(floor: number): string {
  return `The audit log is kept at least ${String(floor)} days, so the record a quarterly review reads cannot be configured away.`;
}

/* ------------------------------------------------------------------ validation */

/** The longest name the service accepts. */
export const NAME_MAX_LENGTH = 100;

/** The service's name rule: no leading or trailing whitespace, no control characters. */
const NAME_PATTERN = /^[^\s\p{Cc}](?:[^\p{Cc}]*[^\s\p{Cc}])?$/u;

/** The service's domain rule: two or more lower-case hostname labels. */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** What the browser says about a name the service would refuse. */
export const NAME_INVALID =
  "A workspace name cannot be empty, start or end with a space, or contain control characters.";
/** What the browser says about a name that is too long. */
export const NAME_TOO_LONG = `A workspace name is at most ${String(NAME_MAX_LENGTH)} characters.`;
/** What the browser says about a domain the service would refuse. */
export const DOMAIN_INVALID = "Enter a lower-case domain name, such as acme.ouroboros.dev.";

/**
 * What is wrong with one class's days, if anything.
 *
 * @param dataClass The class.
 * @param value The days, as typed.
 * @param tier The class's tier, for its bounds.
 * @returns The sentence, or `undefined` when the value may be sent.
 */
export function tierError(
  dataClass: CoreClass,
  value: string,
  tier: RetentionTier,
): string | undefined {
  const days = Number(value);
  const label = CLASS_LABELS[dataClass];

  if (value.trim() === "" || !Number.isSafeInteger(days)) {
    return `${label} retention is a whole number of days.`;
  }
  if (days < tier.floor) {
    return dataClass === "audit"
      ? `${daysLabel(days)} is below the audit floor. ${auditFloorReason(tier.floor)}`
      : `${label} must be kept at least ${daysLabel(tier.floor)}.`;
  }
  if (days > tier.ceiling) return `${label} can be kept at most ${daysLabel(tier.ceiling)}.`;

  return undefined;
}

/**
 * Check the section before anything is sent — the service's own rules, so a refusal it would give
 * is given here, at the input, first.
 *
 * @param draft Every field as it stands.
 * @param baseline What is saved.
 * @param retention The tiers as read, for their bounds.
 * @returns An error per field that is wrong.
 */
export function validateWorkspace(
  draft: WorkspaceCardValues,
  baseline: WorkspaceCardValues,
  retention: RetentionSettings,
): Partial<Record<WorkspaceField, string>> {
  const errors: Partial<Record<WorkspaceField, string>> = {};

  if (draft.name !== baseline.name) {
    if (draft.name.length > NAME_MAX_LENGTH) errors.name = NAME_TOO_LONG;
    else if (!NAME_PATTERN.test(draft.name)) errors.name = NAME_INVALID;
  }
  if (draft.domain !== baseline.domain && !DOMAIN_PATTERN.test(draft.domain)) {
    errors.domain = DOMAIN_INVALID;
  }

  const tiers = effectiveTiers(draft, baseline);
  for (const dataClass of CORE_CLASSES) {
    const tier = tierOf(retention, dataClass);
    if (tier === undefined || tiers[dataClass] === baseline[dataClass]) continue;

    const error = tierError(dataClass, tiers[dataClass], tier);
    if (error === undefined) continue;

    // A tier the select moved is the select's error; one the editor moved is its own.
    const field: WorkspaceField = draft[dataClass] !== baseline[dataClass] ? dataClass : "loopDays";
    errors[field] ??= error;
  }

  return errors;
}

/* ------------------------------------------------------------------ the writes */

/** The section's changes, as the two requests that carry them. */
export interface WorkspacePatches {
  /** For `PATCH /api/v1/settings/workspace`, or `undefined` when neither field changed. */
  readonly workspace?: WorkspaceSettingsPatch;
  /** For `PATCH /api/v1/settings/retention`, or `undefined` when no tier changed. */
  readonly retention?: RetentionPatch;
  /**
   * Which retention fields the reader moved, so a refusal naming a class can be routed back to
   * the control that set it.
   */
  readonly retentionFields: readonly WorkspaceField[];
}

/**
 * Split the section's changes into the two bodies.
 *
 * The retention body is `{loopDays}` when the select is the only retention change — the service's
 * one-control save — and `{classes}` with every tier that differs from what is saved otherwise.
 *
 * @param draft Every field as it stands.
 * @param baseline What is saved.
 * @returns The bodies, each present only when it carries a change.
 */
export function workspacePatches(
  draft: WorkspaceCardValues,
  baseline: WorkspaceCardValues,
): WorkspacePatches {
  const workspace: { name?: string; domain?: string } = {};
  if (draft.name !== baseline.name) workspace.name = draft.name;
  if (draft.domain !== baseline.domain) workspace.domain = draft.domain;

  const retentionFields = (["loopDays", ...CORE_CLASSES] as const).filter(
    (field) => draft[field] !== baseline[field],
  );
  const tiers = effectiveTiers(draft, baseline);
  const classes = Object.fromEntries(
    CORE_CLASSES.filter((dataClass) => tiers[dataClass] !== baseline[dataClass]).map(
      (dataClass) => [dataClass, Number(tiers[dataClass])],
    ),
  );

  const retention: RetentionPatch | undefined =
    Object.keys(classes).length === 0
      ? undefined
      : retentionFields.length === 1 && retentionFields[0] === "loopDays"
        ? { loopDays: Number(draft.loopDays) }
        : { classes };

  return {
    ...(Object.keys(workspace).length > 0 ? { workspace } : {}),
    ...(retention === undefined ? {} : { retention }),
    retentionFields,
  };
}

/** What a refusal is said as on the card, when the name and domain were not written. */
export const WORKSPACE_NOT_SAVED = "Nothing on this card was saved.";

/**
 * What a refusal is said as when the name and domain landed and the tiers did not.
 *
 * @param reason The service's sentence for the retention refusal.
 * @returns The sentence.
 */
export function retentionNotSaved(reason: string): string {
  return `The name and domain were saved; the retention tiers were not. ${reason}`.trim();
}

/** The sentence for a refusal the service gave no words for. */
export const SAVE_FAILED = "The card could not be saved. Try again.";

/**
 * The first message of each field in a refusal's `details.fields`.
 *
 * @param details The `ApiError`'s details.
 * @returns Messages by the service's field path.
 */
function detailFields(details: unknown): Readonly<Record<string, string>> {
  if (typeof details !== "object" || details === null) return {};
  const fields = (details as { fields?: unknown }).fields;
  if (typeof fields !== "object" || fields === null) return {};

  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).flatMap(([path, messages]) => {
      const first = Array.isArray(messages) ? messages[0] : messages;
      return typeof first === "string" && first !== "" ? [[path, first]] : [];
    }),
  );
}

/**
 * Route a workspace refusal's fields to the card's inputs.
 *
 * @param details The `ApiError`'s details.
 * @returns Errors for `name` and `domain`.
 */
export function workspaceFieldErrors(details: unknown): Partial<Record<WorkspaceField, string>> {
  const fields = detailFields(details);
  const errors: Partial<Record<WorkspaceField, string>> = {};

  if (fields.name !== undefined) errors.name = fields.name;
  if (fields.domain !== undefined) errors.domain = fields.domain;

  return errors;
}

/**
 * Route a retention refusal's fields to the card's inputs: `loopDays` to the select,
 * `classes.<class>` to that class's input — or to the select, when it was the select that moved
 * the class.
 *
 * @param details The `ApiError`'s details.
 * @param moved Which retention fields the reader moved ({@link WorkspacePatches.retentionFields}).
 * @returns Errors by field.
 */
export function retentionFieldErrors(
  details: unknown,
  moved: readonly WorkspaceField[],
): Partial<Record<WorkspaceField, string>> {
  const errors: Partial<Record<WorkspaceField, string>> = {};

  for (const [path, message] of Object.entries(detailFields(details))) {
    const dataClass = path.startsWith("classes.") ? path.slice("classes.".length) : null;
    const own = CORE_CLASSES.find((one) => one === dataClass);
    const field: WorkspaceField = own !== undefined && moved.includes(own) ? own : "loopDays";

    errors[field] ??= message;
  }

  return errors;
}
