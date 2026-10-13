import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMirror, ChatMirrorEntry } from "@/app/api/chatops-mirror";
import type { MirrorCardProps } from "@/app/chatops/mirror-card";
import {
  APP_TAG,
  BOT_NAME,
  COMPOSER_HINT,
  COMPOSER_LABEL,
  CONSOLE_SURFACE_MARK,
  EARLIER_FAILED,
  ESCALATED_MARK,
  LOADING_EARLIER_LABEL,
  LOAD_EARLIER_LABEL,
  MIRROR_EMPTY_TITLE,
  MIRROR_FRESH_TITLE,
  MIRROR_LABEL,
  MIRROR_READING,
  MIRROR_STALE_HEADLINE,
  MIRROR_TIP_LABEL,
  MIRROR_TOOLTIP,
  MIRROR_UNREAD,
  PENDING_NOTE,
  PLAIN_TEXT_HINT,
  PLATFORM_SEGMENT_LABEL,
  SENDING_LABEL,
  SEND_LABEL,
  SEND_NEEDS_COMMAND,
  STREAM_LABEL,
  TEAMS_REASON,
  TODAY_LABEL,
  UNKNOWN_AUTHOR,
  UNKNOWN_INITIALS,
  YESTERDAY_LABEL,
  clockText,
  mirrorEmptyNote,
  removedNote,
  resolutionText,
} from "@/app/chatops/view";

import { signedIn } from "../helpers/account";
import {
  CHATOPS_READ_AT,
  at,
  buildGreen,
  channel,
  deferred,
  freshMirror,
  mirror,
  mirrorCard,
  mirrorCommand,
  mirrorLine,
  openQuestion,
  pendingDryRun,
  resolvedQuestion,
} from "../helpers/chatops";
import { completions, consoleActions, resetConsoleActions, result } from "../helpers/console";
import { settle } from "../helpers/settle";

/**
 * The channel mirror (#542): the head that says what the card is, every entry treatment drawn
 * from its record and from nothing else, history paged backwards by day, a poll that brings new
 * records in place, and a composer that runs commands and says why it sends nothing else.
 */

vi.mock("@/app/api/auth-client", async () => (await import("../helpers/account")).authClientModule());
vi.mock("@/app/shell/console-actions", async () => (await import("../helpers/console")).consoleActionsModule());

const { MirrorCard } = await import("@/app/chatops/mirror-card");

/** The channel the card is of. */
const LOOPS = channel("ouroboros-loops", { purpose: "loops" });

beforeEach(() => {
  resetConsoleActions();
  signedIn();
});

/**
 * A reader that answers one page for every ask.
 *
 * @param page The page.
 * @returns The mock.
 */
function answering(page: ChatMirror = mirror()) {
  return vi.fn().mockResolvedValue(freshMirror(page));
}

/**
 * The card.
 *
 * @param read How the latest page is read.
 * @param over What differs.
 * @returns The element.
 */
function Mirror(read: MirrorCardProps["poll"] = { read: answering() }, over: Partial<MirrorCardProps> = {}) {
  return (
    <MirrorCard appVersion="v2.4" channel={LOOPS} poll={{ visible: () => true, ...read }} readAt={CHATOPS_READ_AT} {...over} />
  );
}

/**
 * The card on one page of entries, once the page has been drawn.
 *
 * @param entries The entries.
 * @param over What else differs on the page.
 * @returns The stream.
 */
async function showing(entries: ChatMirrorEntry[], over: Partial<ChatMirror> = {}): Promise<HTMLElement> {
  render(Mirror({ read: answering(mirror({ entries, ...over })) }));
  await waitFor(() => expect(screen.queryByText(MIRROR_READING)).toBeNull());

  return stream();
}

/** The stream's scroller. */
function stream(): HTMLElement {
  return screen.getByRole("log", { name: STREAM_LABEL });
}

/** The composer's box. */
function box(): HTMLInputElement {
  return screen.getByRole("combobox", { name: COMPOSER_LABEL });
}

/** **Send**, whatever it currently reads. */
function send(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^(${SEND_LABEL}|${SENDING_LABEL})$`) });
}

/**
 * Type into the composer.
 *
 * @param text What the box should hold.
 */
function type(text: string): void {
  fireEvent.change(box(), { target: { value: text } });
}

describe("the head", () => {
  it("names the channel, its platform, its members and the app, from connection truth", async () => {
    render(Mirror());

    const card = screen.getByRole("region", { name: "Mirror of #ouroboros-loops" });

    expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent("#ouroboros-loops");
    expect(within(card).getByText("Slack", { selector: ".ou-tag" })).toBeInTheDocument();
    expect(await within(card).findByText("24 members · Ouroboros app v2.4")).toBeInTheDocument();
  });

  it("leaves out whichever half of the meta line is not known, and never a placeholder", async () => {
    const quiet = channel("ouroboros-loops", { purpose: "loops", memberCount: null });

    const { unmount } = render(
      Mirror({ read: answering(mirror({ channel: quiet, appVersion: null })) }, { channel: quiet, appVersion: null }),
    );
    await screen.findByText(clockText(at("11:58")));
    expect(document.querySelector(".chatops-mirror__members")).toBeNull();
    unmount();

    render(Mirror({ read: answering(mirror({ channel: quiet })) }, { channel: quiet, appVersion: null }));
    expect(await screen.findByText("Ouroboros app v2.4")).toBeInTheDocument();
    expect(screen.queryByText(/members/)).toBeNull();
  });

  it("says it is a mirror, and what that means", () => {
    render(Mirror());

    const chip = screen.getByText(MIRROR_LABEL, { selector: ".chatops-mirror__chip" });
    const tip = screen.getByRole("button", { name: MIRROR_TIP_LABEL });

    expect(MIRROR_TOOLTIP).toBe(
      "this is Ouroboros's record of what it published — the conversation lives in Slack",
    );
    expect(chip).toHaveAttribute("title", MIRROR_TOOLTIP);
    expect(screen.getByRole("note")).toHaveTextContent(MIRROR_TOOLTIP);
    expect(tip).toHaveAttribute("aria-describedby", screen.getByRole("note").id);
  });

  it("shows Teams as there and unavailable, and names CB.2 in words beside it", () => {
    render(Mirror());

    const segment = screen.getByRole("group", { name: PLATFORM_SEGMENT_LABEL });
    const slack = within(segment).getByRole("button", { name: "Slack" });
    const teams = within(segment).getByRole("button", { name: "Teams" });
    const reason = screen.getByText(TEAMS_REASON);

    expect(TEAMS_REASON).toBe("arrives with CB.2 (#547)");
    expect(slack).toHaveAttribute("aria-pressed", "true");
    expect(teams).toHaveAttribute("aria-disabled", "true");
    expect(teams).toHaveAttribute("aria-pressed", "false");
    // The reason is on the page and tied to the control — not only a tooltip on a dead button.
    expect(reason).toBeVisible();
    expect(teams).toHaveAttribute("aria-describedby", reason.id);

    fireEvent.click(teams);
    expect(slack).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves for the real conversation in a new tab", () => {
    render(Mirror());

    const open = within(screen.getByRole("banner")).getByRole("link", { name: "Open #ouroboros-loops in Slack" });

    expect(open).toHaveTextContent("Open ↗");
    expect(open).toHaveAttribute("href", LOOPS.url);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
  });
});

describe("a card", () => {
  it("is drawn from its record: mark, headline, lines, figures and buttons", async () => {
    const log = await showing([mirrorCard()]);
    const rich = log.querySelector(".chatops-mirror__rich") as HTMLElement;

    expect(rich).toHaveClass("chatops-mirror__rich--ok");
    expect(within(rich).getByText("✓ Loop #1846 finished — PR #512 merged")).toHaveClass("chatops-mirror__headline--ok");
    expect(within(rich).getByText("#474 Debounce e-stop interrupt handler")).toBeInTheDocument();
    expect(within(rich).getByText("14/14 checks · 11m cycle · $0.94 · claude-fable-5")).toHaveClass("chatops-mirror__mono");
    expect(within(log).getByText(BOT_NAME)).toHaveTextContent(`${BOT_NAME}${APP_TAG}`);
    expect(within(log).getByText(clockText(at("11:58")))).toHaveAttribute("datetime", at("11:58"));
  });

  it.each([
    ["ok", "chatops-mirror__rich--ok"],
    ["warn", "chatops-mirror__rich--warn"],
    ["accent", "chatops-mirror__rich--accent"],
    ["err", "chatops-mirror__rich--err"],
    ["info", "chatops-mirror__rich--info"],
  ] as const)("takes the %s treatment from its severity", async (severity, name) => {
    const log = await showing([mirrorCard({ severity })]);

    expect(log.querySelector(".chatops-mirror__rich")).toHaveClass(name);
  });

  it("deep-links its refs as given: the PR, the run console, the PR verification and the inbox item", async () => {
    const log = await showing([mirrorCard(), openQuestion(), buildGreen()]);

    expect(within(log).getByRole("link", { name: "View PR ↗" })).toHaveAttribute("href", "/prs/5eed0512");
    expect(within(log).getByRole("link", { name: "Run console" })).toHaveAttribute("href", "/runs/5eed1846");
    expect(within(log).getByRole("link", { name: "PR verification →" })).toHaveAttribute(
      "href",
      "/prs/5eed0514/verification",
    );
    expect(within(log).getByRole("link", { name: "Allow once" })).toHaveAttribute("href", "/inbox?item=5eed0460");
    expect(within(log).getByRole("link", { name: "Deny" })).toHaveAttribute("href", "/inbox?item=5eed0460");

    // In-app pages stay in the tab.
    for (const link of within(log).getAllByRole("link")) expect(link).not.toHaveAttribute("target");
  });

  it("gives an open question its answers in the record's styles, and its footnote", async () => {
    const log = await showing([openQuestion()]);

    expect(log.querySelector(".chatops-mirror__rich")).toHaveClass("chatops-mirror__rich--warn");
    expect(within(log).getByRole("link", { name: "Allow once" })).toHaveClass("ou-btn--primary");
    expect(within(log).getByRole("link", { name: "Deny" })).toHaveClass("ou-btn--danger");
    expect(within(log).getByRole("link", { name: "View diff →" })).toHaveClass("ou-btn--ghost");
    expect(within(log).getByText("paused 4m · escalates to the Needs-you inbox in 26m")).toBeInTheDocument();
    expect(log.querySelector(".chatops-mirror__resolution")).toBeNull();
  });

  it("reads a resolved question's outcome and actor, with no button of any kind", async () => {
    const question = resolvedQuestion();
    const log = await showing([question]);

    expect(within(log).getByText(resolutionText(question.resolution!))).toBeInTheDocument();
    expect(resolutionText(question.resolution!, "UTC")).toBe("resolved: allow once — Maya Chen (12:11)");
    expect(within(log).queryByRole("link")).toBeNull();
    expect(within(log).queryByRole("button")).toBeNull();
  });

  it("draws no button on a resolved question even when the record still lists actions", async () => {
    const log = await showing([resolvedQuestion({ actions: openQuestion().actions })]);

    expect(within(log).queryByRole("link")).toBeNull();
    expect(within(log).queryByRole("button")).toBeNull();
  });

  it("says how a resolved question came out once: the record's own footnote is not repeated under it", async () => {
    const log = await showing([resolvedQuestion({ footnote: "Maya Chen answered: allowed once · in Slack" })]);

    expect(log.querySelector(".chatops-mirror__resolution")).not.toBeNull();
    expect(within(log).queryByText("Maya Chen answered: allowed once · in Slack")).toBeNull();
  });

  it("keeps the footnote of a resolved card whose record names no resolution", async () => {
    const log = await showing([resolvedQuestion({ resolution: null, footnote: "answered · in Slack" })]);

    expect(within(log).getByText("answered · in Slack")).toBeInTheDocument();
  });

  it("names nobody when a resolution has no actor", async () => {
    const log = await showing([resolvedQuestion({ resolution: { outcome: "auto-allowed", actor: null, at: at("12:11") } })]);

    expect(within(log).getByText(`resolved: auto-allowed (${clockText(at("12:11"))})`)).toBeInTheDocument();
  });

  it("annotates an escalated card", async () => {
    const log = await showing([openQuestion({ escalatedAt: at("12:37") })]);
    const mark = log.querySelector(".chatops-mirror__escalated") as HTMLElement;

    expect(mark).toHaveTextContent(ESCALATED_MARK);
    expect(mark).toHaveTextContent(clockText(at("12:37")));
  });

  it("annotates nothing that was not escalated", async () => {
    expect((await showing([openQuestion()])).querySelector(".chatops-mirror__escalated")).toBeNull();
  });
});

describe("no archetype is hard-coded", () => {
  it("draws invented words verbatim, whatever the family and the severity", async () => {
    const invented = mirrorCard({
      family: "zorblax_inverted",
      severity: "quux" as never,
      mark: "§",
      headline: "Flux capacitor recalibrated — 88 of 88",
      lines: ["first invented line", "second invented line"],
      stats: "1.21 GW · 0 paradoxes",
      actions: [{ id: "a", label: "Open the vortex", href: "/vortex/9", style: "sideways" as never }],
      footnote: "an invented footnote",
    });
    const log = await showing([invented, mirrorLine({ text: "an invented system line" })]);
    const rich = log.querySelector(".chatops-mirror__rich") as HTMLElement;

    expect(rich).toHaveAttribute("data-family", "zorblax_inverted");
    expect(rich).toHaveAttribute("data-severity", "quux");
    // A severity this build has no treatment for is drawn plainly; its words are still the record's.
    expect(rich).toHaveClass("chatops-mirror__rich--info");
    expect(within(rich).getByText("§ Flux capacitor recalibrated — 88 of 88")).toBeInTheDocument();
    expect(within(rich).getByText("first invented line")).toBeInTheDocument();
    expect(within(rich).getByText("second invented line")).toBeInTheDocument();
    expect(within(rich).getByText("1.21 GW · 0 paradoxes")).toBeInTheDocument();
    expect(within(rich).getByText("an invented footnote")).toBeInTheDocument();
    expect(within(rich).getByRole("link", { name: "Open the vortex" })).toHaveAttribute("href", "/vortex/9");
    expect(within(log).getByText("an invented system line")).toHaveClass("chatops-mirror__sys");
  });

  it("draws nothing a record did not put there", async () => {
    const log = await showing([mirrorCard({ mark: "", lines: [], stats: null, actions: [], footnote: null })]);
    const rich = log.querySelector(".chatops-mirror__rich") as HTMLElement;

    expect(rich.children).toHaveLength(1);
    expect(rich).toHaveTextContent(/^Loop #1846 finished — PR #512 merged$/);
  });

  it("holds none of the mockup's sentences in its source", () => {
    const directory = join(import.meta.dirname, "..", "..", "app", "chatops");
    const source = readdirSync(directory)
      .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
      // Prose may quote the mockup; what is checked is what could be rendered.
      .map((name) => readFileSync(join(directory, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, " "))
      .join("\n");

    for (const sentence of [
      "Loop #1846",
      "PR #512",
      "Debounce e-stop",
      "14/14 checks",
      "claude-fable-5",
      "Build paused",
      "a question for you",
      "rollback_flag",
      "Allow once",
      "View diff",
      "View PR",
      "Run console",
      "Maya Chen",
      "loops live",
      "Dry run started",
      "Open Copilot",
      "build 3 green",
      "PR verification",
      "loop_finished",
      "build_green",
      "build_failed",
    ]) {
      expect(source, `the source holds “${sentence}”`).not.toContain(sentence);
    }
  });
});

describe("a system line", () => {
  it("is its text, between two rules", async () => {
    const log = await showing([mirrorLine()]);

    expect(within(log).getByText(mirrorLine().text)).toHaveClass("chatops-mirror__sys");
  });
});

describe("a command", () => {
  it("is the person's line and the boxed reply that answered it", async () => {
    const log = await showing([mirrorCommand()]);
    const person = log.querySelector('[data-surface="slack"]') as HTMLElement;

    expect(within(person).getByText("KS")).toHaveClass("chatops-mirror__avatar--human");
    expect(within(person).getByText("Ken Suenobu")).toBeInTheDocument();
    expect(within(person).getByText("/ouro status")).toHaveClass("chatops-mirror__cmd");
    expect(within(person).queryByText(CONSOLE_SURFACE_MARK)).toBeNull();

    const reply = within(log).getByText(mirrorCommand().reply!.text);

    expect(reply).toHaveClass("chatops-mirror__reply");
    expect(reply).not.toHaveClass("chatops-mirror__reply--err");
    expect(log.querySelector(".chatops-mirror__pending")).toBeNull();
  });

  it("marks a command typed in this app, and gives nobody a neutral face", async () => {
    const log = await showing([mirrorCommand({ surface: "console", author: null })]);
    const person = log.querySelector('[data-surface="console"]') as HTMLElement;

    expect(within(person).getByText(CONSOLE_SURFACE_MARK)).toBeInTheDocument();
    expect(within(person).getByText(UNKNOWN_AUTHOR)).toBeInTheDocument();
    expect(within(person).getByText(UNKNOWN_INITIALS)).toHaveClass("chatops-mirror__avatar--unknown");
  });

  it("links where its reply points, and says a pending one is still running", async () => {
    const log = await showing([pendingDryRun()]);

    expect(within(log).getByText(pendingDryRun().reply!.text)).toBeInTheDocument();
    expect(within(log).getByRole("link", { name: "Open Copilot →" })).toHaveAttribute(
      "href",
      "/workflows/copilot?run=5eed0562",
    );
    expect(within(log).getByText(PENDING_NOTE)).toBeInTheDocument();
  });

  it("opens a reply's link in a new tab when it leaves the app", async () => {
    const log = await showing([
      mirrorCommand({
        reply: { text: "Queued.", link: { label: "On GitHub", href: "https://github.com/acme/helios/issues/486" }, at: null },
      }),
    ]);
    const link = within(log).getByRole("link", { name: "On GitHub" });

    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("adds the result as a further message once an asynchronous command has finished", async () => {
    const log = await showing([
      pendingDryRun({
        outcome: "ok",
        result: { text: "Dry run finished: 4 stages, nothing written.", link: null, at: at("12:16") },
      }),
    ]);

    expect(within(log).getByText("Dry run finished: 4 stages, nothing written.")).toHaveClass("chatops-mirror__reply");
    expect(within(log).getByText(clockText(at("12:16")))).toBeInTheDocument();
    expect(within(log).queryByText(PENDING_NOTE)).toBeNull();
  });

  it("says a pending command is still running even when it said nothing at once", async () => {
    const log = await showing([pendingDryRun({ reply: null })]);

    expect(within(log).getByText(PENDING_NOTE)).toBeInTheDocument();
  });

  it.each(["error", "denied", "unlinked"] as const)("styles a reply that was %s as a failure, in the stored words", async (outcome) => {
    const log = await showing([mirrorCommand({ outcome, reply: { text: "the stored words", link: null, at: null } })]);

    expect(within(log).getByText("the stored words")).toHaveClass("chatops-mirror__reply--err");
  });
});

describe("days", () => {
  it("groups the stream by day, each under its divider", async () => {
    const read = answering(
      mirror({
        entries: [
          mirrorLine({ id: "old", at: at("12:00", "2026-10-05"), text: "a week ago" }),
          mirrorLine({ id: "yesterday", at: at("12:00", "2026-10-11"), text: "the day before" }),
          mirrorLine({ id: "today", at: at("12:00"), text: "this day" }),
        ],
      }),
    );

    render(Mirror({ read }, { readAt: at("13:00") }));

    await screen.findByText("this day");

    // The poll's own clock is the test's; pin what is asserted to the entries' own gaps.
    const rules = within(stream())
      .getAllByRole("separator")
      .map((rule) => rule.textContent);

    expect(rules).toHaveLength(3);
    expect(new Set(rules).size).toBe(3);
    expect(rules).not.toContain("");
    expect([TODAY_LABEL, YESTERDAY_LABEL]).not.toContain(rules[0]);
  });

  it("offers no way back at the start of history", async () => {
    await showing([mirrorLine()]);

    expect(screen.queryByRole("button", { name: LOAD_EARLIER_LABEL })).toBeNull();
  });

  it("pages backwards in place, keeping what was read and stopping where history starts", async () => {
    const earlier = vi.fn().mockResolvedValue(
      freshMirror(mirror({ entries: [mirrorLine({ id: "older", at: at("09:00"), text: "an earlier line" })], olderCursor: null })),
    );

    render(Mirror({ read: answering(mirror({ entries: [mirrorLine()], olderCursor: "cursor-1" })), earlier }));

    fireEvent.click(await screen.findByRole("button", { name: LOAD_EARLIER_LABEL }));

    expect(await screen.findByText("an earlier line")).toBeInTheDocument();
    expect(earlier).toHaveBeenCalledWith(LOOPS.id, "cursor-1");
    expect(screen.getByText(mirrorLine().text)).toBeInTheDocument();

    // Prepended: the earlier line is above the one already on screen.
    const lines = [...stream().querySelectorAll(".chatops-mirror__sys")].map((line) => line.textContent);
    expect(lines).toEqual(["an earlier line", mirrorLine().text]);
    expect(screen.queryByRole("button", { name: LOAD_EARLIER_LABEL })).toBeNull();
  });

  it("says a page is on its way, and takes one press at a time", async () => {
    const page = deferred<ReturnType<typeof freshMirror>>();
    const earlier = vi.fn().mockReturnValue(page.promise);

    render(Mirror({ read: answering(mirror({ entries: [mirrorLine()], olderCursor: "cursor-1" })), earlier }));

    fireEvent.click(await screen.findByRole("button", { name: LOAD_EARLIER_LABEL }));

    const busy = screen.getByRole("button", { name: LOADING_EARLIER_LABEL });
    expect(busy).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    expect(earlier).toHaveBeenCalledTimes(1);

    page.resolve(freshMirror(mirror({ entries: [], olderCursor: "cursor-2" })));
    expect(await screen.findByRole("button", { name: LOAD_EARLIER_LABEL })).toBeInTheDocument();
  });

  it("says so when an earlier page cannot be read, and leaves the way back", async () => {
    const earlier = vi
      .fn()
      .mockResolvedValueOnce({ state: "failed", reason: "ouroboros-rest is restarting.", pollAfterSeconds: null })
      .mockRejectedValueOnce(new Error("offline"));

    render(Mirror({ read: answering(mirror({ entries: [mirrorLine()], olderCursor: "cursor-1" })), earlier }));

    fireEvent.click(await screen.findByRole("button", { name: LOAD_EARLIER_LABEL }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ouroboros-rest is restarting.");

    fireEvent.click(screen.getByRole("button", { name: LOAD_EARLIER_LABEL }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(EARLIER_FAILED));
    expect(screen.getByText(mirrorLine().text)).toBeInTheDocument();
  });

  it("keeps the reader's place when an earlier page lands above them", async () => {
    const page = deferred<ReturnType<typeof freshMirror>>();

    render(
      Mirror({
        read: answering(mirror({ entries: [mirrorLine()], olderCursor: "cursor-1" })),
        earlier: () => page.promise,
      }),
    );

    const button = await screen.findByRole("button", { name: LOAD_EARLIER_LABEL });
    const log = stream();

    // jsdom lays nothing out: the scroller is as tall as what it holds, three hundred a line.
    Object.defineProperty(log, "scrollHeight", {
      configurable: true,
      get: () => 200 + 300 * log.querySelectorAll(".chatops-mirror__sys").length,
    });
    log.scrollTop = 40;
    fireEvent.click(button);

    page.resolve(freshMirror(mirror({ entries: [mirrorLine({ id: "older", at: at("09:00"), text: "an earlier line" })] })));
    await screen.findByText("an earlier line");

    // Three hundred more above: what was at 40 is now at 340.
    expect(log.scrollTop).toBe(340);
  });
});

describe("staying current", () => {
  it("shows a new record after a poll, in place, without losing an earlier page", async () => {
    const first = mirror({ entries: [mirrorLine()], olderCursor: "cursor-1" });
    const next = mirror({ entries: [mirrorLine(), buildGreen()], olderCursor: "cursor-9" });
    const read = vi.fn().mockResolvedValueOnce(freshMirror(first)).mockResolvedValue(freshMirror(next));
    const earlier = vi
      .fn()
      .mockResolvedValue(freshMirror(mirror({ entries: [mirrorLine({ id: "older", at: at("09:00"), text: "an earlier line" })] })));

    render(Mirror({ read, earlier }));

    fireEvent.click(await screen.findByRole("button", { name: LOAD_EARLIER_LABEL }));
    await screen.findByText("an earlier line");
    expect(screen.queryByText(buildGreen().headline, { exact: false })).toBeNull();

    // The freshness tag is the poll's own way of being asked now.
    fireEvent.click(screen.getByTitle(MIRROR_FRESH_TITLE));

    expect(await screen.findByText(`⟳ ${buildGreen().headline}`)).toBeInTheDocument();
    expect(screen.getByText("an earlier line")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(LOOPS.id, null);
  });

  it("redraws an entry a later read changed: a question that was open is resolved", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(freshMirror(mirror({ entries: [openQuestion()] })))
      .mockResolvedValue(freshMirror(mirror({ entries: [resolvedQuestion()] })));

    render(Mirror({ read }));

    expect(await screen.findByRole("link", { name: "Allow once" })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(MIRROR_FRESH_TITLE));

    expect(await screen.findByText(resolutionText(resolvedQuestion().resolution!))).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Allow once" })).toBeNull();
    expect(stream().querySelectorAll(".chatops-mirror__rich")).toHaveLength(1);
  });

  it("reads how fresh it is, on the poll family's tag", async () => {
    render(Mirror());

    expect(screen.getByTitle(MIRROR_FRESH_TITLE)).toHaveTextContent("reading…");
    await waitFor(() => expect(screen.getByTitle(MIRROR_FRESH_TITLE)).toHaveTextContent(/^updated \d+s ago$/));
  });

  it("follows the newest entry while the reader is at the end, and not once they have scrolled up", async () => {
    const pages = [
      mirror({ entries: [mirrorLine()] }),
      mirror({ entries: [mirrorLine(), buildGreen()] }),
      mirror({ entries: [mirrorLine(), buildGreen(), mirrorCard({ id: "late", at: at("12:40"), headline: "a later card" })] }),
    ];
    const read = vi.fn();
    for (const page of pages) read.mockResolvedValueOnce(freshMirror(page));

    render(Mirror({ read }));
    await screen.findByText(mirrorLine().text);

    const log = stream();
    let height = 500;

    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 200 });

    height = 700;
    fireEvent.click(screen.getByTitle(MIRROR_FRESH_TITLE));
    await screen.findByText(`⟳ ${buildGreen().headline}`);
    expect(log.scrollTop).toBe(700);

    // The reader scrolls up to read.
    log.scrollTop = 100;
    fireEvent.scroll(log);

    height = 900;
    fireEvent.click(screen.getByTitle(MIRROR_FRESH_TITLE));
    await screen.findByText("✓ a later card");
    expect(log.scrollTop).toBe(100);
  });

  it("keeps the stream as last read under a retry banner when a re-read fails", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(freshMirror())
      .mockResolvedValue({ state: "failed", reason: "ouroboros-rest is restarting.", pollAfterSeconds: 15 });

    render(Mirror({ read }));
    await screen.findByText(mirrorLine().text);

    fireEvent.click(screen.getByTitle(MIRROR_FRESH_TITLE));

    const banner = (await screen.findByText(MIRROR_STALE_HEADLINE)).closest(".ou-retry") as HTMLElement;

    expect(banner).toHaveTextContent("ouroboros-rest is restarting.");
    expect(screen.getByText(mirrorLine().text)).toBeInTheDocument();

    const asked = read.mock.calls.length;
    fireEvent.click(within(banner).getByRole("button"));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(asked));
  });
});

describe("the card's states", () => {
  it("says it is reading before the first answer", () => {
    render(Mirror({ read: () => new Promise(() => undefined) }));

    expect(screen.getByText(MIRROR_READING)).toBeInTheDocument();
    expect(screen.queryByText(MIRROR_EMPTY_TITLE)).toBeNull();
  });

  it("says nothing has been published to a channel with no entries", async () => {
    await showing([]);

    expect(screen.getByText(MIRROR_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(mirrorEmptyNote(LOOPS))).toBeInTheDocument();
  });

  it("warns inline when the bot was removed from the channel", async () => {
    await showing([mirrorLine()], { channel: channel("ouroboros-loops", { purpose: "loops", joined: false }) });

    expect(screen.getByText(removedNote(LOOPS))).toHaveClass("chatops-mirror__warning");
    expect(removedNote(LOOPS)).toContain("/invite @Ouroboros");
    // What was published before is still the record, and commands are still ours to run.
    expect(screen.getByText(mirrorLine().text)).toBeInTheDocument();
    expect(box()).not.toHaveAttribute("disabled");
  });

  it("has its own unread state when the first read fails, with a way to ask again", async () => {
    const read = vi.fn().mockResolvedValue({ state: "failed", reason: "ouroboros-rest answered 500.", pollAfterSeconds: 15 });

    render(Mirror({ read }));

    expect(await screen.findByText(MIRROR_UNREAD)).toBeInTheDocument();
    expect(screen.getByText("ouroboros-rest answered 500.")).toBeInTheDocument();
    expect(screen.queryByText(MIRROR_STALE_HEADLINE)).toBeNull();

    const asked = read.mock.calls.length;
    fireEvent.click(within(stream()).getByRole("button"));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(asked));
  });
});

describe("the composer", () => {
  it("is the mockup's box and Send, with a standing hint", () => {
    render(Mirror());

    expect(box()).toHaveAttribute("placeholder", "Message #ouroboros-loops — or /ouro …");
    expect(send()).toHaveTextContent(SEND_LABEL);
    expect(send()).toHaveAttribute("aria-disabled", "true");
    expect(send()).toHaveAttribute("title", SEND_NEEDS_COMMAND);
    expect(screen.getByText(COMPOSER_HINT)).toBeInTheDocument();
    expect(box()).toHaveAttribute("aria-describedby", screen.getByText(COMPOSER_HINT).id);
  });

  it("cannot send plain text, and says why — with the way to where it can be said", async () => {
    await showing([mirrorLine()]);

    type("can someone look at the OTA build?");

    const hint = screen.getByText(PLAIN_TEXT_HINT, { exact: false });

    expect(PLAIN_TEXT_HINT).toBe("messages live in Slack — commands work here");
    expect(hint).toBeVisible();
    expect(hint).toHaveAttribute("role", "status");
    expect(within(hint).getByRole("link", { name: "Open #ouroboros-loops in Slack" })).toHaveAttribute("href", LOOPS.url);
    expect(within(hint).getByRole("link")).toHaveAttribute("target", "_blank");
    expect(send()).toHaveAttribute("aria-disabled", "true");
    expect(send()).toHaveAttribute("title", PLAIN_TEXT_HINT);

    fireEvent.click(send());
    fireEvent.keyDown(box(), { key: "Enter" });
    await settle();

    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
    expect(box()).toHaveValue("can someone look at the OTA build?");
  });

  it("does not call a prefix still being typed a message", () => {
    render(Mirror());

    for (const typed of ["/", "/ou", "/ouro", "/ouro "]) {
      type(typed);
      expect(screen.getByText(COMPOSER_HINT)).toBeInTheDocument();
      expect(screen.queryByText(PLAIN_TEXT_HINT, { exact: false })).toBeNull();
      expect(send()).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("runs /ouro status under the channel, and the stream reads the record it became", async () => {
    const ran = mirrorCommand({ id: "ran", at: at("12:50"), surface: "console", reply: { text: "the recorded reply", link: null, at: null } });
    const read = vi
      .fn()
      .mockResolvedValueOnce(freshMirror(mirror({ entries: [mirrorLine()] })))
      .mockResolvedValue(freshMirror(mirror({ entries: [mirrorLine(), ran] })));

    render(Mirror({ read }));
    await screen.findByText(mirrorLine().text);

    type("/ouro status");
    expect(send()).not.toHaveAttribute("aria-disabled");
    fireEvent.keyDown(box(), { key: "Enter" });

    await waitFor(() => expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("status", LOOPS.id));

    // The reply on screen is the record's, read back — not the dispatcher's answer drawn by hand.
    expect(await screen.findByText("the recorded reply")).toBeInTheDocument();
    expect(screen.queryByText(result().reply.text)).toBeNull();
    expect(within(stream()).getByText(CONSOLE_SURFACE_MARK)).toBeInTheDocument();
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(box()).toHaveValue("");
  });

  it("sends from the button as well", async () => {
    await showing([mirrorLine()]);

    type("/ouro status");
    fireEvent.click(send());

    await waitFor(() => expect(consoleActions.runConsoleCommand).toHaveBeenCalledWith("status", LOOPS.id));
  });

  it("is busy while a line is out, marks it as sending, and takes no second one", async () => {
    const running = deferred<ReturnType<typeof result>>();
    consoleActions.runConsoleCommand.mockReturnValue(running.promise);

    await showing([mirrorLine()]);

    type("/ouro status");
    fireEvent.click(send());

    await waitFor(() => expect(send()).toHaveTextContent(SENDING_LABEL));
    expect(send()).toHaveAttribute("aria-busy", "true");
    expect(send()).toHaveAttribute("aria-disabled", "true");
    expect(box()).toHaveAttribute("readonly");
    expect(within(stream()).getByRole("status")).toHaveTextContent("Running /ouro status…");

    fireEvent.click(send());
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(consoleActions.runConsoleCommand).toHaveBeenCalledTimes(1);

    running.resolve(result());
    await waitFor(() => expect(send()).toHaveTextContent(SEND_LABEL));
    expect(within(stream()).queryByRole("status")).toBeNull();
    expect(send()).not.toHaveAttribute("aria-busy");
  });

  it("says why a line could not be sent, and keeps it in the box", async () => {
    consoleActions.runConsoleCommand.mockResolvedValue({ error: "That channel is no longer bound.", code: "chat_channel_not_found" });
    const read = answering(mirror({ entries: [mirrorLine()] }));

    render(Mirror({ read }));
    await screen.findByText(mirrorLine().text);
    const asked = read.mock.calls.length;

    type("/ouro status");
    fireEvent.click(send());

    expect(await screen.findByRole("alert")).toHaveTextContent("That channel is no longer bound.");
    expect(box()).toHaveValue("/ouro status");
    // Nothing was recorded, so there is nothing to read.
    expect(read.mock.calls.length).toBe(asked);

    // Typing again takes the notice down.
    type("/ouro statu");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("completes from the console's own grammar, with the palette's keys", async () => {
    render(Mirror());

    type("/ouro sta");

    const list = await screen.findByRole("listbox");
    const first = within(list).getAllByRole("option")[0]!;

    expect(first).toHaveAttribute("aria-selected", "true");
    expect(box()).toHaveAttribute("aria-activedescendant", first.id);
    expect(box()).toHaveAttribute("aria-expanded", "true");

    // Enter on a command row names it rather than running half a word.
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("/ouro status ");
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });

  it("asks the same completions endpoint for an argument", async () => {
    consoleActions.readConsoleCompletions.mockResolvedValue(completions("queue", "ticket", [["#485", "OTA rollback flag"]]));

    render(Mirror());
    type("/ouro queue ");

    expect(await screen.findByRole("option", { name: /#485/ })).toBeInTheDocument();
    expect(consoleActions.readConsoleCompletions).toHaveBeenCalledWith("queue ");

    fireEvent.keyDown(box(), { key: "Tab" });
    expect(box()).toHaveValue("/ouro queue #485 ");
  });

  it("says why a command the caller may not run cannot be, without sending it", async () => {
    render(Mirror());

    type("/ouro ");
    const denied = (await screen.findAllByRole("option")).find((row) => row.getAttribute("aria-disabled") === "true")!;

    fireEvent.click(denied);

    expect(await screen.findByRole("alert")).toHaveTextContent(/^You cannot run \/ouro /);
    expect(consoleActions.runConsoleCommand).not.toHaveBeenCalled();
  });
});
