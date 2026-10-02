/**
 * `/api/v1/insights/digest/unsubscribe/{token}` — the link at the bottom of every digest (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440)).
 *
 * **`@AllowAnonymous()`, and it has to be.** An unsubscribe link that asks for a login is the
 * difference between a useful digest and a filter rule. The caller is whoever holds the mail;
 * the token in the path is the whole credential, it is minted per send, and all it can do is
 * stop that one person's digest for that one workspace. `route.table.fixture.ts` records both
 * routes as public.
 *
 * **`GET` changes nothing.** Mail scanners and link previewers open every link in a message, so
 * the link opens a page with one button; the button's `POST` is the unsubscribe. The same `POST`
 * is what a mail client's own unsubscribe control sends (RFC 8058), which is why it reads no
 * body: `List-Unsubscribe=One-Click` is not a field this API validates.
 *
 * **It answers HTML, including when the link is bad.** A person arrives here from a mail, not a
 * client from a contract, so an unknown token is a page saying so with a `404` — returned, never
 * thrown, because a thrown error leaves through the JSON envelope.
 */

import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { TenantOptional } from "../../tenancy/tenant.decorators";
import type { DigestPage } from "./digest.pages";
import { UNSUBSCRIBE_ROUTE } from "./digest.render";
import { DigestService } from "./digest.service";

/** The part of a platform response this controller writes. */
interface PageResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/**
 * Headers every page here carries: never cached (it names a workspace), never sniffed, allowed
 * to run nothing and load nothing but its own inline style, and never to pass the token on as a
 * referrer.
 */
export const UNSUBSCRIBE_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};

/**
 * Answer with a page.
 *
 * @param response - The platform response.
 * @param page - The page and its status.
 * @returns The document, for Nest to send.
 */
function answer(response: PageResponse, page: DigestPage): string {
  // Set here rather than by `@Header()`, so a failure that leaves through the error filter is
  // not labelled HTML.
  response.status(page.status);

  for (const [name, value] of Object.entries(UNSUBSCRIBE_PAGE_HEADERS)) {
    response.setHeader(name, value);
  }

  return page.html;
}

@AllowAnonymous()
@TenantOptional()
@Controller(UNSUBSCRIBE_ROUTE)
export class DigestUnsubscribeController {
  /** @param digest - The digest's request-side behaviour. */
  constructor(private readonly digest: DigestService) {}

  /**
   * The confirmation page a link opens. Nothing is changed by opening it.
   *
   * @param token - The token from the mail.
   * @param response - For the status and headers.
   * @returns An HTML page: the confirmation, or `404` for a link that names no send.
   */
  @Get(":token")
  async confirm(
    @Param("token") token: string,
    @Res({ passthrough: true }) response: PageResponse,
  ): Promise<string> {
    return answer(response, await this.digest.unsubscribePage(token));
  }

  /**
   * Unsubscribe. Idempotent: a second `POST` answers the same page.
   *
   * @param token - The token from the mail.
   * @param response - For the status and headers.
   * @returns An HTML page: done, or `404` for a link that names no send.
   */
  @Post(":token")
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @Param("token") token: string,
    @Res({ passthrough: true }) response: PageResponse,
  ): Promise<string> {
    return answer(response, await this.digest.unsubscribe(token));
  }
}
