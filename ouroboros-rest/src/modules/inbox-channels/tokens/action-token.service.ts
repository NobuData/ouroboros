/**
 * `ActionTokenService` — mint, read and spend the single-use tokens a decision mail carries (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463), decision **X5**).
 *
 * ```
 * mint(org, item, action, person, channel)
 *   ─▶ the workspace's HMAC key (created and vault-sealed on first use) ─▶ token = ouro_act_…
 *   ─▶ action_token_mint(item, action, person, HMAC(key, token), key_ref, channel)   (V096)
 *   ─▶ the token, for one mail — never stored, never logged
 *
 * inspect(presented)   shape ─▶ key by ref ─▶ HMAC ─▶ action_tokens_state      (spends nothing)
 * spend(inspected)     action_token_use(HMAC) — accepted once, then used/revoked/expired
 * ```
 *
 * **Why the key is per workspace and sealed.** V096 stores only the HMAC; the key it is taken
 * under is 32 random bytes the vault seals with the workspace DEK (AD.1), so a database read gives
 * neither a token nor the means to forge a hash — and purging the workspace's DEK kills every link.
 * Unsealed keys are cached in memory for the process's life; they never leave it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { DecisionChannel } from "../../db/schema";
import { VaultService } from "../../vault/vault.service";
import {
  hashActionToken,
  mintActionToken,
  newKey,
  newKeyRef,
  parseActionToken,
} from "./action-token.codec";
import {
  ActionTokenRepository,
  type ActionTokenRecord,
  type ActionTokenUse,
} from "./action-token.repository";

/** A presented token that names a stored one. */
export interface InspectedActionToken {
  /** The HMAC — what spending it asks for. */
  readonly hash: string;
  /** The token's subject and state. */
  readonly record: ActionTokenRecord;
}

@Injectable()
export class ActionTokenService {
  /** Unsealed keys by ref. Process memory only. */
  private readonly keys = new Map<string, { organizationId: string; key: Buffer }>();

  /**
   * @param repository - The keys and tokens.
   * @param vault - Seals and opens the workspace keys.
   */
  constructor(
    private readonly repository: ActionTokenRepository,
    private readonly vault: VaultService,
  ) {}

  /**
   * Mint one token.
   *
   * @param organizationId - The item's workspace.
   * @param itemId - The item.
   * @param actionId - The answering action the link performs.
   * @param userId - The person the mail goes to — the only person the token works for.
   * @param channel - The send carrying it (`email`).
   * @returns The token. Put it into the one mail; it is stored nowhere.
   */
  async mint(
    organizationId: string,
    itemId: string,
    actionId: string,
    userId: string,
    channel: DecisionChannel,
  ): Promise<string> {
    const { keyRef, key } = await this.liveKey(organizationId);
    const token = mintActionToken(keyRef);

    await this.repository.mint({
      itemId,
      actionId,
      userId,
      tokenHash: hashActionToken(key, token),
      keyRef,
      channel,
    });

    return token;
  }

  /**
   * Read a presented token without spending it.
   *
   * @param presented - Whatever arrived in the link.
   * @returns The token's hash, subject and state; undefined when it is malformed, names no key,
   *   or names no stored token — one answer for all three, so a probe learns nothing.
   */
  async inspect(presented: unknown): Promise<InspectedActionToken | undefined> {
    const parsed = parseActionToken(presented);

    if (parsed === undefined) {
      return undefined;
    }

    const key = await this.keyByRef(parsed.keyRef);

    if (key === undefined) {
      return undefined;
    }

    const hash = hashActionToken(key.key, parsed.token);
    const record = await this.repository.peek(hash);

    // A token whose row names another workspace than its key cannot be minted here; refuse it.
    return record === undefined || record.organizationId !== key.organizationId
      ? undefined
      : { hash, record };
  }

  /**
   * Spend a token. Atomic: of two clicks racing, one is `accepted`.
   *
   * @param token - An inspected token.
   * @returns `accepted`, or why it no longer works.
   */
  spend(token: InspectedActionToken): Promise<ActionTokenUse> {
    return this.repository.use(token.hash);
  }

  /**
   * Sign a message under the workspace's live key — for a value this service hands out and
   * must later recognise as its own, such as a chat card's button (#536).
   *
   * The caller domain-separates its message; nothing signed here can be mistaken for a token's
   * hash, because a token's hash is over the token itself, which begins `ouro_act_`.
   *
   * @param organizationId - The workspace.
   * @param message - What to sign.
   * @returns The key's ref and HMAC-SHA256 of the message, lower-case hex.
   */
  async sign(organizationId: string, message: string): Promise<{ keyRef: string; mac: string }> {
    const { keyRef, key } = await this.liveKey(organizationId);

    return { keyRef, mac: createHmac("sha256", key).update(message, "utf8").digest("hex") };
  }

  /**
   * Whether a MAC is this workspace's signature of a message.
   *
   * @param organizationId - The workspace the message claims to be for.
   * @param keyRef - The key the signature names.
   * @param message - What was signed.
   * @param mac - The presented HMAC, hex.
   * @returns True only when the key exists, belongs to that workspace, and the MAC matches —
   *   compared in constant time.
   */
  async verifySignature(
    organizationId: string,
    keyRef: string,
    message: string,
    mac: string,
  ): Promise<boolean> {
    const opened = await this.keyByRef(keyRef);

    if (opened === undefined || opened.organizationId !== organizationId) {
      return false;
    }

    const expected = createHmac("sha256", opened.key).update(message, "utf8").digest();
    const presented = Buffer.from(mac, "hex");

    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }

  /**
   * The workspace's live key, created and sealed on first use.
   *
   * @param organizationId - The workspace.
   * @returns The key and its ref.
   */
  private async liveKey(organizationId: string): Promise<{ keyRef: string; key: Buffer }> {
    let stored = await this.repository.liveKey(organizationId);

    if (stored === undefined) {
      const keyRef = newKeyRef();
      const key = newKey();
      // The vault zeroizes what it seals, so it seals a copy.
      const sealedKey = await this.vault.encrypt(organizationId, keyRef, Buffer.from(key));

      if (await this.repository.insertKey({ keyRef, organizationId, sealedKey })) {
        this.keys.set(keyRef, { organizationId, key });

        return { keyRef, key };
      }

      // Another replica stored one first; use theirs.
      stored = await this.repository.liveKey(organizationId);

      if (stored === undefined) {
        throw new Error(`workspace ${organizationId} has no live action-token key`);
      }
    }

    const opened = await this.keyByRef(stored.keyRef);

    if (opened === undefined) {
      throw new Error(`action-token key ${stored.keyRef} vanished`);
    }

    return { keyRef: stored.keyRef, key: opened.key };
  }

  /**
   * A key by ref, opened — from memory, or from the table through the vault.
   *
   * @param keyRef - The ref.
   * @returns The key and its workspace, or undefined for a ref no key has.
   */
  private async keyByRef(
    keyRef: string,
  ): Promise<{ organizationId: string; key: Buffer } | undefined> {
    const cached = this.keys.get(keyRef);

    if (cached !== undefined) {
      return cached;
    }

    const stored = await this.repository.keyByRef(keyRef);

    if (stored === undefined) {
      return undefined;
    }

    const key = await this.vault.decrypt(stored.organizationId, keyRef, stored.sealedKey);
    const opened = { organizationId: stored.organizationId, key };

    this.keys.set(keyRef, opened);

    return opened;
  }
}
