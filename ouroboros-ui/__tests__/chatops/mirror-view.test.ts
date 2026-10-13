import { describe, expect, it } from "vitest";

import {
  ACTION_TONES,
  COMPOSER_HINT,
  MIRROR_FRESH_READING,
  MIRROR_PARAM,
  PLAIN_TEXT_HINT,
  SENDING_LABEL,
  SEND_NEEDS_COMMAND,
  TODAY_LABEL,
  UNKNOWN_INITIALS,
  YESTERDAY_LABEL,
  archivedNote,
  cardSeverity,
  clockText,
  composerMode,
  composerPlaceholder,
  dayKey,
  dayLabel,
  entryKey,
  initials,
  isChatMirror,
  isInApp,
  mergeMirror,
  mirrorAddress,
  mirrorChannel,
  mirrorDays,
  mirrorEmptyNote,
  mirrorEndpoint,
  mirrorFreshness,
  mirrorMeta,
  mirrorName,
  removedNote,
  replyFailed,
  resolutionText,
  sendReason,
  showMirrorName,
  standingNote,
} from "@/app/chatops/view";

import {
  at,
  boundChannelList,
  buildGreen,
  channel,
  mirror,
  mirrorCard,
  mirrorCommand,
  mirrorLine,
  openQuestion,
  resolvedQuestion,
  unboundChannels,
} from "../helpers/chatops";

/**
 * What the channel mirror says and decides (#542), as data: where it is read from, which channel
 * shows, how history is held and grouped, how a record's parts are worded, and what the composer
 * will and will not send.
 */

describe("where a mirror is read from", () => {
  it("names the channel, and the cursor when there is one", () => {
    expect(mirrorEndpoint("channel-1")).toBe("/api/chatops/mirror?channel=channel-1");
    expect(mirrorEndpoint("channel-1", null)).toBe("/api/chatops/mirror?channel=channel-1");
    expect(mirrorEndpoint("channel-1", "")).toBe("/api/chatops/mirror?channel=channel-1");
    expect(mirrorEndpoint("channel-1", "a/b=")).toBe("/api/chatops/mirror?channel=channel-1&before=a%2Fb%3D");
  });

  it("keeps the channel in the page's address", () => {
    expect(MIRROR_PARAM).toBe("channel");
    expect(mirrorAddress("channel-1")).toBe("?channel=channel-1");
  });

  it("recognises a page of a mirror", () => {
    expect(isChatMirror(mirror())).toBe(true);
    expect(isChatMirror({ channel: mirror().channel })).toBe(false);
    expect(isChatMirror({ entries: [] })).toBe(false);
    expect(isChatMirror({ channel: null, entries: [] })).toBe(false);
    expect(isChatMirror(null)).toBe(false);
    expect(isChatMirror("mirror")).toBe(false);
  });
});

describe("which channel shows", () => {
  const list = boundChannelList();

  it("is the one the address names, when it is bound", () => {
    expect(mirrorChannel(list, list[1]!.id)?.name).toBe("helios-alerts");
  });

  it("is the first bound channel when the address names none, an unbound one or a stranger", () => {
    expect(mirrorChannel(list, null)?.name).toBe("ouroboros-loops");
    expect(mirrorChannel(list, list[2]!.id)?.name).toBe("ouroboros-loops");
    expect(mirrorChannel(list, "not-a-channel")?.name).toBe("ouroboros-loops");
  });

  it("is none while nothing is bound", () => {
    expect(mirrorChannel(unboundChannels(), unboundChannels()[0]!.id)).toBeNull();
    expect(mirrorChannel([], null)).toBeNull();
  });
});

describe("the head", () => {
  it("names the card and the row's way to it", () => {
    expect(mirrorName(channel("ouroboros-loops"))).toBe("Mirror of #ouroboros-loops");
    expect(showMirrorName(channel("helios-alerts"))).toBe("Show the mirror of #helios-alerts");
  });

  it("writes the meta line from what is known, and nothing for what is not", () => {
    expect(mirrorMeta(24, "v2.4")).toBe("24 members · Ouroboros app v2.4");
    expect(mirrorMeta(1, "2.4")).toBe("1 member · Ouroboros app v2.4");
    expect(mirrorMeta(null, "v2.4")).toBe("Ouroboros app v2.4");
    expect(mirrorMeta(24, null)).toBe("24 members");
    expect(mirrorMeta(24, " ")).toBe("24 members");
    expect(mirrorMeta(null, null)).toBeNull();
  });

  it("reads how long ago the mirror was read", () => {
    expect(mirrorFreshness(null, 1_000)).toBe(MIRROR_FRESH_READING);
    expect(mirrorFreshness(1_000_000, 1_012)).toBe("updated 12s ago");
    expect(mirrorFreshness(1_000_000, 1_180)).toBe("updated 3m ago");
    expect(mirrorFreshness(1_000_000, 990)).toBe("updated 0s ago");
  });
});

describe("the clock and the days", () => {
  it("writes an instant in twenty-four hours, in the reader's zone", () => {
    expect(clockText("2026-10-12T14:11:30.000Z", "UTC")).toBe("14:11");
    expect(clockText("2026-10-12T00:05:00.000Z", "UTC")).toBe("00:05");
    expect(clockText("2026-10-12T14:11:00.000Z", "Asia/Tokyo")).toBe("23:11");
    expect(clockText("not a stamp")).toBe("");
  });

  it("keys a day by where the reader is", () => {
    expect(dayKey(new Date("2026-10-12T23:30:00.000Z"), "UTC")).toBe("2026-10-12");
    expect(dayKey(new Date("2026-10-12T23:30:00.000Z"), "Asia/Tokyo")).toBe("2026-10-13");
  });

  it("names today and yesterday, and dates the rest", () => {
    const now = new Date("2026-10-12T14:00:00.000Z");

    expect(dayLabel(new Date("2026-10-12T01:00:00.000Z"), now, "UTC")).toBe(TODAY_LABEL);
    expect(dayLabel(new Date("2026-10-11T23:00:00.000Z"), now, "UTC")).toBe(YESTERDAY_LABEL);
    expect(dayLabel(new Date("2026-10-05T12:00:00.000Z"), now, "UTC")).toBe("Mon 5 Oct");
    expect(dayLabel(new Date("2025-12-31T12:00:00.000Z"), now, "UTC")).toBe("Wed 31 Dec 2025");
  });

  it("groups the stream by local day, oldest first", () => {
    const now = new Date(at("14:00"));
    const days = mirrorDays(
      [
        mirrorLine({ id: "a", at: at("22:00", "2026-10-10") }),
        mirrorLine({ id: "b", at: at("23:30", "2026-10-11") }),
        mirrorLine({ id: "c", at: at("00:10") }),
        mirrorLine({ id: "d", at: at("12:00") }),
      ],
      now,
      "UTC",
    );

    expect(days.map((day) => [day.key, day.label, day.entries.map((entry) => entry.id)])).toEqual([
      ["2026-10-10", "Sat 10 Oct", ["a"]],
      ["2026-10-11", YESTERDAY_LABEL, ["b"]],
      ["2026-10-12", TODAY_LABEL, ["c", "d"]],
    ]);

    // The same instants fall on other days for a reader elsewhere.
    expect(mirrorDays([mirrorLine({ id: "b", at: at("23:30", "2026-10-11") })], now, "Asia/Tokyo")[0]!.key).toBe("2026-10-12");
    expect(mirrorDays([], now)).toEqual([]);
  });
});

describe("what is held", () => {
  it("keys a card and a command apart, though their ids are rows of two tables", () => {
    expect(entryKey(mirrorCard({ id: "1" }))).toBe("card:1");
    expect(entryKey(mirrorCommand({ id: "1" }))).toBe("command:1");
  });

  it("adds what a page brings, replaces what it changed, and drops nothing", () => {
    const held = [mirrorCard(), openQuestion()];
    const merged = mergeMirror(held, [resolvedQuestion(), buildGreen()]);

    expect(merged.map((entry) => entry.id)).toEqual([mirrorCard().id, openQuestion().id, buildGreen().id]);
    expect(merged[1]).toEqual(resolvedQuestion());
  });

  it("orders by instant and then by id, whichever way the pages arrived", () => {
    const early = mirrorLine({ id: "b", at: at("09:00") });
    const twin = mirrorLine({ id: "a", at: at("09:00") });
    const late = mirrorLine({ id: "c", at: at("10:00") });

    expect(mergeMirror([late], [early, twin]).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(mergeMirror([], [])).toEqual([]);
  });
});

describe("a record's parts", () => {
  it("words a resolution: the outcome, the actor when there is one, and the time", () => {
    expect(resolutionText({ outcome: "allow once", actor: "Maya Chen", at: at("14:11") }, "UTC")).toBe(
      "resolved: allow once — Maya Chen (14:11)",
    );
    expect(resolutionText({ outcome: "auto-allowed", actor: null, at: at("14:11") }, "UTC")).toBe(
      "resolved: auto-allowed (14:11)",
    );
    expect(resolutionText({ outcome: "denied", actor: " ", at: "never" }, "UTC")).toBe("resolved: denied");
  });

  it("makes initials of a name, and a neutral mark of none", () => {
    expect(initials("Ken Suenobu")).toBe("KS");
    expect(initials("maya de la chen")).toBe("MC");
    expect(initials("Ken")).toBe("K");
    expect(initials("  ")).toBe(UNKNOWN_INITIALS);
    expect(initials(null)).toBe(UNKNOWN_INITIALS);
    expect(initials(undefined)).toBe(UNKNOWN_INITIALS);
  });

  it("tells a page of this app from an address outside it", () => {
    expect(isInApp("/prs/512")).toBe(true);
    expect(isInApp("/inbox?item=1")).toBe(true);
    expect(isInApp("https://github.com/acme/helios/pull/512")).toBe(false);
    expect(isInApp("//evil.example/x")).toBe(false);
  });

  it("maps an action's style to a button, and an unknown severity to the plain card", () => {
    expect(ACTION_TONES).toEqual({ primary: "primary", danger: "danger", default: "ghost" });
    expect(cardSeverity("warn")).toBe("warn");
    expect(cardSeverity("err")).toBe("err");
    expect(cardSeverity("quux")).toBe("info");
  });

  it("draws a refused or failed reply as a failure, and no other", () => {
    expect(["error", "denied", "unlinked"].map((outcome) => replyFailed(outcome as never))).toEqual([true, true, true]);
    expect(replyFailed("ok")).toBe(false);
    expect(replyFailed("async_pending")).toBe(false);
  });
});

describe("the card's states", () => {
  it("says what an empty mirror will hold", () => {
    expect(mirrorEmptyNote(channel("helios-alerts"))).toContain("#helios-alerts");
  });

  it("warns about a channel the bot was removed from, in #541's words for the invite", () => {
    expect(removedNote(channel("helios-alerts"))).toBe(
      "Ouroboros was removed from #helios-alerts, so nothing new is being posted there. In Slack, open the channel and send /invite @Ouroboros to bring it back.",
    );
    expect(standingNote(channel("helios-alerts", { joined: false }))).toBe(removedNote(channel("helios-alerts")));
  });

  it("warns about an archived channel, and about nothing in good standing", () => {
    expect(standingNote(channel("old-builds", { archived: true, joined: false }))).toBe(archivedNote(channel("old-builds")));
    expect(standingNote(channel("ouroboros-loops"))).toBeNull();
  });
});

describe("the composer", () => {
  it("offers the mockup's placeholder", () => {
    expect(composerPlaceholder(channel("ouroboros-loops"))).toBe("Message #ouroboros-loops — or /ouro …");
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["/", "prefix"],
    ["/ou", "prefix"],
    ["/OURO", "prefix"],
    ["/ouro ", "prefix"],
    ["/ouro status", "command"],
    ["/Ouro dry-run #486", "command"],
    ["hello", "plain"],
    ["/ourobouros", "plain"],
    ["/invite @Ouroboros", "plain"],
    ["status", "plain"],
  ] as const)("reads %j as %s", (text, mode) => {
    expect(composerMode(text)).toBe(mode);
  });

  it("says why Send cannot be pressed, and nothing when it can", () => {
    expect(sendReason("command", false)).toBeUndefined();
    expect(sendReason("command", true)).toBe(SENDING_LABEL);
    expect(sendReason("plain", false)).toBe(PLAIN_TEXT_HINT);
    expect(sendReason("empty", false)).toBe(SEND_NEEDS_COMMAND);
    expect(sendReason("prefix", false)).toBe(SEND_NEEDS_COMMAND);
    expect(COMPOSER_HINT).toContain("/ouro");
  });
});
