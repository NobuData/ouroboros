import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CopilotStreamEvent } from "@/app/api/workflow-copilot";
import { MODELS_PATH, PROVIDERS_PATH, ROUTING_MATRIX_HASH } from "@/app/paths";
import { DRAFT_KEY_PREFIX, resetComposerDrafts } from "@/app/workflows/copilot/composer-draft";
import {
  CLOSED_MID_REPLY_NOTE,
  CLOSED_MID_REPLY_TITLE,
  COMPOSER_LABEL,
  COMPOSER_PLACEHOLDER,
  CONNECTION_LOST,
  CONVERSATION_CAPTION,
  DRY_RUN_REASON,
  EMPTY_READER_TITLE,
  EMPTY_TITLE,
  COPILOT_WILL,
  COPILOT_WILL_NOT,
  EXAMPLES_LABEL,
  EXAMPLE_BRIEFS,
  GATEWAY_NOTICE_LINK,
  GATEWAY_NOTICE_TITLE,
  GATEWAY_REASON,
  INTERRUPTED_REPLY,
  MESSAGES_LABEL,
  NEW_CONVERSATION_LABEL,
  NOTHING_SENT,
  NOTHING_TO_SEND,
  PENDING_REASON,
  REPLY_FAILED_TITLE,
  RETRY_LABEL,
  SEND_LABEL,
  SENDING,
  SESSION_CLOSED_CODE,
  SHOW_EARLIER_LABEL,
  STREAMING_REASON,
  THINKING,
  UNROUTED_NOTICE_TITLE,
  UNROUTED_REASON,
  clockOf,
  WILL_LABEL,
  WILL_NOT_LABEL,
} from "@/app/workflows/copilot/conversation";
import type { CopilotTransport, TransportStream } from "@/app/workflows/copilot/conversation-transport";
import { readCopilotLive, resetCopilotLive } from "@/app/workflows/copilot/copilot-live";
import {
  DISCARDED_TRANSCRIPT_NOTE,
  INTERRUPTED_BODY,
  ROLE_TRANSCRIPT_NOTE,
  TRANSCRIPT_EMPTY,
  promotedTranscriptNote,
} from "@/app/workflows/copilot/copilot-view";

import { connection } from "../../helpers/providers";
import { maskIds, renderInBothPalettes } from "../../helpers/palettes";
import { settle } from "../../helpers/settle";
import {
  CLOSED_MID_REPLY_SENTENCE,
  DRY_RUNNING,
  LIVE_REPLY_ID,
  NO_GATEWAY,
  SECURITY_PATCH_ID,
  SEEDED_BOUNCE,
  SEEDED_IDS,
  SESSION_ID,
  UNROUTED,
  UNROUTED_REASON_TEXT,
  closedConversation,
  copilotConversation,
  copilotMessage,
  copilotReadiness,
  copilotSession,
  exchangeScript,
  operationEvent,
  seededConversation,
  seededMessages,
} from "../../helpers/workflow-copilot";

/**
 * The conversation card as it is drawn (CE.2, #566) — mockup 20's `c-5` card.
 *
 * One acceptance criterion a `describe`, more or less: the seeded exchange with both chip rows
 * answered; a live reply's tokens and operation markers in order; a chip that posts, re-enters
 * the loop and goes inert; the quiet bounce that opens to the validator's message; the pill from
 * provenance; the cost that is absent rather than zero; the composer that says why; the designed
 * gateway and failure states; and a reader who can only read.
 *
 * The transport is a fake that yields the events the service would — the stream's framing is
 * `conversation.test.ts`'s and the wire is `conversation-transport.test.ts`'s.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { ConversationCard } = await import("@/app/workflows/copilot/conversation-card");

/** A stream a test feeds one event at a time. */
function controlled() {
  const queue: (CopilotStreamEvent | null)[] = [];
  let wake: (() => void) | null = null;

  /** Hand the reader the next thing. */
  const put = (item: CopilotStreamEvent | null): void => {
    queue.push(item);
    wake?.();
    wake = null;
  };

  async function* events(): AsyncGenerator<CopilotStreamEvent> {
    for (;;) {
      while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const next = queue.shift();
      if (next === null || next === undefined) return;
      yield next;
    }
  }

  return {
    stream: { ok: true, events: events() } satisfies TransportStream,
    /** Deliver events, and let React draw them. */
    async push(...items: CopilotStreamEvent[]): Promise<void> {
      await act(async () => {
        for (const item of items) put(item);
        await Promise.resolve();
      });
      await settle();
    },
    /** Close the stream. */
    async end(): Promise<void> {
      await act(async () => {
        put(null);
        await Promise.resolve();
      });
      await settle();
    },
  };
}

/** A stream that yields a whole script and closes. */
function scripted(events: readonly CopilotStreamEvent[]): TransportStream {
  return {
    ok: true,
    events: (async function* () {
      for (const event of events) yield event;
    })(),
  };
}

/** A transport whose three calls are spies. */
function fakeTransport(overrides: Partial<CopilotTransport> = {}) {
  return {
    startSession: vi.fn<CopilotTransport["startSession"]>(() =>
      Promise.resolve({ ok: true, value: copilotSession({ lastSeq: 0, modelProvenance: [] }) }),
    ),
    send: vi.fn<CopilotTransport["send"]>(() => Promise.resolve(scripted(exchangeScript("hello", [{ kind: "delta", text: "Done." }])))),
    answer: vi.fn<CopilotTransport["answer"]>(() => Promise.resolve(scripted(exchangeScript("answer", [{ kind: "delta", text: "Noted." }])))),
    ...overrides,
  };
}

type CardProps = Parameters<typeof ConversationCard>[0];

/** Render the card as an owner sees it, on the seeded conversation unless told otherwise. */
function renderCard(overrides: Partial<CardProps> = {}) {
  const props: CardProps = {
    conversation: seededConversation(),
    mayAdminister: true,
    name: "security-patch",
    readiness: copilotReadiness(),
    slug: "security-patch",
    transport: fakeTransport(),
    workflowId: SECURITY_PATCH_ID,
    ...overrides,
  };

  return { ...render(<ConversationCard {...props} />), props };
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: "Conversation" });
}

/** The card's one live region. */
function spoken(): HTMLElement {
  const regions = card().querySelectorAll<HTMLElement>("[aria-live]");

  expect(regions).toHaveLength(1);

  return regions[0]!;
}

/** The composer's box. */
function box(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: COMPOSER_LABEL });
}

/** The send button. */
function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: SEND_LABEL });
}

/** Every message, in order. */
function bubbles(): HTMLElement[] {
  return within(within(card()).getByRole("group", { name: MESSAGES_LABEL })).getAllByRole("listitem");
}

/** Type into the composer. */
function type(text: string): void {
  fireEvent.change(box(), { target: { value: text } });
}

/** Type and press Enter. */
function say(text: string): void {
  type(text);
  fireEvent.keyDown(box(), { key: "Enter" });
}

/** An open question on the newest reply. */
function asking(): ReturnType<typeof seededConversation> {
  return copilotConversation({
    messages: [
      copilotMessage(),
      copilotMessage({
        id: "5eed0c0c-0000-4000-8000-000000000002",
        seq: 2,
        role: "copilot",
        body: "Two questions:",
        choices: [
          { prompt: "What triggers it?", options: ["label:security", "CVE pattern in title"], selected: null, answeredAt: null },
          { prompt: "May it read the Advisory DB?", options: ["Yes", "No"], selected: null, answeredAt: null },
        ],
      }),
    ],
  });
}

beforeEach(() => {
  refresh.mockReset();
  window.sessionStorage.clear();
  resetComposerDrafts();
  resetCopilotLive();
});

describe("the seeded exchange", () => {
  it("draws the six messages as bubbles, the person's and the copilot's apart", () => {
    renderCard();

    const items = bubbles();

    expect(items).toHaveLength(6);
    expect(items.map((item) => item.className.includes("--user"))).toEqual([true, false, true, false, true, false]);
    expect(items[0]).toHaveTextContent("Create a workflow for security patches");
    expect(items[5]).toHaveTextContent("Dry run finished — 2m 41s, $0.31, zero side effects.");
    expect(items.map((item) => item.dataset.messageId)).toEqual(SEEDED_IDS);
  });

  it("heads each with a mono meta line: who, and when as a machine-readable time", () => {
    renderCard();

    const [first, second] = bubbles();
    const time = first!.querySelector("time");

    expect(first!.querySelector(".copilot-chat__meta")).toHaveTextContent(/^You · /);
    expect(second!.querySelector(".copilot-chat__meta")).toHaveTextContent(/^Copilot · /);
    expect(second!.querySelector(".copilot-chat__meta")).toHaveClass("copilot-chat__meta--bot");
    expect(time).toHaveAttribute("datetime", "2026-09-13T15:02:00.000Z");
    expect(time).toHaveTextContent(clockOf("2026-09-13T15:02:00.000Z"));
  });

  it("draws both chip rows answered — numbered, the chosen chip marked, every chip inert", () => {
    renderCard();

    const first = within(card()).getByRole("group", { name: "① What triggers it?" });
    const second = within(card()).getByRole("group", { name: "② May it read the GitHub Advisory DB?" });

    expect(within(first).getByRole("button", { name: "label:security" })).toHaveAttribute("aria-pressed", "true");
    expect(within(first).getByRole("button", { name: "label:security" })).toHaveTextContent("label:security ✓");
    expect(within(first).getByRole("button", { name: "label:security" })).toHaveClass("copilot-chat__chip--selected");
    expect(within(first).getByRole("button", { name: "CVE pattern in title" })).toHaveAttribute("aria-pressed", "false");
    expect(within(second).getByRole("button", { name: "Yes" })).toHaveTextContent("Yes ✓");

    for (const chip of [...within(first).getAllByRole("button"), ...within(second).getAllByRole("button")]) {
      expect(chip).toBeDisabled();
    }
  });

  it("posts nothing when an answered chip is pressed", () => {
    const transport = fakeTransport();
    renderCard({ transport });

    fireEvent.click(screen.getByRole("button", { name: "CVE pattern in title" }));

    expect(transport.answer).not.toHaveBeenCalled();
  });

  it("carries the caption under the card, verbatim, and the card's stable id", () => {
    const { container } = renderCard();

    expect(card()).toHaveAttribute("id", "copilot-conversation");
    expect(container.querySelector(".copilot-chat__caption")).toHaveTextContent(CONVERSATION_CAPTION);
    expect(card()).not.toHaveTextContent(CONVERSATION_CAPTION);
  });

  it("draws the same markup in both palettes, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ConversationCard
        conversation={seededConversation()}
        mayAdminister
        name="security-patch"
        readiness={NO_GATEWAY}
        slug="security-patch"
        transport={fakeTransport()}
        workflowId={SECURITY_PATCH_ID}
      />,
    );

    expect(light).toContain("copilot-chat__bubble--bot");
    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });
});

describe("the head", () => {
  it("shows the model the newest reply was routed to, with its alias as the tooltip — and the draft's tag", () => {
    renderCard({
      conversation: seededConversation({
        session: copilotSession({
          modelProvenance: [
            { seq: 2, alias: "coder-max", modelId: "claude-fable-5" },
            { seq: 4, alias: "planner", modelId: "another-model-2" },
          ],
        }),
      }),
    });

    const pill = within(card()).getByText("another-model-2");

    expect(pill).toHaveAttribute("title", "Routed through the alias planner");
    expect(within(card()).queryByText("claude-fable-5")).toBeNull();
    expect(within(card()).getByText("draft: security-patch")).toBeInTheDocument();
  });

  it("shows no pill before the first recorded exchange — never a default", () => {
    const { container } = renderCard({
      conversation: copilotConversation({ session: copilotSession({ modelProvenance: [] }), messages: [] }),
    });

    expect(container.querySelector(".ou-chip")).toBeNull();
  });

  it("tags the draft with the workflow's slug before there is a conversation to name it", () => {
    renderCard({ conversation: null, slug: "docs-only" });

    expect(within(card()).getByText("draft: docs-only")).toBeInTheDocument();
  });
});

describe("the cost affix", () => {
  it("sits on each priced reply's meta line", () => {
    renderCard();

    const metas = bubbles().map((item) => item.querySelector(".copilot-chat__meta")?.textContent ?? "");

    expect(metas[1]).toMatch(/ · \$0\.12$/);
    expect(metas[3]).toMatch(/ · \$0\.04$/);
    expect(metas[5]).toMatch(/ · \$0\.02$/);
    expect(metas[0]).not.toContain("$");
  });

  it("is absent — not zero — for an unpriced reply, and $0.00 for one priced at nothing", () => {
    const [user, reply] = seededMessages();
    renderCard({
      conversation: seededConversation({
        messages: [user!, { ...reply!, costCents: null }, { ...reply!, id: "free", seq: 3, costCents: 0 }],
      }),
    });

    const metas = bubbles().map((item) => item.querySelector(".copilot-chat__meta")?.textContent ?? "");

    expect(metas[1]).not.toContain("$");
    expect(metas[1]).not.toContain("0.00");
    expect(metas[2]).toMatch(/ · \$0\.00$/);
  });
});

describe("a stored reply's operations", () => {
  it("are one quiet line that opens to the list, the bounce carrying the validator's message", () => {
    renderCard();

    const toggle = screen.getByRole("button", { name: /applied 6 operations · 1 corrected/ });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toBeVisible();

    fireEvent.click(toggle);

    const detail = document.getElementById(toggle.getAttribute("aria-controls")!)!;

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(detail).toBeVisible();
    expect(within(detail).getAllByRole("listitem").map((line) => line.textContent)).toContain(
      `corrected: connecting test → exploit_verify — ${SEEDED_BOUNCE}`,
    );
    expect(detail).toHaveTextContent("adding stage exploit-verify… ✓");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("word the proposed spend guard as proposed, and draw no line for a reply that only read", () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /applied 1 operation · 1 proposed · 1 dry run proposed/ }));

    expect(bubbles()[3]).toHaveTextContent("set spend cap $5.00/run… proposed, not applied");
    expect(within(bubbles()[5]!).queryByRole("button")).toBeNull();
  });
});

describe("a live exchange", () => {
  it("shows the message at once, then tokens and operation markers in the order they arrive", async () => {
    const live = controlled();
    const transport = fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) });
    renderCard({ conversation: copilotConversation({ messages: [] }), transport });

    say("add exploit verification");
    await settle();

    expect(transport.send).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, SESSION_ID, "add exploit verification");
    expect(transport.startSession).not.toHaveBeenCalled();
    expect(box()).toHaveValue("");
    expect(bubbles()[0]).toHaveTextContent("add exploit verification");
    expect(bubbles()[0]).toHaveTextContent(SENDING);
    expect(bubbles()[1]).toHaveTextContent(THINKING);

    const script = exchangeScript("add exploit verification", [
      { kind: "delta", text: "Drafted **security-patch**." },
      operationEvent("add_stage", { node: { id: "exploit-verify" } }, "applied", {
        warnings: [{ code: "reference.unknown_skill", node: "exploit-verify", name: "poc", path: "/x", message: "No skill called poc is registered." }],
      }),
      { kind: "delta", text: " Capping spend." },
      operationEvent("set_trigger", { trigger: {} }),
      operationEvent("set_guard", { spend_cap_cents: 500, per: "run" }, "proposed"),
    ]);

    await live.push(script[0]!, script[1]!);

    const reply = bubbles()[1]!.querySelector(".copilot-chat__bubble")!;

    expect(bubbles()[0]).not.toHaveTextContent(SENDING);
    expect(reply).toHaveAttribute("aria-busy", "true");
    expect(reply).toHaveTextContent("Drafted security-patch.");
    expect(reply.querySelector("strong")).toHaveTextContent("security-patch");
    expect(reply).not.toHaveTextContent("adding stage");

    await live.push(script[2]!);
    expect(reply).toHaveTextContent("adding stage exploit-verify… ✓");
    expect(reply).toHaveTextContent("⚠ exploit-verify: No skill called poc is registered.");
    expect(reply).not.toHaveTextContent("Capping spend.");

    await live.push(script[3]!, script[4]!, script[5]!);

    const order = [...reply.children].map((child) => child.textContent?.trim());

    expect(order).toEqual([
      "Drafted security-patch.",
      "adding stage exploit-verify… ✓",
      "⚠ exploit-verify: No skill called poc is registered.",
      "Capping spend.",
      "set trigger… ✓",
      "set spend cap $5.00/run… proposed, not applied",
    ]);
    expect(refresh).not.toHaveBeenCalled();

    await live.push(...script.slice(6));
    await live.end();

    const settled = bubbles()[1]!.querySelector(".copilot-chat__bubble")!;

    expect(settled).not.toHaveAttribute("aria-busy");
    expect([...settled.children].map((child) => child.textContent?.trim())).toEqual(order);
    expect(bubbles()[1]!.querySelector(".copilot-chat__meta")).toHaveTextContent(/ · \$0\.03$/);
  });

  it("re-reads the page when the reply is done, and publishes what it applied for the stage list", async () => {
    const transport = fakeTransport({
      send: vi.fn(() =>
        Promise.resolve(
          scripted(
            exchangeScript("go", [
              operationEvent("add_stage", { node: { id: "exploit-verify" } }),
              operationEvent("add_edge", { edge: { from: "a", to: "b" } }, "bounced", { validatorMessage: "No." }),
              operationEvent("set_guard", { spend_cap_cents: 500 }, "proposed"),
            ]),
          ),
        ),
      ),
    });
    renderCard({ transport });

    say("go");
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    const published = readCopilotLive(SECURITY_PATCH_ID);

    expect(published.operations.map((operation) => [operation.ordinal, operation.op.kind, operation.outcome])).toEqual([
      [1, "add_stage", "applied"],
      [2, "set_guard", "proposed"],
    ]);
    expect(published.draft).toEqual(copilotConversation().draft);
    expect(published.streaming).toBe(false);
  });

  it("draws a bounced operation as one quiet line that opens to the validator's message", async () => {
    const transport = fakeTransport({
      send: vi.fn(() =>
        Promise.resolve(
          scripted(
            exchangeScript("go", [
              operationEvent("add_edge", { edge: { from: "test", to: "exploit_verify" } }, "bounced", { validatorMessage: SEEDED_BOUNCE }),
              operationEvent("add_edge", { edge: { from: "test", to: "exploit-verify" } }),
            ]),
          ),
        ),
      ),
    });
    renderCard({ transport });

    say("go");

    const toggle = await screen.findByRole("button", { name: /1 operation corrected/ });
    const detail = document.getElementById(toggle.getAttribute("aria-controls")!)!;

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(detail).not.toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(detail).toBeVisible();
    expect(detail).toHaveTextContent(`connecting test → exploit_verify — ${SEEDED_BOUNCE}`);
  });

  it("draws reads, a proposed dry run and a conflict as quiet lines", async () => {
    const transport = fakeTransport({
      send: vi.fn(() =>
        Promise.resolve(
          scripted(
            exchangeScript("go", [
              { kind: "read", tool: "catalog" },
              { kind: "conflict", message: "The canvas saved first; I re-read the draft.", etag: "e" },
              { kind: "dry_run_proposal", ticket: "#489", reason: "closest open issue" },
            ]),
          ),
        ),
      ),
    });
    renderCard({ transport });

    say("go");
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    const reply = bubbles().at(-1)!;

    expect(reply).toHaveTextContent("read catalog…");
    expect(reply).toHaveTextContent("draft changed elsewhere — The canvas saved first; I re-read the draft.");
    expect(reply).toHaveTextContent("proposed a dry run on #489 — closest open issue");
  });

  it("switches the composer off, with the reason, for as long as the reply is arriving", async () => {
    const live = controlled();
    const transport = fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) });
    renderCard({ transport });

    say("first");
    await settle();

    expect(box()).toHaveAttribute("readonly");
    expect(box()).toHaveAttribute("aria-disabled", "true");
    expect(box()).toHaveAccessibleDescription(STREAMING_REASON);
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    expect(sendButton()).toHaveAccessibleDescription(STREAMING_REASON);
    expect(within(card()).getByText(STREAMING_REASON)).toBeVisible();

    fireEvent.keyDown(box(), { key: "Enter" });
    fireEvent.click(sendButton());
    expect(transport.send).toHaveBeenCalledOnce();

    await live.push(...exchangeScript("first", [{ kind: "delta", text: "Done." }]));
    await live.end();

    expect(box()).not.toHaveAttribute("readonly");
    expect(box()).not.toHaveAttribute("aria-disabled");
    expect(within(card()).queryByText(STREAMING_REASON)).toBeNull();
  });

  it("announces the reply once, when it is whole — not as it arrives", async () => {
    const live = controlled();
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) }) });

    const region = spoken();
    const script = exchangeScript("go", [
      { kind: "delta", text: "Added " },
      { kind: "delta", text: "the stage." },
    ]);

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");

    say("go");
    await live.push(script[0]!, script[1]!, script[2]!);

    expect(region).toHaveTextContent("");
    expect(bubbles().at(-1)!.querySelector("[aria-live]")).toBeNull();

    await live.push(...script.slice(3));
    await live.end();

    expect(region).toHaveTextContent("Copilot replied: Added the stage.");
    expect(spoken()).toBe(region);
  });

  it("starts the conversation on the first message, then sends into it", async () => {
    const transport = fakeTransport();
    renderCard({ conversation: null, transport });

    say("Build a docs-only workflow");
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(transport.startSession).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, SESSION_ID, "Build a docs-only workflow");
    expect(bubbles()).toHaveLength(2);

    // The session started here is the one the next message goes into — no second start.
    say("and one more");
    await waitFor(() => expect(transport.send).toHaveBeenCalledTimes(2));
    expect(transport.startSession).toHaveBeenCalledOnce();
  });

  it("keeps what it watched when the page is read again with the same messages", async () => {
    const script = exchangeScript("go", [
      { kind: "delta", text: "Added." },
      operationEvent("add_stage", { node: { id: "exploit-verify" } }),
    ]);
    const transport = fakeTransport({ send: vi.fn(() => Promise.resolve(scripted(script))) });
    const { rerender, props } = renderCard({ conversation: copilotConversation({ messages: [] }), transport });

    say("go");
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    const done = script.at(-1) as Extract<CopilotStreamEvent, { kind: "done" }>;
    const accepted = script[0] as Extract<CopilotStreamEvent, { kind: "accepted" }>;
    rerender(
      <ConversationCard {...props} conversation={copilotConversation({ messages: [accepted.message, done.message] })} />,
    );

    expect(bubbles()).toHaveLength(2);
    expect(bubbles()[1]).toHaveTextContent("adding stage exploit-verify… ✓");
  });
});

describe("choice chips", () => {
  it("are live on the newest open questions: pressing one posts the answer and streams the continuation", async () => {
    const live = controlled();
    const transport = fakeTransport({ answer: vi.fn(() => Promise.resolve(live.stream)) });
    renderCard({ conversation: asking(), transport });

    const row = within(card()).getByRole("group", { name: "① What triggers it?" });
    const chip = within(row).getByRole("button", { name: "label:security" });

    expect(chip).toBeEnabled();
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip);
    await settle();

    expect(transport.answer).toHaveBeenCalledExactlyOnceWith(
      SECURITY_PATCH_ID,
      SESSION_ID,
      "5eed0c0c-0000-4000-8000-000000000002",
      { question: 0, selected: "label:security" },
    );
    // Until the service accepts it the answer is not drawn as given — and nothing else can be pressed.
    expect(chip).toHaveAttribute("aria-pressed", "false");
    for (const other of within(card()).getAllByRole("button", { name: /Yes|No|CVE pattern/ })) {
      expect(other).toBeDisabled();
    }

    const script = exchangeScript("What triggers it? → label:security", [
      operationEvent("set_trigger", { trigger: {} }),
      { kind: "delta", text: "Trigger set." },
    ]);
    await live.push(script[0]!);

    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("label:security ✓");
    expect(chip).toBeDisabled();
    expect(within(row).getByRole("button", { name: "CVE pattern in title" })).toBeDisabled();

    await live.push(...script.slice(1));
    await live.end();

    expect(bubbles().at(-1)).toHaveTextContent("set trigger… ✓");
    expect(bubbles().at(-2)).toHaveTextContent("What triggers it? → label:security");
    expect(refresh).toHaveBeenCalledOnce();

    // The second question is still open, and live again now that the reply is whole.
    const second = within(card()).getByRole("group", { name: "② May it read the Advisory DB?" });
    expect(within(second).getByRole("button", { name: "Yes" })).toBeEnabled();
    expect(chip).toBeDisabled();
  });

  it("draws a single question with no number", () => {
    const conversation = asking();
    conversation.messages[1]!.choices = [conversation.messages[1]!.choices![0]!];
    renderCard({ conversation });

    expect(within(card()).getByRole("group", { name: "What triggers it?" })).toBeInTheDocument();
  });

  it("leaves an older reply's open question inert once the conversation has moved on", () => {
    const conversation = asking();
    conversation.messages.push(
      copilotMessage({ id: "u3", seq: 3, body: "never mind" }),
      copilotMessage({ id: "r4", seq: 4, role: "copilot", body: "Fine." }),
    );
    renderCard({ conversation });

    // Still the newest reply *with an open question*, so it stays answerable.
    expect(screen.getByRole("button", { name: "Yes" })).toBeEnabled();

    conversation.messages.push(
      copilotMessage({
        id: "r5",
        seq: 5,
        role: "copilot",
        body: "One more:",
        choices: [{ prompt: "Really?", options: ["Sure", "Nope"], selected: null, answeredAt: null }],
      }),
    );
    cleanup();
    renderCard({ conversation });

    expect(screen.getAllByRole("button", { name: "Yes" }).at(-1)).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Sure" }).at(-1)).toBeEnabled();
  });

  it.each([
    ["a reader who may not write", { mayAdminister: false }],
    ["a dry run in progress", { readiness: DRY_RUNNING }],
    ["no gateway", { readiness: NO_GATEWAY }],
    ["a closed conversation", { conversation: { ...asking(), session: copilotSession({ status: "promoted" }) } }],
  ])("are inert for %s", (_what, overrides) => {
    const transport = fakeTransport();
    renderCard({ conversation: asking(), transport, ...overrides });

    for (const chip of within(card()).getAllByRole("button", { name: /label:security|CVE pattern|Yes|No/ })) {
      expect(chip).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "label:security" }));
    expect(transport.answer).not.toHaveBeenCalled();
  });

  it("says a refused answer in the service's words and leaves the chip unanswered", async () => {
    const transport = fakeTransport({
      answer: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          refusal: { status: 422, code: "copilot_answer_invalid", message: "That question was already answered." },
        }),
      ),
    });
    renderCard({ conversation: asking(), transport });

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That question was already answered.");
    expect(screen.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "false");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("the composer", () => {
  it("is a labelled multi-line box with the issue's placeholder", () => {
    renderCard();

    expect(box().tagName).toBe("TEXTAREA");
    expect(box()).toHaveAttribute("placeholder", COMPOSER_PLACEHOLDER);
    expect(box()).not.toHaveAttribute("aria-describedby");
  });

  it("sends on Enter, trimmed", async () => {
    const transport = fakeTransport();
    renderCard({ transport });

    say("  cap spend at $5  ");
    await settle();

    expect(transport.send).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, SESSION_ID, "cap spend at $5");
  });

  it("sends on the button", async () => {
    const transport = fakeTransport();
    renderCard({ transport });

    type("cap spend");
    fireEvent.click(sendButton());
    await settle();

    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("writes a line on Shift+Enter, and leaves Enter to an input method that is composing", () => {
    const transport = fakeTransport();
    renderCard({ transport });

    type("line one");
    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(box(), { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 })).toBe(true);

    expect(transport.send).not.toHaveBeenCalled();
    expect(box()).toHaveValue("line one");
  });

  it("sends nothing from an empty box, and says so on the button only", () => {
    const transport = fakeTransport();
    renderCard({ transport });

    // Enter on nothing is swallowed, so a blank message does not become a stray line break.
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(false);
    type("   ");
    fireEvent.click(sendButton());

    expect(transport.send).not.toHaveBeenCalled();
    expect(sendButton()).toHaveAttribute("title", NOTHING_TO_SEND);
    expect(box()).not.toHaveAttribute("aria-disabled");
  });

  it.each([
    ["a dry run in progress", { readiness: DRY_RUNNING }, DRY_RUN_REASON],
    ["a deployment with no gateway", { readiness: NO_GATEWAY }, GATEWAY_REASON],
    ["a copilot with no route", { readiness: UNROUTED }, UNROUTED_REASON],
    [
      "a reply still arriving from another page",
      {
        conversation: copilotConversation({
          messages: [copilotMessage(), copilotMessage({ id: "r", seq: 2, role: "copilot", body: "", status: "streaming" })],
        }),
      },
      PENDING_REASON,
    ],
  ])("is switched off for %s, with the reason in view and tied to the box", (_what, overrides, reason) => {
    const transport = fakeTransport();
    renderCard({ transport, ...overrides });

    expect(box()).toHaveAttribute("readonly");
    expect(box()).toHaveAttribute("aria-disabled", "true");
    expect(box()).toHaveAccessibleDescription(reason);
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    expect(within(card()).getByText(reason)).toBeVisible();

    fireEvent.keyDown(box(), { key: "Enter" });
    fireEvent.click(sendButton());
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("stays focusable while it is switched off, so the reason can be reached and heard", () => {
    renderCard({ readiness: DRY_RUNNING });

    expect(box()).not.toBeDisabled();
    box().focus();
    expect(box()).toHaveFocus();
  });

  it("is not gated by readiness that could not be read", () => {
    renderCard({ readiness: null });

    expect(box()).not.toHaveAttribute("readonly");
    expect(within(card()).queryByRole("status")).toBeNull();
  });

  it("keeps the unsent text per workflow in session storage, and restores it on return", () => {
    const first = renderCard();

    type("half a thought");
    expect(window.sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${SECURITY_PATCH_ID}`)).toBe("half a thought");

    first.unmount();
    resetComposerDrafts();
    renderCard();

    expect(box()).toHaveValue("half a thought");
  });

  it("keeps one workflow's text out of another's box, and forgets it once sent", async () => {
    window.sessionStorage.setItem(`${DRAFT_KEY_PREFIX}${SECURITY_PATCH_ID}`, "for security-patch");
    renderCard({ workflowId: "5eed001b-0000-4000-8000-000000000099" });

    expect(box()).toHaveValue("");

    say("for the other one");
    await settle();

    expect(window.sessionStorage.getItem(`${DRAFT_KEY_PREFIX}5eed001b-0000-4000-8000-000000000099`)).toBeNull();
    expect(window.sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${SECURITY_PATCH_ID}`)).toBe("for security-patch");
  });

  it.each([
    [409, "copilot_session_closed", "That conversation was promoted and is closed."],
    [403, "forbidden", "Only owners and admins may write to a workflow's conversation."],
    [422, "validation_failed", "text must be shorter than or equal to 20000 characters"],
  ])("puts the text back and says why when the service refuses with %i before a reply starts", async (status, code, message) => {
    const transport = fakeTransport({ send: vi.fn(() => Promise.resolve({ ok: false as const, refusal: { status, code, message } })) });
    renderCard({ transport });

    say("my careful message");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(box()).toHaveValue("my careful message");
    expect(bubbles()).toHaveLength(6);
    expect(refresh).not.toHaveBeenCalled();
    expect(box()).not.toHaveAttribute("readonly");
  });

  it("puts the text back when the conversation could not be started", async () => {
    const transport = fakeTransport({
      startSession: vi.fn(() =>
        Promise.resolve({ ok: false as const, refusal: { status: 409, code: "copilot_session_active", message: "A conversation is already open." } }),
      ),
    });
    renderCard({ conversation: null, transport });

    say("first words");

    expect(await screen.findByRole("alert")).toHaveTextContent("A conversation is already open.");
    expect(box()).toHaveValue("first words");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("tells a reader whose session ended what to do, with the text back in the box", async () => {
    const transport = fakeTransport({
      send: vi.fn(() => Promise.resolve({ ok: false as const, refusal: { status: 401, code: "unauthenticated", message: "Sign in." } })),
    });
    renderCard({ transport });

    say("kept");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Your session has ended\. Reload the page/);
    expect(box()).toHaveValue("kept");
  });

  it("puts the text back when the stream closed before the service recorded anything", async () => {
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(scripted([]))) }) });

    say("lost in transit");

    expect(await screen.findByRole("alert")).toHaveTextContent(NOTHING_SENT);
    expect(box()).toHaveValue("lost in transit");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears a refusal when the next message goes", async () => {
    const send = vi
      .fn<CopilotTransport["send"]>()
      .mockResolvedValueOnce({ ok: false, refusal: { status: 409, code: "x", message: "Busy." } })
      .mockResolvedValue(scripted(exchangeScript("again", [{ kind: "delta", text: "Done." }])));
    renderCard({ transport: fakeTransport({ send }) });

    say("again");
    await screen.findByRole("alert");
    fireEvent.keyDown(box(), { key: "Enter" });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the empty state", () => {
  it("invites a first message, with example briefs that fill the box and send nothing", () => {
    const transport = fakeTransport();
    renderCard({ conversation: null, transport });

    expect(card()).toHaveTextContent(EMPTY_TITLE);

    const examples = within(within(card()).getByRole("list", { name: EXAMPLES_LABEL })).getAllByRole("button");

    expect(examples.map((example) => example.textContent)).toEqual([...EXAMPLE_BRIEFS]);
    expect(examples.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(examples[1]!);

    expect(box()).toHaveValue(EXAMPLE_BRIEFS[1]);
    expect(transport.send).not.toHaveBeenCalled();
    expect(transport.startSession).not.toHaveBeenCalled();
  });

  it("states plainly what the copilot will and will not do (#569)", () => {
    renderCard({ conversation: null });

    const will = within(card()).getByRole("list", { name: WILL_LABEL });
    const willNot = within(card()).getByRole("list", { name: WILL_NOT_LABEL });

    expect(within(will).getAllByRole("listitem").map((item) => item.textContent)).toEqual([...COPILOT_WILL]);
    expect(within(willNot).getAllByRole("listitem").map((item) => item.textContent)).toEqual([...COPILOT_WILL_NOT]);
  });

  it("keeps that statement from a reader who cannot start a conversation, and from one under way", () => {
    renderCard({ conversation: null, mayAdminister: false });
    expect(within(card()).queryByRole("list", { name: WILL_LABEL })).toBeNull();
  });

  it("is drawn for an open conversation nobody has said anything in yet", () => {
    renderCard({ conversation: copilotConversation({ messages: [] }) });

    expect(card()).toHaveTextContent(EMPTY_TITLE);
    expect(within(card()).queryByRole("list", { name: EXAMPLES_LABEL })).not.toBeNull();
  });

  it("reports the current provider status under the gateway notice, and links to Providers (#569)", () => {
    renderCard({ conversation: null, readiness: NO_GATEWAY, providers: [connection(), connection({ status: "error" })] });

    const notice = within(card()).getByRole("status");

    expect(notice).toHaveTextContent(GATEWAY_NOTICE_TITLE);
    expect(notice).toHaveTextContent("Provider status: 2 connected — 1 active, 1 failing.");
    expect(within(notice).getByRole("link", { name: GATEWAY_NOTICE_LINK })).toHaveAttribute("href", PROVIDERS_PATH);
  });

  it("says nothing about providers when they could not be read", () => {
    renderCard({ conversation: null, readiness: NO_GATEWAY });

    expect(within(card()).getByRole("status")).not.toHaveTextContent(/Provider status/);
  });

  it("switches the examples off while a message could not be sent", () => {
    renderCard({ conversation: null, readiness: NO_GATEWAY });

    for (const example of within(within(card()).getByRole("list", { name: EXAMPLES_LABEL })).getAllByRole("button")) {
      expect(example).toBeDisabled();
    }
  });

  it("tells a reader who may not start one that there is none yet — with no box and no examples", () => {
    renderCard({ conversation: null, mayAdminister: false });

    expect(card()).toHaveTextContent(EMPTY_READER_TITLE);
    expect(within(card()).queryByRole("textbox")).toBeNull();
    expect(within(card()).queryByRole("button")).toBeNull();
    expect(within(card()).queryByRole("note")).toBeNull();
  });
});

describe("the hard prerequisites", () => {
  it("says there is no invocation gateway, links to Providers, and keeps the transcript readable", () => {
    renderCard({ readiness: NO_GATEWAY });

    const notice = within(card()).getByRole("status");

    expect(notice).toHaveTextContent(GATEWAY_NOTICE_TITLE);
    expect(notice).toHaveTextContent("This deployment has no invocation gateway");
    expect(within(notice).getByRole("link", { name: "See Providers" })).toHaveAttribute("href", PROVIDERS_PATH);
    expect(bubbles()).toHaveLength(6);
  });

  it("says the copilot has no route, in the service's words, and links to Model routing", () => {
    renderCard({ readiness: UNROUTED });

    const notice = within(card()).getByRole("status");

    expect(notice).toHaveTextContent(UNROUTED_NOTICE_TITLE);
    expect(notice).toHaveTextContent(`T${UNROUTED_REASON_TEXT.slice(1)}`);
    expect(notice).not.toHaveTextContent(GATEWAY_NOTICE_TITLE);
    expect(within(notice).getByRole("link", { name: "Open Model routing" })).toHaveAttribute(
      "href",
      `${MODELS_PATH}#${ROUTING_MATRIX_HASH}`,
    );
    expect(bubbles()).toHaveLength(6);
  });

  it("stays inside the card, and is not drawn over a conversation that is closed anyway", () => {
    const { container, unmount } = renderCard({ readiness: NO_GATEWAY, conversation: closedConversation("promoted") });

    expect(container.querySelector(".copilot-chat__notice")).toBeNull();
    unmount();

    renderCard({ readiness: NO_GATEWAY });
    expect(card().querySelector(".copilot-chat__notice")).not.toBeNull();
  });
});

describe("a reply that failed", () => {
  const FAILED = exchangeScript("add a review stage", [{ kind: "delta", text: "Adding" }], {
    error: { code: "engine_unavailable", message: "The engine stopped answering part-way through." },
  });

  it("says what failed in the service's words, and Retry sends the same text again as a new message", async () => {
    const send = vi
      .fn<CopilotTransport["send"]>()
      .mockResolvedValueOnce(scripted(FAILED))
      .mockResolvedValue(scripted(exchangeScript("add a review stage", [{ kind: "delta", text: "Added." }], { seq: 9 }).map(renumbered)));
    renderCard({ conversation: copilotConversation(), transport: fakeTransport({ send }) });

    say("add a review stage");

    const ending = await screen.findByRole("group", { name: REPLY_FAILED_TITLE });

    expect(ending).toHaveTextContent("The engine stopped answering part-way through.");
    expect(bubbles().at(-1)).toHaveTextContent("Adding");
    expect(spoken()).toHaveTextContent(`${REPLY_FAILED_TITLE}. The engine stopped answering`);

    fireEvent.click(within(ending).getByRole("button", { name: RETRY_LABEL }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    expect(send).toHaveBeenLastCalledWith(SECURITY_PATCH_ID, SESSION_ID, "add a review stage");
    await waitFor(() => expect(bubbles().at(-1)).toHaveTextContent("Added."));
    // The transcript honestly keeps both: the failed exchange, then the retried one.
    expect(bubbles()).toHaveLength(6);
    expect(screen.getByRole("group", { name: REPLY_FAILED_TITLE })).toBeInTheDocument();
    // Retry is offered on the newest reply only.
    expect(screen.queryByRole("button", { name: RETRY_LABEL })).toBeNull();
  });

  it("draws a stored interrupted reply the same way, retrying the message before it", async () => {
    const transport = fakeTransport();
    renderCard({
      conversation: copilotConversation({
        messages: [copilotMessage(), copilotMessage({ id: "r", seq: 2, role: "copilot", body: "", status: "interrupted" })],
      }),
      transport,
    });

    const ending = screen.getByRole("group", { name: REPLY_FAILED_TITLE });

    expect(ending).toHaveTextContent(INTERRUPTED_REPLY);
    expect(bubbles()[1]).toHaveTextContent(INTERRUPTED_BODY);

    fireEvent.click(within(ending).getByRole("button", { name: RETRY_LABEL }));
    await settle();

    expect(transport.send).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, SESSION_ID, copilotMessage().body);
  });

  it("offers no Retry where a message could not be sent", () => {
    renderCard({
      mayAdminister: false,
      conversation: copilotConversation({
        messages: [copilotMessage(), copilotMessage({ id: "r", seq: 2, role: "copilot", body: "Half", status: "interrupted" })],
      }),
    });

    expect(screen.getByRole("group", { name: REPLY_FAILED_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RETRY_LABEL })).toBeNull();
  });

  it("settles a stream that broke off as a reply that did not finish", async () => {
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(scripted(FAILED.slice(0, 2)))) }) });

    say("add a review stage");

    expect(await screen.findByRole("group", { name: REPLY_FAILED_TITLE })).toHaveTextContent(CONNECTION_LOST);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("states a reply stopped because the conversation was closed — its own ending, with no Retry and the sentence once", async () => {
    const closed = exchangeScript(
      "add a review stage",
      [operationEvent("add_stage", { node: { id: "review" } }), { kind: "delta", text: CLOSED_MID_REPLY_SENTENCE }],
      { error: { code: SESSION_CLOSED_CODE, message: CLOSED_MID_REPLY_SENTENCE } },
    );
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(scripted(closed))) }) });

    say("add a review stage");

    const ending = await screen.findByRole("group", { name: CLOSED_MID_REPLY_TITLE });

    expect(ending).toHaveTextContent(CLOSED_MID_REPLY_NOTE);
    expect(ending).toHaveClass("copilot-chat__ending--closed");
    expect(within(ending).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("group", { name: REPLY_FAILED_TITLE })).toBeNull();
    // The service's sentence is the reply's own last words — in the bubble, and nowhere else.
    expect(bubbles().at(-1)!.textContent!.split(CLOSED_MID_REPLY_SENTENCE)).toHaveLength(2);
    expect(bubbles().at(-1)).toHaveTextContent("adding stage review… ✓");
  });
});

/** Give a retried exchange's messages their own ids, as the service would. */
function renumbered(event: CopilotStreamEvent): CopilotStreamEvent {
  if (event.kind === "accepted") {
    return { ...event, message: { ...event.message, id: "retry-user" }, replyId: "retry-reply" };
  }
  if (event.kind === "done") return { ...event, message: { ...event.message, id: "retry-reply" } };

  return event;
}

describe("read-only", () => {
  it.each([
    ["a member or a viewer", { mayAdminister: false }, ROLE_TRANSCRIPT_NOTE],
    ["a promoted conversation", { conversation: { ...seededConversation(), session: copilotSession({ status: "promoted" }) } }, promotedTranscriptNote("security-patch")],
    ["a discarded conversation", { conversation: { ...seededConversation(), session: copilotSession({ status: "discarded" }) } }, DISCARDED_TRANSCRIPT_NOTE],
  ])("is the same card for %s: the bubbles and the chips, no box, and the reason where the box would be", (_what, overrides, note) => {
    renderCard(overrides);

    expect(bubbles()).toHaveLength(6);
    expect(within(card()).getByRole("group", { name: "① What triggers it?" })).toBeInTheDocument();
    expect(within(card()).queryByRole("textbox")).toBeNull();
    expect(within(card()).queryByRole("button", { name: SEND_LABEL })).toBeNull();
    expect(within(card()).getByRole("note")).toHaveTextContent(note);
    expect(card().querySelector(".copilot-chat__composer")).toContainElement(within(card()).getByRole("note"));
  });

  it("says a closed conversation with nothing in it was silent", () => {
    renderCard({ conversation: { ...closedConversation("discarded"), messages: [] } });

    expect(card()).toHaveTextContent(TRANSCRIPT_EMPTY);
    expect(card()).not.toHaveTextContent(EMPTY_TITLE);
  });

  it("offers an owner a new conversation after a closed one, and nobody else", async () => {
    const transport = fakeTransport({
      startSession: vi.fn(() => Promise.resolve({ ok: true as const, value: copilotSession({ id: "5eed0c0b-0000-4000-8000-0000000000ff", modelProvenance: [] }) })),
    });
    const closed = closedConversation("promoted");
    const { unmount } = renderCard({ conversation: closed, mayAdminister: false });

    expect(screen.queryByRole("button", { name: NEW_CONVERSATION_LABEL })).toBeNull();
    unmount();

    renderCard({ conversation: closed, transport });
    fireEvent.click(screen.getByRole("button", { name: NEW_CONVERSATION_LABEL }));

    expect(card()).toHaveTextContent(EMPTY_TITLE);
    expect(within(card()).queryByRole("note")).toBeNull();
    expect(within(card()).queryByText(copilotMessage().body)).toBeNull();

    say("start over");
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(transport.startSession).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, "5eed0c0b-0000-4000-8000-0000000000ff", "start over");
  });
});

describe("history", () => {
  /** A conversation of `count` alternating messages. */
  function long(count: number) {
    return copilotConversation({
      messages: Array.from({ length: count }, (_, at) =>
        copilotMessage({
          id: `m-${at + 1}`,
          seq: at + 1,
          role: at % 2 === 0 ? "user" : "copilot",
          body: `message ${at + 1}`,
        }),
      ),
    });
  }

  it("shows the newest thirty, and earlier ones a page at a time", () => {
    renderCard({ conversation: long(70) });

    expect(bubbles()).toHaveLength(30);
    expect(bubbles()[0]).toHaveTextContent("message 41");
    expect(bubbles().at(-1)).toHaveTextContent("message 70");

    fireEvent.click(screen.getByRole("button", { name: SHOW_EARLIER_LABEL }));

    expect(bubbles()).toHaveLength(60);
    expect(bubbles()[0]).toHaveTextContent("message 11");

    fireEvent.click(screen.getByRole("button", { name: SHOW_EARLIER_LABEL }));

    expect(bubbles()).toHaveLength(70);
    expect(screen.queryByRole("button", { name: SHOW_EARLIER_LABEL })).toBeNull();
    // The button went with the last page: focus is on the list it was above, not lost.
    expect(within(card()).getByRole("group", { name: MESSAGES_LABEL })).toHaveFocus();
  });

  it("offers nothing earlier for a conversation that fits a page", () => {
    renderCard();

    expect(screen.queryByRole("button", { name: SHOW_EARLIER_LABEL })).toBeNull();
  });

  it("puts the message being read back where it was when earlier ones are prepended", () => {
    renderCard({ conversation: long(40) });

    const scroller = within(card()).getByRole("group", { name: MESSAGES_LABEL });
    // jsdom has no layout: every message is 100 tall, stacked from the scrolled content's top.
    const rect = (top: number) => ({ top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) });

    scroller.scrollTop = 250;
    // m-13 (the third shown, 200–300) is the first in view. Ten messages arrive above it.
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this === scroller) return rect(0) as DOMRect;
      const all = [...scroller.querySelectorAll("[data-message-id]")];
      return rect(all.indexOf(this) * 100 - scroller.scrollTop) as DOMRect;
    };

    try {
      fireEvent.click(screen.getByRole("button", { name: SHOW_EARLIER_LABEL }));
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }

    // It was 200 from the top and is now 1200: the scroller moved by the same 1000.
    expect(scroller.scrollTop).toBe(1250);
  });
});

describe("the scroller", () => {
  /** Give the scroller a size jsdom does not. */
  function sized(scroller: HTMLElement, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => scrollHeight });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => clientHeight });
  }

  it("is the card's own keyboard-reachable wrapper, and not a live region", () => {
    renderCard();

    const scroller = within(card()).getByRole("group", { name: MESSAGES_LABEL });

    expect(scroller).toHaveClass("copilot-chat__scroll");
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).not.toHaveAttribute("aria-live");
    expect(scroller).not.toHaveAttribute("role", "log");
  });

  it("follows a streaming reply while the reader is at the bottom", async () => {
    const live = controlled();
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) }) });

    const scroller = within(card()).getByRole("group", { name: MESSAGES_LABEL });
    sized(scroller, 2000, 400);

    say("go");
    const script = exchangeScript("go", [{ kind: "delta", text: "Streaming…" }]);
    await live.push(script[0]!, script[1]!);

    expect(scroller.scrollTop).toBe(2000);
    expect(screen.queryByRole("button", { name: "New messages ↓" })).toBeNull();

    await live.push(...script.slice(2));
    await live.end();
  });

  it("does not move a reader who scrolled up — and offers New messages instead", async () => {
    const live = controlled();
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) }) });

    const scroller = within(card()).getByRole("group", { name: MESSAGES_LABEL });
    sized(scroller, 2000, 400);

    say("go");
    const script = exchangeScript("go", [
      { kind: "delta", text: "First." },
      { kind: "delta", text: " Second." },
    ]);
    await live.push(script[0]!, script[1]!);

    // The reader scrolls up to re-read something.
    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("button", { name: "New messages ↓" })).toBeNull();

    await live.push(script[2]!);

    expect(scroller.scrollTop).toBe(300);

    const newest = screen.getByRole("button", { name: "New messages ↓" });
    fireEvent.click(newest);

    expect(scroller.scrollTop).toBe(2000);
    expect(screen.queryByRole("button", { name: "New messages ↓" })).toBeNull();

    await live.push(...script.slice(3));
    await live.end();
  });

  it("follows again once the reader scrolls back to the bottom themselves", async () => {
    const live = controlled();
    renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) }) });

    const scroller = within(card()).getByRole("group", { name: MESSAGES_LABEL });
    sized(scroller, 2000, 400);

    say("go");
    const script = exchangeScript("go", [{ kind: "delta", text: "First." }, { kind: "delta", text: " Second." }]);
    await live.push(script[0]!);

    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);
    scroller.scrollTop = 1590;
    fireEvent.scroll(scroller);

    await live.push(script[1]!);

    expect(scroller.scrollTop).toBe(2000);

    await live.push(...script.slice(2));
    await live.end();
  });
});

describe("a reply the page is not watching", () => {
  it("does not touch state after the card has gone, and still finishes for the stage list", async () => {
    const live = controlled();
    const { unmount } = renderCard({ transport: fakeTransport({ send: vi.fn(() => Promise.resolve(live.stream)) }) });

    say("go");
    await settle();
    unmount();

    await live.push(...exchangeScript("go", [operationEvent("add_stage", { node: { id: "late" } })]));
    await live.end();

    expect(refresh).not.toHaveBeenCalled();
    expect(readCopilotLive(SECURITY_PATCH_ID).operations).toHaveLength(1);
    expect(readCopilotLive(SECURITY_PATCH_ID).streaming).toBe(false);
  });
});

describe("the reply's id", () => {
  it("is the one the service gave it, so a link to a message survives the re-read", async () => {
    renderCard({ conversation: copilotConversation({ messages: [] }) });

    say("go");
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(bubbles().at(-1)).toHaveAttribute("data-message-id", LIVE_REPLY_ID);
  });
});
