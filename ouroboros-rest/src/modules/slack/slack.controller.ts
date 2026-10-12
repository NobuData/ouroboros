/**
 * The Slack app's routes (BZ.1, [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * ```
 * POST /api/v1/slack/events            Slack → here     signed · anonymous · acks at once
 * POST /api/v1/slack/interactivity     Slack → here     signed · anonymous · acks at once
 * POST /api/v1/slack/commands          Slack → here     signed · anonymous · acks at once
 * GET  /api/v1/slack/oauth/install     browser          owner/admin → 302 to Slack's consent
 * GET  /api/v1/slack/oauth/callback    browser          owner/admin → 302 back to Settings
 * GET  /api/v1/slack/link/:token       browser          the confirmation screen (HTML)
 * POST /api/v1/slack/link/:token       browser          links, once (HTML)
 * GET  /api/v1/slack/connection        any member       the connection's status
 * POST /api/v1/slack/connection/verify owner/admin      ask Slack now, refresh channels
 * ```
 *
 * The whole family is forwarded by the UI origin (`ouroboros-ui/proxy.ts`), so the browser
 * routes carry the session cookie and an operator may give Slack either origin.
 *
 * **The three inbound routes are anonymous to this service's own guards** — Slack holds no
 * session — and are guarded by {@link SlackSignatureGuard} instead, which verifies the raw body
 * before a handler runs. Their bodies are taken as `unknown`: the global validation pipe forbids
 * unknown properties, and a Slack payload is nothing but.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AllowAnonymous, Session } from "@thallesp/nestjs-better-auth";

import { type Principal, type PrincipalRequest, principalOf } from "../auth/principal";
import { AppConfigService } from "../config/config.service";
import type { Organization } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { ANSWER_PAGE_HEADERS } from "../inbox-channels/answer/answer.controller";
import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant, TenantOptional } from "../tenancy/tenant.decorators";
import { SLACK_PATH_PREFIX, SLACK_ROUTE } from "./slack.app";
import { slackInstallDenied, slackStateInvalid } from "./slack.errors";
import { COMMAND_ACK, SlackInboundService } from "./slack.inbound.service";
import { SlackInstallService, type SlackVerification } from "./slack.install.service";
import { type LinkSession, SlackLinkService } from "./slack.link.service";
import type { SlackLinkPage } from "./slack.pages";
import { SlackRepository } from "./slack.repository";
import { type SlackConnectionResource, connectionResource } from "./slack.resources";
import { SlackSignatureGuard } from "./slack.signature.guard";

/** The cookie that binds an install to the browser that began it. */
export const OAUTH_STATE_COOKIE = "ouro_slack_oauth";

/** How long an install may take between leaving for Slack and coming back. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/** The part of a platform response these handlers write. */
interface HeaderResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/** The part of a request the OAuth handlers read. */
interface CookieRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

/** A redirect, as `@Redirect()` takes it from a handler. */
interface RedirectTo {
  readonly url: string;
  readonly statusCode: number;
}

/**
 * One cookie's value from a request.
 *
 * @param request - The request.
 * @param name - The cookie.
 * @returns Its value, or undefined.
 */
export function cookieOf(request: CookieRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  const pairs = (Array.isArray(header) ? header.join("; ") : (header ?? "")).split(";");

  for (const pair of pairs) {
    const [key, ...rest] = pair.trim().split("=");

    if (key === name) {
      return rest.join("=");
    }
  }

  return undefined;
}

/**
 * The state cookie, as a `Set-Cookie` value.
 *
 * `HttpOnly`, scoped to the OAuth routes, short-lived, and `SameSite=Lax` — the callback is a
 * top-level navigation from slack.com, which `Strict` would strip the cookie from.
 *
 * @param value - The cookie's value; empty to clear it.
 * @param secure - Whether the UI origin is https.
 * @returns The header value.
 */
export function stateCookie(value: string, secure: boolean): string {
  return [
    `${OAUTH_STATE_COOKIE}=${value}`,
    `Path=${SLACK_PATH_PREFIX}oauth`,
    `Max-Age=${value === "" ? 0 : OAUTH_STATE_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Whether a callback's state is the one this browser's install began with, for this workspace.
 *
 * @param cookie - The state cookie's value: `<state>.<organization id>`.
 * @param state - The `state` Slack sent back.
 * @param organizationId - The workspace the callback is acting in.
 * @returns True only when all three agree. Compared in constant time.
 */
export function stateMatches(
  cookie: string | undefined,
  state: string | undefined,
  organizationId: string,
): boolean {
  if (cookie === undefined || state === undefined || state === "") {
    return false;
  }

  const expected = Buffer.from(`${state}.${organizationId}`);
  const presented = Buffer.from(cookie);

  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/* ------------------------------------------------------------------ Slack → here */

@AllowAnonymous()
@TenantOptional()
@UseGuards(SlackSignatureGuard)
@Controller(SLACK_ROUTE)
export class SlackInboundController {
  /** @param inbound - What a verified request does. */
  constructor(private readonly inbound: SlackInboundService) {}

  /**
   * `POST /slack/events` — the Events API, including its URL-verification handshake.
   *
   * @param body - The parsed JSON, already verified against the raw bytes.
   * @returns The challenge for a handshake; otherwise an empty acknowledgement.
   */
  @Post("events")
  @HttpCode(HttpStatus.OK)
  events(@Body() body: unknown): Record<string, unknown> {
    return this.inbound.event(body);
  }

  /**
   * `POST /slack/interactivity` — a button press.
   *
   * @param body - The parsed form, already verified against the raw bytes.
   * @returns An empty acknowledgement; the result follows as a separate message.
   */
  @Post("interactivity")
  @HttpCode(HttpStatus.OK)
  interactivity(@Body() body: unknown): Record<string, never> {
    return this.inbound.interaction(body);
  }

  /**
   * `POST /slack/commands` — the `/ouro` slash command.
   *
   * @param body - The parsed form, already verified against the raw bytes.
   * @returns *Working on it…*; the result follows as a separate message.
   */
  @Post("commands")
  @HttpCode(HttpStatus.OK)
  commands(@Body() body: unknown): typeof COMMAND_ACK {
    return this.inbound.command(body);
  }
}

/* ------------------------------------------------------------------ install */

@Controller(`${SLACK_ROUTE}/oauth`)
export class SlackOauthController {
  /**
   * @param installs - The install itself.
   * @param config - The UI origin the browser is sent back to.
   */
  constructor(
    private readonly installs: SlackInstallService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `GET /slack/oauth/install` — send an owner or admin to Slack's consent screen.
   *
   * @param tenant - The workspace installing.
   * @param response - Carries the state cookie.
   * @returns A redirect to Slack.
   * @throws {NotFoundError} `404 slack_not_configured`.
   */
  @Get("install")
  @Roles(...ADMINISTRATORS)
  @Redirect()
  install(
    @CurrentTenant() tenant: Organization,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): RedirectTo {
    const state = randomBytes(24).toString("base64url");
    const url = this.installs.authorizeUrl(state);

    response.setHeader("Set-Cookie", stateCookie(`${state}.${tenant.id}`, this.secure()));
    response.setHeader("Cache-Control", "no-store");

    return { url, statusCode: HttpStatus.FOUND };
  }

  /**
   * `GET /slack/oauth/callback` — where Slack sends the browser back.
   *
   * Every outcome is a redirect to Settings, carrying `slack=connected` or the refusal's code:
   * this is a page navigation, and a JSON error would be a dead end in a browser.
   *
   * @param tenant - The workspace the session is acting in.
   * @param principal - The owner or admin completing the install.
   * @param code - The code to exchange.
   * @param state - The state the install began with.
   * @param error - Slack's error, when the person declined.
   * @param request - Carries the state cookie.
   * @param response - Clears it.
   * @returns A redirect to Settings.
   */
  @Get("callback")
  @Roles(...ADMINISTRATORS)
  @Redirect()
  async callback(
    @CurrentTenant() tenant: Organization,
    @Session() principal: Principal,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<RedirectTo> {
    // Spent whatever happens next: a state works for one callback.
    response.setHeader("Set-Cookie", stateCookie("", this.secure()));
    response.setHeader("Cache-Control", "no-store");

    let outcome = "connected";

    try {
      if (!stateMatches(cookieOf(request, OAUTH_STATE_COOKIE), state, tenant.id)) {
        throw slackStateInvalid();
      }
      if (typeof error === "string" && error !== "") {
        throw slackInstallDenied(error.slice(0, 64));
      }
      if (typeof code !== "string" || code === "") {
        throw slackStateInvalid();
      }

      await this.installs.complete(tenant.id, principal.user.id, code);
    } catch (failure) {
      if (!(failure instanceof DomainError)) {
        throw failure;
      }
      outcome = failure.code;
    }

    return {
      url: `${this.config.uiUrl.replace(/\/+$/, "")}/settings?slack=${encodeURIComponent(outcome)}#integrations`,
      statusCode: HttpStatus.FOUND,
    };
  }

  /** @returns Whether cookies should be `Secure` — the UI origin is https. */
  private secure(): boolean {
    return this.config.uiUrl.startsWith("https://");
  }
}

/* ------------------------------------------------------------------ linking */

/**
 * The signed-in person a request carries, if any.
 *
 * @param request - The request, as the authentication guard left it.
 * @returns The person, or undefined on an anonymous request.
 */
export function linkSessionOf(request: PrincipalRequest): LinkSession | undefined {
  const principal = principalOf(request);

  return principal === undefined
    ? undefined
    : { userId: principal.user.id, name: principal.user.name, email: principal.user.email };
}

/**
 * Whether a browser says a request was made from another site.
 *
 * The confirm button binds *whichever account is signed in* to the Slack identity the token
 * names, so a form on another site that posted here from a signed-in person's browser would bind
 * that person to somebody else's Slack identity. The session cookie's `SameSite=Lax` already
 * keeps it off a cross-site `POST`; this is the same refusal stated by the request itself, for a
 * deployment whose cookies are configured otherwise. `Sec-Fetch-Site` is set by the browser and
 * cannot be set by a page; a client that sends none (an old browser, a plain-http origin) is
 * left to the cookie's rule.
 *
 * @param request - The request's headers.
 * @returns True when the browser reported a cross-site or same-site (sibling origin) request.
 */
export function fromAnotherSite(request: CookieRequest): boolean {
  const site = request.headers["sec-fetch-site"];

  return site === "cross-site" || site === "same-site";
}

/**
 * Answer with a page.
 *
 * @param response - The platform response.
 * @param page - The page and its status.
 * @returns The document, for Nest to send.
 */
function page(response: HeaderResponse, page: SlackLinkPage): string {
  response.status(page.status);

  for (const [name, value] of Object.entries(ANSWER_PAGE_HEADERS)) {
    response.setHeader(name, value);
  }

  return page.html;
}

@AllowAnonymous()
@TenantOptional()
@Controller(`${SLACK_ROUTE}/link`)
export class SlackLinkController {
  /** @param links - What a link does. */
  constructor(private readonly links: SlackLinkService) {}

  /**
   * `GET /slack/link/:token` — the confirmation screen. Nothing is linked by opening it.
   *
   * @param token - The token from the link.
   * @param request - For the session, if any.
   * @param response - For the status and headers.
   * @returns An HTML page: the confirmation, a sign-in, or a designed refusal.
   */
  @Get(":token")
  async confirm(
    @Param("token") token: string,
    @Req() request: PrincipalRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<string> {
    return page(response, await this.links.page(token, linkSessionOf(request)));
  }

  /**
   * `POST /slack/link/:token` — link, once.
   *
   * @param token - The token from the link.
   * @param request - For the session, if any, and where the browser says the post came from.
   * @param response - For the status and headers.
   * @returns An HTML page: the receipt, or why nothing was linked.
   */
  @Post(":token")
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param("token") token: string,
    @Req() request: PrincipalRequest & CookieRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<string> {
    // A post from another site carries nobody's consent: it is answered as an anonymous one,
    // which links nothing and shows the sign-in page.
    const session = fromAnotherSite(request) ? undefined : linkSessionOf(request);

    return page(response, await this.links.confirm(token, session));
  }
}

/* ------------------------------------------------------------------ status */

/** `POST /slack/connection/verify`'s answer: what Slack said, and the status after it. */
export interface SlackVerificationResource {
  readonly result: SlackVerification;
  readonly connection: SlackConnectionResource;
}

@Controller(`${SLACK_ROUTE}/connection`)
export class SlackConnectionController {
  /**
   * @param installs - Verifies a connection.
   * @param repository - Reads it.
   * @param config - Whether Socket Mode is on.
   */
  constructor(
    private readonly installs: SlackInstallService,
    private readonly repository: SlackRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * `GET /slack/connection` — where Slack stands for this workspace.
   *
   * @param tenant - The workspace.
   * @returns The status. Never the bot token.
   */
  @Get()
  async status(@CurrentTenant() tenant: Organization): Promise<SlackConnectionResource> {
    const connection = await this.repository.connectionOf(tenant.id);
    const channels = connection === undefined ? [] : await this.repository.channels(connection.id);

    return connectionResource({
      configured: this.installs.credentials() !== undefined,
      connection,
      channels: {
        total: channels.length,
        joined: channels.filter((channel) => channel.joined && !channel.archived).length,
      },
      socketMode: this.config.slackSocketMode,
    });
  }

  /**
   * `POST /slack/connection/verify` — ask Slack whether the connection still works, and refresh
   * its channels.
   *
   * @param tenant - The workspace.
   * @returns What Slack said, and the status after it.
   */
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMINISTRATORS)
  async verify(@CurrentTenant() tenant: Organization): Promise<SlackVerificationResource> {
    const result = await this.installs.verify(tenant.id);

    return { result, connection: await this.status(tenant) };
  }
}
