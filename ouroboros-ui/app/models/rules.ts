/**
 * Every decision the **Escalation rules** card and its **+ Add rule** builder make, as
 * functions with inputs and outputs.
 *
 * The card ([#204](https://github.com/NobuData/ouroboros/issues/204)) renders sentences, and
 * sentences invite free-text editing. But a rule the system cannot evaluate is decoration —
 * the switch toggles and routing does not change. So nothing on this surface takes a string
 * and stores it: the sentence a row prints is the database's generated `display` (V018),
 * rendered and never composed, and the builder composes **structure** — a predicate, an
 * action, a target — from closed lists, sends that, and lets the server write the sentence.
 *
 * **Framework-free and pure**, like `app/models/matrix.ts` beside it: nothing here imports
 * React, `next/*` or the server-only client. The writes are `app/models/rule-actions.ts`'s
 * and the drawing is `app/models/rules-card.tsx`'s and `app/models/rule-builder.tsx`'s. The
 * result types those two exchange live here rather than beside the actions, because a
 * `"use server"` module may export nothing but async functions.
 *
 * ### The violet alias, without composing the sentence
 *
 * Mockup 06 draws the alias name inside each sentence in the model hue. The sentence is one
 * string this application may not assemble, so the highlight is a **derivation over it**
 * rather than a second rendering: {@link ruleSegments} takes the alias the rule's `then`
 * names — a fact of the structure, not of the text — and finds it in the sentence after the
 * verb the grammar puts in front of it. The string printed is `display`, character for
 * character; what this decides is only which characters of it are violet. A rule whose
 * structure names no alias (`route_local`) is drawn in one piece.
 *
 * ### Invalid structures are unreachable, not rejected
 *
 * The builder's draft is a discriminated shape: which predicate, which action, and the one
 * operand each takes. {@link composeRule} is total over every value a select can hold —
 * three predicates × three actions × the workspace's own kinds and aliases — and produces a
 * `CreateEscalationRule` the contract admits for every one of them. The two things a draft
 * can be missing are a GitHub label (the one operand the grammar takes from outside the
 * product's vocabulary) and a workspace with nothing to name, and both are a *reason* the
 * submit control carries rather than a refusal after the press.
 */

import type {
  CreateEscalationRule,
  EscalationRule,
  EscalationThen,
  EscalationWhen,
  RoutingAlias,
} from "@/app/api/routing";

import { type AliasCell, aliasCell } from "./matrix";

/* ------------------------------------------------------------------ the card */

/** The card's title, as mockup 06 sets it. */
export const RULES_TITLE = "Escalation rules";

/**
 * How many rules apply.
 *
 * The contract's own definition: *the card's `N active` is the count of these that are
 * true*. A disabled rule keeps its row, its sentence and its place in the order, and is not
 * counted — the count says what routing does, not how many rows the card has.
 *
 * @param rules Every rule, enabled and disabled alike.
 * @returns How many are enabled.
 */
export function activeRuleCount(rules: readonly EscalationRule[]): number {
  return rules.filter((rule) => rule.enabled).length;
}

/**
 * The count chip beside the title — the mockup's `3 active`.
 *
 * @param count How many rules are enabled.
 * @returns The chip's label. `0 active` is a true statement about a card whose every switch
 *   is off, and is drawn rather than hidden.
 */
export function activeCountLabel(count: number): string {
  return `${count} active`;
}

/**
 * The alias a rule's action names, or `null` for the one action that names none.
 *
 * @param rule The rule.
 * @returns The alias, or `null` for `route_local`.
 */
export function ruleAlias(rule: EscalationRule): string | null {
  const then = rule.then;

  if ("use_alias" in then) return then.use_alias.alias;

  return "add_vote" in then ? then.add_vote.alias : null;
}

/** One run of a rule's sentence: either the alias, drawn in the model hue, or not. */
export interface SentenceSegment {
  /** The characters, exactly as `display` holds them. */
  readonly text: string;
  /** Whether this run is the alias the rule names. */
  readonly alias: boolean;
}

/** What separates a rule's condition from its action, as V018 joins them. */
const ARROW = " → ";

/**
 * The verb V018 puts in front of the alias, per action. The alias is found *after* it, so a
 * task kind that happens to share the alias's spelling (`docs` uses `docs`) cannot be the
 * match.
 */
const VERB = { use_alias: " uses ", add_vote: " adds " } as const;

/**
 * A rule's sentence, split at the alias it names.
 *
 * The segments concatenate to `display` exactly — nothing is added, dropped or re-spelled —
 * and the only decision made is which run is the alias. A sentence in which the alias cannot
 * be found after its verb is returned in one piece rather than guessed at, which is the
 * right answer for a `display` the database has since learned to render differently.
 *
 * @param rule The rule.
 * @returns One segment for a rule naming no alias; up to three otherwise, with empty runs
 *   dropped so a sentence ending in the alias has no trailing empty segment.
 */
export function ruleSegments(rule: EscalationRule): readonly SentenceSegment[] {
  const { display, then } = rule;
  const whole = [{ text: display, alias: false }];
  const alias = ruleAlias(rule);

  if (alias === null) return whole;

  const verb = "use_alias" in then ? VERB.use_alias : VERB.add_vote;
  const arrow = display.lastIndexOf(ARROW);
  const at = display.indexOf(`${verb}${alias}`, arrow === -1 ? 0 : arrow);

  if (at === -1) return whole;

  const start = at + verb.length;
  const end = start + alias.length;

  return [
    { text: display.slice(0, start), alias: false },
    { text: alias, alias: true },
    { text: display.slice(end), alias: false },
  ].filter((segment) => segment.text !== "");
}

/**
 * A rule's switch's accessible name.
 *
 * What pressing it decides — whether this rule *applies* — followed by the sentence, because
 * a card of three switches needs three distinguishable names and the sentence is the only
 * thing that tells them apart. `aria-checked` carries the position, so the name never
 * changes with it.
 *
 * @param rule The rule.
 * @returns The name.
 */
export function ruleSwitchLabel(rule: EscalationRule): string {
  return `Apply ${rule.display}`;
}

/**
 * A rule's delete control's accessible name.
 *
 * @param rule The rule.
 * @returns The name, carrying the sentence so a reader knows which rule the control is for.
 */
export function deleteRuleLabel(rule: EscalationRule): string {
  return `Delete rule: ${rule.display}`;
}

/**
 * What a member — who sees no switch — reads beside a rule that is switched off.
 *
 * A word rather than a hue: a muted sentence tells a reader with no colour vision nothing,
 * and a member with no control to inspect has no other way to learn the rule is suspended.
 */
export const RULE_OFF = "off";

/** The mockup's button, as it prints it. */
export const ADD_RULE = "+ Add rule";

/** What the card says to a workspace with no rules. */
export const NO_RULES_TITLE = "No escalation rules";

/**
 * …and what a rule is for, in one sentence, without pretending there is one.
 *
 * The three actions the grammar admits, named in order, so a reader learns the shape of what
 * the builder can make before they open it.
 */
export const NO_RULES_NOTE =
  "A rule escalates a task kind to a stronger alias, adds a second-opinion vote, or routes " +
  "everything local when its condition holds. Routing runs without any.";

/* ------------------------------------------------------------------ the writes' results */

/**
 * What a write answers with: that it landed, or the sentence to show for a refusal.
 *
 * A refusal is a value rather than a throw because it is **a state to render** — one row's
 * control failing must not replace the page the reader is still entitled to be on. The
 * caller refreshes the route on `ok`, so there is nothing to carry back but the fact.
 */
export type RuleWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * What the builder reads when it opens: every alias the workspace has, each with the
 * resolution line the matrix draws for it — or why the list could not be read.
 */
export type RuleTargetsReading =
  | { readonly ok: true; readonly aliases: readonly AliasCell[] }
  | { readonly ok: false; readonly reason: string };

/**
 * One alias as the builder's select offers it: the name, and what it currently means.
 *
 * The same cell the matrix draws, from the registry list rather than from a chain, so the
 * option a rule is composed from and the pill the matrix prints for it agree about what the
 * alias resolves to.
 *
 * @param alias The alias from `GET /api/v1/routing/aliases`.
 * @returns The name and its resolution line.
 */
export function ruleTarget(alias: RoutingAlias): AliasCell {
  return aliasCell(alias);
}

/** The `code` the contract answers when a role may read the card and not write to it. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` the contract answers for a rule that no longer exists. */
export const RULE_NOT_FOUND_CODE = "escalation_rule_not_found";

/**
 * Why a member's press did not take — the sentence a role that reached a write anyway is
 * shown, in the words the card would have used had it drawn the control for them.
 */
export const RULE_FORBIDDEN = "Only an owner or an admin can change escalation rules.";

/** What a switch or a delete says for a rule somebody else removed first. */
export const RULE_GONE = "This rule has already been removed. Reload to see the card as it stands.";

/** What a write says when the service refused it without a sentence of its own. */
export const RULE_WRITE_FAILURE = "The rule could not be saved.";

/** What the builder says when the registry list could not be read. */
export const TARGETS_UNAVAILABLE =
  "The registry could not be read, so a rule cannot name an alias right now.";

/* ------------------------------------------------------------------ the builder's vocabulary */

/** The three conditions a rule may test — V018's grammar, in the order it renders them. */
export const PREDICATES = ["effort_gte", "label", "diff_kind"] as const;

/** One of {@link PREDICATES}. */
export type Predicate = (typeof PREDICATES)[number];

/** The three route modifications a rule may make. */
export const ACTIONS = ["use_alias", "add_vote", "route_local"] as const;

/** One of {@link ACTIONS}. */
export type Action = (typeof ACTIONS)[number];

/** The effort scale, smallest first — the estimator's own. */
export const EFFORT_LEVELS = ["xs", "s", "m", "l", "xl"] as const;

/** One of {@link EFFORT_LEVELS}. */
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The diff classifications a rule may test. One value today, and honestly so: a
 * classification nothing computes is a rule that can never fire.
 */
export const DIFF_KINDS = ["docs_only"] as const;

/** One of {@link DIFF_KINDS}. */
export type DiffKind = (typeof DIFF_KINDS)[number];

/**
 * What a `use_alias` rule may say about thinking — the registry's own vocabulary (V019,
 * decision R3), plus `inherit`, which is *send no param and let the alias's own default
 * stand*.
 *
 * The one param the builder offers, because it is the one mockup 06 draws (`(max thinking)`)
 * and the one every rule in the seed uses. The contract admits any scalar param; a builder
 * offering a free-form key would be offering a param that renders in the sentence and means
 * nothing to the model, which is the thing this surface exists not to do.
 */
export const THINKING_CHOICES = ["inherit", "off", "std", "max"] as const;

/** One of {@link THINKING_CHOICES}. */
export type ThinkingChoice = (typeof THINKING_CHOICES)[number];

/** What each predicate is called in the builder. */
export const PREDICATE_LABELS: Readonly<Record<Predicate, string>> = {
  effort_gte: "Effort is at least",
  label: "Issue carries the label",
  diff_kind: "The diff is",
};

/** What each action is called in the builder. */
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  use_alias: "Use an alias for a task kind",
  add_vote: "Add a vote to a task kind",
  route_local: "Route everything local",
};

/** What each effort level is called — the scale's own letters, as the sentence prints them. */
export const EFFORT_LABELS: Readonly<Record<EffortLevel, string>> = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

/** What each diff kind is called — the sentence's own spelling. */
export const DIFF_KIND_LABELS: Readonly<Record<DiffKind, string>> = {
  docs_only: "docs-only",
};

/** What each thinking choice is called. */
export const THINKING_LABELS: Readonly<Record<ThinkingChoice, string>> = {
  inherit: "The alias's own thinking",
  off: "Thinking off",
  std: "Standard thinking",
  max: "Max thinking",
};

/**
 * Whether an action names a task kind and an alias.
 *
 * @param action The action.
 * @returns `true` for the two that do; `false` for `route_local`, which modifies every kind
 *   and therefore names none.
 */
export function needsTarget(action: Action): boolean {
  return action !== "route_local";
}

/* ------------------------------------------------------------------ the builder's draft */

/**
 * What the builder holds while a rule is being composed: one value per select, all of them
 * present, so switching the predicate or the action never loses what was chosen for the
 * other.
 *
 * Only the operand the current `predicate` and `action` read is sent — {@link composeRule}
 * takes exactly the fields the structure needs and ignores the rest — which is what makes a
 * draft carrying a task kind *and* `route_local` a valid draft rather than an invalid rule.
 */
export interface RuleDraft {
  /** Which condition. */
  readonly predicate: Predicate;
  /** The operand of `effort_gte`. */
  readonly effort: EffortLevel;
  /** The operand of `label`: a GitHub label name, as GitHub spells it. */
  readonly label: string;
  /** The operand of `diff_kind`. */
  readonly diffKind: DiffKind;
  /** Which route modification. */
  readonly action: Action;
  /** The task kind `use_alias` and `add_vote` name. Empty when the workspace has none. */
  readonly taskKind: string;
  /** The alias they name. Empty until the registry list has been read. */
  readonly alias: string;
  /** The one param `use_alias` may carry. */
  readonly thinking: ThinkingChoice;
}

/**
 * The builder's opening state — mockup 06's own first rule, with the workspace's first task
 * kind and alias as the targets.
 *
 * The seed's rule rather than empty selects, because a select with no chosen value is a
 * control that lies about being a choice; and the mockup's because a reader who opens the
 * builder should see the shape of a rule they have already read on the card.
 *
 * @param taskKinds The workspace's task kinds, in the matrix's order.
 * @param aliases The workspace's aliases, in the registry's order — or none, before the list
 *   has been read.
 * @returns The draft.
 */
export function initialDraft(
  taskKinds: readonly string[],
  aliases: readonly string[] = [],
): RuleDraft {
  return {
    predicate: "effort_gte",
    effort: "l",
    label: "",
    diffKind: "docs_only",
    action: "use_alias",
    taskKind: taskKinds[0] ?? "",
    alias: aliases[0] ?? "",
    thinking: "max",
  };
}

/**
 * A draft with the alias filled in once the registry list has arrived, when it had none.
 *
 * @param draft The draft as it stands.
 * @param aliases The aliases the read produced, in the registry's order.
 * @returns The draft, naming the first alias if it named none. A draft that already names
 *   one is returned as it is, so a read arriving late does not overwrite a choice.
 */
export function withAliases(draft: RuleDraft, aliases: readonly string[]): RuleDraft {
  if (draft.alias !== "" || aliases.length === 0) return draft;

  return { ...draft, alias: aliases[0] };
}

/** Why a draft cannot be sent: the label predicate has no label. */
export const LABEL_REQUIRED = "Name the GitHub label the rule fires on.";

/** Why a draft cannot be sent: nothing to name. */
export const NO_TASK_KINDS = "This workspace has no task kinds for a rule to name.";

/** Why a draft cannot be sent: nothing to name, the other half. */
export const NO_ALIASES =
  "This workspace has no aliases for a rule to name — create one in the Model registry.";

/**
 * A draft's predicate, as the contract's `when` document — or `null` when it needs a label
 * it does not have.
 *
 * Exactly one condition, always. The grammar ANDs several; the builder offers one, because
 * mockup 06's three rules each test one and a builder that composed conjunctions would need a
 * second row of controls this card has no room for. That is a scope decision, not a
 * constraint of the contract.
 *
 * @param draft The draft.
 * @returns The predicate, or `null`.
 */
export function composeWhen(draft: RuleDraft): EscalationWhen | null {
  switch (draft.predicate) {
    case "effort_gte":
      return { effort_gte: draft.effort };
    case "label": {
      // The schema refuses a label with surrounding whitespace, so the draft's is trimmed
      // here rather than refused for a space a reader cannot see.
      const label = draft.label.trim();
      return label === "" ? null : { label };
    }
    case "diff_kind":
      return { diff_kind: draft.diffKind };
  }
}

/**
 * A draft's action, as the contract's `then` document.
 *
 * Total: every action has a shape, and the shape carries exactly the fields the union
 * requires for it. The caller checks that the target names something the workspace has.
 *
 * @param draft The draft.
 * @returns The action.
 */
export function composeThen(draft: RuleDraft): EscalationThen {
  switch (draft.action) {
    case "use_alias":
      return {
        use_alias: {
          task_kind: draft.taskKind,
          alias: draft.alias,
          // `inherit` sends no `params` at all: the contract refuses an empty object, and
          // *no params* is how "the alias's own defaults" is said.
          ...(draft.thinking === "inherit" ? {} : { params: { thinking: draft.thinking } }),
        },
      };
    case "add_vote":
      return { add_vote: { task_kind: draft.taskKind, alias: draft.alias } };
    case "route_local":
      return { route_local: {} };
  }
}

/** What composing a draft produces: a rule to send, or why there is not one yet. */
export type Composed =
  | { readonly ok: true; readonly rule: CreateEscalationRule }
  | { readonly ok: false; readonly reason: string };

/**
 * The rule a draft describes, or the one thing it is missing.
 *
 * @param draft The draft.
 * @param taskKinds The task kinds the workspace has.
 * @param aliases The aliases it has.
 * @returns The `CreateEscalationRule` to send — `when` and `then` only, so `enabled` and
 *   `sortOrder` take the contract's defaults (on, and appended) — or the reason the submit
 *   control is inert.
 */
export function composeRule(
  draft: RuleDraft,
  taskKinds: readonly string[],
  aliases: readonly string[],
): Composed {
  const when = composeWhen(draft);
  if (when === null) return { ok: false, reason: LABEL_REQUIRED };

  if (needsTarget(draft.action)) {
    if (!taskKinds.includes(draft.taskKind)) return { ok: false, reason: NO_TASK_KINDS };
    if (!aliases.includes(draft.alias)) return { ok: false, reason: NO_ALIASES };
  }

  return { ok: true, rule: { when, then: composeThen(draft) } };
}

/* ------------------------------------------------------------------ the builder's copy */

/** The dialog's title. */
export const BUILDER_TITLE = "Add rule";

/**
 * What the dialog says about the sentence it does not let anybody type.
 *
 * The one place the surface explains itself: a reader looking for the text box is told why
 * there is none, and where the sentence comes from instead.
 */
export const BUILDER_NOTE =
  "A rule is structure — a condition, an action and its target. The sentence the card " +
  "prints is written by the server from that structure once the rule is saved, so there is " +
  "nothing to type.";

/** What the dialog says while the registry list is on its way. */
export const TARGETS_LOADING = "Reading the registry…";

/** The submit control. Not the mockup's `+ Add rule`: the plus is for opening the dialog. */
export const SAVE_RULE = "Save rule";

/** The confirmation's title. */
export const DELETE_TITLE = "Delete this rule?";

/**
 * The confirmation's note — which says what the switch is for, because a reader who wanted
 * to suspend a rule and reached for delete should be told the difference before pressing.
 */
export const DELETE_NOTE =
  "Deleting removes the rule and its place in the evaluation order. To suspend it and keep " +
  "its place, switch it off instead.";

/** The confirmation's destructive control. */
export const DELETE_RULE = "Delete rule";

/** Every dialog's way out. */
export const CANCEL = "Cancel";
