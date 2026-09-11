import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKSPACE_PARAM } from "@/app/login/view";
import { DEFAULT_FILTER, isFiltered } from "@/app/issues/filter";
import {
  CHECK_AGAIN_LABEL,
  CLEAR_TITLE,
  FIRST_SYNC_TITLE,
  NO_REPOS_TITLE,
  NO_TOKEN_TITLE,
  OPEN_SETTINGS_SOON,
  PAUSE_HEADLINE,
  SYNC_UNREAD_HEADLINE,
  UNEXPLAINED_PAUSE,
  chooseReposHref,
  firstSyncProgress,
  guidanceKind,
  resumesIn,
  syncBanner,
} from "@/app/issues/states";

import {
  PAUSE_MESSAGES,
  SEEDED_SYNCED_AT,
  SYNCED,
  UNSYNCED,
  UNSYNCED_REASON,
  backlogListing,
  paused,
  synced,
} from "../helpers/issues";

/**
 * The intake screen's guidance states — the decisions and the copy (#120).
 *
 * Which of the six states a page with no rows is in, decided from the listing, the filter and
 * M.4's status in the order the module argues; what the banner says over the rows, and when it
 * stays away because the empty state already says it; the wait as a sentence; and the copy held
 * to the ticket's own words where the ticket writes them.
 */

/** The contract, for the pause vocabulary the headlines must cover. */
const CONTRACT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "ouroboros-rest", "openapi.yaml"),
  "utf8",
);

/** A listing with no rows, in a scope that has nothing open. */
const EMPTY = backlogListing({ items: [], total: 0, openCount: 0, sizedCount: 0 });

/** A listing with no rows on the page, in a scope that has open issues — a narrowed view. */
const NARROWED = backlogListing({ items: [], total: 0 });

/** A filter that differs from the default view. */
const FILTERED = { ...DEFAULT_FILTER, labels: ["docs"] };

describe("guidanceKind — which state a page with no rows is in", () => {
  it("is the filter's doing first, whatever the sync is doing", () => {
    expect(guidanceKind(NARROWED, isFiltered(FILTERED), SYNCED)).toBe("matches");
    expect(guidanceKind(NARROWED, true, paused("not_configured"))).toBe("matches");
    expect(guidanceKind(NARROWED, true, UNSYNCED)).toBe("matches");
  });

  it("is no token over a workspace with none, before anything else the status could say", () => {
    expect(guidanceKind(EMPTY, false, paused("not_configured"))).toBe("no-token");
    // A filter over an empty workspace is not the problem; the token is.
    expect(guidanceKind(EMPTY, true, paused("not_configured"))).toBe("no-token");
  });

  it("is no repos over a token pointed at nothing", () => {
    expect(guidanceKind(EMPTY, false, paused("no_repositories"))).toBe("no-repos");
  });

  it("is the first sync while a cycle is running over a backlog never stamped", () => {
    expect(guidanceKind(EMPTY, false, synced({ running: true, syncedAt: null }))).toBe("first-sync");
  });

  it("is clear only over a loop that is running and has synced at least once", () => {
    expect(guidanceKind(EMPTY, false, synced({ syncedAt: SEEDED_SYNCED_AT }))).toBe("clear");
    expect(guidanceKind(EMPTY, false, synced({ running: true, syncedAt: SEEDED_SYNCED_AT }))).toBe("clear");
  });

  it("is the plain nothing yet for a pause the banner explains, a loop that never ran, or a status unread", () => {
    for (const pause of ["rate_limited", "unauthorized", "not_found", "upstream_error"] as const) {
      expect(guidanceKind(EMPTY, false, paused(pause))).toBe("mirrored");
    }
    expect(guidanceKind(EMPTY, false, synced({ syncedAt: null }))).toBe("mirrored");
    expect(guidanceKind(EMPTY, false, UNSYNCED)).toBe("mirrored");
  });

  it("reads the seeded personal workspace — enabled repositories, no token — as no token", () => {
    // `R__dev_seed_intake.sql` gives `kensuenobu` two enabled repositories and no mirrored issue,
    // and no seed writes a token; M.4 ranks the missing token first, and so does this.
    expect(guidanceKind(EMPTY, false, paused("not_configured"))).toBe("no-token");
  });
});

describe("syncBanner — what sits over the rows", () => {
  it("is nothing over a loop that is running normally", () => {
    expect(syncBanner(SYNCED, null, 9)).toEqual({ kind: "none" });
    expect(syncBanner(SYNCED, "clear", 0)).toEqual({ kind: "none" });
    expect(syncBanner(SYNCED, "matches", 9)).toEqual({ kind: "none" });
  });

  it("names the pause as the headline and carries the service's own sentence under it", () => {
    expect(syncBanner(paused("rate_limited", { retryAfterSeconds: 1180 }), null, 9)).toEqual({
      kind: "paused",
      pause: "rate_limited",
      headline: PAUSE_HEADLINE.rate_limited,
      reason: PAUSE_MESSAGES.rate_limited,
      retryAfterSeconds: 1180,
    });
  });

  it("carries a wait only beside a rate limit, and only when the service knows one", () => {
    expect(syncBanner(paused("rate_limited"), null, 9)).toMatchObject({ retryAfterSeconds: null });
    expect(syncBanner(paused("upstream_error", { retryAfterSeconds: 30 }), null, 9)).toMatchObject({
      retryAfterSeconds: null,
    });
  });

  it("stays away when the empty state is already the guidance for the pause", () => {
    expect(syncBanner(paused("not_configured"), "no-token", 0)).toEqual({ kind: "none" });
    expect(syncBanner(paused("no_repositories"), "no-repos", 0)).toEqual({ kind: "none" });
  });

  it("is drawn for the same pauses over rows, and over a narrowed view", () => {
    // A token cleared after a sync: the rows are still there, and the banner says why the tag
    // has stopped moving.
    expect(syncBanner(paused("not_configured"), null, 9)).toMatchObject({ kind: "paused" });
    expect(syncBanner(paused("no_repositories"), "matches", 9)).toMatchObject({ kind: "paused" });
  });

  it("falls back to a guard sentence for a pause the service gave no sentence for", () => {
    expect(syncBanner(paused("upstream_error", { message: null }), null, 9)).toMatchObject({
      reason: UNEXPLAINED_PAUSE,
    });
  });

  it("reports the first sync's progress over rows, and not where the empty state already does", () => {
    const first = synced({ running: true, syncedAt: null });

    expect(syncBanner(first, null, 120)).toEqual({ kind: "first-sync", message: firstSyncProgress(120) });
    expect(syncBanner(first, "matches", 120)).toMatchObject({ kind: "first-sync" });
    expect(syncBanner(first, "first-sync", 0)).toEqual({ kind: "none" });
  });

  it("says the status could not be read, with the reason, whatever the card draws", () => {
    expect(syncBanner(UNSYNCED, null, 9)).toEqual({ kind: "unread", reason: UNSYNCED_REASON });
    expect(syncBanner(UNSYNCED, "mirrored", 0)).toEqual({ kind: "unread", reason: UNSYNCED_REASON });
  });
});

describe("the headlines", () => {
  it("cover every pause the contract can answer, each naming its reason in words", () => {
    const enumerated = /pause:\s*\n\s*type: \[string, "null"\]\s*\n\s*enum:\s*\n\s*\[([\s\S]*?)\]/.exec(CONTRACT)![1]!;
    const pauses = enumerated
      .split(",")
      .map((word) => word.trim())
      .filter((word) => word !== "" && word !== "null");

    expect(Object.keys(PAUSE_HEADLINE).sort()).toEqual([...pauses].sort());
    for (const headline of Object.values(PAUSE_HEADLINE)) {
      expect(headline).toMatch(/^Sync paused — .+\.$/);
      expect(headline).not.toMatch(/something went wrong/i);
    }
  });

  it("say what is unread and what the control does, in words", () => {
    expect(SYNC_UNREAD_HEADLINE).toBe("The sync status could not be read.");
    expect(CHECK_AGAIN_LABEL).toBe("Check again");
  });
});

describe("resumesIn — the wait as a sentence", () => {
  it("counts minutes, rounding up, so the banner never promises sooner than the guard does", () => {
    expect(resumesIn(1180)).toBe("Resumes in about 20 minutes.");
    expect(resumesIn(60)).toBe("Resumes in about 1 minute.");
    expect(resumesIn(61)).toBe("Resumes in about 2 minutes.");
  });

  it("counts seconds under a minute", () => {
    expect(resumesIn(40)).toBe("Resumes in 40 seconds.");
    expect(resumesIn(0.2)).toBe("Resumes in 1 second.");
  });

  it("says any moment now once the wait has elapsed on the reader's clock", () => {
    expect(resumesIn(0)).toBe("Resumes any moment now.");
    expect(resumesIn(-15)).toBe("Resumes any moment now.");
  });
});

describe("the copy", () => {
  it("is the ticket's own where the ticket writes it", () => {
    expect(NO_TOKEN_TITLE).toBe("Connect GitHub to watch your backlog");
    expect(NO_REPOS_TITLE).toMatch(/^Enable an org and repos to begin$/);
    expect(FIRST_SYNC_TITLE).toBe("First sync running");
    expect(CLEAR_TITLE).toBe("Backlog clear");
    expect(firstSyncProgress(120)).toBe("First sync running — 120 open issues so far…");
    expect(firstSyncProgress(1)).toBe("First sync running — 1 open issue so far…");
  });

  it("names the issue that unblocks the settings control, rather than linking nowhere", () => {
    expect(OPEN_SETTINGS_SOON).toContain("#141");
  });

  it("sends Choose repos to sign-in's step 2, opened on the workspace", () => {
    expect(chooseReposHref("acme-robotics")).toBe(`/login?${WORKSPACE_PARAM}=acme-robotics`);
    expect(chooseReposHref("a b")).toBe(`/login?${WORKSPACE_PARAM}=a%20b`);
  });
});
