/**
 * What pre-selects a Mark & Route radio, and what its affix may say
 * ([#340](https://github.com/NobuData/ouroboros/issues/340)) — with the four classes it chooses
 * among.
 *
 * **The affix is decided by the answer's `actor`, not by copy** ({@link pickView}). The mockup
 * prints `AI pick · 84%`; until AV.1 ([#343](https://github.com/NobuData/ouroboros/issues/343)) the
 * pre-selection is a deterministic rule's, so the affix reads `heuristic` and names the rule.
 * {@link PickView} is a union whose only variant *able to carry* a percentage is `model`, built
 * only from an answer whose actor is `model` — the failure card's rule (`failure.ts`), applied to
 * the surface most able to mislead.
 *
 * **Two things can suggest a class**: the attempt's hints, which the failure-detail card states,
 * and a classification a rule or a model stored (V055's `actor`). A person's classification is a
 * decision, not a suggestion, and is `mark-route-decision.ts`'s.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  CaseHint,
  Classification,
  FailureClass,
  TestRunHints,
} from "@/app/api/test-results";

import { confidenceText, ruleCondition, triageActor } from "./failure";

/** The affix of a rule's pick, before the rule is named. */
export const HEURISTIC_AFFIX = "heuristic";

/** The affix of a model's pick, before its confidence — the mockup's `AI pick`. */
export const AI_PICK_AFFIX = "AI pick";

/** What separates an affix's parts. */
const AFFIX_SEPARATOR = " · ";

/** Anything that reads as a percentage. */
const PERCENTAGE = /\d\s*%/;

/** The four classes, in the mockup's order, as the radios name them. */
export const CLASSES: readonly { readonly value: FailureClass; readonly label: string }[] = [
  { value: "product_bug", label: "Product bug" },
  { value: "test_update", label: "Test needs update" },
  { value: "flake_retry", label: "Flake — retry" },
  { value: "infra_rig", label: "Infra — rig issue" },
];

/** The classes whose route is a correction round, and so carry a note (#332). */
const CORRECTION_CLASSES: readonly FailureClass[] = ["product_bug", "test_update"];

/** The actor of a decision a person made (V055). */
export const HUMAN_ACTOR = "human";

// --- the classes ------------------------------------------------------------------------------------

/**
 * Whether a class queues a correction round, and so carries a note.
 *
 * @param value The class, or `null`.
 * @returns `true` for `product_bug` and `test_update`.
 */
export function isCorrection(value: FailureClass | null): boolean {
  return value !== null && CORRECTION_CLASSES.includes(value);
}

// --- the pick ---------------------------------------------------------------------------------------

/**
 * What pre-selects a radio, and what its affix may say.
 *
 * Only `model` has a percentage to draw, and only {@link casePick} builds one — from an answer
 * whose actor is `model`.
 */
export type PickView =
  /** Nothing suggested a class — no radio is pre-selected. */
  | { readonly kind: "none" }
  /** A deterministic rule's suggestion. */
  | {
      readonly kind: "heuristic";
      readonly class: FailureClass;
      /** `heuristic · new failure ∩ diff-path overlap`. Never a percentage. */
      readonly affix: string;
      /** Why the rule fired, in the service's sentence, or `null`. */
      readonly reason: string | null;
    }
  /** A model's suggestion (#343). */
  | {
      readonly kind: "model";
      readonly class: FailureClass;
      /** `AI pick · 84%`, or `AI pick` when the answer carries no readable confidence. */
      readonly affix: string;
    };

/** No pick. */
const NO_PICK: PickView = { kind: "none" };

/**
 * A field of something that may not be an object.
 *
 * @param value Anything.
 * @param key The field.
 * @returns The field's value, or `undefined`.
 */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * A value as one of the four classes.
 *
 * @param value Anything.
 * @returns The class, or `null` for anything that is not one.
 */
export function asFailureClass(value: unknown): FailureClass | null {
  return CLASSES.find((each) => each.value === value)?.value ?? null;
}

/**
 * What a class is called on the card.
 *
 * @param value The class.
 * @returns `Product bug`.
 */
export function classLabel(value: FailureClass): string {
  return CLASSES.find((each) => each.value === value)?.label ?? value;
}

/**
 * A rule's affix.
 *
 * @param ruleId The rule's id, or `null` when the answer names none.
 * @returns `heuristic · new failure ∩ diff-path overlap`. **Never a percentage**: a rule whose
 *   name would read as one — which no rule of this service does — is left unnamed.
 */
export function heuristicAffix(ruleId: string | null): string {
  const rule = ruleCondition(ruleId);

  return rule === null || PERCENTAGE.test(rule)
    ? HEURISTIC_AFFIX
    : `${HEURISTIC_AFFIX}${AFFIX_SEPARATOR}${rule}`;
}

/**
 * One case's pick, from its hint entry.
 *
 * @param entry The case's hint entry.
 * @returns The model's pick when the answer's actor is `model` and it names a class; otherwise
 *   the rule's; `none` when nothing suggested a class this card knows.
 *   **A confidence is read only on the `model` path.**
 */
export function casePick(entry: CaseHint): PickView {
  const actor = triageActor(entry);

  if (actor === "model") {
    const suggested = asFailureClass(field(entry.triage, "class"));
    if (suggested === null) return { kind: "none" };

    const confidence = confidenceText(field(entry.triage, "confidence"));

    return {
      kind: "model",
      class: suggested,
      affix:
        confidence === null ? AI_PICK_AFFIX : `${AI_PICK_AFFIX}${AFFIX_SEPARATOR}${confidence}`,
    };
  }

  // The model path ends above. From here nothing reads `confidence`.
  if (actor === null) return { kind: "none" };

  const suggested =
    asFailureClass(field(entry.hint, "suggestedClass")) ??
    asFailureClass(field(entry.triage, "class"));
  if (suggested === null) return { kind: "none" };

  const ruleId =
    field(entry.hint, "ruleId") ?? field(field(entry.triage, "provenance"), "rule_id");
  const reason = field(entry.hint, "reason");

  return {
    kind: "heuristic",
    class: suggested,
    affix: heuristicAffix(typeof ruleId === "string" && ruleId.trim() !== "" ? ruleId : null),
    reason: typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null,
  };
}

/**
 * The pick a stored classification carries — one a rule or a model wrote, not a person.
 *
 * @param stored The classification.
 * @returns The model's pick when its actor is `model`; the rule's when it is `heuristic`;
 *   `none` for a person's decision, which is a decision and not a suggestion.
 *   **A confidence is read only on the `model` path.**
 */
export function storedPick(
  stored: Pick<Classification, "actor" | "class" | "ruleId" | "confidence">,
): PickView {
  const suggested = asFailureClass(stored.class);
  if (suggested === null || stored.actor === HUMAN_ACTOR) return { kind: "none" };

  if (stored.actor === "model") {
    const confidence = confidenceText(stored.confidence);

    return {
      kind: "model",
      class: suggested,
      affix:
        confidence === null ? AI_PICK_AFFIX : `${AI_PICK_AFFIX}${AFFIX_SEPARATOR}${confidence}`,
    };
  }

  // The model path ends above. From here nothing reads `confidence`.
  return {
    kind: "heuristic",
    class: suggested,
    affix: heuristicAffix(stored.ruleId),
    reason: null,
  };
}

/**
 * The pick for the failure on the card.
 *
 * @param hints The attempt's hints, or `null` when they have not been read.
 * @param caseId The failure's case.
 * @param classifications The attempt's current classifications. A rule's or a model's is a
 *   suggestion, read here; a person's is a decision, and is not. Empty when absent.
 * @returns A model's pick when either source carries one; otherwise the hint's — what the
 *   failure-detail card states — and then the stored suggestion's; `none` when nothing suggested
 *   a class.
 */
export function pickView(
  hints: TestRunHints | null,
  caseId: string,
  classifications: readonly Classification[] = [],
): PickView {
  const entry = hints?.cases.find((each) => each.caseId === caseId);
  const suggestion = classifications.find(
    (each) => each.testCaseId === caseId && each.actor !== HUMAN_ACTOR,
  );
  const picks = [
    entry === undefined ? NO_PICK : casePick(entry),
    suggestion === undefined ? NO_PICK : storedPick(suggestion),
  ];

  return (
    picks.find((each) => each.kind === "model") ??
    picks.find((each) => each.kind !== "none") ??
    NO_PICK
  );
}
