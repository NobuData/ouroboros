import { describe, expect, it } from "vitest";

import {
  BATCH_READ,
  CARD_UNREAD_NOTE,
  CATALOG_READ,
  CONNECT_TRACKER_MEMBER_NOTE,
  CONNECT_TRACKER_NOTE,
  HEALTH_READ,
  PLANNING_DEGRADED_HEADLINE,
  PLANNING_FAILED_HEADLINE,
  ROADMAP_READ,
  SOURCES_READ,
  SWEEP_NOTE,
  planningFailureReason,
  planningFailures,
  planningHeadline,
  planningReadCount,
  trackerState,
} from "@/app/planning/states";

import { planningBatch, planningReadings, writableCatalog } from "../helpers/planning";
import { catalogPayload, githubEntry, jiraSource, source, sourcePage } from "../helpers/sources";

/**
 * The planning page's states (AM.5, #287).
 *
 * The two claims this file exists for: a failed read is said **once** and is a different sentence
 * from an empty workspace, and *nothing to draft against* covers a workspace with no tracker and
 * one whose every tracker is read-only alike.
 */

/** A refusal, as `attempt` shapes one. */
function failed(reason: string) {
  return { ok: false as const, reason };
}

describe("the failed reads", () => {
  it("finds nothing wrong with a page that read everything", () => {
    expect(planningFailures(planningReadings())).toStrictEqual([]);
  });

  it("names each failed read in the page's own order", () => {
    const readings = planningReadings(failed("roadmap gone"), {
      health: failed("health gone"),
      batch: failed("batch gone"),
    });

    expect(planningFailures(readings).map((failure) => failure.what)).toStrictEqual([
      ROADMAP_READ,
      HEALTH_READ,
      BATCH_READ,
    ]);
  });

  it("carries the service's own sentence for each", () => {
    const readings = planningReadings(undefined, { sources: failed("Sources failed.") });
    const [failure] = planningFailures(readings);

    expect(failure).toStrictEqual({ what: SOURCES_READ, reason: "Sources failed." });
  });

  // A page with no `?batch=` made no batch read, so there is no batch read to have failed.
  it("does not count an absent batch as a failure", () => {
    const readings = planningReadings(undefined, { batch: null });

    expect(planningFailures(readings)).toStrictEqual([]);
    expect(planningReadCount(readings)).toBe(4);
  });

  it("counts the batch read when the address named one", () => {
    const readings = planningReadings(undefined, {
      batch: { ok: true, value: planningBatch() },
    });

    expect(planningReadCount(readings)).toBe(5);
  });

  it("joins the reasons into one sentence for the banner", () => {
    const reason = planningFailureReason([
      { what: ROADMAP_READ, reason: "gone" },
      { what: CATALOG_READ, reason: "also gone" },
    ]);

    expect(reason).toBe(`${ROADMAP_READ}: gone · ${CATALOG_READ}: also gone`);
  });

  it("answers an empty string for nothing, rather than throwing", () => {
    expect(planningFailureReason([])).toBe("");
  });
});

describe("the banner's headline", () => {
  it("says part of the page for a partial failure", () => {
    expect(planningHeadline([{ what: ROADMAP_READ, reason: "x" }], 4)).toBe(
      PLANNING_DEGRADED_HEADLINE,
    );
  });

  it("says the whole page when every read failed", () => {
    const all = [ROADMAP_READ, SOURCES_READ, CATALOG_READ, HEALTH_READ].map((what) => ({
      what,
      reason: "x",
    }));

    expect(planningHeadline(all, 4)).toBe(PLANNING_FAILED_HEADLINE);
  });

  it("never claims a total outage when the page made no reads", () => {
    expect(planningHeadline([], 0)).toBe(PLANNING_DEGRADED_HEADLINE);
  });

  it("points a quiet card at the banner rather than repeating the reason", () => {
    expect(CARD_UNREAD_NOTE).toContain("banner");
    expect(CARD_UNREAD_NOTE).toContain("retry");
  });
});

describe("whether anything can be drafted against", () => {
  it("is ready when a writable tracker is connected", () => {
    const sources = { ok: true as const, value: sourcePage([source()]) };

    expect(trackerState(sources, { ok: true, value: writableCatalog() })).toBe("ready");
  });

  it("is the guidance path for a workspace that has connected nothing", () => {
    const empty = { ok: true as const, value: sourcePage([]) };

    expect(trackerState(empty, { ok: true, value: writableCatalog() })).toBe("none-writable");
  });

  // The case the ticket's "no writable source" actually means most of the time.
  it("is the guidance path when every connected tracker is read-only", () => {
    const sources = { ok: true as const, value: sourcePage([source()]) };
    const readOnly = { ok: true as const, value: catalogPayload([githubEntry()]) };

    expect(trackerState(sources, readOnly)).toBe("none-writable");
  });

  it("is the guidance path when the only connected kind has no provider in this build", () => {
    const sources = { ok: true as const, value: sourcePage([jiraSource()]) };

    expect(trackerState(sources, { ok: true, value: writableCatalog() })).toBe("none-writable");
  });

  it("says nothing at all when either read failed", () => {
    const sources = { ok: true as const, value: sourcePage([source()]) };

    expect(trackerState(failed("no sources"), { ok: true, value: writableCatalog() })).toBe("unread");
    expect(trackerState(sources, failed("no catalog"))).toBe("unread");
  });
});

describe("the copy", () => {
  // The contract binds a batch to a tracker at generation, not at push — so the note has to say
  // *filed*, or a reader told only "push is disabled" expects to be able to draft.
  it("explains that a draft is filed against a tracker, not merely pushed to one", () => {
    expect(CONNECT_TRACKER_NOTE).toContain("filed");
    expect(CONNECT_TRACKER_NOTE).not.toContain("push");
  });

  it("names who can connect one, for a reader who cannot", () => {
    expect(CONNECT_TRACKER_MEMBER_NOTE).toContain("owners and admins");
  });

  it("explains the sizing queue without inventing a duration", () => {
    expect(SWEEP_NOTE).toContain("queue");
    expect(SWEEP_NOTE).not.toMatch(/\d/);
  });
});
