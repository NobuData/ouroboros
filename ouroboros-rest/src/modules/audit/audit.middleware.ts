/**
 * The one thing in this module that has to be middleware.
 *
 * It reads the request's peer address and calls the rest of the request inside an
 * {@link runWithAuditContext} store carrying it. That is all it does.
 *
 * Why middleware rather than the interceptor AD.4's technical-stack line names is argued at
 * length in `audit.context.ts`: `AsyncLocalStorage.run` needs something that *wraps* the
 * request, an interceptor hands back an `Observable` that Nest subscribes to after the
 * interceptor's frame has returned, and middleware is the only stage in Nest's pipeline that
 * qualifies. `tenancy/tenant.middleware.ts` exists for the same reason and says so too.
 *
 * It is applied to every route, including the public ones. A store nothing reads costs one
 * object per request and means {@link currentClientAddress} is always a legitimate question
 * with an honest answer, rather than one that returns `undefined` on the routes somebody
 * forgot to list — which, in a trail, would read as *this happened from nowhere* rather than
 * as a missing registration.
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";

import { clientAddress, runWithAuditContext, type AddressedRequest } from "./audit.context";

/**
 * The part of the pipeline this middleware needs — the callback that continues it.
 *
 * Structural rather than `express.NextFunction`, matching `tenancy/tenant.middleware.ts`:
 * this module has no opinion about the HTTP adapter, and the one thing it touches is a
 * function it calls with no arguments.
 */
export type ContinueRequest = () => void;

@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  /**
   * Open a context carrying where this request came from, and continue.
   *
   * @param request - The request. Only its socket's peer address is read; see
   *   `audit.context.ts` on why no header is.
   * @param _response - Unread.
   * @param next - The rest of the request. Called *inside* the store, which is what puts
   *   every continuation it schedules inside it too.
   */
  use(request: AddressedRequest, _response: unknown, next: ContinueRequest): void {
    runWithAuditContext(clientAddress(request), next);
  }
}
