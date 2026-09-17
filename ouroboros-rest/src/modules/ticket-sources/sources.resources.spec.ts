import type { TicketSourcePublic } from "../db/schema";
import { MASK_ONLY } from "../provider-connections/masking";
import {
  maskOf,
  sourceResource,
  statusResource,
  syncResult,
  testResource,
} from "./sources.resources";
import {
  SOURCE_SKIPPED_IN_FLIGHT,
  SOURCE_SKIPPED_UNSUPPORTED,
  SOURCE_SKIP_MESSAGES,
  type SourceSyncOutcome,
} from "./sync.report";
import { TICKET_SOURCE_ERROR_REASONS } from "./ticket-source.errors";

/**
 * The source-management resources ([#141](https://github.com/NobuData/ouroboros/issues/141)),
 * composed from rows and the loop's memory — and the one rule every one of them keeps: no
 * credential, and no envelope, in anything a client reads.
 */

const NOW = new Date("2026-09-12T10:00:00.000Z");

/** A row through the view — no credential column, because the view has none. */
function row(overrides: Partial<TicketSourcePublic> = {}): TicketSourcePublic {
  return {
    id: "5eed001a-0000-4000-8000-000000000001",
    organization_id: "org-sources",
    kind: "github",
    display_name: "GitHub · acme-robotics",
    config: { login: "acme-robotics", repos: ["helios-firmware"] },
    status: "active",
    status_reason: null,
    sync_cursor: null,
    synced_at: null,
    created_at: new Date("2026-09-01T09:00:00.000Z"),
    updated_at: new Date("2026-09-01T09:00:00.000Z"),
    ...overrides,
  };
}

/** One outcome, with the counters a spec does not care about zeroed. */
function outcome(overrides: Partial<SourceSyncOutcome> = {}): SourceSyncOutcome {
  return {
    organizationId: "org-sources",
    sourceId: "5eed001a-0000-4000-8000-000000000001",
    kind: "github",
    displayName: "GitHub · acme-robotics",
    imported: 0,
    updated: 0,
    unchanged: 0,
    skippedClosed: 0,
    enqueued: 0,
    hasMore: false,
    ...overrides,
  };
}

describe("a source", () => {
  it("is the row, camel-cased, with the instants as ISO strings", () => {
    expect(sourceResource(row({ synced_at: NOW }), false, 42)).toStrictEqual({
      id: "5eed001a-0000-4000-8000-000000000001",
      kind: "github",
      displayName: "GitHub · acme-robotics",
      config: { login: "acme-robotics", repos: ["helios-firmware"] },
      status: "active",
      statusReason: null,
      credentialMask: null,
      syncedAt: "2026-09-12T10:00:00.000Z",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
      openTicketCount: 42,
    });
  });

  it("masks a stored credential as four bullets and nothing else on a read", () => {
    expect(sourceResource(row(), true, 0).credentialMask).toBe(MASK_ONLY);
    expect(sourceResource(row(), true, 0).credentialMask).toBe("••••");
  });

  it("echoes a suffix only where a write hands one in, and never when nothing is stored", () => {
    expect(sourceResource(row(), true, 0, maskOf("github_pat_example1234")).credentialMask).toBe(
      "••••1234",
    );
    expect(
      sourceResource(row(), false, 0, maskOf("github_pat_example1234")).credentialMask,
    ).toBeNull();
  });

  it("answers an empty object for a config that is not one, rather than crashing a list", () => {
    expect(sourceResource(row({ config: "github" }), false, 0).config).toStrictEqual({});
    expect(sourceResource(row({ config: ["a"] }), false, 0).config).toStrictEqual({});
  });

  it("carries the honest reason beside an error", () => {
    const resource = sourceResource(
      row({ status: "error", status_reason: "rate limited until 14:20 UTC" }),
      true,
      6,
    );

    expect(resource.status).toBe("error");
    expect(resource.statusReason).toBe("rate limited until 14:20 UTC");
  });

  // The count is the caller's, because it lives in another table — see the mapper's note.
  it("publishes the open-ticket count it was handed, zero included (#285)", () => {
    expect(sourceResource(row(), false, 0).openTicketCount).toBe(0);
    expect(sourceResource(row(), false, 42).openTicketCount).toBe(42);
  });
});

describe("the masked echo", () => {
  it("is four bullets and the last four characters of what was submitted", () => {
    expect(maskOf("ghp_mnbvcxzlkjhgfdsapoiuytrewq9876543210")).toBe("••••3210");
  });

  it("carries no suffix for a credential too short to have one", () => {
    expect(maskOf("abc")).toBe("••••");
  });
});

describe("the status report", () => {
  it("answers the row's half and nulls for a process that has synced nothing", () => {
    expect(statusResource(row(), false, undefined, undefined, undefined)).toStrictEqual({
      sourceId: "5eed001a-0000-4000-8000-000000000001",
      status: "active",
      statusReason: null,
      syncedAt: null,
      running: false,
      retryAfterSeconds: null,
      lastSync: null,
    });
  });

  it("composes the last sync from the loop's outcome and its start", () => {
    const report = statusResource(
      row({ synced_at: NOW }),
      true,
      22,
      outcome({ imported: 2, updated: 1, unchanged: 6, enqueued: 2, hasMore: true }),
      NOW,
    );

    expect(report.running).toBe(true);
    expect(report.retryAfterSeconds).toBe(22);
    expect(report.lastSync).toStrictEqual({
      startedAt: "2026-09-12T10:00:00.000Z",
      outcome: "synced",
      imported: 2,
      updated: 1,
      unchanged: 6,
      skippedClosed: 0,
      enqueued: 2,
      hasMore: true,
      errorClass: null,
      reason: null,
    });
  });

  it("reports a failure with its class and the row's own sentence", () => {
    const result = syncResult(
      outcome({ failure: { errorClass: "rate_limit", reason: "rate limited until 14:20 UTC" } }),
      NOW,
    );

    expect(result.outcome).toBe("failed");
    expect(result.errorClass).toBe("rate_limit");
    expect(result.reason).toBe("rate limited until 14:20 UTC");
  });

  it("reports a skip with the report's own sentence for it", () => {
    for (const skipped of [SOURCE_SKIPPED_UNSUPPORTED, SOURCE_SKIPPED_IN_FLIGHT] as const) {
      const result = syncResult(outcome({ skipped }), NOW);

      expect(result.outcome).toBe("skipped");
      expect(result.errorClass).toBeNull();
      expect(result.reason).toBe(SOURCE_SKIP_MESSAGES[skipped]);
    }
  });
});

describe("a test result", () => {
  it("answers a pass with the provider's words and no class", () => {
    expect(
      testResource(
        "5eed001a-0000-4000-8000-000000000001",
        { status: "ok", detail: "acme-robotics · 4 repositories" },
        NOW,
      ),
    ).toStrictEqual({
      sourceId: "5eed001a-0000-4000-8000-000000000001",
      checkedAt: "2026-09-12T10:00:00.000Z",
      status: "ok",
      errorClass: null,
      detail: "acme-robotics · 4 repositories",
      reason: null,
    });
  });

  it("answers a failure with its class, the provider's words, and the taxonomy's sentence", () => {
    const result = testResource(
      "5eed001a-0000-4000-8000-000000000001",
      { status: "failed", errorClass: "auth", detail: "GitHub refused the token (401)" },
      NOW,
    );

    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("auth");
    expect(result.detail).toBe("GitHub refused the token (401)");
    // The same phrase the row would carry, so the form and the list agree about what a
    // refused token is called.
    expect(result.reason).toBe(TICKET_SOURCE_ERROR_REASONS.auth);
  });
});
