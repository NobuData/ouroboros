/**
 * `GET /api/v1/dashboard` — mockup 02 in one round trip
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)).
 *
 * **One endpoint for six cards, which is decision F5.** Painting the page from six requests
 * would tear it — the cards would land at different times, each with its own idea of what
 * "now" is — and would multiply the cost of a loop that runs for as long as somebody is
 * looking at the screen. So the page is one payload, measured between one set of boundaries,
 * and the drill-in endpoints (#71, #73, #74) exist for the screens that go deeper rather
 * than for the dashboard to assemble itself out of.
 *
 * **The workspace is the session's, never the request's.** There is no `{orgId}` in the path
 * and no workspace in the body: the tenant guard resolves the active organization, checks
 * that the caller is a member of it, and this handler reads what it established. A dashboard
 * that took a workspace id from a client would be one where reading somebody else's numbers
 * is a matter of typing.
 *
 * **The response is written by hand, and that is the one thing here worth explaining.** Nest
 * sets the status for a `GET` to `200` on the way out, so a handler that returns a value
 * cannot answer `304` — `@Res({passthrough: true})` still hands the response to the
 * framework, which then overwrites the status this route's whole conditional behaviour
 * depends on. Taking the response means the two answers are written where they are decided,
 * which is also the only way `304`'s *no body at all* is a thing the code says rather than a
 * thing a serializer happens to do.
 */

import { Controller, Get, HttpStatus, Logger, Req, Res } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { DashboardService } from "./dashboard.service";
import { matchesIfNoneMatch } from "./etag";

/** The header a client echoes the tag it already holds in. Lower-case, as Node parses headers. */
export const IF_NONE_MATCH = "if-none-match";

/** The header the tag is answered in. */
export const ETAG = "ETag";

/**
 * What a browser is told about storing this answer.
 *
 * `private` because the payload is one workspace's operational numbers and a shared cache
 * has no business holding it. `no-cache` is the more interesting half: it does not mean *do
 * not store*, it means *do not reuse without revalidating* — which is exactly the loop this
 * endpoint is built for. The browser keeps the body, sends `If-None-Match` on the next poll,
 * and is answered `304` when nothing has changed.
 *
 * It is also what makes switching workspaces safe without a `Vary`: a revalidation carries
 * the request's current session and `X-Ouro-Tenant`, the tag is derived from the workspace
 * as well as its rows, so a stored payload for one workspace can never be revalidated into
 * an answer for another. The rest of the polling contract — the interval, the backoff
 * hint, the SSE upgrade path — is written down in `docs/ARCHITECTURE.md` § 5.4
 * ([#75](https://github.com/NobuData/ouroboros/issues/75)).
 */
export const CACHE_CONTROL = "private, no-cache";

/**
 * The backoff hint — how many seconds the server currently wants a client to wait before
 * its next poll ([#75](https://github.com/NobuData/ouroboros/issues/75)).
 *
 * On every answer, `200` and `304` alike, and the client treats the latest value as its
 * effective interval (#87's hook is the reader). That direction is the point of the
 * header: the *server* owns the cadence, so a deployment under load raises
 * `OURO_DASHBOARD_POLL_SECONDS` and every open dashboard slows down within one poll
 * cycle, with nothing shipped to the client. `Retry-After` is deliberately not reused for
 * this — that header belongs to `503` and `3xx` answers, and a proxy is entitled to act
 * on it; this one is advice to one first-party hook, so it carries the `X-Ouro-` prefix
 * the tenancy header established.
 */
export const POLL_AFTER = "X-Ouro-Poll-After";

/**
 * The part of a platform request this controller reads.
 *
 * Named rather than imported from `express`, exactly as `modules/auth/http.ts` and
 * `application.ts` do: this service has no opinion about its HTTP adapter, the members it
 * uses are the whole of the coupling, and a spec satisfies these with an object literal
 * rather than with a mock of a framework.
 */
export interface ConditionalRequest {
  /** The headers, as the adapter parsed them — lower-cased keys. */
  headers?: Record<string, string | string[] | undefined>;
}

/** The part of a platform response this controller writes. */
export interface ConditionalResponse {
  /** Set a header, replacing any previous value. */
  setHeader(name: string, value: string): unknown;
  /** Set the status, then answer — with a body, or with nothing at all. */
  status(code: number): { end(): unknown; json(body: unknown): unknown };
}

@Controller("dashboard")
export class DashboardController {
  /**
   * Instrumentation for the `304` fast path — the polling contract's one measured claim.
   *
   * [#75](https://github.com/NobuData/ouroboros/issues/75)'s acceptance criterion is that
   * a poll which changes nothing serializes no rows, *verified by logging* rather than
   * asserted in a comment. The `debug` line written below is that verification: it is
   * emitted on the branch that returns before `DashboardService.read` is ever called, so
   * its presence in a log is proof of the property, and it carries the measured cost of
   * the version probe so a `304` that quietly got expensive is visible in the same line.
   */
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly dashboard: DashboardService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The whole dashboard for the workspace this session is acting in.
   *
   * The version is read first and the payload only if the caller does not already hold it,
   * so a poll that changes nothing costs four aggregate subqueries and a header — see
   * `dashboard.service.ts` for why the order is that way round and not the other.
   *
   * @param tenant - The workspace, established by the tenant guard from the session's active
   *   organization or from `X-Ouro-Tenant`. A session acting in none is a `400` with
   *   `organization_required` before this handler runs; one that is not a member of the
   *   workspace it named is a `404`.
   * @param request - For `If-None-Match`, and nothing else.
   * @param response - Written directly: `304` with no body, or `200` with the payload. Both
   *   carry the tag, because a `304` is how a client learns its tag is still current — and
   *   both carry the poll hint, because a backed-off server answers mostly `304`s.
   * @returns When the answer has been written.
   */
  @Get()
  async read(
    @CurrentTenant() tenant: Organization,
    @Req() request: ConditionalRequest,
    @Res() response: ConditionalResponse,
  ): Promise<void> {
    const started = performance.now();
    const windows = this.dashboard.windows();
    const etag = await this.dashboard.etag(tenant.id, windows);

    const held = request.headers?.[IF_NONE_MATCH];

    if (matchesIfNoneMatch(typeof held === "string" ? held : undefined, etag)) {
      this.freshness(response, etag);
      response.status(HttpStatus.NOT_MODIFIED).end();
      // Written after the answer, not before: the line certifies what this branch *did*,
      // and the measurement should include everything the caller waited for.
      this.logger.debug(
        `304 for workspace ${tenant.id} in ${(performance.now() - started).toFixed(1)}ms — ` +
          "version probe only, no rows read and none serialized",
      );
      return;
    }

    // The payload is assembled *before* the headers are written, so a failure while
    // assembling it produces an ordinary `500` from the envelope filter rather than one
    // carrying an `ETag` for a body that was never sent — a tag a client would then send
    // back, and be answered `304` on, for a representation it does not have.
    const payload = await this.dashboard.read(tenant.id, windows);

    this.freshness(response, etag);
    response.status(HttpStatus.OK).json(payload);
  }

  /**
   * Say what this answer is, how long it may be reused for, and when to ask again.
   *
   * On both answers, and identically: a `304` that omitted the tag would leave a client
   * unable to tell *still current* from *refused*, one that omitted `Cache-Control`
   * would let a browser apply its own heuristic freshness to a page of live numbers, and
   * one that omitted the poll hint would strand a client on whatever cadence it last
   * heard — when the `304` is precisely the answer a backed-off server sends most.
   *
   * @param response - The response being written.
   * @param etag - The tag for the representation the caller holds or is about to receive.
   */
  private freshness(response: ConditionalResponse, etag: string): void {
    response.setHeader(ETAG, etag);
    response.setHeader("Cache-Control", CACHE_CONTROL);
    response.setHeader(POLL_AFTER, String(this.config.dashboardPollSeconds));
  }
}
