/**
 * Minting, listing and revoking enrollment tokens — the operator's half of decision **B3**.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). Three operations, and the
 * order of operations in the first one is the whole of the *returned exactly once* criterion:
 *
 * ```
 * mint ─▶ choose the row's id ─▶ compose the value ─▶ SEAL ─▶ insert ─▶ audit ─▶ respond
 *              │                       │               │                          │
 *              └── needed before ──────┘               │                          │
 *                  the value exists                    └── the plaintext never    │
 *                                                          reaches a column       │
 *                                                                                 │
 *                                            the only response that carries it ───┘
 * ```
 *
 * The id is chosen here rather than by `gen_random_uuid()` because the token's *value* embeds
 * it — see `farm.tokens.ts` — so the row cannot mint its own identifier without the value
 * having to be composed after the insert, which would mean an update. That is the whole
 * reason `FarmRepository.insertToken` takes an id.
 *
 * **Revocation is idempotent and says so.** A second revoke of the same token answers the
 * token as it stands rather than a `404`: the caller asked for it to be dead and it is. What
 * a `404` means here is *no such token in this workspace*, which is a different fact and one
 * the panel renders differently.
 */

import { Inject, Injectable } from "@nestjs/common";

import { VaultService } from "../vault/vault.service";
import { FARM_CLOCK, type FarmClock } from "./farm.authority";
import { FarmAudit } from "./farm.audit";
import { poolNotFound, tokenNotFound } from "./farm.errors";
import { DEFAULT_TOKEN_TTL_MS } from "./farm.policy";
import { FarmRepository } from "./farm.repository";
import { mintToken } from "./farm.tokens";
import {
  enrollmentTokenResource,
  mintedTokenResource,
  type EnrollmentTokenResource,
  type MintedTokenResource,
} from "./farm.resources";
import type { MintEnrollmentTokenDto } from "./farm.dto";

/** Milliseconds in a second — the DTO speaks seconds and the policy speaks milliseconds. */
const SECOND_MS = 1000;

@Injectable()
export class EnrollmentService {
  /**
   * @param farm - The statements.
   * @param vault - AD.1's envelope encryption, for the one column that holds a secret.
   * @param audit - AD.4's trail.
   * @param now - The clock.
   */
  constructor(
    private readonly farm: FarmRepository,
    private readonly vault: VaultService,
    private readonly audit: FarmAudit,
    @Inject(FARM_CLOCK) private readonly now: FarmClock,
  ) {}

  /**
   * Mint a token scoped to one pool of one workspace.
   *
   * @param organizationId - The workspace, from the tenant context. Never from the request.
   * @param actorId - Who is minting it, from the session.
   * @param request - The pool, the TTL and the use count, already validated.
   * @returns The token, with its full value — the one response in this product that carries
   *   one.
   * @throws {NotFoundError} If the workspace has no pool of that name. Thrown before anything
   *   is generated, so a typo mints nothing.
   */
  async mint(
    organizationId: string,
    actorId: string,
    request: MintEnrollmentTokenDto,
  ): Promise<MintedTokenResource> {
    const pool = await this.farm.poolByName(organizationId, request.pool);
    if (!pool) throw poolNotFound(request.pool);

    const at = this.now();
    const expiresAt = new Date(
      at.getTime() + (request.ttlSeconds ? request.ttlSeconds * SECOND_MS : DEFAULT_TOKEN_TTL_MS),
    );

    // The id first, because the value embeds it. `crypto.randomUUID()` rather than a database
    // default for exactly that reason, and it is a v4 UUID either way.
    const token = mintToken(crypto.randomUUID());

    const row = await this.farm.insertToken({
      id: token.id,
      organization_id: organizationId,
      pool_id: pool.id,
      token_sealed: await this.vault.encryptText(organizationId, token.id, token.secret),
      expires_at: expiresAt,
      max_uses: request.maxUses ?? 1,
      created_by: actorId,
    });

    await this.audit.tokenMinted(
      { organizationId, actorId, at },
      { id: row.id, poolId: pool.id, maxUses: row.max_uses, expiresAt: row.expires_at },
    );

    return mintedTokenResource(row, token.value);
  }

  /**
   * One workspace's tokens, newest first — masked, every one of them.
   *
   * Not paginated, deliberately. A workspace's live enrollment tokens are a handful by
   * construction: they expire within thirty days at the outside, and a workspace with
   * hundreds of them has an incident rather than a list to scroll. Adding a window here would
   * be inventing a `#31`-shaped page for a read that has no second page.
   *
   * @param organizationId - The workspace.
   * @returns The tokens.
   */
  async list(organizationId: string): Promise<EnrollmentTokenResource[]> {
    const rows = await this.farm.tokensOf(organizationId);

    return rows.map(enrollmentTokenResource);
  }

  /**
   * Revoke a token.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who is revoking it.
   * @param id - The token.
   * @returns The token as it now stands.
   * @throws {NotFoundError} If the workspace has no such token. A token that was *already*
   *   revoked is not this case — see this file's header.
   */
  async revoke(
    organizationId: string,
    actorId: string,
    id: string,
  ): Promise<EnrollmentTokenResource> {
    const at = this.now();
    const revoked = await this.farm.revokeToken(organizationId, id, at);

    if (revoked) {
      await this.audit.tokenRevoked(
        { organizationId, actorId, at },
        { id: revoked.id, usesAtRevocation: revoked.uses },
      );

      return enrollmentTokenResource(revoked);
    }

    // Nothing was updated, which is either "already revoked" or "no such token". One more read
    // tells them apart, and it is only reached on the uncommon path.
    const existing = (await this.farm.tokensOf(organizationId)).find((row) => row.id === id);
    if (!existing) throw tokenNotFound();

    return enrollmentTokenResource(existing);
  }
}
