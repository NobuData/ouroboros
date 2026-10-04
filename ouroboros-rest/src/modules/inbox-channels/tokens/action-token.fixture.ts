/**
 * In-memory stand-ins for the action-token store and the vault (BN.3, #463), for unit specs.
 *
 * `FakeTokenStore` keeps keys and tokens the way V096/V100 do — by hash, one live token per
 * (item, action, user), superseding on mint, single use — so a spec can drive
 * `ActionTokenService` and everything above it without a database. `FakeVault` seals by
 * base64-encoding with the workspace and record bound in, and zeroizes what it seals, as the real
 * vault does.
 */

import type { VaultService } from "../../vault/vault.service";
import type {
  ActionTokenRecord,
  ActionTokenRepository,
  ActionTokenUse,
  SealedTokenKey,
} from "./action-token.repository";

/** A token the fake store holds. */
interface StoredToken extends Omit<ActionTokenRecord, "state"> {
  readonly hash: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

/** The fake store — see the file header. */
export class FakeTokenStore {
  readonly keys = new Map<string, SealedTokenKey>();

  readonly tokens: StoredToken[] = [];

  /** Items whose tokens are minted requires_confirm (merge-class kinds). */
  readonly mergeClassItems = new Set<string>();

  /** The workspace each item belongs to. */
  readonly itemOrganizations = new Map<string, string>();

  /** The clock the store judges expiry by. */
  now = new Date("2026-10-04T09:00:00Z");

  /** How long a token lives. */
  ttlMs = 48 * 60 * 60 * 1000;

  /** @returns The store as the repository the service injects. */
  repository(): ActionTokenRepository {
    return {
      liveKey: (organizationId: string) =>
        Promise.resolve(
          [...this.keys.values()].find((key) => key.organizationId === organizationId),
        ),
      keyByRef: (keyRef: string) => Promise.resolve(this.keys.get(keyRef)),
      insertKey: (key: SealedTokenKey) => {
        if ([...this.keys.values()].some((k) => k.organizationId === key.organizationId)) {
          return Promise.resolve(false);
        }

        this.keys.set(key.keyRef, key);

        return Promise.resolve(true);
      },
      mint: (input: Parameters<ActionTokenRepository["mint"]>[0]) => {
        for (const token of this.tokens) {
          if (
            token.itemId === input.itemId &&
            token.actionId === input.actionId &&
            token.userId === input.userId &&
            token.usedAt === null &&
            token.revokedAt === null
          ) {
            token.revokedAt = this.now;
            token.revokeReason = "superseded";
          }
        }

        const id = `token-${String(this.tokens.length + 1)}`;

        this.tokens.push({
          id,
          hash: input.tokenHash,
          organizationId: this.itemOrganizations.get(input.itemId) ?? "org-1",
          itemId: input.itemId,
          actionId: input.actionId,
          userId: input.userId,
          channel: input.channel,
          requiresConfirm: this.mergeClassItems.has(input.itemId),
          expiresAt: new Date(this.now.getTime() + this.ttlMs),
          usedAt: null,
          revokedAt: null,
          revokeReason: null,
        });

        return Promise.resolve(id);
      },
      peek: (hash: string) => {
        const token = this.tokens.find((candidate) => candidate.hash === hash);

        return Promise.resolve(token === undefined ? undefined : this.record(token));
      },
      use: (hash: string): Promise<ActionTokenUse> => {
        const token = this.tokens.find((candidate) => candidate.hash === hash);

        if (token === undefined) {
          return Promise.resolve({ outcome: "unknown", tokenId: null });
        }

        const state = this.record(token).state;

        if (state !== "live") {
          return Promise.resolve({ outcome: state, tokenId: token.id });
        }

        token.usedAt = this.now;

        return Promise.resolve({ outcome: "accepted", tokenId: token.id });
      },
    } as unknown as ActionTokenRepository;
  }

  /**
   * Revoke every outstanding token for an item — V096's trigger on resolution.
   *
   * @param itemId - The item.
   */
  closeItem(itemId: string): void {
    for (const token of this.tokens) {
      if (token.itemId === itemId && token.usedAt === null && token.revokedAt === null) {
        token.revokedAt = this.now;
        token.revokeReason = "item_closed";
      }
    }
  }

  /**
   * A stored token as the repository reads it.
   *
   * @param token - The token.
   * @returns Its record, with V096's state rule.
   */
  private record(token: StoredToken): ActionTokenRecord {
    const state =
      token.usedAt !== null
        ? "used"
        : token.revokedAt !== null
          ? "revoked"
          : token.expiresAt <= this.now
            ? "expired"
            : "live";

    return {
      id: token.id,
      organizationId: token.organizationId,
      itemId: token.itemId,
      actionId: token.actionId,
      userId: token.userId,
      channel: token.channel,
      requiresConfirm: token.requiresConfirm,
      state,
      revokeReason: token.revokeReason,
      expiresAt: token.expiresAt,
    };
  }
}

/** A vault that seals by encoding, binding the workspace and record — see the file header. */
export class FakeVault {
  /** How many keys were sealed. */
  sealed = 0;

  /** How many were opened. */
  opened = 0;

  /** @returns The fake as the service the token service injects. */
  service(): VaultService {
    return {
      encrypt: (organizationId: string, recordId: string, plaintext: Buffer) => {
        const envelope = `fake.${organizationId}.${recordId}.${plaintext.toString("base64")}`;

        plaintext.fill(0);
        this.sealed += 1;

        return Promise.resolve(envelope);
      },
      decrypt: (organizationId: string, recordId: string, envelope: string) => {
        const prefix = `fake.${organizationId}.${recordId}.`;

        if (!envelope.startsWith(prefix)) {
          return Promise.reject(new Error("envelope bound to another record"));
        }

        this.opened += 1;

        return Promise.resolve(Buffer.from(envelope.slice(prefix.length), "base64"));
      },
    } as unknown as VaultService;
  }
}
