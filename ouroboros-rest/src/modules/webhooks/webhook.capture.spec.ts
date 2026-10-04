import {
  ERROR_LIMIT,
  EXCERPT_LIMIT,
  REDACTED,
  failureReason,
  redactCredentials,
  responseExcerpt,
} from "./webhook.capture";

/**
 * The delivery log's bounded capture (#487): never unbounded, and never anything that looks like a
 * credential — a collector's error page is exactly where a misconfigured receiver echoes one.
 */

describe("redacting a receiver's answer", () => {
  it.each([
    ['{"error":"bad","token":"abc123"}', '"token": "abc123"'],
    ["Authorization: Bearer abc.def.ghi", "abc.def.ghi"],
    ["url?api_key=sk_live_1234567890abcdef&x=1", "sk_live_1234567890abcdef"],
    ["expected secret=hunter2", "hunter2"],
    ["got ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ghp_aaaaaaaaaaaaaaaaaaaa"],
    ["key AKIAIOSFODNN7EXAMPLE leaked", "AKIAIOSFODNN7EXAMPLE"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here", "eyJhbGciOiJIUzI1NiJ9"],
    ["hex 0123456789abcdef0123456789abcdef01 tail", "0123456789abcdef0123456789abcdef01"],
    ["our own whsec_ZGV2LXNlZWQtdmFsdWU echoed", "whsec_ZGV2LXNlZWQtdmFsdWU"],
  ])("removes the credential from %s", (text, credential) => {
    const redacted = redactCredentials(text);

    expect(redacted).not.toContain(credential.replace(/^"token": "/, ""));
    expect(redacted).toContain(REDACTED);
  });

  it("leaves an ordinary error message readable", () => {
    expect(redactCredentials("upstream unavailable (503), retry later")).toBe(
      "upstream unavailable (503), retry later",
    );
  });
});

describe("the excerpt", () => {
  it("is null for an empty body", () => {
    expect(responseExcerpt("  \n")).toBeNull();
  });

  it("is bounded to V094's 1024 characters, marking the cut", () => {
    const excerpt = responseExcerpt("x ".repeat(5000)) ?? "";

    expect(excerpt).toHaveLength(EXCERPT_LIMIT);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("redacts before it truncates", () => {
    expect(responseExcerpt('{"password":"hunter2"}')).toBe(`{"password":"${REDACTED}"}`);
  });
});

describe("the failure reason", () => {
  it("is bounded to V098's 512 characters and redacted", () => {
    const reason = failureReason(`refused: token=abc ${"y".repeat(600)}`);

    expect(reason.length).toBeLessThanOrEqual(ERROR_LIMIT);
    expect(reason).not.toContain("token=abc");
  });
});
