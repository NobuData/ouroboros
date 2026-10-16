/**
 * Opening a saved connection for one model call — the half of AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)) that touches a credential.
 *
 * ```
 * chain executor ──▶ ConnectionOpener.open(org, id) ──▶ { adapter, context }   one hop, one scope
 *                ──▶ ConnectionOpener.touch(org, id)  ──▶ last_used_at = now()  the card's "last used"
 * ```
 *
 * The executor lives in `internal/` and needs exactly three things from this module: what a
 * connection is (its kind and monthly cap), the connection opened for one call, and
 * `last_used_at` kept. `ConnectionOpenerModule` exports this class rather than the repository, which keeps every read of a
 * credential envelope inside this module, as it was before (decision **P3**): the plaintext is
 * a value in the returned context for the length of one hop and is never stored on `this`.
 */

import { Injectable } from "@nestjs/common";

import type { ProviderConnectionKind } from "../db/schema";
import {
  supportsInvocation,
  type InvocationCapableAdapter,
  type ProviderConnectionContext,
} from "../providers/provider.adapter";
import { storedConfigSchema } from "../providers/provider.forms";
import { ProviderAdapterError } from "../providers/provider.errors";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { VaultService } from "../vault/vault.service";
import { submissionOf } from "./config.mapping";
import { ProviderConnectionsRepository } from "./provider-connections.repository";

/** What the executor knows about a connection before it opens one. */
export interface ConnectionSummary {
  readonly id: string;
  readonly kind: ProviderConnectionKind;
  /** The card's calendar-month cap in cents (decision P7), or null for none. */
  readonly monthlyCapCents: number | null;
}

/** A connection opened for one call. */
export interface OpenedConnection {
  readonly adapter: InvocationCapableAdapter;
  readonly context: ProviderConnectionContext;
  /** The card's calendar-month cap in cents, read from the same row. */
  readonly monthlyCapCents: number | null;
}

@Injectable()
export class ConnectionOpener {
  constructor(
    private readonly connections: ProviderConnectionsRepository,
    private readonly vault: VaultService,
    private readonly registry: ModelProviderRegistry,
  ) {}

  /**
   * Describe a connection without opening it.
   *
   * @param organizationId - The workspace.
   * @param connectionId - `provider_connections.id`.
   * @returns Its kind and cap, or undefined when the workspace has no such connection.
   */
  async describe(
    organizationId: string,
    connectionId: string,
  ): Promise<ConnectionSummary | undefined> {
    const row = await this.connections.find(organizationId, connectionId);

    return row === undefined
      ? undefined
      : { id: row.id, kind: row.kind, monthlyCapCents: row.monthly_cap_cents };
  }

  /**
   * Open a connection for one model call.
   *
   * @param organizationId - The workspace.
   * @param connectionId - `provider_connections.id`.
   * @returns The adapter, narrowed to one that invokes, the opened context, and the cap.
   * @throws {ProviderAdapterError} `config` when the connection is gone or its kind is not
   *   cleared for invocation (`copilot`, `cursor`) — a fact about the hop, which the executor
   *   reports like any other refusal of that class.
   */
  async open(organizationId: string, connectionId: string): Promise<OpenedConnection> {
    const row = await this.connections.find(organizationId, connectionId);

    if (row === undefined) {
      throw new ProviderAdapterError("config", "connection removed");
    }

    const adapter = this.registry.find(row.kind);

    if (adapter === undefined || !supportsInvocation(adapter)) {
      throw new ProviderAdapterError("config", "provider not cleared for invocation");
    }

    const config = Object.freeze(submissionOf(storedConfigSchema(adapter.configSchema()), row));
    const envelope = await this.connections.envelopeOf(organizationId, row.id);
    const secret =
      envelope === null || envelope === undefined
        ? null
        : await this.vault.decryptText(organizationId, row.id, envelope);

    return {
      adapter,
      // The row's address travels beside `config` because a kind whose schema has no address
      // field (Anthropic) drops it from `submissionOf`, and a seeded fixture address must still
      // reach the relay (#1314).
      context: { connectionId: row.id, config, secret, baseUrl: row.base_url ?? null },
      monthlyCapCents: row.monthly_cap_cents,
    };
  }

  /**
   * Record that a connection served a call — the meta row's *"last used 3m ago"* (AC.6).
   *
   * @param organizationId - The workspace.
   * @param connectionId - `provider_connections.id`.
   * @param at - When.
   */
  async touch(organizationId: string, connectionId: string, at: Date): Promise<void> {
    await this.connections.touch(organizationId, connectionId, at);
  }
}
