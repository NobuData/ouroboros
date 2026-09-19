/**
 * Whether a workspace may have new builds dispatched at all — the seam #489 fills in.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)), amended for BR.5
 * ([#489](https://github.com/NobuData/ouroboros/issues/489)). The settings page's Danger zone
 * promises *"queued issues stay queued; running loops finish their stage"* when a workspace is
 * paused, and #489 makes that an organization state — `active | paused | pending_delete`. This
 * dispatch point must consult it: while `paused` no new build is offered, work already in flight
 * finishes, and `pending_delete` stops dispatch entirely.
 *
 * That state does not exist yet, so this is the question and not the answer. The dispatcher asks
 * {@link DispatchGate.admits} once per workspace per pass, **before** it offers anything, and
 * skips a workspace that is refused — its jobs stay `queued`, and nothing already offered,
 * accepted or running is touched. Passes are at most `DISPATCH_INTERVAL_MS` apart
 * (`dispatch.policy.ts`), which is the one documented poll interval #489's hold has to take
 * effect within. Until #489 binds its own provider to {@link FARM_DISPATCH_GATE},
 * {@link OPEN_GATE} admits everybody.
 */

/** The injection token for the gate — #489 overrides the provider bound to it. */
export const FARM_DISPATCH_GATE = Symbol("FARM_DISPATCH_GATE");

/** Asked before any new build of a workspace is offered to a runner. */
export interface DispatchGate {
  /**
   * @param organizationId - The workspace whose waiting builds are about to be offered.
   * @returns Whether it may be dispatched to now. `false` leaves its builds queued.
   */
  admits(organizationId: string): Promise<boolean>;
}

/** The gate until #489: every workspace is `active`. */
export const OPEN_GATE: DispatchGate = {
  admits: () => Promise.resolve(true),
};
