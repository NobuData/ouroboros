/**
 * The port a source writer tells about a new teaching moment — BF.3's trigger
 * ([#412](https://github.com/NobuData/ouroboros/issues/412)).
 *
 * A token and an interface in a file of their own, so `triage/`, `pull-requests/criteria/` and
 * `controls/` can take the port as `@Optional() @Inject(FACT_SOURCE_OBSERVER)` without importing
 * the proposers' service — the `FACT_COMMIT_OBSERVER` pattern. `FactProposersModule` binds it to
 * `FactProposersService`.
 */

import type { LoadableProposerKind } from "./proposers.types";

/** The injection token. */
export const FACT_SOURCE_OBSERVER = Symbol("FACT_SOURCE_OBSERVER");

/** A source row a proposer may promote. */
export interface FactSourceRef {
  /** Which proposer reads it. */
  readonly kind: LoadableProposerKind;
  /** The row's id — a classification, a waiver or a steer (`run_controls.id`). */
  readonly id: string;
}

/** What a source writer reports to. */
export interface FactSourceObserver {
  /**
   * A source was just written and committed. Propose from it, dedupe, record — and **never
   * throw**: the source's own write already succeeded, and a proposer's trouble is logged, not
   * turned into the caller's error.
   *
   * @param organizationId - The workspace.
   * @param source - The row.
   * @returns When the proposal is recorded (or skipped).
   */
  sourceWritten(organizationId: string, source: FactSourceRef): Promise<void>;
}
