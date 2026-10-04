/**
 * `NotificationPreferencesService` — a person's decision-mail preferences in one workspace (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463)): digest on/off and send time, the
 * instant-send threshold, per-kind mutes. The model mockup 17's notification surface (BO.4)
 * renders; the route is `GET`/`PATCH /api/v1/inbox/notifications`.
 *
 * **Defaults, when nothing is stored**: the daily digest off (09:00 UTC once on), instant mails for
 * `err` items on, nothing muted — so nobody receives a daily mail they did not ask for, and nobody
 * misses an item that is blocking a loop.
 */

import { Injectable } from "@nestjs/common";

import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import { notificationKindUnknown } from "../channels.errors";
import { DEFAULT_DIGEST_TIME, nextDigestSlot } from "./digest.schedule";
import {
  PreferencesRepository,
  type InstantSeverity,
  type PreferencesChange,
  type StoredPreferences,
} from "./preferences.repository";

/** A person's preferences with the defaults filled in. */
export interface EffectivePreferences {
  readonly digestEnabled: boolean;
  readonly digestTime: string;
  readonly instantSeverity: InstantSeverity;
  readonly mutedKinds: readonly string[];
}

/** The defaults — see the file header. */
export const DEFAULT_PREFERENCES: EffectivePreferences = Object.freeze({
  digestEnabled: false,
  digestTime: DEFAULT_DIGEST_TIME,
  instantSeverity: "err",
  mutedKinds: Object.freeze([]),
});

/** `GET`/`PATCH /api/v1/inbox/notifications`. */
export interface NotificationPreferencesResource {
  readonly digest: {
    readonly enabled: boolean;
    /** `HH:MM`. */
    readonly time: string;
    /** Always `UTC` — the digest's clock, stated so no client guesses. */
    readonly timeZone: "UTC";
    /** When the next digest leaves; null while it is off. */
    readonly nextSendAt: string | null;
  };
  readonly instant: {
    /** `err` — each err-severity item is mailed as it is filed; `off` — never. */
    readonly severity: InstantSeverity;
  };
  readonly mutedKinds: readonly string[];
  /** False while the defaults apply. */
  readonly isExplicit: boolean;
  readonly updatedAt: string | null;
}

/**
 * Stored preferences with the defaults filled in.
 *
 * @param stored - The row, or undefined.
 * @returns The effective preferences.
 */
export function effectivePreferences(stored: StoredPreferences | undefined): EffectivePreferences {
  return stored ?? DEFAULT_PREFERENCES;
}

/**
 * Whether a person wants a kind mailed at all.
 *
 * @param preferences - Their effective preferences.
 * @param kindId - The item's kind.
 * @returns False for a muted kind.
 */
export function mailsKind(preferences: EffectivePreferences, kindId: string): boolean {
  return !preferences.mutedKinds.includes(kindId);
}

@Injectable()
export class NotificationPreferencesService {
  /**
   * @param repository - The rows.
   * @param registry - The declared kinds, which a mute must name.
   */
  constructor(
    private readonly repository: PreferencesRepository,
    private readonly registry: DecisionKindRegistry,
  ) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /**
   * A person's preferences, defaults filled in.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @returns The resource.
   */
  async read(organizationId: string, userId: string): Promise<NotificationPreferencesResource> {
    const stored = await this.repository.get(organizationId, userId);
    const effective = effectivePreferences(stored);
    const lastSlot = effective.digestEnabled
      ? await this.repository.lastDigestSlot(organizationId, userId)
      : undefined;

    return {
      digest: {
        enabled: effective.digestEnabled,
        time: effective.digestTime,
        timeZone: "UTC",
        nextSendAt: effective.digestEnabled
          ? nextDigestSlot(this.now(), effective.digestTime, lastSlot).toISOString()
          : null,
      },
      instant: { severity: effective.instantSeverity },
      mutedKinds: [...effective.mutedKinds],
      isExplicit: stored !== undefined,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Change a person's preferences.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @param change - The fields to write; absent fields keep what is stored.
   * @returns The resource after the write.
   * @throws {InvalidRequestError} `notification_kind_unknown` for a mute naming no declared kind.
   */
  async update(
    organizationId: string,
    userId: string,
    change: PreferencesChange,
  ): Promise<NotificationPreferencesResource> {
    if (change.mutedKinds !== undefined) {
      const declared = new Set((await this.registry.kinds()).map(({ kind }) => kind.kindId));
      const unknown = change.mutedKinds.filter((kindId) => !declared.has(kindId));

      if (unknown.length > 0) {
        throw notificationKindUnknown(unknown);
      }
    }

    await this.repository.upsert(organizationId, userId, {
      ...change,
      mutedKinds: change.mutedKinds === undefined ? undefined : [...new Set(change.mutedKinds)],
    });

    return this.read(organizationId, userId);
  }
}
