import { describe, expect, it } from "vitest";

import {
  ApiError,
  UNAUTHENTICATED_CODE,
  UNREADABLE_ERROR_CODE,
  isApiError,
  isErrorEnvelope,
} from "@/app/api/errors";

/**
 * The error envelope, and what this client does with a body that is not one.
 *
 * Reading a *well-formed* envelope is the easy half. The half worth testing is every way
 * a failure can arrive without one — a proxy's HTML, an empty `502`, a truncated body —
 * because that is where a client either keeps the status it has or replaces a real
 * failure with a parse error about it.
 */

/** A response carrying a JSON body, the way `ouroboros-rest` answers. */
function jsonResponse(status: number, body: unknown, statusText?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    ...(statusText ? { statusText } : {}),
    headers: { "Content-Type": "application/json" },
  });
}

describe("isErrorEnvelope", () => {
  it("accepts the contract's shape", () => {
    expect(isErrorEnvelope({ code: "tenant_not_found", message: "No such tenant.", details: {} })).toBe(
      true,
    );
  });

  it("accepts one whose details are missing, rather than discarding a real code", () => {
    expect(isErrorEnvelope({ code: "internal_error", message: "Something failed." })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "unauthenticated"],
    ["a number", 500],
    ["an array", [{ code: "x", message: "y" }]],
    ["an object with no code", { message: "No code here." }],
    ["an object with no message", { code: "no_message" }],
    ["an object whose code is not a string", { code: 401, message: "Numeric code." }],
  ])("rejects %s", (_description, value) => {
    expect(isErrorEnvelope(value)).toBe(false);
  });
});

describe("ApiError.fromResponse", () => {
  it("carries the envelope's code, message and details", async () => {
    const error = await ApiError.fromResponse(
      jsonResponse(409, {
        code: "domain_taken",
        message: "That domain belongs to another tenant.",
        details: { domain: "acme.example.com" },
      }),
    );

    expect(error.status).toBe(409);
    expect(error.code).toBe("domain_taken");
    expect(error.message).toBe("That domain belongs to another tenant.");
    expect(error.details).toEqual({ domain: "acme.example.com" });
  });

  it("is a real Error, so a throw of one carries a stack and reads as one in a log", async () => {
    const error = await ApiError.fromResponse(
      jsonResponse(500, { code: "internal_error", message: "Something failed.", details: {} }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(String(error)).toContain("Something failed.");
  });

  it("substitutes an empty object for absent details, so details.x needs no guard", async () => {
    const error = await ApiError.fromResponse(
      jsonResponse(404, { code: "tenant_not_found", message: "No such tenant." }),
    );

    expect(error.details).toEqual({});
  });

  it("leaves the response readable, because it parses a clone", async () => {
    const response = jsonResponse(422, {
      code: "validation_failed",
      message: "The request was refused.",
      details: { slug: ["slug must be lower-case"] },
    });

    await ApiError.fromResponse(response);

    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toMatchObject({ code: "validation_failed" });
  });

  it("keeps the status and says so when the body is not JSON at all", async () => {
    // What a reverse proxy in front of the service answers with when the service is
    // down: the status is the fact that matters, and it must survive the body.
    const error = await ApiError.fromResponse(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
    );

    expect(error.status).toBe(502);
    expect(error.code).toBe(UNREADABLE_ERROR_CODE);
    expect(error.message).toContain("502 Bad Gateway");
  });

  it("keeps the status when the body is empty", async () => {
    const error = await ApiError.fromResponse(new Response(null, { status: 503 }));

    expect(error.status).toBe(503);
    expect(error.code).toBe(UNREADABLE_ERROR_CODE);
  });

  it("keeps the status when the body is JSON but not an envelope", async () => {
    const error = await ApiError.fromResponse(jsonResponse(400, { error: "nope" }));

    expect(error.status).toBe(400);
    expect(error.code).toBe(UNREADABLE_ERROR_CODE);
  });

  it("never mints a code that could be mistaken for one the service sent", () => {
    // Every code the contract can answer with is named in the specification. A code this
    // client invents must be visibly its own.
    expect(UNREADABLE_ERROR_CODE.startsWith("client_")).toBe(true);
  });
});

describe("ApiError.isUnauthenticated", () => {
  it("is true for the 401 the contract defines", async () => {
    const error = await ApiError.fromResponse(
      jsonResponse(401, {
        code: UNAUTHENTICATED_CODE,
        message: "Sign in to continue.",
        details: {},
      }),
    );

    expect(error.isUnauthenticated).toBe(true);
  });

  it("is true for a 401 whose body was unreadable, because the status is the fact", async () => {
    const error = await ApiError.fromResponse(new Response("", { status: 401 }));

    expect(error.isUnauthenticated).toBe(true);
  });

  it("is false for every other failure, including the 403 a role guard answers", async () => {
    const forbidden = await ApiError.fromResponse(
      jsonResponse(403, { code: "forbidden", message: "Not your workspace.", details: {} }),
    );

    expect(forbidden.isUnauthenticated).toBe(false);
  });
});

describe("isApiError", () => {
  it("narrows what a catch binds", () => {
    const caught: unknown = new ApiError(404, "tenant_not_found", "No such tenant.");
    expect(isApiError(caught)).toBe(true);

    // The narrowing is the point: this line does not compile without the guard above.
    if (isApiError(caught)) {
      expect(caught.code).toBe("tenant_not_found");
    }
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["a TypeError, which is how a fetch that never arrived fails", new TypeError("fetch failed")],
    ["a string", "unauthenticated"],
    ["undefined", undefined],
    ["an envelope-shaped object that was never thrown by this client", { code: "x", message: "y" }],
  ])("rejects %s", (_description, value) => {
    expect(isApiError(value)).toBe(false);
  });
});
