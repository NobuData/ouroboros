/**
 * Who is on the other end of the internal channel — and the only thing about them this
 * service will ever know.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) has an acceptance
 * criterion that is not about a row or a route:
 *
 * > `simulated` cannot be cleared by a client claim; it follows the principal.
 *
 * Decision **R4** put a `simulated` watermark on every run and every transcript entry, and
 * V046's `runs_simulated_is_fixed()` freezes a run's flag the moment it has written
 * anything — so whatever sets it has to be right the first time. A field in the request
 * body cannot be: a body is a claim, and a caller that can claim `simulated: true` can
 * claim `simulated: false` about a run the simulator opened.
 *
 * On this channel a caller proves exactly one thing — **which secret it holds**. So a
 * second principal needs a second secret, and that is the whole of this file:
 *
 * ```
 * X-Ouro-Internal-Key: <OURO_ENGINE_SHARED_SECRET>   → executor    → simulated = false
 * X-Ouro-Internal-Key: <OURO_RUN_SIMULATOR_SECRET>   → simulator   → simulated = true
 * ```
 *
 * **The simulator secret is optional**, and unset means a deployment that runs no
 * simulator: every run opened through the ingestion contract is a real one, and the
 * simulated principal simply does not exist. `configuration.ts` refuses a deployment that
 * sets both variables to the same string, because two principals presenting one proof are
 * one principal — and a configuration that looks like it distinguishes them while it does
 * not is worse than one that never claimed to.
 *
 * **Nothing here grants anything.** Both principals reach every internal route; the
 * distinction is a fact recorded on the runs one of them opens, not a permission. When a
 * route needs to *refuse* a principal, it says so itself — see AP.5's own ticket — rather
 * than by way of a role this file invented.
 */

/**
 * Which caller a request proved itself to be.
 *
 * Two words, closed, and deliberately not an open string: the value reaches
 * {@link RunsTable.simulated} through the ingestion service, and a third word would be a
 * third meaning for a boolean column that has two.
 */
export type InternalPrincipal = "executor" | "simulator";

/** Both, for a suite that iterates them. */
export const INTERNAL_PRINCIPALS = [
  "executor",
  "simulator",
] as const satisfies readonly InternalPrincipal[];

/**
 * Where `InternalKeyGuard` records what it proved, on the request object.
 *
 * Namespaced for the reason the reflector keys are: a request object is one flat space
 * shared with every middleware in the process, and this property is ours to name. A handler
 * reads it through `@CallingPrincipal()` rather than by reaching for the string.
 */
export const INTERNAL_PRINCIPAL_PROPERTY = "ouroInternalPrincipal";

/**
 * The one property the guard writes and a handler reads.
 *
 * Declared here rather than on `internal.guard.ts`'s own request interface so that
 * `internal.decorators.ts` can read the property without importing the guard — the guard
 * already imports the decorators, and the other direction would be a cycle. What each file
 * needs is the *shape of the carrier*, which belongs beside the type it carries.
 */
export interface PrincipalCarrier {
  /**
   * Which principal the key proved, set on every admitted internal request.
   *
   * Absent on a route that is not `@InternalOnly()`, because nothing proved anything there —
   * which is why `@CallingPrincipal()` refuses rather than defaulting when it finds no value.
   */
  [INTERNAL_PRINCIPAL_PROPERTY]?: InternalPrincipal;
}

/**
 * Does a simulated run's watermark follow from this principal?
 *
 * One function rather than `principal === "simulator"` written at each reader, because the
 * mapping from *who called* to *what the row says* is the decision R4 makes and it should
 * be stated once.
 *
 * @param principal - Who the guard proved the caller to be.
 * @returns `true` when runs this caller opens carry the simulated watermark.
 */
export function isSimulatedPrincipal(principal: InternalPrincipal): boolean {
  return principal === "simulator";
}
