/**
 * What the audit plane may narrow the log by, and how the query string spells it (BR.2,
 * [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * ```
 * from / to        a time range — from inclusive, to exclusive
 * actorKind        human | bot | service | system
 * actorId          one person — "user".id
 * actorService     one service account or the bot — devops-bot, ouroboros-app
 * action           a plane (policy.*) or one action (policy.published)
 * ref              pr:509 · run:<id> · repo:<ref> · key:<id> · subject:<id>
 * ```
 *
 * **Every filter hits a structured column, never rendered text.** The card composes sentences, but
 * a filter over sentences would be a sequential scan of a table whose whole nature is to grow. Each
 * dimension has a V102 index leading with the workspace and ending in the page order; a reference
 * is either the event's subject (`audit_events_org_subject_idx`) or a containment test on `detail`
 * (`audit_events_detail_refs_idx`).
 *
 * This file is parsing only — pure, and the one place a query-string spelling becomes a predicate
 * shape, so the list, the today view and the CSV export cannot read the same parameters two ways.
 */

import type { AuditActorKind } from "../db/schema";

/** A reference search — a PR number in `detail`, or an id that is the subject or in `detail`. */
export type AuditReference =
  /** `pr:509` — events whose detail names PR #509. */
  | { readonly kind: "pr"; readonly number: number }
  /** `run:<id>` — the run as the subject, or `detail.run_id`. */
  | { readonly kind: "run"; readonly value: string }
  /** `repo:<ref>` — the repository as the subject, or `detail.repo`. */
  | { readonly kind: "repo"; readonly value: string }
  /** `key:<id>` and `subject:<id>` — exactly the event's subject (a provider key is its connection). */
  | { readonly kind: "subject"; readonly value: string };

/** The structured filter one read of the plane applies. Every field is optional. */
export interface AuditPlaneFilter {
  /** Events at or after this instant. */
  readonly from?: Date;
  /** Events strictly before this instant. */
  readonly to?: Date;
  /** One actor kind. */
  readonly actorKind?: AuditActorKind;
  /** One person. */
  readonly actorId?: string;
  /** One service account, or the bot. */
  readonly actorService?: string;
  /** One plane — `policy`. */
  readonly plane?: string;
  /** One action — `policy.published`. Always carries its plane too, so the plane index serves it. */
  readonly action?: string;
  /** A reference search. */
  readonly ref?: AuditReference;
}

/** `policy.*` or `policy.published` — V022's action grammar, or its family with a wildcard. */
export const ACTION_FILTER_PATTERN = /^[a-z][a-z0-9_]*\.(\*|[a-z][a-z0-9_]*)$/;

/**
 * `pr:509`, `run:…`, `repo:…`, `key:…`, `subject:…` — a kind and a value of up to 200 characters
 * with no whitespace or comma (a uuid, a BetterAuth id, `owner/repo`).
 */
export const REFERENCE_PATTERN = /^(pr|run|repo|key|subject):[^\s,]{1,200}$/;

/**
 * Split an action filter into its plane and, when exact, its action.
 *
 * @param text - `policy.*` or `policy.published`, already matched by {@link ACTION_FILTER_PATTERN}.
 * @returns The plane, and the action unless the filter is a wildcard.
 */
export function parseActionFilter(text: string): { plane: string; action?: string } {
  const [plane, event] = text.split(".", 2);

  return event === "*" ? { plane } : { plane, action: text };
}

/**
 * Parse a reference search.
 *
 * @param text - `pr:509` and the like, already matched by {@link REFERENCE_PATTERN}.
 * @returns The reference, or `undefined` for a `pr:` whose number is not a positive integer.
 */
export function parseReference(text: string): AuditReference | undefined {
  const colon = text.indexOf(":");
  const kind = text.slice(0, colon);
  const value = text.slice(colon + 1);

  switch (kind) {
    case "pr": {
      const number = Number(value);
      return /^[1-9]\d{0,9}$/.test(value) && Number.isSafeInteger(number)
        ? { kind: "pr", number }
        : undefined;
    }
    case "run":
    case "repo":
      return { kind, value };
    default:
      // `key:` names a provider key by its connection id, which is the event's subject.
      return { kind: "subject", value };
  }
}

/**
 * The filter, as the flat scalars an `audit.exported` row records — so the trail says exactly what
 * was extracted.
 *
 * @param filter - The filter the export applied.
 * @returns One key per dimension that was set, each a string.
 */
export function filterFacts(filter: AuditPlaneFilter): Record<string, string> {
  const facts: Record<string, string> = {};

  if (filter.from !== undefined) facts.from = filter.from.toISOString();
  if (filter.to !== undefined) facts.to = filter.to.toISOString();
  if (filter.actorKind !== undefined) facts.actor_kind = filter.actorKind;
  if (filter.actorId !== undefined) facts.actor_id = filter.actorId;
  if (filter.actorService !== undefined) facts.actor_service = filter.actorService;
  if (filter.action !== undefined) facts.action = filter.action;
  else if (filter.plane !== undefined) facts.action = `${filter.plane}.*`;
  if (filter.ref !== undefined) facts.ref = referenceText(filter.ref);

  return facts;
}

/**
 * A reference, spelled back as the query string carries it.
 *
 * @param ref - The parsed reference.
 * @returns `pr:509`, `run:…`, `repo:…`, `subject:…`.
 */
export function referenceText(ref: AuditReference): string {
  return ref.kind === "pr" ? `pr:${String(ref.number)}` : `${ref.kind}:${ref.value}`;
}
