/**
 * The gateway's clock, as a provider.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). Presence is nothing but
 * comparisons against the present — *has this runner beaten in the last 32 seconds?*, *has this
 * session outlived its resume window?*, *has this offer expired?* — and a suite that had to wait
 * for any of them would be a suite nobody runs. `farm.authority.ts`'s `FARM_CLOCK` is the same
 * seam for AH.2; it is not exported, and this module's time is its own.
 */

/** A function answering *now*. */
export type GatewayClock = () => Date;

/** The injection token. */
export const GATEWAY_CLOCK = Symbol("GATEWAY_CLOCK");
