/**
 * The trail's vocabulary — what may be recorded, and what a record may carry.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)). This module holds no
 * behaviour at all: it is the set of names the writers agree on and the shape they agree to
 * write, in one file, so that `where action = 'provider.revealed'` finds every reveal.
 *
 * ---------------------------------------------------------------------------
 * **Why the vocabulary is here and not in the schema mirror.** V022 constrains `action` to
 * an identifier grammar and deliberately *not* to a list — adding an event has to be an
 * application release rather than a migration. So `db/schema.ts` declares `action: string`,
 * which is what the column holds, and this file declares what this service writes. The two
 * are different questions and drift for different reasons.
 *
 * **Nothing here is secret material, and the type says so.** {@link AuditDetail} is a flat
 * record of scalars, which is not a stylistic preference: flatness is what makes
 * *enumerate the keys and you have read the whole payload* true, and both secrecy greps —
 * `audit.secrecy.spec.ts` here and the `audit_events` section of `ouroboros-db`'s
 * `tests/seed.sql` — depend on it. A nested object would give a credential somewhere to hide
 * from a top-level scan.
 *
 * There is also nothing in this file that *takes* a credential. No builder below has a
 * parameter a plaintext, a mask or an envelope could be passed to, which is a stronger
 * statement than a rule about what callers should do: the compiler refuses the call.
 */

/**
 * The kind of thing an event is about.
 *
 * Half of V022's deliberately non-referential subject — see that migration on why an event
 * about a connection must outlive the connection. Three members today; #26 adds
 * `organization` when it lands its own events.
 *
 * `runner` and `enrollment_token` joined with AH.2
 * ([#250](https://github.com/NobuData/ouroboros/issues/250)), and they are the first subjects
 * here that name a machine rather than a person's credential. The rule is AD.4's own, applied
 * one epic further out: an operation that changes who may connect to a workspace is audited
 * from the day it exists. A runner's `subjectId` is its row id; an enrollment token's is its
 * row id too — never its value, which by then exists only as an envelope.
 *
 * `runner_pool` joined with AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)),
 * which owns mockup 08's POOLS card. A pool is not a credential, and it is audited for the
 * neighbouring reason: it decides what a build runs *under* — the executor, the pinned image
 * and the environment a job may carry onto a machine this product does not administer. An
 * `env_allowlist` widened by one name is a change somebody has to be able to find later.
 *
 * `github_credential` joined with K.3 ([#101](https://github.com/NobuData/ouroboros/issues/101)):
 * a workspace's GitHub token is a credential like a provider's, and decision **AD.4**'s rule
 * is that credential operations are audited from the day they exist rather than from the day
 * somebody asks who changed one. Its `subjectId` is the workspace id — there is one token per
 * workspace, so the credential has no identity of its own to name.
 */
export type AuditSubjectType =
  | "provider_connection"
  | "run"
  | "github_credential"
  | "runner"
  | "runner_pool"
  | "enrollment_token";

/** A provider connection was created — or an attempt to create one was refused. */
export const PROVIDER_ADDED_EVENT = "provider.added";

/** A stored provider credential was handed back to a person — or a request for one was refused. */
export const PROVIDER_REVEALED_EVENT = "provider.revealed";

/** A provider credential was replaced by a new, live-validated one — or the replacement failed. */
export const PROVIDER_ROTATED_EVENT = "provider.rotated";

/** A connection was switched on. */
export const PROVIDER_ENABLED_EVENT = "provider.enabled";

/** A connection was switched off. */
export const PROVIDER_DISABLED_EVENT = "provider.disabled";

/** A connection's monthly spend cap moved. */
export const PROVIDER_CAP_CHANGED_EVENT = "provider.cap_changed";

/**
 * A connection's settings changed in some way the three names above do not single out — its
 * name, its address, its capability note, or more than one thing at once.
 *
 * **AD.4's scope does not list this name and AD.2 already writes it**, which is worth an
 * argument rather than a shrug. That scope names `enabled`, `disabled` and `cap_changed`
 * because those are the three settings mockup 07 exposes as affordances of their own — the
 * switch on a card, and the cap under it — and a trail that said *updated* where a person saw
 * themselves press a switch would be describing the request instead of the act.
 *
 * It does not follow that every other edit is not an event. `PATCH` also renames a
 * connection and re-points its address, and *somebody changed where this workspace's
 * inference goes* is exactly the kind of fact an audit trail exists to hold. Inventing
 * `provider.renamed` and `provider.address_changed` from outside AD.4 would be putting names
 * into its vocabulary; dropping the event would be losing the fact. So AD.2's own general
 * name is kept for the general case, and {@link providerUpdateEvent} is the one place that
 * decides which of the four a given edit was.
 */
export const PROVIDER_UPDATED_EVENT = "provider.updated";

/** A connection was removed — or a removal was refused. */
export const PROVIDER_DELETED_EVENT = "provider.deleted";

/** A connection was checked against its live provider. */
export const PROVIDER_TESTED_EVENT = "provider.tested";

/**
 * A worker was told how to reach a local provider (AD.3,
 * [#224](https://github.com/NobuData/ouroboros/issues/224)).
 *
 * Named without the word it describes — `LEASE_GRANTED_EVENT` rather than
 * `CREDENTIAL_LEASE_GRANTED` — because `ouroboros/no-secret-logging` reports an identifier
 * whose words include `credential` inside a call to a sink, and this constant is passed to
 * one. The rule is right to be loud: the string is a name and the identifier is not the place
 * to restate it. `lease.audit.ts` chose the same spelling for the same reason, and imports
 * this one rather than keeping its own.
 */
export const LEASE_GRANTED_EVENT = "credential.lease_granted";

/**
 * A workspace's GitHub token was stored for the first time — or an attempt to store one was
 * refused (K.3, [#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * Separate from {@link GITHUB_TOKEN_ROTATED_EVENT} because the two answer different
 * questions. *"When did this workspace start syncing"* is this one, once. *"Has the token
 * been replaced since, and by whom"* is the other, and a trail that spelled both `set` would
 * make the second unanswerable without counting.
 */
export const GITHUB_TOKEN_SET_EVENT = "github.token_set";

/** A workspace's GitHub token was replaced by a new one — or the replacement was refused. */
export const GITHUB_TOKEN_ROTATED_EVENT = "github.token_rotated";

/**
 * A workspace's GitHub token was removed — or a removal was refused.
 *
 * Written even when there was nothing to remove, with `removed: false` in the detail: an
 * administrator pressing *Clear* on a workspace that already had no token performed the
 * operation, and a trail that only recorded the presses that changed something would be a
 * trail of outcomes rather than of actions.
 */
export const GITHUB_TOKEN_CLEARED_EVENT = "github.token_cleared";

/* ---------------------------------------------------------------------------
 * The build farm's identity lifecycle — AH.2
 * ([#250](https://github.com/NobuData/ouroboros/issues/250)), decision **B3**.
 *
 * Five names, which are the five the issue's scope lists. They are namespaced `runner.*` for
 * the reason the `provider.*` family is: `where action like 'runner.%'` should be the whole
 * of *what has happened to this workspace's fleet*, and a bare `token_minted` would leave
 * that query naming a prefix nobody enforces.
 *
 * `runner.cert_revoked` is a sixth, and it is not in the issue's list because the issue
 * writes `removed` for the operator action that AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254))
 * performs. Revoking a certificate and removing a runner are different acts — a certificate
 * is revoked when a machine is suspected, and a runner is removed when it is retired, and
 * only the first is an incident — so the trail gets a name for each.
 * ------------------------------------------------------------------------ */

/** An enrollment token was minted. Its value existed once, in the response; not here. */
export const RUNNER_TOKEN_MINTED_EVENT = "runner.token_minted";

/** An enrollment token was revoked before it expired. */
export const RUNNER_TOKEN_REVOKED_EVENT = "runner.token_revoked";

/** A machine enrolled — or an attempt to enrol was refused. */
export const RUNNER_ENROLLED_EVENT = "runner.enrolled";

/** A runner replaced its certificate over the already-authenticated channel. */
export const RUNNER_CERT_RENEWED_EVENT = "runner.cert_renewed";

/** A runner's certificate was revoked, so the next handshake refuses it. */
export const RUNNER_CERT_REVOKED_EVENT = "runner.cert_revoked";

/**
 * A runner was removed from the fleet.
 *
 * Written by AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), which owns the
 * lifecycle action. The name is declared here rather than there because this file is the
 * vocabulary — one place where `where action = …` can be answered from — and AH.2's scope is
 * where the farm's five names were decided.
 */
export const RUNNER_REMOVED_EVENT = "runner.removed";

/**
 * A runner was withdrawn from dispatch — and the answer to *who drained bigiron?*
 *
 * Written by AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). V040 splits
 * `runners.status` from `runners.desired_state` so that an operator's decision cannot be
 * overwritten by a measurement, and its own comment names the question that split exists to
 * make answerable. The column says a decision was made; this says who made it.
 */
export const RUNNER_DRAINED_EVENT = "runner.drained";

/** A drained runner was returned to dispatch. The other half of {@link RUNNER_DRAINED_EVENT}. */
export const RUNNER_UNDRAINED_EVENT = "runner.undrained";

/**
 * A pool was created, changed or deleted — mockup 08's POOLS card (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)).
 *
 * Three names rather than one `pool.changed`, because the three are different events to
 * whoever is reading the trail after something went wrong: a pool that was *switched off* took
 * no new work from that moment, a pool whose *image* changed builds different artefacts from
 * that moment, and a pool that was *deleted* had nothing pointing at it. `runner.pool_updated`
 * carries the field names that changed — never their values, which for `env_allowlist` would
 * be the shape of a workspace's secrets.
 *
 * **In the `runner` family, not a `pool` one of their own.** A pool is how the fleet is
 * configured, and `action like 'runner.%'` should stay the one question that answers *what
 * has happened to our build farm* — a second family would make it two questions, and the
 * second one is the one somebody forgets to ask.
 */
export const RUNNER_POOL_CREATED_EVENT = "runner.pool_created";

/** A pool's configuration changed, including its enabled switch. */
export const RUNNER_POOL_UPDATED_EVENT = "runner.pool_updated";

/** A pool was deleted — only ever one nothing pointed at. */
export const RUNNER_POOL_DELETED_EVENT = "runner.pool_deleted";

/**
 * Every action this service writes.
 *
 * A named list rather than a dozen loose constants, so `openapi.yaml`'s prose, the trail
 * endpoint's filter validation, the UI's renderer and this module's own suite can all be held
 * to one enumeration — which is what stops a tenth operation shipping with no trail because
 * nobody remembered to add one.
 */
export const AUDIT_ACTIONS = [
  PROVIDER_ADDED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_ENABLED_EVENT,
  PROVIDER_DISABLED_EVENT,
  PROVIDER_CAP_CHANGED_EVENT,
  PROVIDER_UPDATED_EVENT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_TESTED_EVENT,
  LEASE_GRANTED_EVENT,
  GITHUB_TOKEN_SET_EVENT,
  GITHUB_TOKEN_ROTATED_EVENT,
  GITHUB_TOKEN_CLEARED_EVENT,
  RUNNER_TOKEN_MINTED_EVENT,
  RUNNER_TOKEN_REVOKED_EVENT,
  RUNNER_ENROLLED_EVENT,
  RUNNER_CERT_RENEWED_EVENT,
  RUNNER_CERT_REVOKED_EVENT,
  RUNNER_REMOVED_EVENT,
  RUNNER_DRAINED_EVENT,
  RUNNER_UNDRAINED_EVENT,
  RUNNER_POOL_CREATED_EVENT,
  RUNNER_POOL_UPDATED_EVENT,
  RUNNER_POOL_DELETED_EVENT,
] as const;

/** One of {@link AUDIT_ACTIONS}. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Whether the operation the event records did what it was asked to. */
export type AuditOutcome = "success" | "failure";

/**
 * The `detail` payload — a flat record of scalars, and never anything else.
 *
 * See this file's header on why flatness is load-bearing rather than tidy. `undefined` is
 * permitted as a *value* so a builder can write `{kind, reason: undefined}` without a
 * conditional at every call site; {@link auditDetail} is what drops those keys, so what
 * reaches the column is an object with no `undefined` in it — which `JSON.stringify` would
 * otherwise silently remove anyway, and silently is the objectionable part.
 */
export type AuditDetail = Record<string, string | number | boolean | null | undefined>;

/** What every writer hands the service. */
export interface AuditRecord {
  /** The workspace — resolved from the session, never taken from the request. */
  readonly organizationId: string;
  /**
   * Who did it — `"user"."id"`.
   *
   * `null` when nobody did: a lease grant is a worker authenticated by a service key. Never
   * an address: an id is what the trail's join reads, and an address in this column would be
   * a second copy of a person's contact details in a table nothing prunes.
   */
  readonly actorId: string | null;
  /** What happened. */
  readonly action: AuditAction;
  /** What kind of thing it was about. */
  readonly subjectType: AuditSubjectType;
  /** Which one — `null` when the operation named a kind rather than an instance. */
  readonly subjectId: string | null;
  /** When. Supplied by the caller rather than defaulted, so one operation's events agree. */
  readonly at: Date;
  /** The rest of what happened. Optional; an event with nothing more to say carries `{}`. */
  readonly detail?: AuditDetail;
}

/**
 * Which of the four settings events an edit was.
 *
 * The one place that decides, so that a `PATCH` writes **exactly one** event and the name it
 * writes is the same one every time. The rule is deliberately simple, and simple is the
 * property that matters: *a specialised name when that was the only thing that changed, and
 * the general name otherwise.*
 *
 * A request that flips the switch **and** raises the cap is one act with two effects, and
 * `provider.updated` naming both in its `fields` is a truer record of it than either
 * specialised name would be — `provider.enabled` on a request that also tripled the spend
 * ceiling is a trail that answers *what happened* with half of it.
 *
 * @param fields - Which settings the request actually wrote, in the names the DTO uses.
 *   Order is irrelevant; only the contents are read.
 * @param enabled - What `enabled` was set to, when it was one of the fields. Ignored
 *   otherwise, and required to be present when `fields` is exactly `["enabled"]` — a switch
 *   whose direction is unknown cannot be named.
 * @returns The action to record.
 */
export function providerUpdateEvent(fields: readonly string[], enabled?: boolean): AuditAction {
  if (fields.length !== 1) {
    return PROVIDER_UPDATED_EVENT;
  }

  if (fields[0] === "enabled") {
    return enabled === true ? PROVIDER_ENABLED_EVENT : PROVIDER_DISABLED_EVENT;
  }

  return fields[0] === "monthlyCapCents" ? PROVIDER_CAP_CHANGED_EVENT : PROVIDER_UPDATED_EVENT;
}

/**
 * A payload with its absent fields removed.
 *
 * Every builder below composes its detail with `undefined` where a field does not apply, and
 * this is what turns that into the object the column stores. Done here rather than left to
 * `JSON.stringify`: the serialiser drops `undefined` too, but it does it invisibly, and a
 * payload whose shape depends on a serialiser's habit is one nobody can assert against.
 *
 * @param detail - The payload, possibly with `undefined` values.
 * @returns The same payload with those keys gone. Never `undefined` itself — an event with
 *   nothing to say carries `{}`, which is what makes `detail` a document rather than a null
 *   every reader has to test for.
 */
export function auditDetail(
  detail: AuditDetail = {},
): Record<string, string | number | boolean | null> {
  const kept: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(detail)) {
    if (value !== undefined) {
      kept[key] = value;
    }
  }

  return kept;
}
