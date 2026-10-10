/**
 * The audit card's lines — `time · actor · event`, composed from typed events (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * ```
 * 14:31  ouroboros-app[bot]  pushed PR #514 rev 2           pr_revision.pushed {pr_number, revision}
 * 14:12  Ken                 rotated Anthropic API key      provider.rotated {kind}
 * 13:48  Ken                 enabled auto-merge (policy v7) policy.published {version, changes}
 * 13:22  Maya                approved waiver on PR #509     triage.waived {pr_number}
 * 12:04  system              runner forge-03 marked offline runner.marked_offline {runner}
 * ```
 *
 * **Emitters supply facts; this file composes the sentence.** The inbox's data-composed-prose
 * discipline, applied to the trail: no writer stores an audit line, so a rewording is a release of
 * this file rather than a migration of history, and the CSV and the card cannot disagree because
 * both are this function's output.
 *
 * **Every action has a sentence.** The templates below cover the actions whose facts make a better
 * line than their name; every other action — including the ones SQL triggers write and the ones a
 * later release adds — reads from its own name, `pr_merge_plan.armed` as *pr merge plan armed*.
 * Facts are read defensively: a template whose fact is missing or mistyped degrades to a shorter
 * sentence rather than printing `undefined`.
 */

import type { AuditActorKind } from "../db/schema";
import { parseRuleChanges, ruleChangePhrase } from "../policies/policy-publish";
import type { AuditPlaneRow } from "./audit-plane.repository";

/** A row's facts, as stored. */
type Facts = AuditPlaneRow["detail"];

/** The provider kinds, as a sentence names them (V015's list). */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai_compatible: "OpenAI-compatible",
  ollama: "Ollama",
  copilot: "Copilot",
  cursor: "Cursor",
  custom: "custom provider",
};

/** What the actor column reads for an erased person — the event stays a human's. */
export const ERASED_ACTOR_LABEL = "former member";

/** What the actor column reads when nobody did it. */
export const SYSTEM_ACTOR_LABEL = "system";

/**
 * A fact as a string, when it is one.
 *
 * @param facts - The row's detail.
 * @param key - The fact.
 * @returns The value, or `undefined` when absent, empty, or not a string.
 */
function text(facts: Facts, key: string): string | undefined {
  const value = facts[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * A fact as a number, when it is one.
 *
 * @param facts - The row's detail.
 * @param key - The fact.
 * @returns The value, or `undefined`.
 */
function count(facts: Facts, key: string): number | undefined {
  const value = facts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `N things`, pluralised.
 *
 * @param n - How many.
 * @param noun - The singular noun.
 * @returns `1 row`, `3 rows`.
 */
function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The provider a `provider.*` event is about.
 *
 * @param facts - The row's detail.
 * @returns `Anthropic`, or `provider` when the kind is missing.
 */
function provider(facts: Facts): string {
  const kind = text(facts, "kind");
  return kind === undefined ? "provider" : (PROVIDER_LABELS[kind] ?? kind);
}

/**
 * `PR #509`, when the event names one.
 *
 * @param facts - The row's detail.
 * @returns The phrase, or `undefined`.
 */
function pr(facts: Facts): string | undefined {
  const number = count(facts, "pr_number");
  return number === undefined ? undefined : `PR #${String(number)}`;
}

/** A sentence from a row's facts. */
type Template = (facts: Facts) => string;

/** The provider lifecycle, which every reader wants by provider name. */
const PROVIDER_TEMPLATES: Readonly<Record<string, Template>> = {
  "provider.added": (f) => `connected ${provider(f)}`,
  "provider.revealed": (f) => `revealed ${provider(f)} API key`,
  "provider.rotated": (f) => `rotated ${provider(f)} API key`,
  "provider.enabled": (f) => `enabled ${provider(f)}`,
  "provider.disabled": (f) => `disabled ${provider(f)}`,
  "provider.cap_changed": (f) => `changed ${provider(f)} spend cap`,
  "provider.updated": (f) => `updated ${provider(f)}`,
  "provider.deleted": (f) => `removed ${provider(f)}`,
  "provider.tested": (f) => `tested ${provider(f)}`,
};

/** The actions whose facts make a better line than their name. */
const TEMPLATES: Readonly<Record<string, Template>> = {
  ...PROVIDER_TEMPLATES,
  "pr_revision.pushed": (f) => {
    const revision = count(f, "revision");
    const subject = pr(f) ?? "a PR revision";
    return revision === undefined
      ? `pushed ${subject}`
      : `pushed ${subject} rev ${String(revision)}`;
  },
  "policy.published": (f) => {
    const version = count(f, "version");
    const changes = parseRuleChanges(f.changes).map(({ ruleId, verb }) =>
      ruleChangePhrase(ruleId, verb),
    );
    const what = changes.length === 0 ? "published the policy" : changes.join(", ");
    return version === undefined ? what : `${what} (policy v${String(version)})`;
  },
  "triage.waived": (f) => {
    const target = pr(f);
    if (target !== undefined) return `approved waiver on ${target}`;
    const cases = count(f, "cases");
    return cases === undefined || cases === 0
      ? "approved waiver"
      : `approved waiver on ${plural(cases, "case")}`;
  },
  "runner.marked_offline": (f) => {
    const runner = text(f, "runner");
    return runner === undefined ? "runner marked offline" : `runner ${runner} marked offline`;
  },
  "audit.exported": (f) => {
    const rows = count(f, "rows");
    return rows === undefined ? "exported the audit log" : `exported ${plural(rows, "audit row")}`;
  },
  "audit.purged": (f) => {
    const removed = count(f, "removed") ?? 0;
    const days = count(f, "days");
    const older = days === undefined ? "" : ` older than ${String(days)}d`;
    return `purged ${plural(removed, "audit row")}${older}`;
  },
  "notification_route.updated": (f) => {
    const kind = text(f, "kind");
    return kind === undefined
      ? "updated a notification route"
      : `updated the ${kind.replaceAll("_", " ")} notification route`;
  },
  "regression_watch.policy_updated": (f) =>
    f.autoFile === true && f.previousAutoFile !== true
      ? "let the regression watch file and queue fixes without asking"
      : f.autoFile !== true && f.previousAutoFile === true
        ? "stopped the regression watch filing fixes without asking"
        : `turned the regression watch's automatic bisects ${f.autoBisect === true ? "on" : "off"}`,
};

/**
 * The fallback: an action read from its own name — `pr_merge_plan.armed` as *pr merge plan armed*.
 *
 * @param action - `family.event`.
 * @returns The phrase.
 */
function fromName(action: string): string {
  const [family, event = ""] = action.split(".", 2);
  return `${family.replaceAll("_", " ")} ${event.replaceAll("_", " ")}`.trim();
}

/**
 * The event half of a line.
 *
 * A failed operation is still an event — AD.4 records refusals under the action their success
 * would have used, with `outcome: failure` — so the sentence says it failed.
 *
 * @param row - The row's action and facts.
 * @returns The sentence, never empty.
 */
export function eventSentence(row: Pick<AuditPlaneRow, "action" | "detail">): string {
  const template = TEMPLATES[row.action] as Template | undefined;
  const sentence = template === undefined ? fromName(row.action) : template(row.detail);

  return row.detail.outcome === "failure" ? `${sentence} (failed)` : sentence;
}

/**
 * The actor half of a line.
 *
 * @param row - The row's attribution.
 * @returns A person's first name (the mockup's *Ken*), `ouroboros-app[bot]` for the bot,
 *   `service:<name>` for a service account, `system`, or {@link ERASED_ACTOR_LABEL}.
 */
export function actorLabel(
  row: Pick<AuditPlaneRow, "actor_kind" | "actor_name" | "actor_service">,
): string {
  const kind: AuditActorKind = row.actor_kind;

  switch (kind) {
    case "human": {
      const first = row.actor_name?.trim().split(/\s+/, 1)[0];
      return first === undefined || first === "" ? ERASED_ACTOR_LABEL : first;
    }
    case "bot":
      return `${row.actor_service ?? "bot"}[bot]`;
    case "service":
      return `service:${row.actor_service ?? "unknown"}`;
    case "system":
      return SYSTEM_ACTOR_LABEL;
  }
}
