import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { AUDIT_FORBIDDEN, AUDIT_PAGE_SIZE, AUDIT_UNAVAILABLE } from "@/app/audit-log/view";

import { auditLogPage } from "../helpers/audit-log";

/**
 * The filtered log's server hop (BS.5, #495): the filter and the cursor go to the one read, and a
 * refusal comes back as a sentence rather than a throw.
 */

vi.mock("server-only", () => ({}));

const list = vi.fn();

vi.mock("@/app/api/settings-audit", () => ({
  settingsAudit: { list: (...args: unknown[]) => list(...args) as unknown },
}));

const { readAuditLog } = await import("@/app/audit-log/audit-actions");

beforeEach(() => {
  list.mockReset().mockResolvedValue(auditLogPage());
});

describe("readAuditLog", () => {
  it("reads the first page of the filter at the card's page size", async () => {
    expect(await readAuditLog({ action: "policy.*" })).toEqual({ ok: true, page: auditLogPage() });
    expect(list).toHaveBeenCalledExactlyOnceWith({ action: "policy.*" }, { limit: AUDIT_PAGE_SIZE });
  });

  it("continues from a cursor", async () => {
    await readAuditLog({}, "cursor-2");

    expect(list).toHaveBeenCalledExactlyOnceWith({}, { cursor: "cursor-2", limit: AUDIT_PAGE_SIZE });
  });

  it("answers a reader below admin with the sentence, not the code", async () => {
    list.mockRejectedValue(new ApiError(403, "forbidden", "Forbidden."));

    expect(await readAuditLog({})).toEqual({ ok: false, reason: AUDIT_FORBIDDEN });
  });

  it("keeps the service's own sentence for any other refusal, and has one when it gave none", async () => {
    list.mockRejectedValue(new ApiError(422, "validation_failed", "ref is not a reference."));
    expect(await readAuditLog({ ref: "x" })).toEqual({ ok: false, reason: "ref is not a reference." });

    list.mockRejectedValue(new ApiError(503, "unavailable", ""));
    expect(await readAuditLog({})).toEqual({ ok: false, reason: AUDIT_UNAVAILABLE });
  });

  it("lets anything that is not a refusal keep travelling", async () => {
    list.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(readAuditLog({})).rejects.toThrow("NEXT_REDIRECT");
  });
});
