/**
 * Every statement the action-token service issues (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463)) — V100's `action_token_keys` and V096's
 * `action_tokens`, through the functions V096 ships (`action_token_mint`, `action_token_use`).
 *
 * Raw SQL, as `decisions/inbox.repository.ts` reads its unmirrored tables: neither table is part
 * of REST's schema mirror, and no statement here takes or returns a token — only its HMAC.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { DecisionChannel } from "../../db/schema";

/** A stored key, still sealed. */
export interface SealedTokenKey {
  readonly keyRef: string;
  readonly organizationId: string;
  /** The vault envelope. */
  readonly sealedKey: string;
}

/** What `action_tokens_state` says of a token (V096) — `live`, or why it no longer works. */
export type ActionTokenState = "live" | "used" | "revoked" | "expired";

/** What `action_token_use` answered. */
export type ActionTokenUseOutcome = "accepted" | "used" | "revoked" | "expired" | "unknown";

/** A token, as the confirm page reads it — never the hash, never the token. */
export interface ActionTokenRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly itemId: string;
  readonly actionId: string;
  readonly userId: string;
  readonly channel: DecisionChannel;
  /** Copied from the kind's `merge_class` (X5): the action needs a signed-in confirm. */
  readonly requiresConfirm: boolean;
  readonly state: ActionTokenState;
  /** `superseded`, `item_closed` or `withdrawn` for a revoked token. */
  readonly revokeReason: string | null;
  readonly expiresAt: Date;
}

/** What one spend did. */
export interface ActionTokenUse {
  readonly outcome: ActionTokenUseOutcome;
  readonly tokenId: string | null;
}

@Injectable()
export class ActionTokenRepository {
  /** @param database - The service's connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's live key.
   *
   * @param organizationId - The workspace.
   * @returns The sealed key, or undefined when the workspace has none yet.
   */
  async liveKey(organizationId: string): Promise<SealedTokenKey | undefined> {
    const { rows } = await sql<{ key_ref: string; organization_id: string; sealed_key: string }>`
      select key_ref, organization_id, sealed_key from ouroboros.action_token_keys
       where organization_id = ${organizationId} and retired_at is null`.execute(this.database.db);

    return rows[0] === undefined ? undefined : sealedKeyOf(rows[0]);
  }

  /**
   * A key by its ref — live or retired, since a retired key still verifies its tokens.
   *
   * @param keyRef - `act.<16 hex>`.
   * @returns The sealed key, or undefined.
   */
  async keyByRef(keyRef: string): Promise<SealedTokenKey | undefined> {
    const { rows } = await sql<{ key_ref: string; organization_id: string; sealed_key: string }>`
      select key_ref, organization_id, sealed_key from ouroboros.action_token_keys
       where key_ref = ${keyRef}`.execute(this.database.db);

    return rows[0] === undefined ? undefined : sealedKeyOf(rows[0]);
  }

  /**
   * Store a workspace's first key — unless another replica stored one first.
   *
   * @param key - The new sealed key.
   * @returns True when this one was stored; false when the workspace already had a live key.
   */
  async insertKey(key: SealedTokenKey): Promise<boolean> {
    const { rows } = await sql<{ key_ref: string }>`
      insert into ouroboros.action_token_keys (key_ref, organization_id, sealed_key)
      values (${key.keyRef}, ${key.organizationId}, ${key.sealedKey})
      on conflict (organization_id) where retired_at is null do nothing
      returning key_ref`.execute(this.database.db);

    return rows.length === 1;
  }

  /**
   * Mint a token through V096's function: it supersedes the live token for the same item, action
   * and person, and sets the expiry and `requires_confirm` itself.
   *
   * @param input - The token's subject and its hash.
   * @param input.itemId - The decision item.
   * @param input.actionId - The answering action.
   * @param input.userId - The person it is for.
   * @param input.tokenHash - The HMAC — never the token.
   * @param input.keyRef - The key the HMAC was taken under.
   * @param input.channel - The send that carries it.
   * @returns The token's id.
   */
  async mint(input: {
    readonly itemId: string;
    readonly actionId: string;
    readonly userId: string;
    readonly tokenHash: string;
    readonly keyRef: string;
    readonly channel: DecisionChannel;
  }): Promise<string> {
    const { rows } = await sql<{ id: string }>`
      select ouroboros.action_token_mint(${input.itemId}::uuid, ${input.actionId}, ${input.userId},
                                         ${input.tokenHash}, ${input.keyRef}, ${input.channel}) as id`.execute(
      this.database.db,
    );
    const [row] = rows;

    if (row === undefined) {
      throw new Error(`action_token_mint answered nothing for item ${input.itemId}`);
    }

    return row.id;
  }

  /**
   * Read a token by its hash without spending it — what a link-open (and a mail scanner's
   * prefetch) may do.
   *
   * @param tokenHash - The HMAC of the presented token.
   * @returns The token's subject and state, or undefined for a hash no token has.
   */
  async peek(tokenHash: string): Promise<ActionTokenRecord | undefined> {
    const { rows } = await sql<{
      id: string;
      organization_id: string;
      item_id: string;
      action_id: string;
      user_id: string;
      channel: DecisionChannel;
      requires_confirm: boolean;
      state: ActionTokenState;
      revoke_reason: string | null;
      expires_at: Date;
    }>`
      select s.id, s.organization_id, s.item_id, s.action_id, s.user_id, s.channel,
             s.requires_confirm, s.state, s.revoke_reason, s.expires_at
        from ouroboros.action_tokens t
        join ouroboros.action_tokens_state s on s.id = t.id
       where t.token_hash = ${tokenHash}`.execute(this.database.db);
    const [row] = rows;

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          itemId: row.item_id,
          actionId: row.action_id,
          userId: row.user_id,
          channel: row.channel,
          requiresConfirm: row.requires_confirm,
          state: row.state,
          revokeReason: row.revoke_reason,
          expiresAt: row.expires_at,
        };
  }

  /**
   * Spend a token through V096's function — atomic, so two clicks racing cannot both spend it.
   *
   * @param tokenHash - The HMAC of the presented token.
   * @returns `accepted` (now used) or why not, with the token's id.
   */
  async use(tokenHash: string): Promise<ActionTokenUse> {
    const { rows } = await sql<{ token_id: string | null; outcome: ActionTokenUseOutcome }>`
      select token_id, outcome from ouroboros.action_token_use(${tokenHash})`.execute(
      this.database.db,
    );
    const [row] = rows;

    return { outcome: row?.outcome ?? "unknown", tokenId: row?.token_id ?? null };
  }
}

/**
 * A row as a {@link SealedTokenKey}.
 *
 * @param row - The selected columns.
 * @returns The key.
 */
function sealedKeyOf(row: {
  key_ref: string;
  organization_id: string;
  sealed_key: string;
}): SealedTokenKey {
  return { keyRef: row.key_ref, organizationId: row.organization_id, sealedKey: row.sealed_key };
}
