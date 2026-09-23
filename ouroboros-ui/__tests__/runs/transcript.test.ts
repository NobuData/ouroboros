import { describe, expect, it } from "vitest";

import { deliveryChip } from "@/app/runs/controls";
import {
  STEER_CAPTION,
  STEER_PLACEHOLDER,
  type SentSteer,
  actorLabel,
  announcement,
  byteSize,
  clockTime,
  droppedText,
  elisionText,
  entryView,
  filterEntries,
  filterNote,
  liveSeq,
  placeSteers,
  readHunks,
  readProgress,
  readResult,
  steerChip,
} from "@/app/runs/transcript";

import { runControl, seededEntries } from "../helpers/runs";

/**
 * The transcript's rules (#312), without rendering: every treatment read from a field, payloads
 * checked where they are drawn, the live entry, the elision marker, the stage filter, and a
 * steer placed optimistically then onto the service's mirror.
 */

/**
 * The local clock reading of an instant, computed the way the page does — so the suite passes
 * in any time zone.
 *
 * @param iso The instant.
 * @returns `HH:MM:SS`.
 */
function local(iso: string): string {
  const at = new Date(iso);
  return [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

describe("the seeded nine", () => {
  const views = seededEntries().map((entry) => entryView(entry));

  it("draw the mockup's chips, tags and head notes in order", () => {
    expect(views.map((view) => [view.actorLabel, view.tag, view.headNote])).toEqual([
      ["PLAN", null, null],
      ["TOOL", "read_file", null],
      ["CLAUDE-FABLE-5", null, null],
      ["TOOL", "edit_file", "drivers/can/telemetry_buf.c"],
      ["TOOL", "run_tests", null],
      ["GATE", null, null],
      ["CLAUDE-FABLE-5", null, null],
      ["TOOL", "edit_file", "drivers/can/isr_fastpath.c"],
      ["TOOL", "run_tests", "twister -T tests/telemetry --load-profile"],
    ]);
  });

  it("set each body the mockup's way — plan faint, tool mono, model reasoning, gate warn", () => {
    expect(views.map((view) => view.bodyStyle)).toEqual([
      "faint",
      "mono",
      "reason",
      "mono",
      "mono",
      "warn",
      "reason",
      "mono",
      "mono",
    ]);
    expect(views[3]!.body).toBeNull();
    expect(views[5]!.body).toBe("test flake reproduced — returning to implement (attempt 2) ↺");
  });

  it("print the time in the reader's clock", () => {
    const entries = seededEntries();
    views.forEach((view, index) => expect(view.time).toBe(local(entries[index]!.ts)));
  });

  it("draw the diff with minus-sign and plus marks, the code unmarked", () => {
    expect(views[3]!.diff).toEqual([
      { kind: "ctx", mark: " ", text: "/* telemetry frame path */" },
      { kind: "del", mark: "−", text: "static struct k_fifo tel_fifo;" },
      { kind: "add", mark: "+", text: "K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), CONFIG_TEL_QUEUE_DEPTH, 4);" },
    ]);
  });

  it("colour the flaky result by its stored severity", () => {
    expect(views[4]!.result).toEqual({ text: "2 passed, 1 flaked → retrying under load profile", tone: "warn" });
  });

  it("divide the live entry's fraction for its meter", () => {
    expect(views[8]!.progress).toEqual({ text: "running… 47/63 cases", percent: 74 });
  });
});

describe("clockTime", () => {
  it("prints HH:MM:SS locally, and nothing for an unreadable instant", () => {
    expect(clockTime("2026-09-19T12:02:11.000Z")).toBe(local("2026-09-19T12:02:11.000Z"));
    expect(clockTime("not a date")).toBe("");
  });
});

describe("payload readers", () => {
  it("accept only well-formed hunks", () => {
    expect(readHunks({ hunks: [{ kind: "add", text: "x" }] })).toEqual([{ kind: "add", mark: "+", text: "x" }]);
    expect(readHunks({ hunks: [] })).toBeNull();
    expect(readHunks({ hunks: [{ kind: "rename", text: "x" }] })).toBeNull();
    expect(readHunks({ hunks: [{ kind: "add", text: 3 }] })).toBeNull();
    expect(readHunks(null)).toBeNull();
    expect(readHunks("hunks")).toBeNull();
  });

  it("read severities, and draw an unknown one neutral rather than guessing", () => {
    expect(readResult({ result: "3 passed", severity: "ok" })?.tone).toBe("ok");
    expect(readResult({ result: "boom", severity: "error" })?.tone).toBe("err");
    expect(readResult({ result: "3 passed, 0 failed" })?.tone).toBe("neutral");
    expect(readResult({ result: "" })).toBeNull();
    expect(readResult({ severity: "warn" })).toBeNull();
  });

  it("read a fraction only when it is one", () => {
    expect(readProgress({ progress: { done: 3, total: 4 } }, "lint")).toEqual({ text: "3/4", percent: 75 });
    expect(readProgress({ progress: { done: 5, total: 4 } }, "run_tests")).toBeNull();
    expect(readProgress({ progress: { done: 1, total: 0 } }, "run_tests")).toBeNull();
    expect(readProgress({ progress: { done: -1, total: 4 } }, "run_tests")).toBeNull();
    expect(readProgress({ progress: "47/63" }, "run_tests")).toBeNull();
  });

  it("leave an entry's body where it is when its payload is unrecognised", () => {
    const view = entryView({ seq: 1, ts: "2026-09-19T12:00:00Z", actor: "tool", toolTag: "x", body: "cmd", payload: { odd: 1 }, simulated: false });

    expect(view.body).toBe("cmd");
    expect(view.headNote).toBeNull();
    expect(view.diff).toBeNull();
  });
});

describe("actorLabel", () => {
  it("names a model entry by its model, and says so plainly without one", () => {
    expect(actorLabel({ actor: "model", modelId: "claude-fable-5" })).toBe("CLAUDE-FABLE-5");
    expect(actorLabel({ actor: "model" })).toBe("MODEL");
    expect(actorLabel({ actor: "user" })).toBe("USER");
    expect(actorLabel({ actor: "system" })).toBe("SYSTEM");
  });
});

describe("the elision marker", () => {
  it("states what was elided, how much, and when", () => {
    const text = elisionText({ events: 37, bytes: 421_888, from: "2026-09-19T12:02:11Z", to: "2026-09-19T12:09:30Z" });

    expect(text).toBe(
      `37 entries (412.0 KB) were not kept — the transcript's cap refused them between ` +
        `${local("2026-09-19T12:02:11Z")} and ${local("2026-09-19T12:09:30Z")}.`,
    );
    expect(elisionText({ events: 1, bytes: 10, from: "2026-09-19T12:02:11Z", to: "2026-09-19T12:02:11Z" })).toMatch(/^1 entry \(10 B\)/);
  });

  it("is carried by the entry's view, apart from any body", () => {
    const view = entryView({
      seq: 4,
      ts: "2026-09-19T12:00:00Z",
      actor: "system",
      simulated: false,
      elision: { events: 2, bytes: 2048, from: "2026-09-19T12:00:00Z", to: "2026-09-19T12:01:00Z" },
    });

    expect(view.elision).toMatch(/^2 entries \(2\.0 KB\) were not kept/);
    expect(view.actorLabel).toBe("SYSTEM");
  });

  it("sizes bytes as a person reads them", () => {
    expect(byteSize(812)).toBe("812 B");
    expect(byteSize(12_698)).toBe("12.4 KB");
    expect(byteSize(3_250_586)).toBe("3.1 MB");
  });
});

describe("droppedText", () => {
  it("says how many older entries left the card and where they still are", () => {
    expect(droppedText(1)).toBe("1 earlier entry is not shown here — Raw JSONL has all of them.");
    expect(droppedText(120)).toBe("120 earlier entries are not shown here — Raw JSONL has all of them.");
  });
});

describe("the stage filter", () => {
  it("keeps the stage's entries, or all of them", () => {
    const entries = seededEntries();

    expect(filterEntries(entries, "implement").map((entry) => entry.seq)).toEqual([2, 3, 4, 5, 7, 8, 9]);
    expect(filterEntries(entries, "checks-green").map((entry) => entry.seq)).toEqual([6]);
    expect(filterEntries(entries, null)).toBe(entries);
    expect(filterNote("Implement", 7, 9)).toBe("Showing Implement only — 7 of 9 entries.");
  });
});

describe("liveSeq", () => {
  it("is the newest entry while it is running, and nothing otherwise", () => {
    const entries = seededEntries();

    expect(liveSeq(entries)).toBe(9);
    expect(liveSeq(entries.slice(0, 8))).toBeNull();
    expect(liveSeq([])).toBeNull();
  });
});

describe("steering", () => {
  const steer: SentSteer = {
    localId: -1,
    text: "prefer a fix inside the ISR",
    sentAt: "2026-09-19T12:13:00.000Z",
    afterSeq: 9,
    control: null,
    failure: null,
  };

  it("chips a steer sending, sent, acknowledged in the ack's words — or refused", () => {
    expect(steerChip(steer, undefined).label).toBe("Steer · sending");

    const queued = runControl({ kind: "steer", state: "pending" });
    expect(steerChip({ ...steer, control: queued }, undefined).label).toBe("Steer · sent");
    expect(
      steerChip({ ...steer, control: queued }, { ...queued, state: "acked", detail: "steering applied to attempt 2" }),
    ).toEqual(deliveryChip("steer", "acked", "steering applied to attempt 2"));
    expect(steerChip({ ...steer, failure: "Only a member may steer." }, undefined).label).toBe(
      "Steer · Only a member may steer.",
    );
  });

  it("draws an unmirrored steer at the end as an optimistic USER entry, chip and all", () => {
    const entries = seededEntries();
    const chips = new Map([[-1, deliveryChip("steer", "sending")]]);

    const placed = placeSteers(entries.map((entry) => entryView(entry)), entries, [steer], chips);

    const last = placed.at(-1)!;
    expect(placed).toHaveLength(10);
    expect(last).toMatchObject({ key: -1, actorLabel: "USER", body: steer.text });
    expect(last.chip?.label).toBe("Steer · sending");
  });

  it("moves the chip onto the service's mirror once it arrives, and draws no optimistic copy", () => {
    const entries = [
      ...seededEntries(),
      { seq: 10, ts: "2026-09-19T12:13:01.000Z", actor: "user" as const, stageKey: "implement", attempt: 2, body: steer.text, simulated: false },
    ];
    const chips = new Map([[-1, deliveryChip("steer", "acked", "steering applied to attempt 2")]]);

    const placed = placeSteers(entries.map((entry) => entryView(entry)), entries, [steer], chips);

    expect(placed).toHaveLength(10);
    expect(placed.at(-1)).toMatchObject({ key: 10, actorLabel: "USER" });
    expect(placed.at(-1)!.chip?.label).toBe("Steer · acknowledged");
  });

  it("does not claim an older entry with the same words", () => {
    const entries = [
      { seq: 3, ts: "2026-09-19T12:00:00.000Z", actor: "user" as const, body: steer.text, simulated: false },
    ];
    const chips = new Map([[-1, deliveryChip("steer", "pending")]]);

    const placed = placeSteers(entries.map((entry) => entryView(entry)), entries, [{ ...steer, afterSeq: 3 }], chips);

    expect(placed[0]!.chip).toBeNull();
    expect(placed.at(-1)!.key).toBe(-1);
  });

  it("hides optimistic steers while a stage filter is on", () => {
    const entries = seededEntries();
    const placed = placeSteers([], entries, [steer], new Map(), false);

    expect(placed).toEqual([]);
  });

  it("keeps the mockup's placeholder, and no Slack in the caption until #318", () => {
    expect(STEER_PLACEHOLDER).toBe('Steer the loop — e.g. "prefer a fix inside the ISR; do not touch the test timeouts"');
    expect(STEER_CAPTION).toBe("Steering nudges the current attempt without pausing it.");
    expect(STEER_CAPTION).not.toMatch(/slack/i);
  });
});

describe("announcement", () => {
  it("counts what a poll brought, and says nothing when it brought nothing", () => {
    expect(announcement(0)).toBe("");
    expect(announcement(1)).toBe("1 new transcript entry");
    expect(announcement(4)).toBe("4 new transcript entries");
  });
});
