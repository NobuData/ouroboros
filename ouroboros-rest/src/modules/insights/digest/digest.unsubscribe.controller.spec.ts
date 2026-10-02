import { HTTP_CODE_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../../auth/anonymous";
import { TENANT_OPTIONAL } from "../../tenancy/tenant.decorators";
import type { DigestService } from "./digest.service";
import {
  DigestUnsubscribeController,
  UNSUBSCRIBE_PAGE_HEADERS,
} from "./digest.unsubscribe.controller";

/** A response that records what was set on it. */
function response() {
  const headers: Record<string, string> = {};
  const status = jest.fn();

  return {
    headers,
    status,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

/** A controller over a stand-in service. */
function build() {
  const service = {
    unsubscribePage: jest.fn().mockResolvedValue({ status: 200, html: "<p>confirm</p>" }),
    unsubscribe: jest.fn().mockResolvedValue({ status: 200, html: "<p>done</p>" }),
  };

  return {
    controller: new DigestUnsubscribeController(service as unknown as DigestService),
    service,
  };
}

describe("the unsubscribe routes", () => {
  it("need no session and no workspace: the token is the credential", () => {
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, DigestUnsubscribeController)).toBe(true);
    expect(Reflect.getMetadata(TENANT_OPTIONAL, DigestUnsubscribeController)).toBe(true);
  });

  it("GET answers the confirmation page as HTML and changes nothing", async () => {
    const { controller, service } = build();
    const res = response();

    await expect(controller.confirm("ouro_unsub_x", res)).resolves.toBe("<p>confirm</p>");
    expect(service.unsubscribePage).toHaveBeenCalledWith("ouro_unsub_x");
    expect(service.unsubscribe).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.headers).toEqual(UNSUBSCRIBE_PAGE_HEADERS);
  });

  it("POST unsubscribes and answers 200, not 201", async () => {
    const { controller, service } = build();
    const res = response();

    await expect(controller.unsubscribe("ouro_unsub_x", res)).resolves.toBe("<p>done</p>");
    expect(service.unsubscribe).toHaveBeenCalledWith("ouro_unsub_x");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, DigestUnsubscribeController.prototype.unsubscribe),
    ).toBe(200);
  });

  it.each(["confirm", "unsubscribe"] as const)(
    "%s answers a bad link with the page's own 404 — returned, never thrown",
    async (handler) => {
      const { controller, service } = build();
      const page = { status: 404, html: "<p>not valid</p>" };
      service.unsubscribePage.mockResolvedValue(page);
      service.unsubscribe.mockResolvedValue(page);
      const res = response();

      await expect(controller[handler]("nope", res)).resolves.toBe("<p>not valid</p>");
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    },
  );

  it("serves pages that are never cached, never sniffed, and never leak the token as a referrer", () => {
    expect(UNSUBSCRIBE_PAGE_HEADERS).toEqual({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    });
  });
});
