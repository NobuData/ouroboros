import { sourceRecordViolations } from "../tools/research-tool.citations";
import { clipBytes, entryContentHash, entrySource, sourceTitle } from "./history-index.sources";
import { entry } from "./history-index.store.fixture";

/** History-index entries as citations (CL.5, #618) — held to V108's rules. */

const AT = new Date("2026-09-30T12:00:00Z");

describe("an entry's citation", () => {
  const ticket = entry({
    locator: "issue-index://support/SUP-2214",
    ref: "SUP-2214",
    title: "Docking aborts on coastal sites",
    body: "Customer reports the unit aborting docking in moderate wind.",
    labels: ["docking"],
    repo: "helios-firmware",
    url: "https://support.example.com/tickets/SUP-2214",
  });

  it("is a ticket source the ledger accepts", () => {
    const source = entrySource(ticket, AT, null, { query: { op: "get" } });

    expect(sourceRecordViolations(source)).toEqual([]);
    expect(source).toEqual({
      kind: "ticket",
      title: "SUP-2214 — Docking aborts on coastal sites",
      locator: "issue-index://support/SUP-2214",
      retrievedAt: "2026-09-30T12:00:00.000Z",
      contentHash: entryContentHash(ticket),
      excerpt: "Customer reports the unit aborting docking in moderate wind.",
      meta: {
        entry: "ticket",
        set: "support",
        ref: "SUP-2214",
        occurredAt: "2026-08-01T00:00:00.000Z",
        state: "open",
        labels: ["docking"],
        repo: "helios-firmware",
        url: "https://support.example.com/tickets/SUP-2214",
        query: { op: "get" },
      },
    });
  });

  it("archives the matching passage when a search found one, and the title when there is no text", () => {
    expect(entrySource(ticket, AT, "aborting docking", {}).excerpt).toBe("aborting docking");
    expect(entrySource({ ...ticket, body: null }, AT, "  ", {}).excerpt).toBe(ticket.title);
  });

  it("hashes everything read, so an edited entry is a different citation", () => {
    expect(entryContentHash(ticket)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entryContentHash(ticket)).toBe(entryContentHash({ ...ticket }));
    expect(entryContentHash({ ...ticket, body: "edited" })).not.toBe(entryContentHash(ticket));
    expect(entryContentHash({ ...ticket, state: "closed" })).not.toBe(entryContentHash(ticket));
    expect(entryContentHash({ ...ticket, labels: [] })).not.toBe(entryContentHash(ticket));
  });

  it("stays inside V108's bounds for an entry of any size", () => {
    const huge = {
      ...ticket,
      title: "t".repeat(512),
      body: "é".repeat(200000),
      labels: Array.from({ length: 100 }, (_unused, n) => `${String(n)}-${"l".repeat(250)}`),
      url: `https://support.example.com/${"p".repeat(2000)}`,
    };
    const source = entrySource(huge, AT, null, {
      query: { op: "search", q: "q".repeat(500), labels: Array(20).fill("f".repeat(255)) },
      buckets: Object.fromEntries(
        Array.from({ length: 8 }, (_unused, n) => [`${"b".repeat(250)}${String(n)}`, n]),
      ),
    });

    expect(sourceRecordViolations(source)).toEqual([]);
    expect(source.title).toHaveLength(300);
    expect(Buffer.byteLength(source.excerpt, "utf8")).toBeLessThanOrEqual(4096);
    // Too much detail to keep: cited by identity alone.
    expect(source.meta).toEqual({
      entry: "ticket",
      set: "support",
      ref: "SUP-2214",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("titles a PR, a set and a document as a person would", () => {
    expect(sourceTitle({ ...ticket, kind: "pr", ref: "#512", title: "dock: retry" })).toBe(
      "PR #512 — dock: retry",
    );
    expect(
      sourceTitle({ ...ticket, kind: "document_set", title: "Support churn interviews Q2" }),
    ).toBe("Support churn interviews Q2");
    expect(sourceTitle({ ...ticket, kind: "document", title: "Churn interview — Northwind" })).toBe(
      "Churn interview — Northwind",
    );
  });
});

describe("clipBytes", () => {
  it("keeps text inside the bound and cuts the rest on a character boundary", () => {
    expect(clipBytes("short", 4096)).toBe("short");

    const cut = clipBytes("日本語".repeat(1000), 100);

    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(100);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toContain("�");

    const astral = clipBytes("😀".repeat(100), 21);

    expect(Buffer.byteLength(astral, "utf8")).toBeLessThanOrEqual(21);
    expect(astral).toMatch(/^(😀)+…$/u);
  });
});
