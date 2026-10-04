/**
 * Service accounts — create, list, rotate, revoke
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1).
 *
 * The lifecycle the issue's acceptance criterion walks:
 *
 * ```
 * create  → account + token #1 (shown once)            service_account.created
 * use     → Bearer orb_svc_… authenticates as service:<name>, within its scopes
 * rotate  → token #1 revoked, token #2 minted (shown once), in one transaction
 *                                                       service_account.rotated
 * revoke  → live token revoked, account disabled        service_account.revoked
 * ```
 *
 * Rotation revokes and inserts in **one transaction**, so there is no instant at which both
 * tokens work and none at which neither does; the pre-rotation token stops authenticating the
 * moment the commit lands, because every lookup filters on `revoked_at is null`.
 *
 * The hint is sealed with the vault **before** the transaction opens: sealing reads the
 * workspace's DEK over its own connection, and holding a write transaction open across it would
 * only widen the lock.
 */

import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import {
  SERVICE_ACCOUNT_CREATED_EVENT,
  SERVICE_ACCOUNT_REVOKED_EVENT,
  SERVICE_ACCOUNT_ROTATED_EVENT,
  type AuditAction,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type { Database } from "../db/schema";
import { VaultService } from "../vault/vault.service";
import type { CreateServiceAccountDto } from "./service-accounts.dto";
import {
  serviceAccountDisabled,
  serviceAccountNameTaken,
  serviceAccountNotFound,
} from "./service-accounts.errors";
import { ServiceAccountsRepository, type ServiceAccountRow } from "./service-accounts.repository";
import {
  serviceAccountResource,
  serviceScopeResources,
  type ServiceAccountListResource,
  type ServiceAccountResource,
  type ServiceAccountSecretResource,
} from "./service-accounts.resources";
import { mintServiceToken, type MintedServiceToken } from "./service.tokens";

/** A minted token, its row id, and its sealed hint — everything but the transaction. */
interface PreparedToken {
  readonly id: string;
  readonly minted: MintedServiceToken;
  readonly hintSealed: string;
}

@Injectable()
export class ServiceAccountsService {
  /**
   * @param accounts - The statements.
   * @param vault - Seals and opens the token hints (AD.1).
   * @param audit - AD.4's trail.
   */
  constructor(
    private readonly accounts: ServiceAccountsRepository,
    private readonly vault: VaultService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every service account of a workspace, with the registered scopes.
   *
   * @param organizationId - The workspace.
   * @returns The accounts (newest first; tokens masked) and the allow-list.
   */
  async list(organizationId: string): Promise<ServiceAccountListResource> {
    const rows = await this.accounts.list(organizationId);
    const items = await Promise.all(rows.map((row) => this.render(organizationId, row)));

    return { items, scopes: serviceScopeResources() };
  }

  /**
   * Create an account and its first token.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who created it.
   * @param request - The name and scopes, validated.
   * @returns The account and the token — the only time the token is ever returned.
   * @throws {ConflictError} `service_account_name_taken`.
   */
  async create(
    organizationId: string,
    actorId: string,
    request: CreateServiceAccountDto,
  ): Promise<ServiceAccountSecretResource> {
    const token = await this.prepare(organizationId);
    const at = new Date();

    const accountId = await this.accounts.transaction(async (trx) => {
      if (await this.accounts.nameTaken(organizationId, request.name, trx)) {
        throw serviceAccountNameTaken(request.name);
      }

      const id = await this.accounts.insertAccount(trx, {
        organization_id: organizationId,
        name: request.name,
        scopes: request.scopes,
        created_by: actorId,
      });

      await this.insertToken(trx, organizationId, id, actorId, token, at);

      return id;
    });

    const row = await this.found(organizationId, accountId);

    await this.record(organizationId, actorId, SERVICE_ACCOUNT_CREATED_EVENT, row, at);

    return { account: serviceAccountResource(row, token.minted.hint), token: token.minted.value };
  }

  /**
   * Replace an account's token. The old one stops working at the commit.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who rotated it.
   * @param id - The account.
   * @returns The account and the new token — shown once.
   * @throws {NotFoundError} `service_account_not_found`.
   * @throws {ConflictError} `service_account_disabled` — a revoked account stays revoked.
   */
  async rotate(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<ServiceAccountSecretResource> {
    const existing = await this.found(organizationId, id);

    if (existing.disabled_at !== null) throw serviceAccountDisabled(id);

    const token = await this.prepare(organizationId);
    const at = new Date();

    await this.accounts.transaction(async (trx) => {
      const current = await this.accounts.find(organizationId, id, trx);

      if (current === undefined) throw serviceAccountNotFound(id);
      if (current.disabled_at !== null) throw serviceAccountDisabled(id);

      await this.accounts.revokeLive(trx, id, at);
      await this.insertToken(trx, organizationId, id, actorId, token, at);
    });

    const row = await this.found(organizationId, id);

    await this.record(organizationId, actorId, SERVICE_ACCOUNT_ROTATED_EVENT, row, at);

    return { account: serviceAccountResource(row, token.minted.hint), token: token.minted.value };
  }

  /**
   * Revoke an account: its token dies and the account is disabled. Idempotent — revoking a
   * revoked account changes nothing and records nothing.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who revoked it.
   * @param id - The account.
   * @returns The account, disabled and tokenless.
   * @throws {NotFoundError} `service_account_not_found`.
   */
  async revoke(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<ServiceAccountResource> {
    const existing = await this.found(organizationId, id);

    if (existing.disabled_at !== null) return this.render(organizationId, existing);

    const at = new Date();

    await this.accounts.transaction(async (trx) => {
      await this.accounts.revokeLive(trx, id, at);
      await this.accounts.disable(trx, id, at);
    });

    const row = await this.found(organizationId, id);

    await this.record(organizationId, actorId, SERVICE_ACCOUNT_REVOKED_EVENT, row, at);

    return serviceAccountResource(row, null);
  }

  /**
   * Mint a token and seal its hint, outside any transaction.
   *
   * @param organizationId - The workspace whose DEK seals the hint.
   * @returns The token, its row id and its sealed hint.
   */
  private async prepare(organizationId: string): Promise<PreparedToken> {
    const id = randomUUID();
    const minted = mintServiceToken();
    const hintSealed = await this.vault.encryptText(organizationId, id, minted.hint);

    return { id, minted, hintSealed };
  }

  /**
   * Insert a prepared token: its hash and sealed hint, never the token.
   *
   * @param trx - The transaction.
   * @param organizationId - The workspace.
   * @param accountId - The account.
   * @param actorId - Who minted it.
   * @param token - The prepared token.
   * @param at - When.
   */
  private insertToken(
    trx: Transaction<Database>,
    organizationId: string,
    accountId: string,
    actorId: string,
    token: PreparedToken,
    at: Date,
  ): Promise<void> {
    return this.accounts.insertToken(trx, {
      id: token.id,
      organization_id: organizationId,
      service_account_id: accountId,
      token_hash: token.minted.hash,
      hint_sealed: token.hintSealed,
      created_by: actorId,
      created_at: at,
    });
  }

  /**
   * Read an account, or refuse.
   *
   * @param organizationId - The workspace.
   * @param id - The account.
   * @returns The row.
   * @throws {NotFoundError} `service_account_not_found`.
   */
  private async found(organizationId: string, id: string): Promise<ServiceAccountRow> {
    const row = await this.accounts.find(organizationId, id);

    if (row === undefined) throw serviceAccountNotFound(id);

    return row;
  }

  /**
   * Render an account, opening its live token's hint.
   *
   * @param organizationId - The workspace.
   * @param row - The account.
   * @returns The resource.
   */
  private async render(
    organizationId: string,
    row: ServiceAccountRow,
  ): Promise<ServiceAccountResource> {
    const hint =
      row.token_id !== null && row.token_hint_sealed !== null
        ? await this.vault.decryptText(organizationId, row.token_id, row.token_hint_sealed)
        : null;

    return serviceAccountResource(row, hint);
  }

  /**
   * Audit a lifecycle step. The detail names the account and its scopes — never a token or hint.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who.
   * @param action - Which step.
   * @param row - The account after the step.
   * @param at - When.
   */
  private async record(
    organizationId: string,
    actorId: string,
    action: AuditAction,
    row: ServiceAccountRow,
    at: Date,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorId,
      action,
      subjectType: "service_account",
      subjectId: row.id,
      at,
      detail: { name: row.name, scopes: row.scopes.join(",") },
    });
  }
}
