/**
 * Authenticate a service token before any guard runs
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 *
 * Middleware rather than a guard because of order: the global authentication guard is the
 * library's session guard (extended by `src/auth/session-or-service.guard.ts`), and it has to
 * know whether a service principal is present *before* it asks for a session. Middleware runs
 * ahead of every guard, so the principal is on the request by the time any of them looks.
 *
 * It decides nothing about authorisation. It only answers *who is this*:
 *
 *   * no `Authorization: Bearer orb_svc_…` header — nothing to do, the request is a session's;
 *   * a token whose hash matches a live token of an enabled account — the principal is attached
 *     and the token's `last_used_at` is stamped;
 *   * any other token with the prefix — the request is flagged rejected, and the guard answers
 *     `401 service_token_invalid` (one answer for unknown, rotated, revoked and disabled).
 *
 * The scope check is the tenant guard's (`tenancy/tenant.guard.ts`).
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";

import {
  bearerServiceToken,
  SERVICE_PRINCIPAL_PROPERTY,
  SERVICE_TOKEN_REJECTED_PROPERTY,
  type ServiceRequest,
} from "../auth/service.principal";
import { ServiceAccountsRepository } from "./service-accounts.repository";
import { hashServiceToken, isServiceTokenShape } from "./service.tokens";

/** Express's `next`, with or without an error. */
export type NextFunction = (error?: unknown) => void;

@Injectable()
export class ServiceTokenMiddleware implements NestMiddleware {
  /**
   * @param accounts - The token lookup.
   */
  constructor(private readonly accounts: ServiceAccountsRepository) {}

  /**
   * Attach a service principal, or flag a refused token, and continue.
   *
   * @param request - The request.
   * @param _response - Unread.
   * @param next - The rest of the request; called with the error if the lookup itself fails.
   */
  use(request: ServiceRequest, _response: unknown, next: NextFunction): void {
    this.authenticate(request).then(() => next(), next);
  }

  /**
   * The work {@link use} awaits.
   *
   * @param request - The request.
   */
  async authenticate(request: ServiceRequest): Promise<void> {
    const token = bearerServiceToken(request);

    if (token === undefined) return;

    const row = isServiceTokenShape(token)
      ? await this.accounts.authenticate(hashServiceToken(token))
      : undefined;

    if (row === undefined) {
      request[SERVICE_TOKEN_REJECTED_PROPERTY] = true;
      return;
    }

    await this.accounts.touch(row.tokenId, new Date());

    request[SERVICE_PRINCIPAL_PROPERTY] = {
      accountId: row.accountId,
      tokenId: row.tokenId,
      name: row.name,
      organization: row.organization,
      scopes: row.scopes,
    };
  }
}
