import type { ChatCard } from "../chat/chat.card";
import { ARCHETYPES, UI_URL } from "../chat/chat.fixture";
import { at, commandRow, messageRow } from "./chat.mirror.fixture";
import { inAppHref, mirrorActions, toMirrorCard, toMirrorCommand } from "./chat.mirror.resources";

/**
 * The mirror's wire shapes (#542): a card model becomes an entry with nothing reworded, its
 * links become in-app paths, and its answer buttons become links to the inbox item.
 */

describe("inAppHref", () => {
  it.each([
    [`${UI_URL}/prs/abc`, "/prs/abc"],
    [`${UI_URL}/inbox?item=1#x`, "/inbox?item=1#x"],
    [UI_URL, "/"],
    // The dev seed stores a bare path; the binding stores an absolute URL. Both are in-app.
    ["/workflows/feature-loop/copilot", "/workflows/feature-loop/copilot"],
    ["https://ci.example.test/1", "https://ci.example.test/1"],
    // An origin that merely starts the same is somewhere else.
    [`${UI_URL}.evil.test/x`, `${UI_URL}.evil.test/x`],
  ])("reads %s as %s", (url, href) => {
    expect(inAppHref(url, UI_URL)).toBe(href);
    expect(inAppHref(url, `${UI_URL}/`)).toBe(href);
  });
});

describe("mirrorActions", () => {
  it("turns answers into links to the inbox item, keeping their labels and styles", () => {
    expect(
      mirrorActions(ARCHETYPES.question, { uiUrl: UI_URL, answerHref: "/inbox?item=1" }),
    ).toEqual(
      expect.arrayContaining([
        { id: "allow_once", label: "Allow once", href: "/inbox?item=1", style: "primary" },
        { id: "deny", label: "Deny", href: "/inbox?item=1", style: "default" },
      ]),
    );
  });

  it("never carries a signed value, and never an absolute URL", () => {
    const actions = mirrorActions(ARCHETYPES.question, {
      uiUrl: UI_URL,
      answerHref: "/inbox?item=1",
    });

    expect(JSON.stringify(actions)).not.toContain("signed:");
    expect(actions.every((action) => /^\/(?!\/)/.test(action.href))).toBe(true);
  });

  it("drops an answer with nowhere to lead, and a link off the UI origin", () => {
    const card: ChatCard = {
      ...ARCHETYPES.question,
      actions: [
        { type: "answer", id: "allow_once", label: "Allow once", style: "primary", value: "v" },
        { type: "link", id: "elsewhere", label: "Elsewhere", url: "https://other.example.test/x" },
        { type: "link", id: "scheme", label: "Scheme-relative", url: "//other.example.test/x" },
        { type: "link", id: "here", label: "Here", url: `${UI_URL}/runs/1` },
      ],
    };

    expect(mirrorActions(card, { uiUrl: UI_URL, answerHref: null })).toEqual([
      { id: "here", label: "Here", href: "/runs/1", style: "default" },
    ]);
  });
});

describe("toMirrorCard", () => {
  it("carries the card model's words through untouched", () => {
    const card = ARCHETYPES.loop_finished;
    const entry = toMirrorCard(messageRow("m-1", at("13:58")), card, { uiUrl: UI_URL });

    expect(entry).toMatchObject({
      severity: card.severity,
      mark: card.mark,
      headline: card.headline,
      lines: card.lines,
      stats: card.stats,
      footnote: card.footnote,
      // Only a decision card has a state.
      state: null,
      resolution: null,
    });
  });

  it("reads a decision card with no state as open", () => {
    const row = messageRow("m-2", at("14:07"), { kind: "decision_card", card_kind: "k" });

    expect(toMirrorCard(row, ARCHETYPES.question, { uiUrl: UI_URL }).state).toBe("open");
  });
});

describe("toMirrorCommand", () => {
  it("dates an at-once reply by when the command finished", () => {
    const entry = toMirrorCommand(commandRow("c-1", at("14:12")), UI_URL);

    expect(entry.reply?.at).toBe("2026-10-11T14:12:01.000Z");
    expect(entry.result).toBeNull();
  });

  it.each([
    ["while it is pending", { outcome: "async_pending", completed_at: null } as const],
    ["once it left a result", { settled_reply: { text: "Done." }, completed_at: at("14:20") }],
    [
      "once its settlement named a result message",
      { result_ref: { result_message: "m" }, completed_at: at("14:20") },
    ],
  ])("dates an async command's acknowledgement by when it was typed, %s", (_when, overrides) => {
    expect(toMirrorCommand(commandRow("c-1", at("14:12"), overrides), UI_URL).reply?.at).toBe(
      "2026-10-11T14:12:00.000Z",
    );
  });
});
