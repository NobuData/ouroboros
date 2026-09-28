import { describe, expect, it } from "vitest";

import type { PrThreadEntry } from "@/app/api/pull-requests";
import {
  AUTHOR_KINDS,
  BLOCKING_PILL,
  ENTRY_RESOLVED,
  ENTRY_RESOLVED_MIRRORED,
  MIRROR_LINK,
  WAS_BLOCKING_PILL,
  entryRow,
  entryStanding,
  entryTag,
  isOpen,
  resolveOutcome,
  threadCard,
  threadHeader,
  withResolved,
  withheldNote,
} from "@/app/prs/thread";

import {
  ATTEMPT_4_REPLY,
  MIRROR_COMMENT_URL,
  mockupEntries,
  prPage,
  resolution,
  thread,
  threadEntry,
  threadEntryId,
  threadPage,
} from "../helpers/pull-requests";

/**
 * The Review thread card's rules (#368): the header counted from the rows, provenance as a
 * condition of rendering, the blocking → resolved arc read off the row's lifecycle, and what an
 * answer on this page changes until a read catches up.
 */

/**
 * The card for some entries.
 *
 * @param entries The entries.
 * @param mayContribute Whether the reader may resolve.
 * @returns The card.
 */
function cardOf(entries: readonly PrThreadEntry[], mayContribute = true) {
  return threadCard({ page: threadPage(entries), entries, mayContribute });
}

describe("the header", () => {
  it("counts the mockup's thread as 3 entries · 0 open", () => {
    expect(threadHeader(mockupEntries())).toBe("3 entries · 0 open");
  });

  it("counts open as blocking and unresolved — nothing else", () => {
    expect(isOpen(threadEntry({ blocking: true, resolved: false }))).toBe(true);
    expect(isOpen(threadEntry({ blocking: true, resolved: true }))).toBe(false);
    expect(isOpen(threadEntry({ blocking: false, resolved: false }))).toBe(false);
    expect(isOpen(threadEntry({ blocking: false, resolved: true }))).toBe(false);
  });

  it("says 1 entry, and 0 entries", () => {
    expect(threadHeader([threadEntry()])).toBe("1 entry · 1 open");
    expect(threadHeader([])).toBe("0 entries · 0 open");
  });

  it("is computed from the rows, whatever counts the payload carries", () => {
    const entries = [...mockupEntries(), threadEntry()];
    const page = prPage({ thread: thread(entries, { entryCount: 99, openCount: 42 }) });

    expect(threadCard({ page, entries: page.thread.entries, mayContribute: false }).header).toBe(
      "4 entries · 1 open",
    );
  });
});

describe("provenance", () => {
  it("draws a watermarked model entry, the policy bot's and a person's", () => {
    for (const entry of [...mockupEntries(), threadEntry()]) {
      expect(entryStanding(entry)).toBe("drawn");
    }
  });

  it("refuses a model entry without the watermark", () => {
    expect(entryStanding(threadEntry({ authorKind: "model", simulated: false }))).toBe(
      "unwatermarked_model",
    );
  });

  it("refuses a model entry whose watermark is missing or not a boolean", () => {
    const missing = { ...threadEntry({ authorKind: "model" }), simulated: undefined };
    const truthy = { ...threadEntry({ authorKind: "model" }), simulated: "yes" };

    expect(entryStanding(missing as unknown as PrThreadEntry)).toBe("unwatermarked_model");
    expect(entryStanding(truthy as unknown as PrThreadEntry)).toBe("unwatermarked_model");
  });

  it("refuses an entry with no author name, or a kind this page does not know", () => {
    expect(entryStanding(threadEntry({ authorName: "  " }))).toBe("unknown_author");
    expect(
      entryStanding(threadEntry({ authorKind: "agent" as PrThreadEntry["authorKind"] })),
    ).toBe("unknown_author");
    expect(
      entryStanding(threadEntry({ authorKind: "toString" as PrThreadEntry["authorKind"] })),
    ).toBe("unknown_author");
  });

  it("withholds what it refuses, says so, and still counts it — open included", () => {
    const forged = threadEntry({
      id: threadEntryId(9),
      authorKind: "model",
      authorName: "gpt-reviewer",
      simulated: false,
      blocking: true,
    });
    const card = cardOf([...mockupEntries(), forged]);

    expect(card.rows.map((row) => row.author)).not.toContain("gpt-reviewer");
    expect(card.rows).toHaveLength(3);
    expect(card.header).toBe("4 entries · 1 open");
    expect(card.withheld).toBe(withheldNote(1));
    expect(card.withheld).toContain("1 entry is withheld");
    expect(card.empty).toBe(false);
  });

  it("says nothing about withholding when nothing was, and counts more than one", () => {
    expect(withheldNote(0)).toBeNull();
    expect(cardOf(mockupEntries()).withheld).toBeNull();
    expect(withheldNote(2)).toContain("2 entries are withheld");
  });

  it("names each kind in words", () => {
    expect(AUTHOR_KINDS).toEqual({ model: "model", policy_bot: "policy bot", human: "person" });
  });
});

describe("the rows", () => {
  it("draws the mockup's three entries, oldest first", () => {
    const [second, self, policy] = cardOf(mockupEntries()).rows;

    expect(second).toMatchObject({
      author: "cursor/composer-2",
      kind: "model",
      tag: "second opinion · rev 1",
      simulated: true,
      time: "14:12:44",
      blocking: true,
      pill: { label: WAS_BLOCKING_PILL },
      reply: ATTEMPT_4_REPLY,
      resolved: true,
      resolve: false,
    });
    expect(self).toMatchObject({
      author: "claude-fable-5",
      tag: "self-review",
      simulated: true,
      time: "14:29:07",
      blocking: false,
      pill: null,
      reply: null,
      resolved: true,
    });
    expect(policy).toMatchObject({
      author: "ouroboros policy bot",
      kind: "policy_bot",
      kindLabel: "policy bot",
      tag: "policy",
      simulated: false,
      time: "14:31:52",
      pill: null,
      resolved: false,
      resolve: false,
    });
    expect(policy!.body).toContain("no human review required for effort ≤ M");
  });

  it("names the revision only when the entry is about an earlier one", () => {
    expect(entryTag(threadEntry({ revisionSeq: 1 }), 2)).toBe("second opinion · rev 1");
    expect(entryTag(threadEntry({ revisionSeq: 2 }), 2)).toBe("second opinion");
    expect(entryTag(threadEntry({ revisionSeq: null }), 2)).toBe("second opinion");
    expect(entryTag(threadEntry({ revisionSeq: 1 }), null)).toBe("second opinion · rev 1");
  });

  it("marks an unanswered objection as blocking", () => {
    expect(entryRow(threadEntry(), 2, true)).toMatchObject({
      blocking: true,
      pill: { label: BLOCKING_PILL },
      resolved: false,
      reply: null,
    });
  });

  it("leaves the time out for a moment that is not a date", () => {
    expect(entryRow(threadEntry({ createdAt: "soon" }), 2, true).time).toBeNull();
  });

  it("offers Reply & resolve on an unresolved entry to a reader who may contribute", () => {
    expect(entryRow(threadEntry(), 2, true).resolve).toBe(true);
    expect(entryRow(threadEntry({ blocking: false }), 2, true).resolve).toBe(true);
    expect(
      entryRow(threadEntry({ authorKind: "model", simulated: true }), 2, true).resolve,
    ).toBe(true);
  });

  it("offers it to no viewer, on no resolved entry, and never on the policy bot's", () => {
    expect(entryRow(threadEntry(), 2, false).resolve).toBe(false);
    expect(entryRow(threadEntry({ resolved: true }), 2, true).resolve).toBe(false);
    expect(entryRow(threadEntry({ authorKind: "policy_bot" }), 2, true).resolve).toBe(false);
  });

  it("is empty for a PR with no entry", () => {
    expect(cardOf([])).toEqual({
      header: "0 entries · 0 open",
      rows: [],
      withheld: null,
      empty: true,
    });
  });
});

describe("what this page just resolved", () => {
  const open = threadEntry();
  const answered = resolution(open, "Overflow path fixed.").entry;

  it("draws the answer in the entry's place, and the open count follows", () => {
    const entries = withResolved(thread([open]), [{ entry: answered, at: 2_000 }], 1_000);

    expect(entries).toEqual([answered]);
    expect(threadHeader(entries)).toBe("1 entry · 0 open");
  });

  it("stands before the poll's first answer", () => {
    expect(withResolved(thread([open]), [{ entry: answered, at: 2_000 }], null)).toEqual([
      answered,
    ]);
  });

  it("gives way to a read made after it", () => {
    expect(withResolved(thread([open]), [{ entry: answered, at: 2_000 }], 3_000)).toEqual([open]);
  });

  it("never adds an entry the thread does not hold", () => {
    const stranger = { entry: threadEntry({ id: threadEntryId(8) }), at: 2_000 };

    expect(withResolved(thread([open]), [stranger], 1_000)).toEqual([open]);
  });
});

describe("what a resolution did", () => {
  const open = threadEntry();

  it("says the entry is resolved", () => {
    expect(resolveOutcome(resolution(open, null))).toEqual({
      text: ENTRY_RESOLVED,
      failed: false,
      link: null,
    });
  });

  it("links the mirrored comment when the host said where it is", () => {
    expect(
      resolveOutcome(
        resolution(open, "Fixed.", { state: "posted", url: MIRROR_COMMENT_URL, error: null }),
      ),
    ).toEqual({
      text: ENTRY_RESOLVED_MIRRORED,
      failed: false,
      link: { label: MIRROR_LINK, href: MIRROR_COMMENT_URL },
    });
  });

  it("draws no link for a comment with no address, or one a browser would execute", () => {
    for (const url of [null, "javascript:alert(1)"]) {
      expect(
        resolveOutcome(resolution(open, "Fixed.", { state: "posted", url, error: null })).link,
      ).toBeNull();
    }
  });

  it("says the reply was not posted, with the host's reason, as a failure", () => {
    expect(
      resolveOutcome(
        resolution(open, "Fixed.", {
          state: "failed",
          url: null,
          error: { code: "host_rate_limit", message: "The host is rate limiting requests." },
        }),
      ),
    ).toEqual({
      text: "Entry resolved · the reply was not posted on the PR: The host is rate limiting requests.",
      failed: true,
      link: null,
    });
    expect(
      resolveOutcome(resolution(open, "Fixed.", { state: "failed", url: null, error: null })).text,
    ).toContain("the host did not say why");
  });
});
