/**
 * `/api/v1/inbox/answer/{token}` — the page an emailed action link opens (BN.3,
 * [#463](https://github.com/NobuData/ouroboros/issues/463), decision **X5**).
 *
 * **`@AllowAnonymous()`, and it has to be.** A non-merge-class answer is one click from the mail
 * — the token is the credential, minted for one item, one action and one person, single-use and
 * short-lived. The authentication guard still reads a session when the request carries one (the
 * page is linked on the UI origin and forwarded here by `proxy.ts`, so the cookie arrives), and
 * {@link AnswerService} uses it: a merge-class link demands it, and someone else's refuses.
 *
 * **`GET` (and the `HEAD` Express answers from it) changes nothing** — mail scanners and link
 * previewers open every link in a message. The page's one button `POST`s the answer.
 *
 * **It answers HTML, including when the link is bad**: a person arrives here from a mail, so every
 * refusal is a designed page with its status — returned, never thrown, because a thrown error
 * leaves through the JSON envelope.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { principalOf, type PrincipalRequest } from "../../auth/principal";
import { TenantOptional } from "../../tenancy/tenant.decorators";
import { ANSWER_ROUTE } from "../channel.links";
import type { AnswerPage } from "./answer.pages";
import { AnswerService, type AnswerSession } from "./answer.service";

/** The part of a platform response this controller writes. */
interface PageResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/**
 * Headers every page here carries: never cached (it shows a decision), never indexed or sniffed,
 * allowed to run nothing and load nothing but its own inline style, to post only to itself, and
 * never to pass the token on as a referrer.
 */
export const ANSWER_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
};

/**
 * Answer with a page.
 *
 * @param response - The platform response.
 * @param page - The page and its status.
 * @returns The document, for Nest to send.
 */
function answer(response: PageResponse, page: AnswerPage): string {
  response.status(page.status);

  for (const [name, value] of Object.entries(ANSWER_PAGE_HEADERS)) {
    response.setHeader(name, value);
  }

  return page.html;
}

/**
 * The signed-in person a request carries, if any.
 *
 * @param request - The request, as the authentication guard left it.
 * @returns The person, or undefined on an anonymous request.
 */
export function sessionOf(request: PrincipalRequest): AnswerSession | undefined {
  const principal = principalOf(request);

  return principal === undefined
    ? undefined
    : { userId: principal.user.id, name: principal.user.name };
}

/**
 * The note a form posted, if any.
 *
 * @param body - The parsed body — urlencoded from the page's form, or JSON.
 * @returns The note, or undefined.
 */
export function noteOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const note = (body as Record<string, unknown>).note;

  return typeof note === "string" ? note : undefined;
}

@AllowAnonymous()
@TenantOptional()
@Controller(ANSWER_ROUTE)
export class AnswerController {
  /** @param answers - What a token link does. */
  constructor(private readonly answers: AnswerService) {}

  /**
   * The confirm page. Nothing is decided by opening it.
   *
   * @param token - The token from the mail.
   * @param request - For the session, if any.
   * @param response - For the status and headers.
   * @returns An HTML page: the card and its button, a sign-in, or a designed refusal.
   */
  @Get(":token")
  async confirm(
    @Param("token") token: string,
    @Req() request: PrincipalRequest,
    @Res({ passthrough: true }) response: PageResponse,
  ): Promise<string> {
    return answer(response, await this.answers.page(token, sessionOf(request)));
  }

  /**
   * The answer.
   *
   * @param token - The token from the mail.
   * @param body - The form: a `note` for an action that takes one.
   * @param request - For the session, if any.
   * @param response - For the status and headers.
   * @returns An HTML page: the receipt, or why nothing was done.
   */
  @Post(":token")
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param("token") token: string,
    @Body() body: unknown,
    @Req() request: PrincipalRequest,
    @Res({ passthrough: true }) response: PageResponse,
  ): Promise<string> {
    return answer(response, await this.answers.answer(token, sessionOf(request), noteOf(body)));
  }
}
