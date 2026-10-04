/**
 * The webhook management API's operations (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * list        endpoints · health from the log · activeCount · SIEM row · registry
 * create      SSRF check ─▶ mint secret ─▶ seal ─▶ insert ─▶ audit ─▶ answer with the secret, once
 * update      SSRF check (new URL) ─▶ write ─▶ audit (enabled | disabled | updated)
 * rotate      mint ─▶ seal ─▶ write ─▶ audit ─▶ answer with the new secret, once
 * delete      delete (log cascades) ─▶ audit
 * ping        a real attempt, sent now, logged ─▶ answer with the log row
 * redeliver   a dead letter with no later attempt ─▶ a new pending attempt, same key ─▶ audit
 * ```
 *
 * **Secrets.** Minted here, sealed under the workspace DEK with the endpoint id as the record, and
 * returned only by create and rotate. No audit detail, error or log line carries one — the audit
 * detail names the endpoint's host, not its URL, because a collector token can ride a query string.
 *
 * **Every mutation is audited** after it commits, the way every writer of the trail does (AD.4):
 * create, edit, enable/disable, rotate, delete and redeliver.
 */

import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import {
  WEBHOOK_CREATED_EVENT,
  WEBHOOK_DELETED_EVENT,
  WEBHOOK_DISABLED_EVENT,
  WEBHOOK_ENABLED_EVENT,
  WEBHOOK_REDELIVERED_EVENT,
  WEBHOOK_SECRET_ROTATED_EVENT,
  WEBHOOK_UPDATED_EVENT,
  type AuditAction,
  type AuditDetail,
} from "../audit/audit.events";
import { AppConfigService } from "../config/config.service";
import { pageOf, windowOf } from "../tenancy/pagination";
import { VaultService } from "../vault/vault.service";
import { WebhookDispatcher, DELIVERY_LEASE_MS } from "./webhook.dispatcher";
import { LATEST_REGISTRY_VERSION, PING_EVENT, subscriptionEntryProblem } from "./webhook.registry";
import { mintSigningSecret } from "./webhook.signing";
import {
  InternalAllowlist,
  SsrfBlockedError,
  checkWebhookTarget,
  hostOf,
  type HostResolver,
} from "./webhook.ssrf";
import { WEBHOOK_RESOLVER } from "./webhook.transport";
import type { CreateWebhookDto, ListDeliveriesQuery, UpdateWebhookDto } from "./webhooks.dto";
import {
  webhookDeliveryNotFound,
  webhookNameTaken,
  webhookNotFound,
  webhookNotRedeliverable,
  webhookRegistryVersionUnknown,
  webhookSiemRequiresAudit,
  webhookSiemTaken,
  webhookSubscriptionInvalid,
  webhookTargetRefused,
} from "./webhooks.errors";
import { WebhooksRepository, type EndpointChanges, type EndpointRow } from "./webhooks.repository";
import {
  deliveryResource,
  endpointHealth,
  endpointResource,
  registryResource,
  siemResource,
  type WebhookDeliveryPageResource,
  type WebhookDeliveryResource,
  type WebhookEndpointResource,
  type WebhookListResource,
  type WebhookSecretResource,
} from "./webhooks.resources";

@Injectable()
export class WebhooksService {
  /** The operator's override, parsed once. */
  private readonly allowlist: InternalAllowlist;

  /**
   * @param endpoints - The statements.
   * @param vault - Seals the signing secrets.
   * @param audit - The trail every mutation is written to.
   * @param dispatcher - Sends the ping.
   * @param config - The SSRF override.
   * @param resolve - The resolver the save-time SSRF check judges.
   */
  constructor(
    private readonly endpoints: WebhooksRepository,
    private readonly vault: VaultService,
    private readonly audit: AuditService,
    private readonly dispatcher: WebhookDispatcher,
    config: AppConfigService,
    @Inject(WEBHOOK_RESOLVER) private readonly resolve: HostResolver,
  ) {
    this.allowlist = new InternalAllowlist(config.webhookInternalAllowlist);
  }

  /**
   * Every endpoint, its health, the counted *N active* and the derived SIEM row.
   *
   * @param organizationId - The workspace.
   * @returns The list answer.
   */
  async list(organizationId: string): Promise<WebhookListResource> {
    const [rows, health] = await Promise.all([
      this.endpoints.list(organizationId),
      this.endpoints.health(organizationId),
    ]);
    const byEndpoint = new Map(health.map((row) => [row.endpoint_id, row]));
    const items = rows.map((row) => endpointResource(row, endpointHealth(byEndpoint.get(row.id))));

    return {
      items,
      activeCount: items.filter((item) => item.active).length,
      siem: siemResource(items),
      registry: registryResource(),
    };
  }

  /**
   * One endpoint.
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @returns The endpoint and its health.
   * @throws {NotFoundError} `404 webhook_not_found`.
   */
  async read(organizationId: string, id: string): Promise<WebhookEndpointResource> {
    const row = await this.found(organizationId, id);

    return this.render(organizationId, row);
  }

  /**
   * Create an endpoint. The answer carries its signing secret — the only time it ever will.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who created it.
   * @param request - The endpoint.
   * @returns The endpoint and its secret, `201`.
   * @throws {InvalidRequestError} `422` for a refused URL, subscription or SIEM shape.
   * @throws {ConflictError} `409` for a taken name or a second SIEM route.
   */
  async create(
    organizationId: string,
    actorId: string,
    request: CreateWebhookDto,
  ): Promise<WebhookSecretResource> {
    const siem = request.siem ?? false;

    this.checkSubscriptions(request.eventFamilies, LATEST_REGISTRY_VERSION, siem);
    await this.checkTarget(request.url);

    const id = randomUUID();
    const secret = mintSigningSecret();
    const sealed = await this.vault.encryptText(organizationId, id, secret);

    await this.endpoints.transaction(async (trx) => {
      if (await this.endpoints.nameTaken(trx, organizationId, request.name)) {
        throw webhookNameTaken(request.name);
      }

      const otherSiem = siem ? await this.endpoints.otherSiem(trx, organizationId) : undefined;

      if (otherSiem !== undefined) throw webhookSiemTaken(otherSiem);

      await this.endpoints.insert(trx, {
        id,
        organizationId,
        name: request.name,
        description: request.description ?? null,
        url: request.url,
        hmacKeySealed: sealed,
        eventFamilies: request.eventFamilies,
        siem,
        active: request.active ?? true,
        registryVersion: LATEST_REGISTRY_VERSION,
        createdBy: actorId,
      });
    });

    const row = await this.found(organizationId, id);

    await this.record(organizationId, actorId, WEBHOOK_CREATED_EVENT, row, {
      families: row.event_families.join(","),
      siem: row.siem,
      active: row.active,
    });

    return { endpoint: await this.render(organizationId, row), secret };
  }

  /**
   * Edit an endpoint. Writes one audit event: `webhook.enabled` / `webhook.disabled` when the
   * switch was the only change, `webhook.updated` otherwise (naming the changed fields).
   *
   * @param organizationId - The workspace.
   * @param actorId - Who edited it.
   * @param id - The endpoint.
   * @param request - The fields to change.
   * @returns The endpoint as stored.
   */
  async update(
    organizationId: string,
    actorId: string,
    id: string,
    request: UpdateWebhookDto,
  ): Promise<WebhookEndpointResource> {
    const current = await this.found(organizationId, id);
    const families = request.eventFamilies ?? current.event_families;
    const siem = request.siem ?? current.siem;
    const version = request.registryVersion ?? current.registry_version;

    if (version > LATEST_REGISTRY_VERSION) {
      throw webhookRegistryVersionUnknown(version, LATEST_REGISTRY_VERSION);
    }

    this.checkSubscriptions(families, version, siem);

    if (request.url !== undefined && request.url !== current.url) {
      await this.checkTarget(request.url);
    }

    const changes: EndpointChanges = {
      name: request.name,
      description: request.description,
      url: request.url,
      eventFamilies: request.eventFamilies,
      siem: request.siem,
      active: request.active,
      registryVersion: request.registryVersion,
    };
    const changed = changedFields(current, changes);

    if (changed.length === 0) return this.render(organizationId, current);

    await this.endpoints.transaction(async (trx) => {
      if (
        request.name !== undefined &&
        (await this.endpoints.nameTaken(trx, organizationId, request.name, id))
      ) {
        throw webhookNameTaken(request.name);
      }

      const otherSiem = siem ? await this.endpoints.otherSiem(trx, organizationId, id) : undefined;

      if (otherSiem !== undefined) throw webhookSiemTaken(otherSiem);

      await this.endpoints.update(trx, organizationId, id, changes);
    });

    const row = await this.found(organizationId, id);
    const action = updateEvent(changed, row.active);

    await this.record(organizationId, actorId, action, row, {
      fields: changed.join(","),
      families: row.event_families.join(","),
      siem: row.siem,
      active: row.active,
      registry_version: row.registry_version,
    });

    return this.render(organizationId, row);
  }

  /**
   * Replace the signing secret. The old one stops signing at once; the answer carries the new one,
   * once.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who rotated it.
   * @param id - The endpoint.
   * @returns The endpoint and its new secret.
   */
  async rotate(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<WebhookSecretResource> {
    await this.found(organizationId, id);

    const secret = mintSigningSecret();
    const sealed = await this.vault.encryptText(organizationId, id, secret);

    await this.endpoints.transaction((trx) =>
      this.endpoints.update(trx, organizationId, id, { hmacKeySealed: sealed }),
    );

    const row = await this.found(organizationId, id);

    await this.record(organizationId, actorId, WEBHOOK_SECRET_ROTATED_EVENT, row, {});

    return { endpoint: await this.render(organizationId, row), secret };
  }

  /**
   * Delete an endpoint and its delivery log.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who deleted it.
   * @param id - The endpoint.
   */
  async remove(organizationId: string, actorId: string, id: string): Promise<void> {
    const row = await this.found(organizationId, id);

    if (!(await this.endpoints.delete(organizationId, id))) throw webhookNotFound(id);

    await this.record(organizationId, actorId, WEBHOOK_DELETED_EVENT, row, {
      siem: row.siem,
    });
  }

  /**
   * Fire the test event at one endpoint, now, and answer with the delivery-log row it produced —
   * so *did it work* is a row, not a guess. A ping is never retried; it may be sent to a disabled
   * endpoint, because checking one before switching it on is the point.
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @returns The settled attempt.
   */
  async ping(organizationId: string, id: string): Promise<WebhookDeliveryResource> {
    const row = await this.found(organizationId, id);
    const sealed = await this.endpoints.sealedSecret(organizationId, id);

    if (sealed === undefined) throw webhookNotFound(id);

    const now = new Date();
    // Queued already leased, so the dispatcher never takes it while this request sends it.
    const [delivery] = await this.endpoints.insertDeliveries([
      {
        organizationId,
        endpointId: id,
        eventType: PING_EVENT,
        eventId: null,
        deliveryKey: randomUUID(),
        attempt: 1,
        nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
      },
    ]);

    const settlement = await this.dispatcher.send({
      delivery,
      url: row.url,
      hmacKeySealed: sealed,
      registryVersion: row.registry_version,
    });

    await this.dispatcher.settle(delivery, settlement);

    return this.delivery(organizationId, id, delivery.id);
  }

  /**
   * One page of an endpoint's delivery log, newest first.
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @param query - The status filter and window.
   * @returns The page.
   */
  async deliveries(
    organizationId: string,
    id: string,
    query: ListDeliveriesQuery,
  ): Promise<WebhookDeliveryPageResource> {
    await this.found(organizationId, id);

    const window = windowOf(query);
    const { rows, total } = await this.endpoints.page(organizationId, id, query.status, window);

    return pageOf(rows.map(deliveryResource), total, window);
  }

  /**
   * Queue a dead-lettered event again: a new pending attempt with the same idempotency key, due
   * now. It gets one try; a failure returns it to the DLQ.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who redelivered it.
   * @param id - The endpoint.
   * @param deliveryId - The dead-lettered attempt.
   * @returns The new pending attempt.
   * @throws {ConflictError} `409 webhook_delivery_not_redeliverable` unless the attempt is the
   *   latest at its event and dead-lettered.
   */
  async redeliver(
    organizationId: string,
    actorId: string,
    id: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryResource> {
    const endpoint = await this.found(organizationId, id);

    const queued = await this.endpoints.transaction(async (trx) => {
      const dead = await this.endpoints.findDelivery(organizationId, id, deliveryId, trx);

      if (dead === undefined) throw webhookDeliveryNotFound(deliveryId);
      if (!dead.redeliverable) throw webhookNotRedeliverable(deliveryId, dead.status);

      const attempt = (await this.endpoints.lastAttempt(trx, dead.delivery_key)) + 1;
      const [row] = await this.endpoints.insertDeliveries(
        [
          {
            organizationId,
            endpointId: id,
            eventType: dead.event_type,
            eventId: dead.event_id,
            deliveryKey: dead.delivery_key,
            attempt,
            nextAttemptAt: new Date(),
          },
        ],
        trx,
      );

      return row;
    });

    await this.record(organizationId, actorId, WEBHOOK_REDELIVERED_EVENT, endpoint, {
      delivery_id: deliveryId,
      delivery_key: queued.delivery_key,
      event_type: queued.event_type,
      attempt: queued.attempt,
    });

    return this.delivery(organizationId, id, queued.id);
  }

  // --- helpers -----------------------------------------------------------------------------

  /**
   * An endpoint, or the `404`.
   *
   * @param organizationId - The workspace.
   * @param id - The endpoint.
   * @returns The row.
   */
  private async found(organizationId: string, id: string): Promise<EndpointRow> {
    const row = await this.endpoints.find(organizationId, id);

    if (row === undefined) throw webhookNotFound(id);

    return row;
  }

  /**
   * An endpoint with its health.
   *
   * @param organizationId - The workspace.
   * @param row - The row.
   * @returns The resource.
   */
  private async render(organizationId: string, row: EndpointRow): Promise<WebhookEndpointResource> {
    const health = await this.endpoints.health(organizationId);

    return endpointResource(row, endpointHealth(health.find((h) => h.endpoint_id === row.id)));
  }

  /**
   * One delivery-log row as a resource.
   *
   * @param organizationId - The workspace.
   * @param endpointId - The endpoint.
   * @param deliveryId - The attempt.
   * @returns The resource.
   */
  private async delivery(
    organizationId: string,
    endpointId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryResource> {
    const row = await this.endpoints.findDelivery(organizationId, endpointId, deliveryId);

    if (row === undefined) throw webhookDeliveryNotFound(deliveryId);

    return deliveryResource(row);
  }

  /**
   * The URL policy at save time.
   *
   * @param url - The URL.
   * @throws {InvalidRequestError} `422 webhook_target_refused`.
   */
  private async checkTarget(url: string): Promise<void> {
    try {
      await checkWebhookTarget(url, this.resolve, this.allowlist);
    } catch (error) {
      if (error instanceof SsrfBlockedError) throw webhookTargetRefused(error.reason, error.detail);
      throw error;
    }
  }

  /**
   * Every subscription entry registered at the version, and a SIEM route on `audit.*`.
   *
   * @param families - The entries.
   * @param version - The registry version.
   * @param siem - Whether the endpoint is the SIEM route.
   */
  private checkSubscriptions(families: readonly string[], version: number, siem: boolean): void {
    const problems = families
      .map((entry) => subscriptionEntryProblem(entry, version))
      .filter((problem): problem is string => problem !== undefined);

    if (problems.length > 0) throw webhookSubscriptionInvalid(problems);
    if (siem && !families.includes("audit.*")) throw webhookSiemRequiresAudit();
  }

  /**
   * Write one audit event about an endpoint. The detail names the host, never the URL.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who.
   * @param action - What.
   * @param row - The endpoint.
   * @param detail - What else to record.
   */
  private async record(
    organizationId: string,
    actorId: string,
    action: AuditAction,
    row: EndpointRow,
    detail: AuditDetail,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorId,
      action,
      subjectType: "webhook_endpoint",
      subjectId: row.id,
      at: new Date(),
      detail: { name: row.name, host: hostOf(new URL(row.url)), ...detail },
    });
  }
}

/**
 * Which fields an edit actually changes.
 *
 * @param current - The row as stored.
 * @param changes - The request.
 * @returns The DTO names of the fields whose value differs.
 */
export function changedFields(current: EndpointRow, changes: EndpointChanges): string[] {
  const changed: string[] = [];

  if (changes.name !== undefined && changes.name !== current.name) changed.push("name");
  if (changes.description !== undefined && changes.description !== current.description) {
    changed.push("description");
  }
  if (changes.url !== undefined && changes.url !== current.url) changed.push("url");
  if (
    changes.eventFamilies !== undefined &&
    JSON.stringify([...changes.eventFamilies].sort()) !==
      JSON.stringify([...current.event_families].sort())
  ) {
    changed.push("eventFamilies");
  }
  if (changes.siem !== undefined && changes.siem !== current.siem) changed.push("siem");
  if (changes.active !== undefined && changes.active !== current.active) changed.push("active");
  if (
    changes.registryVersion !== undefined &&
    changes.registryVersion !== current.registry_version
  ) {
    changed.push("registryVersion");
  }

  return changed;
}

/**
 * The audit action an edit is recorded as — the switch's own name when it was the only change.
 *
 * @param changed - The changed fields.
 * @param active - The endpoint's state after the edit.
 * @returns `webhook.enabled`, `webhook.disabled` or `webhook.updated`.
 */
export function updateEvent(changed: readonly string[], active: boolean): AuditAction {
  if (changed.length === 1 && changed[0] === "active") {
    return active ? WEBHOOK_ENABLED_EVENT : WEBHOOK_DISABLED_EVENT;
  }

  return WEBHOOK_UPDATED_EVENT;
}
