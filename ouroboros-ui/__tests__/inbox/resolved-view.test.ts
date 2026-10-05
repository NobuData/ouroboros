import { describe, expect, it } from "vitest";

import {
  ZERO_LINE,
  ZERO_NOTE,
  channelNote,
  dayLabel,
  emptyDayLine,
  isToday,
  parseDay,
  policyNote,
  resolvedHeading,
  summarySegments,
} from "@/app/inbox/resolved-view";

import { resolvedDay, resolvedRow, seededResolvedRows } from "../helpers/inbox";

/**
 * The resolved list's pure rules (#468): how a served row is drawn. The line itself is the
 * service's — composed from kind, refs and action — and none of these rules names a kind.
 */

describe("a day, read from something untrusted", () => {
  it("accepts a real date and nothing else", () => {
    expect(parseDay("2026-10-04")).toBe("2026-10-04");
    expect(parseDay("2024-02-29")).toBe("2024-02-29");
  });

  it.each([null, undefined, "", "today", "2026-10-4", "2026-13-01", "2026-02-31", "2026-10-04T00:00:00Z", "../etc"])(
    "reads %j as today",
    (value) => {
      expect(parseDay(value)).toBeNull();
    },
  );
});

describe("the heading", () => {
  it("is the mockup's *Resolved today · 5* for today", () => {
    expect(resolvedHeading(resolvedDay(), null)).toBe("Resolved today · 5");
  });

  it("names another day, with its count", () => {
    expect(
      resolvedHeading(resolvedDay({ day: "2026-10-02", rows: [resolvedRow()], nextDay: "2026-10-03" }), "2026-10-02"),
    ).toBe("Resolved Oct 2, 2026 · 1");
  });

  it("names the day asked for while it has not been read — and claims no count", () => {
    expect(resolvedHeading(null, null)).toBe("Resolved today");
    expect(resolvedHeading(null, "2026-09-30")).toBe("Resolved Sep 30, 2026");
  });

  it("knows today as the one day with no day after it", () => {
    expect(isToday(resolvedDay())).toBe(true);
    expect(isToday(resolvedDay({ nextDay: "2026-10-05" }))).toBe(false);
  });

  it("prints a day it cannot read as it was given", () => {
    expect(dayLabel("someday")).toBe("someday");
    expect(dayLabel("2026-01-09")).toBe("Jan 9, 2026");
  });
});

describe("a day with nothing resolved", () => {
  it("is one quiet line, naming the day", () => {
    expect(emptyDayLine(resolvedDay({ rows: [] }))).toBe("Nothing has been resolved today.");
    expect(emptyDayLine(resolvedDay({ day: "2026-10-03", rows: [], nextDay: "2026-10-04" }))).toBe(
      "Nothing was resolved on Oct 3, 2026.",
    );
  });
});

describe("the composed line's mono spans", () => {
  it("sets the mockup's keys in mono: #490 and #486", () => {
    expect(summarySegments("Split #490 into 6 tickets")).toEqual([
      { text: "Split ", mono: false },
      { text: "#490", mono: true },
      { text: " into 6 tickets", mono: false },
    ]);
    expect(summarySegments("Estimator re-size #486 L→M")).toEqual([
      { text: "Estimator re-size ", mono: false },
      { text: "#486", mono: true },
      { text: " L→M", mono: false },
    ]);
  });

  it("sets a path in mono, and leaves prose alone", () => {
    expect(summarySegments("One-time edit to boot/rollback_flag.c").at(-1)).toEqual({
      text: "boot/rollback_flag.c",
      mono: true,
    });
    expect(summarySegments("Waiver of “Flake must not reappear”")).toEqual([
      { text: "Waiver of “Flake must not reappear”", mono: false },
    ]);
    expect(summarySegments("")).toEqual([]);
  });

  it("gives every seeded subject back whole", () => {
    for (const row of seededResolvedRows()) {
      expect(
        summarySegments(row.subject)
          .map((segment) => segment.text)
          .join(""),
      ).toBe(row.subject);
    }
  });
});

describe("where an answer came from", () => {
  it("says so for mail and GitHub — and every other place that is not this page", () => {
    expect(channelNote(resolvedRow({ channel: "email" }))).toEqual({
      label: "email",
      title: "Answered from email by Ken Suenobu",
    });
    expect(channelNote(resolvedRow({ channel: "github" }))?.label).toBe("GitHub");
    expect(channelNote(resolvedRow({ channel: "slack" }))?.label).toBe("Slack");
    expect(channelNote(resolvedRow({ channel: "push" }))?.label).toBe("push");
    expect(channelNote(resolvedRow({ channel: "api" }))?.label).toBe("API");
  });

  it("leaves the web unsaid, and a policy's channel too — nobody answered from there", () => {
    expect(channelNote(resolvedRow({ channel: "web" }))).toBeNull();
    expect(channelNote(resolvedRow({ resolver: "policy", channel: "api", actor: null }))).toBeNull();
  });

  it("names nobody when the person is gone", () => {
    expect(channelNote(resolvedRow({ channel: "email", actor: null }))?.title).toBe("Answered from email");
  });
});

describe("the policy note", () => {
  const auto = seededResolvedRows().find((row) => row.resolver === "policy")!;

  it("names the rule that fired, the policy version it fired under, and where it is configured", () => {
    expect(policyNote(auto)).toEqual({ rule: "auto_accept_resize", version: 7, href: "/settings#policies" });
  });

  it("names no version the resolution did not record", () => {
    expect(policyNote({ ...auto, outcome: {} })?.version).toBeNull();
    expect(policyNote({ ...auto, outcome: { org_policy_version: "7" } })?.version).toBeNull();
  });

  it("is absent for a person's answer, and for a policy with nowhere to lead", () => {
    expect(policyNote(resolvedRow())).toBeNull();
    expect(policyNote({ ...auto, policy: "source_resolved", policyHref: null })).toBeNull();
    expect(policyNote({ ...auto, policy: null })).toBeNull();
  });

  it("never links off-site, whatever arrives", () => {
    expect(policyNote({ ...auto, policyHref: "https://evil.test/policies" })).toBeNull();
  });
});

describe("the zero card's copy", () => {
  it("is the mockup's two lines, verbatim", () => {
    expect(ZERO_LINE).toBe("Inbox zero. The loop is turning on its own.");
    expect(ZERO_NOTE).toBe("You'll be pinged only when policy says so.");
  });
});
