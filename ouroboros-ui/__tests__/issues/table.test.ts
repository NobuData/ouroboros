import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COLUMN_HEADERS,
  NEVER_SYNCED,
  SIZING,
  STATUS_LABEL,
  STATUS_TONE,
  SYNC_STARTED,
  TABLE_TITLE,
  UNESTIMATED,
  age,
  coverage,
  emptyKind,
  selectLabel,
  statusChanges,
  statusOf,
  syncOutcome,
  syncTooSoon,
  syncedLabel,
  tableRows,
} from "@/app/issues/table";

import {
  ESTIMATING_ROW,
  READ_AT,
  SEEDED_ROWS,
  SEEDED_SYNCED_AT,
  backlogListing,
  issueId,
} from "../helpers/issues";

/**
 * The backlog table's copy and its decisions (#117).
 *
 * The **copy** is compared with `docs/mockups/03-issues.html` itself: the card's title, the five
 * column headings, the `sizing…` placeholder and the four pill words — and the seeded rows against
 * the mockup's rows, one by one, with the two divergences the seed documents named rather than
 * hidden. The **decisions** are which pill a row wears, what an unsized row prints, the header
 * checkbox's coverage, which pills animate, what the freshness tag reads and what a sync press
 * came back as.
 */

/** The mockup this table is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "03-issues.html"),
  "utf8",
);

/** The mockup's table card alone — from its head to the selection bar that follows it. */
const CARD = MOCKUP.slice(
  MOCKUP.indexOf("<!-- main table + selection bar -->"),
  MOCKUP.indexOf("<!-- selection action bar -->"),
);

/**
 * Text as a reader sees it: tags dropped, `&nbsp;` read as a space, whitespace collapsed.
 *
 * @param html A fragment of the mockup.
 * @returns Its text.
 */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One row of the mockup's table, as the mockup draws it. */
interface MockupRow {
  readonly number: number;
  readonly title: string;
  readonly tags: readonly string[];
  readonly effort: string | null;
  readonly confidence: string | null;
  readonly workflow: string;
  readonly model: string;
  readonly status: string;
}

/**
 * The mockup's nine rows, parsed.
 *
 * @returns The rows, in the mockup's own hand-laid order.
 */
function mockupRows(): readonly MockupRow[] {
  const body = CARD.slice(CARD.indexOf("<tbody>"), CARD.indexOf("</tbody>"));

  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) => {
    const cells = [...row!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]!);
    const [, issue, effort, workflow, model, status] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const chip = /<span class="effort \w+">(\w+)<\/span><span class="conf">([\d%]+)<\/span>/.exec(effort);

    return {
      number: Number(/#(\d+)/.exec(issue)![1]),
      title: text(/<span class="title">([\s\S]*?)<\/span>/.exec(issue)![1]!),
      tags: [...issue.matchAll(/<span class="tag">([^<]*)<\/span>/g)].map((tag) => tag[1]!),
      effort: chip === null ? null : chip[1]!,
      confidence: chip === null ? null : chip[2]!,
      workflow: text(workflow),
      model: text(model),
      status: text(status),
    };
  });
}

/**
 * The seeded rows that the dashboard seed queues and the mockup does not, or the reverse. The
 * queue rows are DASH-F.5's and `R__dev_seed_intake.sql` argues why the two disagree.
 */
const QUEUE_DIVERGENCE = new Set([485, 489, 490, 491]);

describe("the copy, against the mockup", () => {
  it("takes the card's title verbatim, capitals being the card head's own treatment", () => {
    expect(TABLE_TITLE.toUpperCase()).toBe(text(/<span class="card-title">([\s\S]*?)<\/span>/.exec(CARD)![1]!));
  });

  it("takes the five column headings verbatim, in the mockup's order", () => {
    const headings = [...CARD.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((heading) => text(heading[1]!))
      .filter((heading) => heading !== "");

    expect(Object.values(COLUMN_HEADERS)).toEqual(headings);
  });

  it("takes the unsized placeholder verbatim", () => {
    expect(CARD).toContain(`>${SIZING}<`);
  });

  it("prints the four pills the mockup prints, in its words", () => {
    const pills = new Set(
      [...CARD.matchAll(/<span class="pill(?: \w+)?">([^<]*)<\/span>/g)].map((pill) => pill[1]!),
    );

    for (const status of ["sized", "queued", "estimating", "needs_human"] as const) {
      expect(pills).toContain(STATUS_LABEL[status]);
    }
  });

  it("names a row's checkbox by its issue number", () => {
    expect(selectLabel(485)).toBe("Select #485");
  });
});

describe("the seeded rows, against the mockup's", () => {
  const rows = tableRows(SEEDED_ROWS);

  it("draws every one of the mockup's nine issues, and no tenth", () => {
    expect(new Set(rows.map((row) => row.number))).toEqual(
      new Set(mockupRows().map((row) => row.number)),
    );
    expect(rows).toHaveLength(9);
  });

  it.each(mockupRows())("draws #$number as the mockup does", (expected) => {
    const row = rows.find((candidate) => candidate.number === expected.number)!;

    expect(row.title).toBe(expected.title);
    // The mockup's cell shows three of `#485`'s four labels; one issue has one label set, and the
    // seed stores the panel's — so the cell's tags are a prefix of the row's.
    expect(row.labels.slice(0, expected.tags.length)).toEqual(expected.tags);
    expect(row.effort).toBe(expected.effort);
    expect(row.confidence).toBe(expected.confidence);

    if (row.effort === null) {
      // The mockup's `#483` names a workflow and a model beside `sizing…`; an issue with no
      // estimate has neither to name, and the cells say so rather than inventing them.
      expect(row.workflow).toBeNull();
      expect(row.model).toBeNull();
    } else {
      expect(row.workflow).toBe(expected.workflow);
      expect(row.model).toBe(expected.model);
    }

    if (QUEUE_DIVERGENCE.has(row.number)) {
      // The queue rows are the dashboard seed's, and the pill follows the rows that exist.
      const mockupSizing = expected.status === "queued" ? "sized" : expected.status;
      const seeded = SEEDED_ROWS.find((candidate) => candidate.number === row.number)!;

      expect(STATUS_LABEL[seeded.sizingStatus]).toBe(mockupSizing);
    } else {
      expect(STATUS_LABEL[row.status]).toBe(expected.status);
    }
  });

  it("are in M.1's default order — chip order, confidence descending within a chip, the unsized last", () => {
    expect(rows.map((row) => row.effort)).toEqual(["XS", "S", "M", "M", "M", "L", "L", "XL", null]);
    expect(rows.map((row) => row.confidence)).toEqual([
      "98%", "95%", "92%", "88%", "78%", "84%", "71%", "61%", null,
    ]);
  });
});

describe("the status pill", () => {
  it("prefers queued to any sizing status — where the loop will pick the issue up is the newer fact", () => {
    expect(statusOf({ queued: true, sizingStatus: "needs_human" })).toBe("queued");
    expect(statusOf({ queued: true, sizingStatus: "estimating" })).toBe("queued");
  });

  it("is the sizing status otherwise", () => {
    for (const sizingStatus of ["unsized", "estimating", "sized", "needs_human"] as const) {
      expect(statusOf({ queued: false, sizingStatus })).toBe(sizingStatus);
    }
  });

  it("wears the ticket's map, with the fifth state neutral", () => {
    expect(STATUS_TONE).toEqual({
      sized: "neutral",
      queued: "accent",
      estimating: "warn",
      needs_human: "err",
      unsized: "neutral",
    });
  });

  it("says unsized in its own word rather than borrowing sized", () => {
    expect(STATUS_LABEL.unsized).toBe("unsized");
  });
});

describe("tableRows", () => {
  it("prints the effort in the chip's capitals and the confidence as a whole percentage", () => {
    const [xs] = tableRows([SEEDED_ROWS[0]!]);

    expect(xs).toMatchObject({ effort: "XS", confidence: "98%" });
    expect(tableRows([{ ...SEEDED_ROWS[0]!, estimate: { ...SEEDED_ROWS[0]!.estimate!, confidence: 91.6 } }])[0]!.confidence).toBe("92%");
  });

  it("draws an issue with no estimate as sizing, with nothing to name beside it", () => {
    const [row] = tableRows([ESTIMATING_ROW]);

    expect(row).toMatchObject({
      effort: null,
      confidence: null,
      workflow: null,
      model: null,
      estMinutes: null,
      status: "estimating",
    });
  });

  it("carries the estimate's minutes for the selection bar, drawn by no cell (#118)", () => {
    const rows = tableRows(SEEDED_ROWS);

    expect(rows.find((row) => row.number === 485)?.estMinutes).toBe(45);
    expect(rows.find((row) => row.number === 490)?.estMinutes).toBe(180);
  });

  it("keeps the listing's order and every row's id", () => {
    expect(tableRows(SEEDED_ROWS).map((row) => row.id)).toEqual(SEEDED_ROWS.map((row) => row.id));
  });
});

describe("coverage — the header's checkbox", () => {
  const page = [issueId(485), issueId(484), issueId(491)];

  it("is none with nothing on the page selected, and over an empty page", () => {
    expect(coverage(page, [])).toBe("none");
    expect(coverage(page, [issueId(483)])).toBe("none");
    expect(coverage([], page)).toBe("none");
  });

  it("is some with part of the page selected", () => {
    expect(coverage(page, [issueId(484)])).toBe("some");
  });

  it("is all with every row selected, whatever else is selected off the page", () => {
    expect(coverage(page, [issueId(483), ...page])).toBe("all");
  });
});

describe("statusChanges — the pills that animate", () => {
  const first = tableRows(SEEDED_ROWS);

  it("marks nothing on a first sight of the rows", () => {
    const { seen, swapped } = statusChanges(new Map(), first, new Set());

    expect(swapped.size).toBe(0);
    expect(seen.get(ESTIMATING_ROW.id)).toBe("estimating");
  });

  it("marks a row whose status moved, and keeps it marked", () => {
    const start = statusChanges(new Map(), first, new Set());
    const sized = tableRows([
      ...SEEDED_ROWS.slice(0, -1),
      { ...ESTIMATING_ROW, sizingStatus: "sized", estimate: SEEDED_ROWS[0]!.estimate },
    ]);

    const moved = statusChanges(start.seen, sized, start.swapped);
    expect([...moved.swapped]).toEqual([ESTIMATING_ROW.id]);

    const still = statusChanges(moved.seen, sized, moved.swapped);
    expect([...still.swapped]).toEqual([ESTIMATING_ROW.id]);
  });

  it("forgets a row that left the page, so its return is a first sight again", () => {
    const start = statusChanges(new Map(), first, new Set());
    const without = statusChanges(start.seen, first.slice(0, 3), start.swapped);

    expect(without.seen.has(ESTIMATING_ROW.id)).toBe(false);
  });
});

describe("the freshness tag", () => {
  it("counts in the coarsest unit that is still honest, rounding down", () => {
    expect(age(0)).toBe("0s");
    expect(age(40.9)).toBe("40s");
    expect(age(59)).toBe("59s");
    expect(age(60)).toBe("1m");
    expect(age(3599)).toBe("59m");
    expect(age(3600)).toBe("1h");
    expect(age(86_399)).toBe("23h");
    expect(age(86_400)).toBe("1d");
    expect(age(-5)).toBe("0s");
  });

  it("reads the mockup's own tag forty seconds after the seeded sync", () => {
    expect(syncedLabel(SEEDED_SYNCED_AT, READ_AT / 1000)).toBe(
      text(/<span class="tag">(synced[^<]*)<\/span>/.exec(CARD)![1]!),
    );
  });

  it("says never synced for a backlog no sync has stamped, or a stamp it cannot read", () => {
    expect(syncedLabel(null, READ_AT / 1000)).toBe(NEVER_SYNCED);
    expect(syncedLabel("yesterday", READ_AT / 1000)).toBe(NEVER_SYNCED);
  });
});

describe("a sync press", () => {
  it("that started a cycle says so", () => {
    expect(syncOutcome({ ...statusAt(), running: true })).toEqual({ ok: true, message: SYNC_STARTED });
  });

  it("over a paused loop carries the service's own sentence as the refusal", () => {
    expect(syncOutcome({ ...statusAt(), state: "paused", pause: "not_configured", message: "No token." })).toEqual({
      ok: false,
      reason: "No token.",
    });
  });

  it("refused as too soon says how long to wait, in whole seconds", () => {
    expect(syncTooSoon(12)).toBe("The backlog was synced moments ago. Try again in 12 seconds.");
    expect(syncTooSoon(0.4)).toBe("The backlog was synced moments ago. Try again in 1 second.");
  });

  it("refused as too soon with no usable wait says shortly", () => {
    for (const wait of [null, undefined, 0, -3, "12", Number.NaN]) {
      expect(syncTooSoon(wait)).toBe("The backlog was synced moments ago. Try again shortly.");
    }
  });
});

describe("emptyKind — which empty state a page with no rows is in", () => {
  it("is the filter's doing when the scope has open issues and something is filtered", () => {
    expect(emptyKind(backlogListing({ items: [], total: 0 }), true)).toBe("matches");
  });

  it("is the mirror's when nothing is filtered, or the scope has no open issues to match", () => {
    expect(emptyKind(backlogListing({ items: [], total: 0 }), false)).toBe("mirrored");
    expect(emptyKind(backlogListing({ items: [], total: 0, openCount: 0, sizedCount: 0 }), true)).toBe("mirrored");
  });
});

/**
 * A sync status, for the outcome cases.
 *
 * @returns An `ok` loop with a cycle in flight.
 */
function statusAt() {
  return {
    syncedAt: SEEDED_SYNCED_AT,
    state: "ok" as const,
    pause: null,
    message: null,
    retryAfterSeconds: null,
    running: true,
    repositories: [],
  };
}

/** The em dash the two estimate-less cells print — held here so a change is deliberate. */
describe("the unsized placeholders", () => {
  it("are the mockup's word for the effort and the design system's dash for the rest", () => {
    expect(SIZING).toBe("sizing…");
    expect(UNESTIMATED).toBe("—");
  });
});
