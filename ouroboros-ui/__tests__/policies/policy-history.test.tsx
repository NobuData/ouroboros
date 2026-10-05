import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  HISTORY_CLOSE,
  HISTORY_EMPTY,
  HISTORY_LOADING,
  HISTORY_OLDER,
  HISTORY_TITLE,
  type HistoryResult,
  NO_NOTE,
  type PolicyVersionEntry,
  historyTrigger,
} from "@/app/policies/card-view";
import type { PolicyDocument } from "@/app/policies/document";
import {
  HISTORY_RETRY,
  IN_FORCE,
  LOAD_OLDER_TO_COMPARE,
  NO_RULE_CHANGES,
  PolicyVersionTag,
} from "@/app/policies/policy-history";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The version tag and its history, rendered (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)): mockup 17's `policy v7` opens a real
 * v6 → v7 diff from the seeded story — one rule, auto-merge turned on — with its note and
 * publisher; older versions page in; a failed read can be retried; and every opening re-reads.
 */

/** `schemas/org-policy/fixtures/valid/policy-v7.json` — the seeded policy v7. */
const V7_DOCUMENT = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "schemas", "org-policy", "fixtures", "valid", "policy-v7.json"),
    "utf8",
  ),
) as PolicyDocument;

/** v6: the same document before auto-merge was turned on. */
const V6_DOCUMENT: PolicyDocument = {
  ...V7_DOCUMENT,
  auto_merge: { ...V7_DOCUMENT.auto_merge, enabled: false },
};

const V7: PolicyVersionEntry = {
  version: 7,
  publishedAt: "2026-10-04T13:48:00.000Z",
  publishedBy: "user-ken",
  publisherName: "Ken",
  changeNote: "Enable auto-merge",
  classification: "loosening",
  changes: [
    { ruleId: "auto_merge", classification: "loosening", verb: "enabled", summary: "enabled auto-merge" },
  ],
  summary: "enabled auto-merge (policy v7)",
  document: V7_DOCUMENT,
};

const V6: PolicyVersionEntry = {
  version: 6,
  publishedAt: "2026-09-28T09:05:00.000Z",
  publishedBy: null,
  publisherName: null,
  changeNote: null,
  classification: "tightening",
  changes: [
    {
      ruleId: "spend_guard",
      classification: "tightening",
      verb: "changed",
      summary: "changed spend guard",
    },
  ],
  summary: "changed spend guard (policy v6)",
  document: V6_DOCUMENT,
};

const V5: PolicyVersionEntry = {
  ...V6,
  version: 5,
  changes: [],
  classification: "neutral",
  summary: "no rule changed (policy v5)",
  document: {
    ...V6_DOCUMENT,
    spend_guard: { enabled: true, conditions: { per_run_cap_cents: 500 } },
  },
};

/**
 * A page of history, as the action answers it.
 *
 * @param items The versions.
 * @param nextBefore The next page's `before`.
 * @returns The answer.
 */
function page(items: readonly PolicyVersionEntry[], nextBefore: number | null = null): HistoryResult {
  return { ok: true, page: { items, nextBefore } };
}

/**
 * Draw the tag.
 *
 * @param loadHistory The history read.
 * @param version The version in force.
 * @returns The read spy.
 */
function draw(
  loadHistory: (before?: number) => Promise<HistoryResult> = vi.fn(() => Promise.resolve(page([V7, V6]))),
  version: number | null = 7,
) {
  render(<PolicyVersionTag loadHistory={loadHistory} version={version} />);

  return loadHistory;
}

/** The tag's button. */
function trigger(): HTMLElement {
  return screen.getByRole("button", { name: historyTrigger(7) });
}

/**
 * Press something, and let what it asked for settle.
 *
 * @param element What to press.
 */
async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

/**
 * One version's entry in the open dialog.
 *
 * @param version The version.
 * @returns Its list item.
 */
function entry(version: number): HTMLElement {
  return screen.getByRole("heading", { level: 3, name: `v${String(version)}` }).closest("li") as HTMLElement;
}

describe("the tag", () => {
  it("is mockup 17's `policy v7`, a button that says what it opens", () => {
    draw();

    expect(trigger()).toHaveTextContent(/^policy v7$/);
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveClass("ou-tag");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads nothing until it is opened", () => {
    const load = draw();

    expect(load).not.toHaveBeenCalled();
  });

  it("is text, with nothing to open, for a workspace that has published nothing", () => {
    const load = draw(vi.fn(), null);

    expect(screen.getByText("not published")).toHaveClass("ou-tag");
    expect(screen.queryByRole("button")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <PolicyVersionTag loadHistory={() => Promise.resolve(page([]))} version={7} />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("the history", () => {
  it("says it is reading while the first page is on its way", async () => {
    let answer: (result: HistoryResult) => void = () => {};
    draw(() => new Promise<HistoryResult>((resolve) => (answer = resolve)));

    await press(trigger());

    const dialog = screen.getByRole("dialog", { name: HISTORY_TITLE });
    expect(within(dialog).getByRole("status")).toHaveTextContent(HISTORY_LOADING);

    await act(async () => {
      answer(page([V7, V6]));
    });

    expect(within(dialog).queryByText(HISTORY_LOADING)).toBeNull();
    expect(entry(7)).toBeInTheDocument();
  });

  it("draws the seeded v6 → v7 diff: auto-merge loosened from off to on, with its chips", async () => {
    const load = draw();

    await press(trigger());

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(undefined);

    const v7 = within(entry(7));

    expect(v7.getByText(IN_FORCE)).toBeInTheDocument();
    expect(v7.getByText("Ken · 2026-10-04 13:48 UTC")).toBeInTheDocument();
    expect(v7.getByText("Enable auto-merge").tagName).toBe("Q");
    expect(v7.getByText("enabled auto-merge (policy v7)")).toBeInTheDocument();
    expect(v7.getByRole("heading", { level: 4 })).toHaveTextContent("v6 → v7");

    const rules = v7.getAllByRole("listitem");
    expect(rules).toHaveLength(1);

    const rule = within(rules[0]);
    expect(rule.getByText("Auto-merge when all gates green")).toBeInTheDocument();
    expect(rule.getByText("Loosens")).toBeInTheDocument();
    expect(rule.getByText("— enabled auto-merge")).toBeInTheDocument();

    const before = rule.getByText("Before").closest("div") as HTMLElement;
    const after = rule.getByText("After").closest("div") as HTMLElement;

    expect(within(before).getByText("off")).toBeInTheDocument();
    expect(within(before).getByText("effort ≤ M")).toHaveClass("ou-tag");
    expect(within(before).getByText("non-refactor")).toHaveClass("ou-tag");
    expect(within(after).getByText("on")).toBeInTheDocument();
    expect(within(after).getByText("effort ≤ M")).toBeInTheDocument();
    expect(within(after).getByText("non-refactor")).toBeInTheDocument();
  });

  it("lists versions newest first, and marks only the one in force", async () => {
    draw();

    await press(trigger());

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["v7", "v6"]);
    expect(screen.getAllByText(IN_FORCE)).toHaveLength(1);
    expect(within(entry(6)).queryByText(IN_FORCE)).toBeNull();
  });

  it("says so when a version has no note, and names a removed publisher as a former member", async () => {
    draw();

    await press(trigger());

    const v6 = within(entry(6));
    expect(v6.getByText(NO_NOTE)).toBeInTheDocument();
    expect(v6.getByText("a former member · 2026-09-28 09:05 UTC")).toBeInTheDocument();
  });

  it("draws only the after side, and says why, while the version before is not loaded", async () => {
    draw(vi.fn(() => Promise.resolve(page([V7, V6], 6))));

    await press(trigger());

    const v6 = within(entry(6));
    expect(v6.getByText(LOAD_OLDER_TO_COMPARE)).toBeInTheDocument();
    expect(v6.getByText("pause loop at $2.50/run")).toBeInTheDocument();
    expect(v6.queryByText("pause loop at $5/run")).toBeNull();
  });

  it("pages older versions in, which resolves the comparison that was waiting for them", async () => {
    const load = vi.fn((before?: number) =>
      Promise.resolve(before === undefined ? page([V7, V6], 6) : page([V5])),
    );
    draw(load);

    await press(trigger());
    await press(screen.getByRole("button", { name: HISTORY_OLDER }));

    expect(load).toHaveBeenLastCalledWith(6);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "v7",
      "v6",
      "v5",
    ]);

    const v6 = within(entry(6));
    expect(v6.queryByText(LOAD_OLDER_TO_COMPARE)).toBeNull();
    expect(v6.getByText("pause loop at $5/run")).toBeInTheDocument();
    expect(v6.getByText("Tightens")).toBeInTheDocument();

    // v5 changed no rule, and is the oldest page: nothing further to load.
    expect(within(entry(5)).getByText(NO_RULE_CHANGES)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: HISTORY_OLDER })).toBeNull();
  });

  it("keeps what is loaded and says why when an older page cannot be read", async () => {
    const load = vi.fn((before?: number) =>
      Promise.resolve<HistoryResult>(
        before === undefined ? page([V7, V6], 6) : { ok: false, reason: "The service is restarting." },
      ),
    );
    draw(load);

    await press(trigger());
    await press(screen.getByRole("button", { name: HISTORY_OLDER }));

    expect(screen.getByRole("alert")).toHaveTextContent("The service is restarting.");
    expect(entry(7)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: HISTORY_OLDER })).toBeInTheDocument();
  });

  it("says a failed read's reason and reads again on retry", async () => {
    const load = vi
      .fn<(before?: number) => Promise<HistoryResult>>()
      .mockResolvedValueOnce({ ok: false, reason: "The policy history could not be read." })
      .mockResolvedValueOnce(page([V7, V6]));
    draw(load);

    await press(trigger());

    expect(screen.getByRole("alert")).toHaveTextContent("The policy history could not be read.");
    expect(screen.queryByRole("list")).toBeNull();

    await press(screen.getByRole("button", { name: HISTORY_RETRY }));

    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(entry(7)).toBeInTheDocument();
  });

  it("turns a read that rejects into a failure the reader can retry", async () => {
    draw(vi.fn(() => Promise.reject(new Error("offline"))));

    await press(trigger());

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be read/);
    expect(screen.getByRole("button", { name: HISTORY_RETRY })).toBeInTheDocument();
  });

  it("says nothing has been published when the history is empty", async () => {
    draw(vi.fn(() => Promise.resolve(page([]))));

    await press(trigger());

    expect(screen.getByRole("status")).toHaveTextContent(HISTORY_EMPTY);
  });

  it("closes, and re-reads on the next opening — the history may have grown", async () => {
    const load = vi
      .fn<(before?: number) => Promise<HistoryResult>>()
      .mockResolvedValueOnce(page([V6]))
      .mockResolvedValueOnce(page([V7, V6]));
    draw(load);

    await press(trigger());
    expect(screen.queryByRole("heading", { level: 3, name: "v7" })).toBeNull();

    await press(screen.getByRole("button", { name: HISTORY_CLOSE }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await press(trigger());

    expect(load).toHaveBeenCalledTimes(2);
    expect(entry(7)).toBeInTheDocument();
  });

  it("drops an answer that arrives after the dialog closed", async () => {
    const answers: ((result: HistoryResult) => void)[] = [];
    const load = vi.fn(() => new Promise<HistoryResult>((resolve) => answers.push(resolve)));
    draw(load);

    await press(trigger());
    await press(screen.getByRole("button", { name: HISTORY_CLOSE }));
    await press(trigger());

    // The first opening's answer arrives late: it is not this opening's.
    await act(async () => {
      answers[0](page([V5]));
    });
    expect(screen.getByRole("status")).toHaveTextContent(HISTORY_LOADING);

    await act(async () => {
      answers[1](page([V7, V6]));
    });
    expect(screen.queryByRole("heading", { level: 3, name: "v5" })).toBeNull();
    expect(entry(7)).toBeInTheDocument();
  });

  it("asks for an older page once, however fast the button is pressed", async () => {
    const answers: ((result: HistoryResult) => void)[] = [];
    const load = vi.fn((before?: number) =>
      before === undefined
        ? Promise.resolve(page([V7, V6], 6))
        : new Promise<HistoryResult>((resolve) => answers.push(resolve)),
    );
    draw(load);

    await press(trigger());

    const older = screen.getByRole("button", { name: HISTORY_OLDER });
    fireEvent.click(older);
    fireEvent.click(older);

    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      answers[0](page([V5]));
    });
    expect(entry(5)).toBeInTheDocument();
  });
});
