/**
 * An in-memory stand-in for {@link WebhooksRepository}, a vault that seals reversibly, a recording
 * audit trail and a scripted transport — so the dispatcher and the management service run their
 * real code over state a test can read (#487).
 *
 * The SQL itself is proven against PostgreSQL in `webhooks.integration-spec.ts`; this fake keeps
 * the same rules (one pending attempt per key, settle only a pending attempt, endpoints without
 * their envelope) so a unit test cannot pass on behaviour the database would refuse.
 */

import { randomUUID } from "node:crypto";

import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { WebhookDelivery, WebhookEndpoint, WebhookOutboxEvent } from "../db/schema";
import type { VaultService } from "../vault/vault.service";
import type { WebhookRequest, WebhookResponse, WebhookTransport } from "./webhook.transport";
import { WebhookTransportError } from "./webhook.transport";
import type {
  ClaimedDelivery,
  DeliveryLogRow,
  EndpointChanges,
  EndpointHealthRow,
  EndpointRow,
  NewDelivery,
  NewEndpoint,
  Settlement,
  WebhooksRepository,
} from "./webhooks.repository";

/** The workspace every fixture row belongs to unless a test says otherwise. */
export const WORKSPACE = "org-acme";

/** Another workspace, for isolation checks. */
export const OTHER_WORKSPACE = "org-other";

/** The fixture vault's envelope prefix — a real `ouro.v1.` envelope in shape only. */
const SEALED = "ouro.v1.fixture.";

/** A vault that "seals" by base64 under a recognisable prefix, keyed by workspace and record. */
export class FakeVault {
  /** Every seal, so a test can assert what was sealed under which record. */
  readonly sealed: { organizationId: string; recordId: string }[] = [];

  encryptText(organizationId: string, recordId: string, plaintext: string): Promise<string> {
    this.sealed.push({ organizationId, recordId });
    const inner = Buffer.from(`${organizationId}|${recordId}|${plaintext}`).toString("base64url");

    return Promise.resolve(`${SEALED}${inner}`);
  }

  decryptText(organizationId: string, recordId: string, envelope: string): Promise<string> {
    const [org, record, ...rest] = Buffer.from(envelope.slice(SEALED.length), "base64url")
      .toString("utf8")
      .split("|");

    if (org !== organizationId || record !== recordId) {
      return Promise.reject(new Error("envelope opened under the wrong record"));
    }

    return Promise.resolve(rest.join("|"));
  }

  /** As the service expects it. */
  asService(): VaultService {
    return this as unknown as VaultService;
  }
}

/** An audit trail that keeps what it was given. */
export class RecordingAudit {
  readonly records: AuditRecord[] = [];

  record(event: AuditRecord): Promise<string> {
    this.records.push(event);
    return Promise.resolve(randomUUID());
  }

  /** As the service expects it. */
  asService(): AuditService {
    return this as unknown as AuditService;
  }
}

/** One scripted answer: a status and body, or a transport failure. */
export type ScriptedAnswer =
  { readonly status: number; readonly body?: string } | { readonly error: WebhookTransportError };

/** A transport that answers from a script and records every request. */
export class ScriptedTransport implements WebhookTransport {
  readonly requests: WebhookRequest[] = [];
  private readonly script: ScriptedAnswer[] = [];

  /** The answer once the script runs out. */
  fallback: ScriptedAnswer = { status: 200, body: "ok" };

  /** Queue answers, in order. */
  answer(...answers: ScriptedAnswer[]): this {
    this.script.push(...answers);
    return this;
  }

  /** @inheritdoc */
  send(request: WebhookRequest): Promise<WebhookResponse> {
    this.requests.push(request);
    const next = this.script.shift() ?? this.fallback;

    if ("error" in next) return Promise.reject(next.error);

    return Promise.resolve({ status: next.status, body: next.body ?? "" });
  }
}

/** A config with the webhook settings a test needs. */
export function webhookConfig(over: Partial<Record<string, unknown>> = {}): AppConfigService {
  return {
    webhookMaxAttempts: 3,
    webhookDispatchSeconds: 5,
    webhookInternalAllowlist: [],
    ...over,
  } as unknown as AppConfigService;
}

/** The in-memory repository. */
export class FakeWebhookStore {
  readonly endpoints: WebhookEndpoint[] = [];
  readonly deliveries: WebhookDelivery[] = [];
  readonly outbox: WebhookOutboxEvent[] = [];

  /** The clock rows are stamped with. */
  now = new Date("2026-10-04T12:00:00.000Z");

  /** As the code under test expects it. */
  asRepository(): WebhooksRepository {
    return this as unknown as WebhooksRepository;
  }

  // --- seeding -----------------------------------------------------------------------------

  /** Add an endpoint directly, as a test's precondition. */
  seedEndpoint(over: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
    const row: WebhookEndpoint = {
      id: randomUUID(),
      organization_id: WORKSPACE,
      name: `endpoint-${String(this.endpoints.length + 1)}`,
      description: null,
      url: "https://siem.acme.dev/hook",
      hmac_key_sealed: "",
      event_families: ["audit.*"],
      siem: false,
      active: true,
      registry_version: 1,
      created_by: "user-admin",
      created_at: new Date(this.now.getTime() - 60_000),
      updated_at: new Date(this.now.getTime() - 60_000),
      ...over,
    };

    // Seal under the row's real id, the way the service does.
    row.hmac_key_sealed = `${SEALED}${Buffer.from(`${row.organization_id}|${row.id}|whsec_test`).toString("base64url")}`;
    this.endpoints.push(row);

    return row;
  }

  /** Add an outbox event directly. */
  seedEvent(over: Partial<WebhookOutboxEvent> = {}): WebhookOutboxEvent {
    const row: WebhookOutboxEvent = {
      id: randomUUID(),
      organization_id: WORKSPACE,
      event_type: "audit.provider.rotated",
      payload: { id: "audit-1", action: "provider.rotated" },
      occurred_at: this.now,
      dispatched_at: null,
      ...over,
    };

    this.outbox.push(row);

    return row;
  }

  // --- WebhooksRepository ------------------------------------------------------------------

  transaction<T>(work: (trx: never) => Promise<T>): Promise<T> {
    return work(undefined as never);
  }

  list(organizationId: string): Promise<EndpointRow[]> {
    return Promise.resolve(
      this.endpoints.filter((e) => e.organization_id === organizationId).map(withoutEnvelope),
    );
  }

  find(organizationId: string, id: string): Promise<EndpointRow | undefined> {
    const row = this.endpoints.find((e) => e.organization_id === organizationId && e.id === id);

    return Promise.resolve(row === undefined ? undefined : withoutEnvelope(row));
  }

  sealedSecret(organizationId: string, id: string): Promise<string | undefined> {
    return Promise.resolve(
      this.endpoints.find((e) => e.organization_id === organizationId && e.id === id)
        ?.hmac_key_sealed,
    );
  }

  nameTaken(
    _trx: unknown,
    organizationId: string,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    return Promise.resolve(
      this.endpoints.some(
        (e) => e.organization_id === organizationId && e.name === name && e.id !== exceptId,
      ),
    );
  }

  otherSiem(_trx: unknown, organizationId: string, exceptId?: string): Promise<string | undefined> {
    return Promise.resolve(
      this.endpoints.find(
        (e) => e.organization_id === organizationId && e.siem && e.id !== exceptId,
      )?.id,
    );
  }

  insert(_trx: unknown, endpoint: NewEndpoint): Promise<void> {
    this.endpoints.push({
      id: endpoint.id,
      organization_id: endpoint.organizationId,
      name: endpoint.name,
      description: endpoint.description,
      url: endpoint.url,
      hmac_key_sealed: endpoint.hmacKeySealed,
      event_families: [...endpoint.eventFamilies],
      siem: endpoint.siem,
      active: endpoint.active,
      registry_version: endpoint.registryVersion,
      created_by: endpoint.createdBy,
      created_at: this.now,
      updated_at: this.now,
    });

    return Promise.resolve();
  }

  update(
    _trx: unknown,
    organizationId: string,
    id: string,
    changes: EndpointChanges,
  ): Promise<void> {
    const row = this.endpoints.find((e) => e.organization_id === organizationId && e.id === id);

    if (row !== undefined) {
      if (changes.name !== undefined) row.name = changes.name;
      if (changes.description !== undefined) row.description = changes.description;
      if (changes.url !== undefined) row.url = changes.url;
      if (changes.hmacKeySealed !== undefined) row.hmac_key_sealed = changes.hmacKeySealed;
      if (changes.eventFamilies !== undefined) row.event_families = [...changes.eventFamilies];
      if (changes.siem !== undefined) row.siem = changes.siem;
      if (changes.active !== undefined) row.active = changes.active;
      if (changes.registryVersion !== undefined) row.registry_version = changes.registryVersion;
      row.updated_at = this.now;
    }

    return Promise.resolve();
  }

  delete(organizationId: string, id: string): Promise<boolean> {
    const index = this.endpoints.findIndex(
      (e) => e.organization_id === organizationId && e.id === id,
    );

    if (index < 0) return Promise.resolve(false);

    this.endpoints.splice(index, 1);
    // V094's cascade.
    for (let i = this.deliveries.length - 1; i >= 0; i -= 1) {
      if (this.deliveries[i].endpoint_id === id) this.deliveries.splice(i, 1);
    }

    return Promise.resolve(true);
  }

  health(organizationId: string): Promise<EndpointHealthRow[]> {
    return Promise.resolve(
      this.endpoints
        .filter((e) => e.organization_id === organizationId)
        .map((endpoint) => {
          const log = this.deliveries.filter(
            (d) => d.endpoint_id === endpoint.id && d.event_type !== "ping",
          );
          const newest = (d: WebhookDelivery) =>
            !log.some((o) => o.delivery_key === d.delivery_key && o.attempt > d.attempt);
          const settled = log
            .filter((d) => d.status !== "pending")
            .sort(
              (a, b) =>
                b.attempted_at.getTime() - a.attempted_at.getTime() || b.attempt - a.attempt,
            );
          const succeeded = log.filter((d) => d.status === "succeeded");

          return {
            endpoint_id: endpoint.id,
            dead_lettered: log.filter((d) => newest(d) && d.status === "dead_lettered").length,
            retrying: log.filter((d) => d.status === "pending" && d.attempt > 1).length,
            last_status: settled[0]?.status ?? null,
            last_response_code: settled[0]?.response_code ?? null,
            last_attempted_at: settled[0]?.attempted_at ?? null,
            last_succeeded_at:
              succeeded.length === 0
                ? null
                : new Date(Math.max(...succeeded.map((d) => d.attempted_at.getTime()))),
          };
        }),
    );
  }

  insertDeliveries(deliveries: readonly NewDelivery[]): Promise<WebhookDelivery[]> {
    const written = deliveries.map((delivery): WebhookDelivery => {
      if (
        this.deliveries.some(
          (d) => d.delivery_key === delivery.deliveryKey && d.status === "pending",
        )
      ) {
        throw new Error("webhook_deliveries_one_pending_idx");
      }

      return {
        id: randomUUID(),
        organization_id: delivery.organizationId,
        endpoint_id: delivery.endpointId,
        event_type: delivery.eventType,
        event_id: delivery.eventId,
        attempt: delivery.attempt,
        status: "pending",
        response_code: null,
        latency_ms: null,
        response_excerpt: null,
        attempted_at: this.now,
        delivery_key: delivery.deliveryKey,
        next_attempt_at: delivery.nextAttemptAt,
        error: null,
      };
    });

    this.deliveries.push(...written);

    return Promise.resolve(written.map((row) => ({ ...row })));
  }

  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<ClaimedDelivery[]> {
    const due = this.deliveries
      .filter((d) => {
        const endpoint = this.endpoints.find((e) => e.id === d.endpoint_id);

        return (
          d.status === "pending" &&
          d.next_attempt_at !== null &&
          d.next_attempt_at.getTime() <= now.getTime() &&
          endpoint?.active === true
        );
      })
      .slice(0, limit);

    return Promise.resolve(
      due.map((delivery) => {
        delivery.next_attempt_at = leaseUntil;
        const endpoint = this.endpoints.find(
          (e) => e.id === delivery.endpoint_id,
        ) as WebhookEndpoint;

        return {
          delivery: { ...delivery },
          url: endpoint.url,
          hmacKeySealed: endpoint.hmac_key_sealed,
          registryVersion: endpoint.registry_version,
        };
      }),
    );
  }

  settle(_executor: unknown, id: string, settlement: Settlement): Promise<boolean> {
    const row = this.deliveries.find((d) => d.id === id && d.status === "pending");

    if (row === undefined) return Promise.resolve(false);

    row.status = settlement.status;
    row.response_code = settlement.responseCode;
    row.latency_ms = settlement.latencyMs;
    row.response_excerpt = settlement.responseExcerpt;
    row.error = settlement.error;
    row.attempted_at = settlement.attemptedAt;
    row.next_attempt_at = null;

    return Promise.resolve(true);
  }

  wasDeadLettered(
    _executor: unknown,
    deliveryKey: string,
    beforeAttempt: number,
  ): Promise<boolean> {
    return Promise.resolve(
      this.deliveries.some(
        (d) =>
          d.delivery_key === deliveryKey &&
          d.attempt < beforeAttempt &&
          d.status === "dead_lettered",
      ),
    );
  }

  findDelivery(
    organizationId: string,
    endpointId: string,
    id: string,
  ): Promise<DeliveryLogRow | undefined> {
    const row = this.deliveries.find(
      (d) => d.organization_id === organizationId && d.endpoint_id === endpointId && d.id === id,
    );

    return Promise.resolve(row === undefined ? undefined : this.logRow(row));
  }

  lastAttempt(_executor: unknown, deliveryKey: string): Promise<number> {
    return Promise.resolve(
      Math.max(
        0,
        ...this.deliveries.filter((d) => d.delivery_key === deliveryKey).map((d) => d.attempt),
      ),
    );
  }

  page(
    organizationId: string,
    endpointId: string,
    status: WebhookDelivery["status"] | undefined,
    window: { limit: number; offset: number },
  ): Promise<{ rows: DeliveryLogRow[]; total: number }> {
    const all = this.deliveries
      .filter(
        (d) =>
          d.organization_id === organizationId &&
          d.endpoint_id === endpointId &&
          (status === undefined || d.status === status),
      )
      .sort((a, b) => b.attempted_at.getTime() - a.attempted_at.getTime() || b.attempt - a.attempt);

    return Promise.resolve({
      rows: all.slice(window.offset, window.offset + window.limit).map((row) => this.logRow(row)),
      total: all.length,
    });
  }

  claimUndispatched(_trx: unknown, limit: number): Promise<WebhookOutboxEvent[]> {
    return Promise.resolve(this.outbox.filter((e) => e.dispatched_at === null).slice(0, limit));
  }

  activeEndpoints(_trx: unknown, organizationIds: readonly string[]): Promise<EndpointRow[]> {
    return Promise.resolve(
      this.endpoints
        .filter((e) => organizationIds.includes(e.organization_id) && e.active)
        .map(withoutEnvelope),
    );
  }

  markDispatched(_trx: unknown, ids: readonly string[], at: Date): Promise<void> {
    for (const event of this.outbox) {
      if (ids.includes(event.id)) event.dispatched_at = at;
    }

    return Promise.resolve();
  }

  outboxEvent(organizationId: string, id: string): Promise<WebhookOutboxEvent | undefined> {
    return Promise.resolve(
      this.outbox.find((e) => e.organization_id === organizationId && e.id === id),
    );
  }

  // --- helpers -----------------------------------------------------------------------------

  /** A row with `redeliverable` computed the way the repository's SQL does. */
  private logRow(row: WebhookDelivery): DeliveryLogRow {
    return {
      ...row,
      redeliverable:
        row.status === "dead_lettered" &&
        !this.deliveries.some(
          (d) => d.delivery_key === row.delivery_key && d.attempt > row.attempt,
        ),
    };
  }
}

/**
 * An endpoint row without its envelope — what every repository reader returns.
 *
 * @param row - The full row.
 * @returns The row minus `hmac_key_sealed`.
 */
function withoutEnvelope(row: WebhookEndpoint): EndpointRow {
  const { hmac_key_sealed: _envelope, ...rest } = row;

  return { ...rest, event_families: [...rest.event_families] };
}

/** A transport failure, for scripts. */
export function transportFailure(
  kind: "blocked" | "timeout" | "network",
  message: string,
): ScriptedAnswer {
  return { error: new WebhookTransportError(kind, message) };
}
