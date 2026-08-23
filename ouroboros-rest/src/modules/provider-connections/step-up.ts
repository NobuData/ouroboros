/**
 * Step-up re-authentication — the price of revealing a credential.
 *
 * AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)), roadmap decision **P4**:
 * *reveal has to cost something*. It is the one endpoint in this API that answers with a
 * live credential, and a session cookie is not a strong enough claim to open one — a
 * borrowed laptop, a copied cookie inside the five-minute cache window, or an XSS on any
 * page of the product are all "a valid session" and none of them is the person.
 *
 * ```
 * reveal ─▶ recent step-up? ──yes──▶ decrypt · audit · answer
 *                │
 *                no ─▶ 401 step_up_required { methods, maxAgeSeconds }
 *                        └─ client re-authenticates ─▶ reveal again, with the proof
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Two methods, because BetterAuth has exactly two this build can use.**
 *
 * The issue says *fresh session / password / provider re-confirm per BetterAuth capability*,
 * and what that resolves to for `better-auth@1.6` as this service configures it is:
 *
 *   * **`session`** — the session was *created* within {@link STEP_UP_MAX_AGE_SECONDS}.
 *     Somebody who signed in a minute ago has just re-authenticated by whatever means their
 *     account uses, GitHub included, and asking them to do it twice would be theatre. This
 *     is the only method available to a GitHub-only account, which is why it exists: see
 *     `principal.ts` on why the check is `createdAt` and never `updatedAt`.
 *   * **`password`** — `auth.api.verifyPassword`, a server-scope endpoint that compares a
 *     password against the caller's `credential` account and writes nothing. It works
 *     wherever the account *has* a password, including in production where
 *     `emailAndPassword.enabled` is false: that flag gates the sign-in routes, and
 *     verification reads the account row directly (`better-auth/dist/utils/password.mjs`).
 *
 * **A provider re-confirm is deliberately absent.** Sending somebody back through GitHub's
 * consent screen means a redirect, a callback and a new session — which is the `session`
 * method with extra steps, and reaching it needs no code here at all.
 *
 * ---------------------------------------------------------------------------
 * **A confirmation is remembered, and only in this process.**
 *
 * The acceptance criterion is *reveal without a **recent** step-up*, so a proof has a
 * lifetime: confirming once and revealing three keys is the flow mockup 07's page implies,
 * and re-prompting per key would train people to type their password into anything that
 * asks. {@link StepUpRegistry} is where that memory lives — a `Map` in the process, keyed by
 * session id, holding an instant and nothing else.
 *
 * In memory rather than in a table, and the trade is worth stating rather than discovering:
 * a second replica does not see the confirmation, so a person behind a round-robin load
 * balancer may be asked again. That is a **re-prompt**, which is the safe direction to fail
 * in, and it is the whole cost. The alternative — a `step_up` table — is a schema change
 * against `ouroboros-db` for state that is meaningless five minutes after it is written, and
 * a session's own row is BetterAuth's rather than this service's to add a column to.
 * `ModelPullTracker` is the precedent for a stateful singleton in this service and it is
 * here for the same reason: the thing being remembered outlives the request that made it.
 */

import { Injectable } from "@nestjs/common";
import { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { cookieHeaders, type AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";

/**
 * How long a step-up counts as recent, in seconds — **five minutes**.
 *
 * The same number as `SESSION_COOKIE_CACHE_SECONDS`, and that is not a coincidence worth
 * hiding: five minutes is already this service's answer to *how stale may a security fact
 * be*, and a second window with a different length would be a second thing to reason about
 * when somebody asks how long a compromise stays useful.
 *
 * A constant rather than a configurable, for the reason `session.options.ts` gives about
 * every value in it: a security property with an environment variable in front of it is a
 * security property somebody sets to a day when re-authenticating gets annoying.
 */
export const STEP_UP_MAX_AGE_SECONDS = 5 * 60;

/**
 * The ways this build accepts a step-up, in the order a client should prefer them.
 *
 * Published in the `401`'s `details.methods`, so a client knows which prompt to put in front
 * of somebody rather than guessing. `session` is first because it is the one that needs
 * nothing typed: a client whose session is fresh should simply retry.
 */
export const STEP_UP_METHODS = ["session", "password"] as const;

/** One of {@link STEP_UP_METHODS}. */
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

/**
 * How long a remembered confirmation is kept before it is swept, in milliseconds.
 *
 * The window itself. An entry older than that cannot satisfy anything, so keeping it is
 * memory held for no reason — and the sweep is what stops the map growing with the number of
 * sessions that have ever revealed a key in this process's lifetime.
 */
export const CONFIRMATION_TTL_MS = STEP_UP_MAX_AGE_SECONDS * 1000;

@Injectable()
export class StepUpRegistry {
  /**
   * When each session last proved itself, by session id.
   *
   * Keyed by `session.id` rather than by the session *token*, which is the value the cookie
   * carries: a token is a credential and this map is an ordinary object a heap dump would
   * show. The id names the same row and is not a bearer of anything.
   */
  private readonly confirmations = new Map<string, number>();

  /**
   * Remember that this session re-authenticated.
   *
   * @param sessionId - `session.id`.
   * @param at - When it happened. Passed in rather than read from the clock, so a spec can
   *   place a confirmation in the past without moving the process's time.
   */
  record(sessionId: string, at: Date): void {
    this.sweep(at);
    this.confirmations.set(sessionId, at.getTime());
  }

  /**
   * Whether this session has a confirmation that is still recent.
   *
   * @param sessionId - `session.id`.
   * @param now - The instant to judge against.
   * @returns `true` when a confirmation was recorded within {@link STEP_UP_MAX_AGE_SECONDS}.
   */
  isRecent(sessionId: string, now: Date): boolean {
    const at = this.confirmations.get(sessionId);

    return at !== undefined && now.getTime() - at <= CONFIRMATION_TTL_MS;
  }

  /**
   * Forget this session's confirmation.
   *
   * Not called by the reveal path — it is here for the caller that ends a session, which is
   * the one event that should invalidate a proof before its window closes. Nothing calls it
   * today and it is one line; the alternative is a registry that cannot be told.
   *
   * @param sessionId - `session.id`.
   */
  forget(sessionId: string): void {
    this.confirmations.delete(sessionId);
  }

  /**
   * How many confirmations are being held. For the suite, and for nothing else.
   *
   * @returns The map's size.
   */
  size(): number {
    return this.confirmations.size;
  }

  /**
   * Drop every confirmation that can no longer satisfy anything.
   *
   * Swept on write rather than on a timer: a timer in a singleton is a handle that keeps a
   * process alive and a thing every test has to remember to stop, and the map only grows
   * when something is written to it.
   *
   * @param now - The instant to judge against.
   */
  private sweep(now: Date): void {
    for (const [sessionId, at] of this.confirmations) {
      if (now.getTime() - at > CONFIRMATION_TTL_MS) {
        this.confirmations.delete(sessionId);
      }
    }
  }
}

@Injectable()
export class StepUpService {
  /**
   * @param betterAuth - The library's typed access to `auth.api`, exactly as
   *   `AuthController` reaches sign-out through it. `verifyPassword` is a *server-scope*
   *   endpoint — it is not mounted for a browser to call — so this is the only way to reach
   *   it, which is also what stops it becoming an unauthenticated password oracle.
   * @param registry - Where a confirmation is remembered.
   */
  constructor(
    private readonly betterAuth: BetterAuth<Auth>,
    private readonly registry: StepUpRegistry,
  ) {}

  /**
   * Whether this request carries a recent step-up, verifying one if it was offered.
   *
   * The order is *cheapest first, and no network or database call unless it is needed*: a
   * fresh session is a subtraction, a remembered confirmation is a map lookup, and only a
   * request that has neither pays for a password comparison — which is a deliberately slow
   * hash and must not be run on every reveal.
   *
   * @param principal - The resolved session, as the guard wrote it.
   * @param request - The request, for the cookie the library authenticates the verification
   *   with. Only its `Cookie` header is read — see `auth/http.ts`.
   * @param password - What the caller offered, or `undefined` when they offered nothing.
   * @param now - The instant to judge against.
   * @returns The method that satisfied it, or `null` when nothing did. A wrong password and
   *   an absent one answer alike, deliberately: telling them apart would make this endpoint
   *   a password oracle for anybody holding a stolen session, which is precisely the person
   *   a step-up exists to stop.
   */
  async satisfied(
    principal: Principal,
    request: AuthRequest,
    password: string | undefined,
    now: Date,
  ): Promise<StepUpMethod | null> {
    if (this.sessionIsFresh(principal, now)) {
      return "session";
    }

    if (this.registry.isRecent(principal.session.id, now)) {
      return "password";
    }

    if (password === undefined || password.length === 0) {
      return null;
    }

    if (!(await this.verify(request, password))) {
      return null;
    }

    this.registry.record(principal.session.id, now);

    return "password";
  }

  /**
   * Whether the session was created recently enough to be a re-authentication in itself.
   *
   * @param principal - The resolved session.
   * @param now - The instant to judge against.
   * @returns `true` when `session.createdAt` is within {@link STEP_UP_MAX_AGE_SECONDS}. A
   *   session carrying no `createdAt` is **not** fresh: an absent fact is not a proof, and
   *   the safe reading of "this build does not know when you signed in" is *ask again*.
   */
  private sessionIsFresh(principal: Principal, now: Date): boolean {
    const { createdAt } = principal.session;

    if (createdAt === undefined) {
      return false;
    }

    const age = now.getTime() - createdAt.getTime();

    // A session stamped in the future is a clock that disagrees with itself, not a session
    // that is very fresh indeed. Refusing it is what stops a skewed replica handing out
    // credentials without asking.
    return age >= 0 && age <= CONFIRMATION_TTL_MS;
  }

  /**
   * Ask BetterAuth whether this is the caller's password.
   *
   * @param request - The request, for its `Cookie` header.
   * @param password - What the caller offered.
   * @returns Whether the library accepted it. **Every failure is `false`**, including a
   *   library error and a session the endpoint would not honour: a verification that could
   *   not be completed has not been passed, and the one thing this must never do is let an
   *   exception on the slow path read as a successful step-up.
   */
  private async verify(request: AuthRequest, password: string): Promise<boolean> {
    try {
      const answer = await this.betterAuth.api.verifyPassword({
        body: { password },
        headers: cookieHeaders(request),
      });

      return answer.status;
    } catch {
      return false;
    }
  }
}
