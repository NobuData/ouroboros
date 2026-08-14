/**
 * The audit emission point [#74](https://github.com/NobuData/ouroboros/issues/74) stubs and
 * [#90](https://github.com/NobuData/ouroboros/issues/90) makes real.
 *
 * Flipping auto-merge changes what the loop does without a human, which is why the write is
 * role-gated and attributed — and why it will be audited: J.2 (#90) emits
 * {@link SETTINGS_AUTO_MERGE_CHANGED} through the #26 audit path once that path exists.
 * Until then this class is the seam: the service already assembles the event and calls the
 * emitter at the one point a change is known to have persisted, so #90 replaces a method
 * body rather than re-deriving where "it changed" is decided.
 *
 * A class rather than a free function so the seam is injectable — the service's spec proves
 * the emission happens on a write and not on a read, which is only worth proving against
 * the interface #90 inherits.
 */

import { Injectable } from "@nestjs/common";

/**
 * The event's name, as the audit log will record it.
 *
 * Declared with the stub rather than with #90, because the name is part of *this* ticket's
 * contract: the roadmap's F6 decision names it, and a consumer grepping the audit trail
 * should find the string that was agreed before the trail existed.
 */
export const SETTINGS_AUTO_MERGE_CHANGED = "settings.auto_merge_changed";

/** What one flip of the switch is, to whoever reads the trail later. */
export interface AutoMergeChangedEvent {
  /** The workspace whose switch moved. */
  readonly organizationId: string;
  /** The position it was set to. */
  readonly enabled: boolean;
  /** Who set it — `"user".id`, from the session. */
  readonly changedBy: string;
  /** When the row says it happened — the trigger's stamp, not a second clock. */
  readonly changedAt: Date;
}

@Injectable()
export class SettingsAudit {
  /**
   * Record that the switch moved.
   *
   * **Deliberately nothing, today.** There is no audit path to emit into — #26 is v2 and
   * #90 wires this surface to it — and half an audit trail (a log line here, a table
   * nowhere) would be worse than an honest stub: it reads as durable and is not.
   *
   * Called on every *persisted* write, re-affirmations included: an administrator setting
   * `true` on a workspace already at `true` is still an event with an actor, and whether
   * the trail collapses those is #90's editorial decision to make, not this seam's.
   *
   * @param event - The flip, fully assembled. Unused until #90; named so the signature is
   *   already the one that ticket implements.
   */
  autoMergeChanged(event: AutoMergeChangedEvent): void {
    void event;
  }
}
