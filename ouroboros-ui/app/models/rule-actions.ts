"use server";

/**
 * The server hop for the **Escalation rules** card
 * ([#204](https://github.com/NobuData/ouroboros/issues/204)) — the four calls its Client
 * Components cannot make themselves.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/dashboard/pulse-actions.ts`
 * is the same seam for the pulse switch: the browser cannot reach REST — `OURO_REST_URL` has
 * no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a Client Component that
 * needs to write something calls a Server Action that calls it. The switches, the builder
 * and the delete are Client Components because they are optimistic and modal; these are
 * their actions, opened beside them.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries, and the one where this module
 * is most careful:
 *
 * - **There is no workspace in any call and no person.** A rule belongs to *the workspace
 *   the caller's own session is acting in*, resolved by `ouroboros-rest` from the cookie this
 *   request carries. There is nothing to forge and no way to point a write at somebody else's
 *   rules; a rule id from another workspace is the service's `404`.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody
 *   else (Z.2, [#195](https://github.com/NobuData/ouroboros/issues/195)). The card draws no
 *   switch, builder or delete for a member, but that is *presentation*: a check made in the
 *   browser is a check anybody can skip, so the one that decides is behind the API, and a
 *   member who reaches an action anyway gets the service's `403` and writes nothing. This
 *   module turns that code into the sentence the card would have shown, and duplicates no
 *   rule.
 * - **The grammar is the service's too.** {@link addRule} forwards the structure the builder
 *   composed; V018's checks and the deferred target trigger are what refuse a document the
 *   builder could not have made, and they answer with a sentence this module passes on.
 *
 * ### Failure posture: loud, and the control goes back
 *
 * A switch that did not persist is drawn back where the server holds it and the reason is
 * printed under the row; a builder whose write was refused stays open with the reason; a
 * delete that failed leaves the row. A rule changes **what routing does without asking a
 * human**, so a control left drawn in a position the server does not hold would be the one
 * dishonest thing on a card built to be honest — the same posture `setAutoMerge` takes, for
 * the same reason.
 *
 * A refusal comes back as a **value** rather than a throw, because it is a state to render:
 * one row's control failing must not replace the page the reader is still entitled to be on.
 */

import { isApiError } from "@/app/api/errors";
import { type CreateEscalationRule, routing } from "@/app/api/routing";

import {
  FORBIDDEN_CODE,
  RULE_FORBIDDEN,
  RULE_GONE,
  RULE_NOT_FOUND_CODE,
  RULE_WRITE_FAILURE,
  type RuleTargetsReading,
  type RuleWriteResult,
  TARGETS_UNAVAILABLE,
  ruleTarget,
} from "./rules";

/**
 * **Every value this module needs is imported rather than declared.** A `"use server"`
 * module may export nothing but async functions — a `const` beside them is a build error,
 * and the whole module is treated as exporting nothing — so the sentences, the codes and the
 * result types live in `app/models/rules.ts` with the rest of the card's copy.
 */

/**
 * Run one write, keeping its refusal as a sentence.
 *
 * @param write The call to make.
 * @returns `ok` when it landed, or the reason it did not.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how
 *   a session that expired since the page rendered still reaches the login screen.
 */
async function attemptWrite(write: () => Promise<unknown>): Promise<RuleWriteResult> {
  try {
    await write();
    return { ok: true };
  } catch (error) {
    if (!isApiError(error)) throw error;

    // The service's own `403` and `404` messages are written for an API caller. These answer
    // with the sentences the card uses, from the one place they are written.
    if (error.code === FORBIDDEN_CODE) return { ok: false, reason: RULE_FORBIDDEN };
    if (error.code === RULE_NOT_FOUND_CODE) return { ok: false, reason: RULE_GONE };

    return { ok: false, reason: error.message === "" ? RULE_WRITE_FAILURE : error.message };
  }
}

/**
 * Move a rule's switch.
 *
 * @param id The rule's id.
 * @param enabled The position to move to — the state to *be in* rather than a request to
 *   invert whatever is stored, so two administrators pressing at once agree on an outcome.
 * @returns Whether it landed, or the sentence to show. The caller refreshes the route on
 *   success, and the card's `N active` follows the read rather than the press.
 * @throws Whatever is not an `ApiError` — see {@link attemptWrite}.
 */
export async function setRuleEnabled(id: string, enabled: boolean): Promise<RuleWriteResult> {
  // `{ enabled }` and nothing else: a switch never resends a predicate it has no intention
  // of changing, which is what the contract's PATCH exists for.
  return attemptWrite(() => routing.changeRule(id, { enabled }));
}

/**
 * Write a new rule.
 *
 * @param rule Its structure — `when` and `then`, composed by `app/models/rules.ts` from the
 *   builder's selects. No `display`: the sentence is the server's to write, and the contract
 *   refuses one in a body.
 * @returns Whether it landed, or the sentence to show in the builder.
 * @throws Whatever is not an `ApiError` — see {@link attemptWrite}.
 */
export async function addRule(rule: CreateEscalationRule): Promise<RuleWriteResult> {
  return attemptWrite(() => routing.addRule(rule));
}

/**
 * Remove a rule outright.
 *
 * Not the switch: the card asks before calling this, because a deleted rule loses its place
 * in the order and its sentence, and a suspended one keeps both.
 *
 * @param id The rule's id.
 * @returns Whether it landed, or the sentence to show under the row.
 * @throws Whatever is not an `ApiError` — see {@link attemptWrite}.
 */
export async function removeRule(id: string): Promise<RuleWriteResult> {
  return attemptWrite(() => routing.removeRule(id));
}

/**
 * Read every alias the workspace has, for the builder's alias select.
 *
 * Read when the builder opens rather than with the page, for the reason
 * `app/providers/audit-actions.ts` gives for the audit sheet: the builder is behind a button
 * most visits never press, and a member session — which has no builder — would pay for a
 * list nothing draws. The cost is a moment's *Reading the registry…* the first time the
 * dialog opens, which is the honest trade.
 *
 * @returns The aliases, each with the resolution line the matrix draws for it, or the
 *   sentence to show instead. A workspace with no aliases reads successfully and answers an
 *   empty list — the builder's *nothing to name* state, not a failure.
 * @throws Whatever is not an `ApiError` — see {@link attemptWrite}.
 */
export async function readRuleTargets(): Promise<RuleTargetsReading> {
  try {
    return { ok: true, aliases: (await routing.aliases()).map(ruleTarget) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: TARGETS_UNAVAILABLE };
  }
}
