/**
 * The Settings notifications card's operations (BR.4,
 * [#488](https://github.com/NobuData/ouroboros/issues/488)).
 *
 * ```
 * list     the four core kinds (stored, or their default binding — off) · custom kinds · channels
 * update   kind check ─▶ config check ─▶ lock (row) ─▶ locked-row rule ─▶ upsert ─▶ audit
 * ```
 *
 * **Org routes are not preferences.** BN.3's `notification_preferences` say how *one person* is
 * told; a route says where the *workspace's* digest, report or pages go, which is why it is an
 * administrator's write and why nothing here reads or writes a person's preferences.
 *
 * **The locked-row rule is enforced here, not only drawn by the UI.** A route whose channel cannot
 * deliver in this build (Slack before mockup 19, PagerDuty before BT.3) may be stored *disabled* —
 * re-bound, configured, registered — but a save that would leave it **enabled** is refused with the
 * reason the card prints, so a direct API call cannot switch on a page that never fires.
 *
 * **Every change is audited**, after it commits, with its before and after values; a save that
 * changes nothing writes no event.
 */

import { Injectable } from "@nestjs/common";

import { NOTIFICATION_ROUTE_UPDATED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { NotificationRouteConfig } from "../db/schema";
import {
  CORE_ROUTE_KINDS,
  channelLock,
  configProblems,
  defaultChannel,
  isRouteKind,
  normalisedConfig,
} from "./routes.catalog";
import type { PatchNotificationRouteDto } from "./routes.dto";
import { routeConfigInvalid, routeKindUnknown, routeLocked } from "./routes.errors";
import {
  NotificationRoutesRepository,
  type EffectiveRouteRow,
  type StoredRouteRow,
} from "./routes.repository";
import {
  channelsResource,
  type NotificationRouteResource,
  type NotificationRoutesResource,
} from "./routes.resources";

/** A route as it was and as it is, for the audit. */
interface RouteChange {
  readonly before: StoredRouteRow;
  readonly after: StoredRouteRow;
  /** Whether a stored route existed before the save. */
  readonly existed: boolean;
}

@Injectable()
export class NotificationRoutesService {
  /**
   * @param routes - The statements.
   * @param audit - The trail every change is written to.
   */
  constructor(
    private readonly routes: NotificationRoutesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * The card: every core kind in the card's order — stored, or its default binding switched off —
   * then any stored custom kind, and every channel's availability.
   *
   * @param organizationId - The workspace.
   * @returns The card.
   */
  async list(organizationId: string): Promise<NotificationRoutesResource> {
    const stored = new Map((await this.routes.list(organizationId)).map((row) => [row.kind, row]));
    const core: NotificationRouteResource[] = CORE_ROUTE_KINDS.map((kind) => {
      const row = stored.get(kind);

      return row === undefined ? defaultRoute(kind) : routeResource(row);
    });
    const custom = [...stored.values()]
      .filter((row) => !(CORE_ROUTE_KINDS as readonly string[]).includes(row.kind))
      .map(routeResource);

    return { items: [...core, ...custom], channels: channelsResource() };
  }

  /**
   * One route.
   *
   * @param organizationId - The workspace.
   * @param kind - The route.
   * @returns The route, stored or default.
   * @throws {NotFoundError} `404 notification_route_kind_unknown` for a kind V094 refuses.
   */
  async read(organizationId: string, kind: string): Promise<NotificationRouteResource> {
    if (!isRouteKind(kind)) {
      throw routeKindUnknown(kind);
    }

    const row = (await this.routes.list(organizationId)).find((route) => route.kind === kind);

    return row === undefined ? defaultRoute(kind) : routeResource(row);
  }

  /**
   * Save a route — re-bind its channel, replace its config, switch it — and audit the change.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who saved it.
   * @param kind - The route.
   * @param patch - The fields to change; none reads back the route.
   * @returns The route as stored, its lock derived.
   * @throws {NotFoundError} `404 notification_route_kind_unknown`.
   * @throws {InvalidRequestError} `422 notification_route_config_invalid`, with `details.fields`.
   * @throws {ConflictError} `409 notification_route_locked` — the save would leave the route
   *   enabled on a channel that cannot deliver; `details.reason` is what the card prints.
   */
  async update(
    organizationId: string,
    actorId: string,
    kind: string,
    patch: PatchNotificationRouteDto,
  ): Promise<NotificationRouteResource> {
    if (!isRouteKind(kind)) {
      throw routeKindUnknown(kind);
    }

    let config: NotificationRouteConfig | undefined;

    if (patch.config !== undefined) {
      const problems = configProblems(patch.config);

      if (Object.keys(problems).length > 0) {
        throw routeConfigInvalid(problems);
      }

      config = normalisedConfig(patch.config);
    }

    const change = await this.routes.transaction(async (trx): Promise<RouteChange | undefined> => {
      const stored = await this.routes.stored(trx, organizationId, kind);
      const before: StoredRouteRow = stored ?? {
        channel: defaultChannel(kind),
        config: {},
        enabled: false,
      };
      const after: StoredRouteRow = {
        channel: patch.channel ?? before.channel,
        config: config ?? before.config,
        enabled: patch.enabled ?? before.enabled,
      };

      if (changedFields(before, after).length === 0) {
        return undefined;
      }

      const lock = channelLock(after.channel);

      if (after.enabled && lock !== null) {
        throw routeLocked(kind, after.channel, lock);
      }

      await this.routes.upsert(trx, organizationId, kind, { ...after, updatedBy: actorId });

      return { before, after, existed: stored !== undefined };
    });

    if (change !== undefined) {
      await this.record(organizationId, actorId, kind, change);
    }

    return this.read(organizationId, kind);
  }

  /**
   * Write the change's audit event — before and after, field by field.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who saved it.
   * @param kind - The route.
   * @param change - What it was and is.
   */
  private async record(
    organizationId: string,
    actorId: string,
    kind: string,
    change: RouteChange,
  ): Promise<void> {
    const { before, after } = change;

    await this.audit.record({
      organizationId,
      actorId,
      action: NOTIFICATION_ROUTE_UPDATED_EVENT,
      subjectType: "notification_route",
      subjectId: kind,
      at: new Date(),
      detail: {
        kind,
        fields: changedFields(before, after).join(","),
        previousSource: change.existed ? "stored" : "default",
        previousChannel: before.channel,
        channel: after.channel,
        previousEnabled: before.enabled,
        enabled: after.enabled,
        previousConfig: JSON.stringify(before.config),
        config: JSON.stringify(after.config),
      },
    });
  }
}

/**
 * Which fields a save changes.
 *
 * @param before - The route as it was (or its default).
 * @param after - The route as the save leaves it.
 * @returns `channel`, `config`, `enabled` — those whose value differs.
 */
export function changedFields(before: StoredRouteRow, after: StoredRouteRow): string[] {
  const changed: string[] = [];

  if (before.channel !== after.channel) changed.push("channel");
  if (
    JSON.stringify(normalisedConfig(before.config)) !==
    JSON.stringify(normalisedConfig(after.config))
  ) {
    changed.push("config");
  }
  if (before.enabled !== after.enabled) changed.push("enabled");

  return changed;
}

/**
 * A stored route as the card shows it.
 *
 * @param row - The view's row.
 * @returns The resource.
 */
export function routeResource(row: EffectiveRouteRow): NotificationRouteResource {
  return {
    kind: row.kind,
    channel: row.channel,
    config: row.config,
    enabled: row.enabled,
    locked: row.locked,
    lockedReason: row.lockedReason,
    delivering: row.delivering,
    stored: true,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/**
 * A kind nobody saved: its default binding, switched off, its lock derived by the same rule.
 *
 * @param kind - The route.
 * @returns The resource.
 */
export function defaultRoute(kind: string): NotificationRouteResource {
  const channel = defaultChannel(kind);
  const lockedReason = channelLock(channel);

  return {
    kind,
    channel,
    config: {},
    enabled: false,
    locked: lockedReason !== null,
    lockedReason,
    delivering: false,
    stored: false,
    updatedAt: null,
    updatedBy: null,
  };
}
