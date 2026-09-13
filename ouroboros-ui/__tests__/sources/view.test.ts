import { describe, expect, it } from "vitest";

import {
  KIND_LABELS,
  NEVER_SYNCED,
  SYNCING,
  UNEXPLAINED_ERROR,
  labelOf,
  lastSyncLine,
  statusPill,
  summaryOf,
  syncLine,
  syncTooSoon,
  syncWaitReason,
  syncedLabel,
  testNote,
} from "@/app/sources/view";

import {
  READ_AT,
  failedSource,
  githubEntry,
  jiraSource,
  refusedTest,
  source,
  statusReport,
  testResult,
} from "../helpers/sources";

/**
 * What a row says ([#141](https://github.com/NobuData/ouroboros/issues/141)): the summary
 * from the provider's own fields, the status pill, the freshness or the honest reason, and
 * the test note.
 */

const NOW = new Date(READ_AT);

describe("the kind", () => {
  it("labels the five kinds the contract declares, and a stranger by its own name", () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual(["custom", "github", "gitlab", "jira", "linear"]);
    expect(labelOf("github")).toBe("GitHub");
    expect(labelOf("gitlab")).toBe("GitLab");
    expect(labelOf("bugzilla")).toBe("bugzilla");
  });
});

describe("the status pill", () => {
  it("carries the state in words and in shape, never in hue alone", () => {
    expect(statusPill("active")).toEqual({ tone: "ok", dot: "filled", label: "active" });
    expect(statusPill("paused")).toEqual({ tone: "neutral", dot: "ring", label: "paused" });
    expect(statusPill("error")).toEqual({ tone: "err", dot: "filled", label: "error" });
  });

  it("pulses while a sync is running, whatever the row's status", () => {
    expect(statusPill("active", true)).toEqual({ tone: "accent", dot: "pulse", label: "syncing" });
    expect(statusPill("error", true).dot).toBe("pulse");
  });
});

describe("the summary", () => {
  it("prints the provider's own fields — a string as itself, a list as a count under its label", () => {
    // The acceptance criterion's *no hard-coded GitHub form*, kept by the summary too: the
    // words *GitHub account* and *Repositories* are the catalog's, not this module's.
    expect(summaryOf(source(), githubEntry().fields)).toBe("acme-robotics · 4 repositories");
    expect(
      summaryOf(source({ config: { login: "solo", repos: ["one"] } }), githubEntry().fields),
    ).toBe("solo · 1 repository");
  });

  it("leaves the secret field out, whatever the row holds under its name", () => {
    expect(
      summaryOf(source({ config: { login: "acme", repos: ["a"], token: "ghp_x" } }), githubEntry().fields),
    ).toBe("acme · 1 repository");
  });

  it("falls back to the stored config's own keys when the catalog could not be read", () => {
    expect(summaryOf(source(), null)).toBe("acme-robotics · 4 repos");
    expect(summaryOf(jiraSource(), null)).toBe("https://acme-robotics.atlassian.net · 1 project_key");
  });

  it("names the kind when there is nothing else to say", () => {
    expect(summaryOf(source({ config: {} }), null)).toBe("GitHub");
    expect(summaryOf(source({ config: { login: "" } }), githubEntry().fields)).toBe("GitHub");
  });
});

describe("the sync line", () => {
  it("spells freshness in the mockup's own phrase", () => {
    expect(syncedLabel(source().syncedAt, NOW)).toBe("synced 40s ago");
    expect(syncedLabel(null, NOW)).toBe(NEVER_SYNCED);
  });

  it("prints freshness for an active row, in the ok hue", () => {
    expect(syncLine(source(), statusReport(), NOW)).toEqual({ text: "synced 40s ago", tone: "ok" });
  });

  it("prints the honest reason and nothing else for a failed row", () => {
    // *rate limited until 14:20 UTC* is the sentence the acceptance criterion asks for, and
    // burying it after a freshness phrase would be the honest reason said second.
    expect(syncLine(failedSource(), null, NOW)).toEqual({
      text: "rate limited until 14:20 UTC",
      tone: "err",
    });
    expect(syncLine(failedSource({ statusReason: null }), null, NOW).text).toBe(UNEXPLAINED_ERROR);
  });

  it("says a paused row is paused before it says how fresh it is", () => {
    expect(syncLine(jiraSource(), null, NOW)).toEqual({
      text: `paused · ${NEVER_SYNCED}`,
      tone: "neutral",
    });
  });

  it("says a running row is running, over any status", () => {
    expect(syncLine(failedSource(), { running: true }, NOW)).toEqual({ text: SYNCING, tone: "accent" });
  });

  it("prints what the last sync did, and nothing when this process has synced none", () => {
    expect(lastSyncLine(statusReport())).toBe("last sync imported 2 · updated 1 · unchanged 6");
    expect(
      lastSyncLine(statusReport({ lastSync: { ...statusReport().lastSync!, hasMore: true } })),
    ).toBe("last sync imported 2 · updated 1 · unchanged 6 · more waiting");
    expect(lastSyncLine(statusReport({ lastSync: null }))).toBeNull();
    expect(lastSyncLine(null)).toBeNull();
  });

  it("prints a failed or skipped last sync's own sentence", () => {
    expect(
      lastSyncLine(
        statusReport({
          lastSync: {
            ...statusReport().lastSync!,
            outcome: "failed",
            errorClass: "auth",
            reason: "credentials rejected (401)",
          },
        }),
      ),
    ).toBe("credentials rejected (401)");
  });
});

describe("the control sentences", () => {
  it("names the wait, so a reader knows when to come back", () => {
    expect(syncWaitReason(22)).toContain("22s");
    expect(syncTooSoon(9)).toContain("9s");
  });
});

describe("the test note", () => {
  it("prints a pass as the provider's own detail, because a bare tick cannot say what was found", () => {
    expect(testNote(testResult())).toEqual({
      tone: "ok",
      glyph: "✓",
      text: "acme-robotics · 4 repositories",
    });
  });

  it("prints a failure as the taxonomy's sentence and the provider's words", () => {
    expect(testNote(refusedTest())).toEqual({
      tone: "err",
      glyph: "✗",
      text: "credentials rejected — GitHub refused the token (401)",
    });
    expect(testNote(refusedTest()).text).not.toContain("ghp_");
  });

  it("does not print an empty detail after the dash", () => {
    expect(testNote(refusedTest()).text).toContain(" — ");
    expect(
      testNote(testResult({ status: "failed", errorClass: "upstream", detail: "", reason: "tracker unavailable" })).text,
    ).toBe("tracker unavailable");
  });
});
