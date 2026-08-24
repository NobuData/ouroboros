/**
 * Where a request came from, available to a writer that never saw the request.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)) requires every audit event
 * to carry the client address. The operations that write those events —
 * `ProviderConnectionsService.reveal`, `.rotate`, `.remove`, `LeaseService.grant` — take a
 * workspace, an actor and a body, and none of them takes a request. Threading one down
 * through five service methods and two modules to reach a single field is exactly what
 * `tenancy/tenant.context.ts` describes as the problem rather than the solution, so this is
 * the same instrument at a smaller scale: an `AsyncLocalStorage` store opened per request by
 * `audit.middleware.ts` and read by {@link currentClientAddress} from any depth.
 *
 * ---------------------------------------------------------------------------
 * **Middleware, and deliberately not the interceptor AD.4's stack line names.** An
 * interceptor cannot open one of these. `AsyncLocalStorage.run` exists for the duration of a
 * callback, and an interceptor's contribution is an `Observable` that Nest subscribes to
 * *after* the interceptor's own frame has returned — so the handler would run outside any
 * scope the interceptor opened. Middleware is the one stage in Nest's pipeline that wraps the
 * rest of the request, which is why the tenancy module reached for it too, and why that file
 * splits the work between a middleware that opens the store and a guard that fills it in.
 *
 * This one needs no such split, and that is the whole of the difference: a peer address is
 * known at the socket, before any guard has run, so the middleware that opens the store can
 * also fill it. There is no second half.
 *
 * **A separate store rather than a field on the tenancy one.** Two objects per request
 * instead of one, in exchange for an audit concern not being declared inside the module that
 * owns *which workspace this is* — and for this module being removable, testable and
 * readable without tenancy having an opinion about addresses.
 *
 * ---------------------------------------------------------------------------
 * **What "the client address" honestly means here, and what it does not.**
 *
 * {@link clientAddress} reads the **socket's peer address** and nothing else. It does not
 * read `X-Forwarded-For`, and that omission is the security decision in this file rather
 * than an oversight: a forwarded header is a string the client wrote, and this service is
 * told by nothing which proxies it sits behind. Trusting it would let anyone who can reach
 * the API choose what the audit trail says about them — which is worse than a trail with a
 * less useful address in it, because it is a trail that can be made to lie.
 *
 * The cost is real and is stated rather than hidden: `ouroboros-ui` calls this API
 * server-side (`app/api/server.ts`), so in the compose deployment the address on a
 * browser-driven event is the **UI container's**, not the person's. What the column still
 * distinguishes is the thing AD.3 made possible to confuse — a lease granted to a worker on
 * the cluster network from a reveal performed through the product — and that distinction is
 * what a lease grant's own row is for.
 *
 * Making the header trustworthy needs a configured list of trusted proxies, which is an
 * operational feature with its own failure modes and belongs to the deployment ticket that
 * introduces it (AF.3's territory, `docs/SECURITY_MODEL.md` §5). When it lands, this function
 * is the one place that changes.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Everything one request knows about where it came from. */
export interface AuditContextStore {
  /** The client address, already normalised. `undefined` when none was knowable. */
  address?: string;
}

/**
 * The store itself.
 *
 * A module-level singleton, which is what an `AsyncLocalStorage` has to be: two instances are
 * two unrelated stores, and a provider would give one per module instantiation.
 */
const storage = new AsyncLocalStorage<AuditContextStore>();

/**
 * The part of a platform request this module reads.
 *
 * Structural rather than `express.Request`, matching `auth/http.ts` and `application.ts`:
 * this service has no opinion about its HTTP adapter, and naming the one member it actually
 * touches is both the documentation and the whole of the coupling.
 */
export interface AddressedRequest {
  /** The connection the request arrived on. Absent in a unit test that supplies neither. */
  socket?: { remoteAddress?: string | undefined } | undefined;
}

/**
 * The IPv6 prefix a dual-stack listener reports an IPv4 client with.
 *
 * Exported because the reason it matters is a database fact rather than a formatting
 * preference — see {@link clientAddress}.
 */
export const IPV4_MAPPED_PREFIX = "::ffff:";

/**
 * The address a request arrived from, as `audit_events.ip` should hold it.
 *
 * **The mapping is unwrapped, and that is a correctness fix rather than cosmetics.** A
 * dual-stack socket reports every IPv4 client as `::ffff:10.0.4.20`. PostgreSQL's `inet`
 * keeps that distinct from `10.0.4.20` and its subnet operator does not match across the two,
 * so storing what the socket said would split one host between two spellings and quietly
 * halve the answer to *everything from this network* — which is the one query an
 * investigation actually runs. V022's `ip` comment names this function as the place the
 * unwrapping happens.
 *
 * @param request - The request being handled, or anything with its `socket`.
 * @returns The dotted-quad or IPv6 address, or `undefined` when the socket reported none —
 *   which is what a request over a closed or non-network transport looks like, and is a
 *   better value than a guess.
 */
export function clientAddress(request: AddressedRequest | undefined): string | undefined {
  const address = request?.socket?.remoteAddress;

  if (address === undefined || address === "") {
    return undefined;
  }

  // Only the mapped form is unwrapped. `::ffff:` followed by a hex IPv6 tail is a legal
  // address that is not an IPv4 mapping, so the tail has to look like one — and a `slice`
  // with no check would turn `::ffff:1:2` into the nonsense `1:2`.
  if (address.startsWith(IPV4_MAPPED_PREFIX)) {
    const tail = address.slice(IPV4_MAPPED_PREFIX.length);

    return /^\d{1,3}(\.\d{1,3}){3}$/.test(tail) ? tail : address;
  }

  return address;
}

/**
 * Open a context for the duration of `work`.
 *
 * @param address - The client address, or `undefined` when none was knowable.
 * @param work - The rest of the request. Everything it awaits, however deep, reads the same
 *   store.
 * @returns Whatever `work` returned.
 */
export function runWithAuditContext<T>(address: string | undefined, work: () => T): T {
  return storage.run({ address }, work);
}

/**
 * Where this request came from.
 *
 * @returns The address, or `undefined` outside a request and on a request whose socket
 *   reported none. A background job, a scheduled health probe and a unit test all look like
 *   the first case, and all three write `null` into the column — which is the honest value
 *   for an event no client asked for.
 */
export function currentClientAddress(): string | undefined {
  return storage.getStore()?.address;
}
