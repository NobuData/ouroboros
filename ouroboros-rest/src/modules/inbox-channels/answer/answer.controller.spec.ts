import { ALLOW_ANONYMOUS } from "../../auth/anonymous";
import type { PrincipalRequest } from "../../auth/principal";
import { TENANT_OPTIONAL } from "../../tenancy/tenant.decorators";
import { ANSWER_PAGE_HEADERS, AnswerController, noteOf, sessionOf } from "./answer.controller";
import type { AnswerService } from "./answer.service";

/** A response that records what the controller set. */
function response() {
  const recorded = { status: 0, headers: {} as Record<string, string> };

  return {
    recorded,
    status: (code: number) => {
      recorded.status = code;
    },
    setHeader: (name: string, value: string) => {
      recorded.headers[name] = value;
    },
  };
}

/** A request carrying a session for `id`, or none. */
const request = (id?: string): PrincipalRequest =>
  (id === undefined
    ? {}
    : {
        session: { session: {}, user: { id, name: `Name ${id}` } },
      }) as unknown as PrincipalRequest;

describe("AnswerController (#463)", () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const service = {
    page: (...args: unknown[]) => {
      calls.push({ method: "page", args });

      return Promise.resolve({ status: 200, html: "<p>card</p>" });
    },
    answer: (...args: unknown[]) => {
      calls.push({ method: "answer", args });

      return Promise.resolve({ status: 410, html: "<p>used</p>" });
    },
  } as unknown as AnswerService;
  const controller = new AnswerController(service);

  beforeEach(() => {
    calls.length = 0;
  });

  it("is public and tenant-optional — the token is the credential", () => {
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, AnswerController)).toBe(true);
    expect(Reflect.getMetadata(TENANT_OPTIONAL, AnswerController)).toBe(true);
  });

  it("answers GET with the page, its status and the hardened headers", async () => {
    const res = response();
    const html = await controller.confirm("tok", request(), res);

    expect(html).toBe("<p>card</p>");
    expect(res.recorded.status).toBe(200);
    expect(res.recorded.headers).toEqual(ANSWER_PAGE_HEADERS);
    expect(calls).toEqual([{ method: "page", args: ["tok", undefined] }]);
  });

  it("hands POST the session and the form's note", async () => {
    const res = response();

    await controller.submit("tok", { note: "why" }, request("ken"), res);

    expect(res.recorded.status).toBe(410);
    expect(calls).toEqual([
      { method: "answer", args: ["tok", { userId: "ken", name: "Name ken" }, "why"] },
    ]);
  });

  it("never lets the page be cached, framed, scripted or referred onwards", () => {
    expect(ANSWER_PAGE_HEADERS["Cache-Control"]).toBe("no-store");
    expect(ANSWER_PAGE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    expect(ANSWER_PAGE_HEADERS["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(ANSWER_PAGE_HEADERS["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(ANSWER_PAGE_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("reads the session and the note defensively", () => {
    expect(sessionOf(request())).toBeUndefined();
    expect(noteOf(undefined)).toBeUndefined();
    expect(noteOf({ note: 42 })).toBeUndefined();
    expect(noteOf("note=x")).toBeUndefined();
    expect(noteOf({ note: "x" })).toBe("x");
  });
});
