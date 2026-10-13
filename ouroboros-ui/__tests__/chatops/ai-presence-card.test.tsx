import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiPresenceCard } from "@/app/chatops/ai-presence-card";
import {
  APPLY_REASON,
  COMMANDS_ANCHOR,
  LIVE_CAPTION,
  PRESENCE_ARRIVES,
  PREVIEW_CAPTION,
  PREVIEW_SOURCE,
  PREVIEW_THREAD,
  PREVIEW_THREAD_LABEL,
  type PresenceSource,
  type PresenceThread,
} from "@/app/chatops/presence-view";
import { clockText } from "@/app/chatops/view";
import { ANALYZER_PATH } from "@/app/paths";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The AI-presence card (#544): today a preview that says so at a glance and to a screen reader,
 * in which nothing acts and one link is real; and, handed a live source, the same thread drawn
 * by the same components with its controls switched on — the activation slot #546 uses.
 */

/** A thread no mockup has — proof a live card draws what it is handed. */
const LIVE_THREAD: PresenceThread = {
  entries: [
    {
      type: "message",
      id: "m-1",
      from: "person",
      name: "Maya Chen",
      at: "2026-10-12T09:15:00Z",
      text: "is the farm healthy?",
      suggestion: null,
    },
    {
      type: "message",
      id: "m-2",
      from: "app",
      name: null,
      at: "2026-10-12T09:15:04Z",
      text: "One runner is draining. Retire it?",
      suggestion: { confirmLabel: "Retire", link: { label: "Open Build Farm →", href: "/build-farm" } },
    },
    { type: "line", id: "l-1", text: "✓ retired · policy-checked · audit-logged" },
  ],
};

/**
 * A live source over {@link LIVE_THREAD}.
 *
 * @param onConfirm The confirm handler.
 * @returns The source.
 */
function live(onConfirm: (id: string) => void = vi.fn()): PresenceSource {
  return { mode: "live", thread: LIVE_THREAD, onConfirm, composer: <input aria-label="Ask Ouroboros" /> };
}

/** The card's region. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: "AI PRESENCE" });
}

describe("the preview", () => {
  it("is what the card draws when it is handed nothing", () => {
    const { container } = render(<AiPresenceCard titleId="presence" />);
    const bare = container.innerHTML;
    cleanup();

    const explicit = render(<AiPresenceCard source={PREVIEW_SOURCE} titleId="presence" />);

    expect(maskIds(explicit.container.innerHTML)).toBe(maskIds(bare));
  });

  it("says it is a preview on its head, and names #546 as its arrival — outside the card's name", () => {
    render(<AiPresenceCard titleId="presence" />);

    expect(within(card()).getByText("preview")).toHaveClass("chatops-presence__chip");
    expect(within(card()).getByText("arrives with AI presence (#546)")).toBeInTheDocument();
    expect(PRESENCE_ARRIVES).toContain("#546");
    // The region answers to its title alone, whatever state the card is in.
    expect(document.getElementById("presence")).toHaveTextContent(/^AI PRESENCE$/);
  });

  it("names the thread a preview to a screen reader, described by its arrival", () => {
    render(<AiPresenceCard titleId="presence" />);

    const thread = within(card()).getByRole("group", { name: PREVIEW_THREAD_LABEL });

    expect(PREVIEW_THREAD_LABEL).toMatch(/^Preview/);
    expect(thread).toHaveAccessibleDescription(PRESENCE_ARRIVES);
    expect(thread).toHaveClass("chatops-presence__thread--preview");
  });

  it("reproduces the mockup's exchange, with its written times", () => {
    render(<AiPresenceCard titleId="presence" />);

    expect(within(card()).getByText("Ken")).toBeInTheDocument();
    expect(within(card()).getByText("why did #479 take 38 minutes?")).toBeInTheDocument();
    expect(
      within(card()).getByText(
        "11 of those minutes were queue time on pool-a (14:00–16:00 peak). The Build Analyzer already has a runner-rebalance suggestion that removes it — apply?",
      ),
    ).toBeInTheDocument();
    expect(within(card()).getAllByText("14:36")).toHaveLength(2);
    // A written time names no moment: it is not a `<time>`.
    expect(card().querySelector("time")).toBeNull();
    expect(within(card()).getByText("APP")).toBeInTheDocument();
  });

  it("keeps Apply inert, with its reason as its tooltip, its description and in words", () => {
    render(<AiPresenceCard titleId="presence" />);

    const apply = within(card()).getByRole("button", { name: "Apply" });

    expect(apply).toHaveAttribute("aria-disabled", "true");
    expect(apply).toHaveAttribute("title", APPLY_REASON);
    expect(apply).toHaveAccessibleDescription(APPLY_REASON);
    expect(apply).toHaveAttribute("type", "button");
    // Reachable by keyboard, so the reason can be heard — and visible without a hover.
    expect(apply).not.toBeDisabled();
    expect(within(card()).getByText(APPLY_REASON)).toBeVisible();
    expect(APPLY_REASON).toContain("#546");

    const before = card().innerHTML;
    fireEvent.click(apply);
    fireEvent.keyDown(apply, { key: "Enter" });

    expect(card().innerHTML).toBe(before);
  });

  it("has no control that can be activated — the one button is inert, and there is no input", () => {
    render(<AiPresenceCard titleId="presence" />);

    expect(within(card()).getAllByRole("button")).toHaveLength(1);
    expect(within(card()).getByRole("button")).toHaveAttribute("aria-disabled", "true");
    expect(card().querySelector("input, textarea, select, form")).toBeNull();
  });

  it("links Open Analyzer → to the real Build Analyzer, in the same tab", () => {
    render(<AiPresenceCard titleId="presence" />);

    const link = within(card()).getByRole("link", { name: "Open Analyzer →" });

    expect(link).toHaveAttribute("href", ANALYZER_PATH);
    expect(link).not.toHaveAttribute("target");
  });

  it("draws the system line as an illustration, not as one of the mirror's", () => {
    render(<AiPresenceCard titleId="presence" />);

    const line = within(card()).getByText("✓ applied · policy-checked · audit-logged", { exact: false });

    expect(line).toHaveClass("chatops-presence__sys");
    expect(card().querySelector(".chatops-mirror__sys")).toBeNull();
    expect(line).toHaveTextContent("Illustration: ✓ applied · policy-checked · audit-logged");
    expect(within(line).getByText("Illustration:")).toHaveClass("sr-only");
  });

  it("reframes the caption as a commitment, and points at the commands card", () => {
    render(<AiPresenceCard titleId="presence" />);

    expect(
      within(card()).getByText(
        "When it lands: anything the UI can do, a sentence can do — same permissions, same audit trail.",
      ),
    ).toBeInTheDocument();
    expect(PREVIEW_CAPTION).not.toBe(LIVE_CAPTION);
    expect(within(card()).queryByText(LIVE_CAPTION)).toBeNull();

    const pointer = within(card()).getByRole("link", { name: "today, the /ouro commands do this deterministically →" });

    expect(pointer).toHaveAttribute("href", `#${COMMANDS_ANCHOR}`);
    expect(within(pointer).getByText("/ouro").tagName).toBe("CODE");
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<AiPresenceCard titleId="presence" />);
    cleanup();

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});

describe("the activation slot", () => {
  it("draws a live thread it is handed, on the stream's clock, with no preview marks", () => {
    render(<AiPresenceCard source={live()} titleId="presence" />);

    expect(within(card()).getByText("Maya Chen")).toBeInTheDocument();
    expect(within(card()).getByText("is the farm healthy?")).toBeInTheDocument();
    expect(within(card()).getByText("One runner is draining. Retire it?")).toBeInTheDocument();
    expect([...card().querySelectorAll("time")].map((time) => time.textContent)).toEqual([
      clockText("2026-10-12T09:15:00Z"),
      clockText("2026-10-12T09:15:04Z"),
    ]);

    expect(within(card()).queryByText("preview")).toBeNull();
    expect(within(card()).queryByText(PRESENCE_ARRIVES)).toBeNull();
    expect(within(card()).queryByText(APPLY_REASON)).toBeNull();
    expect(within(card()).queryByRole("group", { name: PREVIEW_THREAD_LABEL })).toBeNull();
    expect(card().querySelector(".chatops-presence__thread--preview")).toBeNull();
    expect(within(card()).queryByText(/^today, the/)).toBeNull();
    expect(within(card()).getByText(LIVE_CAPTION)).toBeInTheDocument();
  });

  it("switches the confirm control on, and hands the handler the message it belongs to", () => {
    const onConfirm = vi.fn();
    render(<AiPresenceCard source={live(onConfirm)} titleId="presence" />);

    const retire = within(card()).getByRole("button", { name: "Retire" });

    expect(retire).not.toHaveAttribute("aria-disabled");
    fireEvent.click(retire);

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("m-2");
    expect(within(card()).getByRole("link", { name: "Open Build Farm →" })).toHaveAttribute("href", "/build-farm");
  });

  it("draws a system line as the mirror's own, and the composer under the thread", () => {
    render(<AiPresenceCard source={live()} titleId="presence" />);

    expect(within(card()).getByText("✓ retired · policy-checked · audit-logged")).toHaveClass("chatops-mirror__sys");
    expect(card().querySelector(".chatops-presence__sys")).toBeNull();
    expect(within(card()).queryByText("Illustration:")).toBeNull();

    const composer = within(card()).getByRole("textbox", { name: "Ask Ouroboros" });
    const thread = within(card()).getByRole("group", { name: "AI presence thread" });

    expect(thread.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("flips without changing layout or components: the preview's thread, live, is the same markup inside the frame", () => {
    /**
     * The message elements of a rendered card, with what only a preview has taken out.
     *
     * @param source The source to draw.
     * @returns Each message's class list and the classes under it.
     */
    function shape(source: PresenceSource): string[][] {
      render(<AiPresenceCard source={source} titleId="presence" />);

      const found = [...card().querySelectorAll(".chatops-mirror__msg")].map((message) =>
        [...message.querySelectorAll("*")]
          .map((element) => element.getAttribute("class") ?? "")
          .filter((name) => name !== "" && name !== "chatops-presence__why"),
      );
      cleanup();

      return found;
    }

    expect(shape({ mode: "live", thread: PREVIEW_THREAD, onConfirm: vi.fn() })).toEqual(shape(PREVIEW_SOURCE));
  });
});
