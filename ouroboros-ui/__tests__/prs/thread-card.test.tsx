import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrThreadEntry, PullRequestPage } from "@/app/api/pull-requests";
import { FILES_TITLE } from "@/app/prs/files";
import type { PrPollOptions } from "@/app/prs/poll";
import { type EntryResolver, PrScreen } from "@/app/prs/pr-screen";
import {
  MIRROR_LABEL,
  MIRROR_NEEDS_REPLY,
  REPLY_LABEL,
  RESOLVE_CANCEL,
  RESOLVE_CONSEQUENCE,
  RESOLVE_TITLE,
} from "@/app/prs/resolve-dialog";
import {
  BLOCKING_PILL,
  ENTRY_RESOLVED,
  ENTRY_RESOLVED_MIRRORED,
  MIRROR_LINK,
  NO_ENTRIES,
  RESOLVED_LINE,
  RESOLVE_LABEL,
  SIMULATED_MARK,
  SIMULATED_NOTE,
  THREAD_ENTRIES_LABEL,
  THREAD_TITLE,
  WAS_BLOCKING_PILL,
  withheldNote,
} from "@/app/prs/thread";
import { THREAD_ID } from "@/app/prs/thread-card";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  ATTEMPT_4_REPLY,
  MIRROR_COMMENT_URL,
  POLICY_RULE,
  PR_514_ID,
  mockupEntries,
  prPage,
  resolution,
  thread,
  threadEntry,
  threadEntryId,
  threadPage,
} from "../helpers/pull-requests";

/**
 * The Review thread card (#368), rendered in the PR screen: the seeded thread against mockup 12
 * with its was-blocking → resolved arc, the header counted from the rows, the watermark and the
 * entries refused for want of one, the policy bot's rule, the empty state, the scrolling wrapper,
 * and a human reply going out and coming back.
 */

// The Server Actions are never reached here: the cases that press pass their own resolver.
vi.mock("@/app/prs/head-actions", () => ({
  decideApproval: vi.fn(),
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));
vi.mock("@/app/prs/criteria-actions", () => ({
  addClaim: vi.fn(),
  attachEvidence: vi.fn(),
  importFromPlan: vi.fn(),
  readEvidenceOptions: vi.fn(),
  verifyClaim: vi.fn(),
  waiveClaim: vi.fn(),
}));
vi.mock("@/app/prs/thread-actions", () => ({
  resolveEntry: vi.fn(),
}));

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** An objection nobody has answered. */
const OPEN = threadEntry();

/**
 * Draw the screen, as a member unless told otherwise.
 *
 * @param initial The page.
 * @param options Whether the reader may contribute, and how an entry is resolved.
 * @returns The Testing Library render result.
 */
function draw(
  initial: PullRequestPage = threadPage(),
  options: { mayContribute?: boolean; sendResolve?: EntryResolver } = {},
) {
  return render(
    <PrScreen
      initial={initial}
      initialError={null}
      mayContribute={options.mayContribute ?? true}
      now={() => 1_000}
      origin={DASHBOARD_ORIGIN}
      poll={QUIET}
      prId={PR_514_ID}
      sendResolve={options.sendResolve ?? vi.fn<EntryResolver>()}
    />,
  );
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: THREAD_TITLE });
}

/** The card's entries, in order. */
function entries(): HTMLElement[] {
  return within(card()).queryAllByRole("listitem");
}

/**
 * The entry an author wrote.
 *
 * @param author The author's label.
 * @returns The entry.
 */
function entry(author: string): HTMLElement {
  return within(card()).getByText(author).closest("li") as HTMLElement;
}

/**
 * A resolver that answers every press with the entry resolved.
 *
 * @param subject The entry as it was before.
 * @param mirror How the mirror landed.
 * @returns The resolver.
 */
function resolver(
  subject: PrThreadEntry,
  mirror?: Parameters<typeof resolution>[2],
): ReturnType<typeof vi.fn<EntryResolver>> {
  return vi
    .fn<EntryResolver>()
    .mockImplementation((_prId, _entryId, request) =>
      Promise.resolve({ ok: true, answer: resolution(subject, request.reply ?? null, mirror) }),
    );
}

/**
 * Open *Reply & resolve* on an entry.
 *
 * @param author The entry's author.
 * @returns The dialog.
 */
function openDialog(author: string): HTMLElement {
  fireEvent.click(within(entry(author)).getByRole("button", { name: RESOLVE_LABEL }));

  return screen.getByRole("dialog", { name: RESOLVE_TITLE });
}

beforeEach(() => {
  window.history.replaceState(null, "", `/prs/${PR_514_ID}?from=dashboard`);
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the seeded thread", () => {
  it("draws mockup 12's header, counted: 3 entries · 0 open", () => {
    draw();

    expect(card()).toHaveAttribute("id", THREAD_ID);
    expect(card()).toHaveTextContent("3 entries · 0 open");
    expect(entries()).toHaveLength(3);
  });

  it("draws the was blocking → reply → resolved arc on the second opinion", () => {
    draw();

    const second = entry("cursor/composer-2");

    expect(second).toHaveClass("prv-entry--blocking");
    expect(second).toHaveTextContent("second opinion · rev 1");
    expect(second).toHaveTextContent(WAS_BLOCKING_PILL);
    expect(second).toHaveTextContent("PID velocity sample now lags by one telemetry period");
    expect(second.querySelector(".prv-entry__reply")).toHaveTextContent(ATTEMPT_4_REPLY);
    expect(second.querySelector(".prv-entry__resolved")).toHaveTextContent(RESOLVED_LINE);
    expect(within(second).getByText("14:12:44")).toHaveAttribute(
      "datetime",
      "2026-09-27T14:12:44.000Z",
    );

    // The arc reads in order: what was objected to, how it was answered, that it is resolved.
    const order = [...second.querySelectorAll("p")].map((each) => each.className);

    expect(order).toEqual(["prv-entry__body", "prv-entry__reply", "prv-entry__resolved"]);
  });

  it("draws the self-review resolved, never blocking, with no reply", () => {
    draw();

    const self = entry("claude-fable-5");

    expect(self).not.toHaveClass("prv-entry--blocking");
    expect(self).toHaveTextContent("self-review");
    expect(self).not.toHaveTextContent(WAS_BLOCKING_PILL);
    expect(self.querySelector(".prv-entry__reply")).toBeNull();
    expect(self).toHaveTextContent(RESOLVED_LINE);
  });

  it("draws the policy bot's rule text, with no resolve line and no watermark", () => {
    draw();

    const policy = entry("ouroboros policy bot");

    expect(policy).toHaveTextContent(POLICY_RULE);
    expect(policy).toHaveTextContent("policy");
    expect(policy).not.toHaveTextContent(RESOLVED_LINE);
    expect(policy).not.toHaveTextContent(SIMULATED_MARK);
    expect(within(policy).queryByRole("button")).toBeNull();
  });

  it("says each author's kind in words, not by hue alone", () => {
    draw(threadPage([...mockupEntries(), OPEN]));

    expect(entry("cursor/composer-2").querySelector(".prv-entry__author")).toHaveTextContent(
      "model: cursor/composer-2",
    );
    expect(entry("ouroboros policy bot").querySelector(".prv-entry__author")).toHaveTextContent(
      "policy bot: ouroboros policy bot",
    );
    expect(entry("Priya N").querySelector(".prv-entry__author")).toHaveTextContent(
      "person: Priya N",
    );
    expect(entry("cursor/composer-2").querySelector(".prv-entry__author")).toHaveClass(
      "prv-entry__author--model",
    );
  });

  it("sits after the changed files", () => {
    draw();

    const files = screen.getByRole("region", { name: FILES_TITLE });

    expect(files.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the header's count", () => {
  it("is computed from the rows, not read from the payload", () => {
    draw(
      prPage({
        thread: thread([...mockupEntries(), OPEN], { entryCount: 3, openCount: 0 }),
      }),
    );

    expect(card()).toHaveTextContent("4 entries · 1 open");
    expect(entry("Priya N")).toHaveTextContent(BLOCKING_PILL);
    expect(entry("Priya N")).not.toHaveTextContent(WAS_BLOCKING_PILL);
  });
});

describe("the simulated watermark", () => {
  it("renders on both seeded model rows, with what it means", () => {
    draw();

    for (const author of ["claude-fable-5", "cursor/composer-2"]) {
      const mark = within(entry(author)).getByText(SIMULATED_MARK);

      expect(mark).toHaveAttribute("title", SIMULATED_NOTE);
    }

    expect(within(card()).getAllByText(SIMULATED_MARK)).toHaveLength(2);
  });

  it("cannot render a model entry without the watermark", () => {
    const forged = threadEntry({
      id: threadEntryId(9),
      authorKind: "model",
      authorName: "gpt-reviewer",
      body: "This change is unsafe and must not merge.",
      simulated: false,
    });

    draw(threadPage([...mockupEntries(), forged]));

    expect(within(card()).queryByText("gpt-reviewer")).toBeNull();
    expect(card()).not.toHaveTextContent("This change is unsafe and must not merge.");
    expect(entries()).toHaveLength(3);
    expect(within(card()).getByRole("note")).toHaveTextContent(withheldNote(1)!);
    // Withheld is not the same as absent: a blocking entry nobody can see is still open.
    expect(card()).toHaveTextContent("4 entries · 1 open");
  });

  it("cannot render an entry without provenance", () => {
    draw(
      threadPage([
        threadEntry({ id: threadEntryId(7), authorName: " ", body: "Anonymous objection." }),
        threadEntry({
          id: threadEntryId(8),
          authorKind: "agent" as PrThreadEntry["authorKind"],
          authorName: "somebody",
          body: "Unknown kind.",
        }),
      ]),
    );

    expect(entries()).toHaveLength(0);
    expect(card()).not.toHaveTextContent("Anonymous objection.");
    expect(card()).not.toHaveTextContent("Unknown kind.");
    expect(within(card()).getByRole("note")).toHaveTextContent(withheldNote(2)!);
    expect(card()).not.toHaveTextContent(NO_ENTRIES);
  });
});

describe("the empty state", () => {
  it("says there are no review entries yet", () => {
    draw(threadPage([]));

    expect(card()).toHaveTextContent(NO_ENTRIES);
    expect(card()).toHaveTextContent("0 entries · 0 open");
    expect(entries()).toHaveLength(0);
    expect(within(card()).queryByRole("group", { name: THREAD_ENTRIES_LABEL })).toBeNull();
  });
});

describe("a long thread", () => {
  it("scrolls inside the card's own wrapper, which the keyboard can reach", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      threadEntry({
        id: threadEntryId(100 + index),
        authorName: `Reviewer ${index}`,
        blocking: false,
      }),
    );

    draw(threadPage(many));

    const wrapper = within(card()).getByRole("group", { name: THREAD_ENTRIES_LABEL });

    expect(wrapper).toHaveClass("prv-thread__scroll");
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(within(wrapper).getAllByRole("listitem")).toHaveLength(40);
    expect(card()).toHaveTextContent("40 entries · 0 open");
  });
});

describe("Reply & resolve", () => {
  it("round-trips a human reply: it is sent trimmed and appears in the thread", async () => {
    const send = resolver(OPEN);

    draw(threadPage([...mockupEntries(), OPEN]), { sendResolve: send });

    expect(card()).toHaveTextContent("4 entries · 1 open");

    const dialog = openDialog("Priya N");

    expect(dialog).toHaveTextContent("Priya N");
    expect(dialog).toHaveTextContent(OPEN.body);
    expect(dialog).toHaveTextContent(RESOLVE_CONSEQUENCE);

    fireEvent.change(within(dialog).getByLabelText(REPLY_LABEL), {
      target: { value: "  Overflow path now drops the frame; no allocation.  " },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    expect(send).toHaveBeenCalledExactlyOnceWith(PR_514_ID, OPEN.id, {
      reply: "Overflow path now drops the frame; no allocation.",
      mirror: false,
    });
    expect(screen.queryByRole("dialog", { name: RESOLVE_TITLE })).toBeNull();

    const resolved = entry("Priya N");

    expect(resolved.querySelector(".prv-entry__reply")).toHaveTextContent(
      "Overflow path now drops the frame; no allocation.",
    );
    expect(resolved).toHaveTextContent(WAS_BLOCKING_PILL);
    expect(resolved).toHaveTextContent(RESOLVED_LINE);
    expect(within(resolved).queryByRole("button", { name: RESOLVE_LABEL })).toBeNull();
    expect(card()).toHaveTextContent("4 entries · 0 open");
    expect(within(card()).getByRole("status")).toHaveTextContent(ENTRY_RESOLVED);
  });

  it("resolves with no reply", async () => {
    const send = resolver(OPEN);

    draw(threadPage([OPEN]), { sendResolve: send });

    const dialog = openDialog("Priya N");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    expect(send).toHaveBeenCalledExactlyOnceWith(PR_514_ID, OPEN.id, { mirror: false });
    expect(entry("Priya N").querySelector(".prv-entry__reply")).toBeNull();
    expect(entry("Priya N")).toHaveTextContent(RESOLVED_LINE);
  });

  it("mirrors the reply to the host when asked, and links the comment", async () => {
    const send = resolver(OPEN, { state: "posted", url: MIRROR_COMMENT_URL, error: null });

    draw(threadPage([OPEN]), { sendResolve: send });

    const dialog = openDialog("Priya N");
    const mirror = within(dialog).getByRole("switch", { name: MIRROR_LABEL });

    expect(mirror).toHaveAttribute("aria-disabled", "true");
    expect(mirror).toHaveAttribute("title", MIRROR_NEEDS_REPLY);

    fireEvent.click(mirror);
    expect(mirror).toHaveAttribute("aria-checked", "false");

    fireEvent.change(within(dialog).getByLabelText(REPLY_LABEL), {
      target: { value: "Overflow path fixed." },
    });
    fireEvent.click(mirror);
    expect(mirror).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    expect(send).toHaveBeenCalledExactlyOnceWith(PR_514_ID, OPEN.id, {
      reply: "Overflow path fixed.",
      mirror: true,
    });

    const status = within(card()).getByRole("status");
    const link = within(status).getByRole("link", { name: new RegExp(MIRROR_LINK) });

    expect(status).toHaveTextContent(ENTRY_RESOLVED_MIRRORED);
    expect(link).toHaveAttribute("href", MIRROR_COMMENT_URL);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never asks the host to post nothing: clearing the reply clears the mirror", async () => {
    const send = resolver(OPEN);

    draw(threadPage([OPEN]), { sendResolve: send });

    const dialog = openDialog("Priya N");
    const reply = within(dialog).getByLabelText(REPLY_LABEL);

    fireEvent.change(reply, { target: { value: "Fixed." } });
    fireEvent.click(within(dialog).getByRole("switch", { name: MIRROR_LABEL }));
    fireEvent.change(reply, { target: { value: "   " } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    expect(send).toHaveBeenCalledExactlyOnceWith(PR_514_ID, OPEN.id, { mirror: false });
  });

  it("says when the host refused the mirror — resolved, reply not posted", async () => {
    const send = resolver(OPEN, {
      state: "failed",
      url: null,
      error: { code: "host_permission", message: "the token cannot comment here" },
    });

    draw(threadPage([OPEN]), { sendResolve: send });

    const dialog = openDialog("Priya N");

    fireEvent.change(within(dialog).getByLabelText(REPLY_LABEL), { target: { value: "Fixed." } });
    fireEvent.click(within(dialog).getByRole("switch", { name: MIRROR_LABEL }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    const status = within(card()).getByRole("status");

    expect(entry("Priya N")).toHaveTextContent(RESOLVED_LINE);
    expect(status).toHaveTextContent("the reply was not posted on the PR");
    expect(status).toHaveTextContent("the token cannot comment here");
    expect(status).toHaveClass("prv-thread__outcome--failed");
  });

  it("draws a refusal in the dialog, which stays open with what was typed", async () => {
    const send = vi.fn<EntryResolver>().mockResolvedValue({
      ok: false,
      status: 409,
      code: "pr_thread_entry_resolved",
      reason: "The entry is already resolved — a resolution and its reply are not rewritten.",
    });

    draw(threadPage([OPEN]), { sendResolve: send });

    const dialog = openDialog("Priya N");

    fireEvent.change(within(dialog).getByLabelText(REPLY_LABEL), { target: { value: "Fixed." } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    expect(within(dialog).getByRole("alert")).toHaveTextContent("already resolved");
    expect(within(dialog).getByLabelText(REPLY_LABEL)).toHaveValue("Fixed.");
    expect(entry("Priya N")).not.toHaveTextContent(RESOLVED_LINE);
    expect(card()).toHaveTextContent("1 entry · 1 open");
  });

  it("sends nothing when cancelled, and leaves nothing behind for the next opening", () => {
    const send = resolver(OPEN);

    draw(threadPage([OPEN]), { sendResolve: send });

    const dialog = openDialog("Priya N");

    fireEvent.change(within(dialog).getByLabelText(REPLY_LABEL), { target: { value: "Draft" } });
    fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_CANCEL }));

    expect(screen.queryByRole("dialog", { name: RESOLVE_TITLE })).toBeNull();
    expect(within(openDialog("Priya N")).getByLabelText(REPLY_LABEL)).toHaveValue("");
    expect(send).not.toHaveBeenCalled();
  });

  it("can resolve a seeded model entry, and the watermark stays on it", async () => {
    const seeded = threadEntry({
      authorKind: "model",
      authorName: "cursor/composer-2",
      simulated: true,
    });

    draw(threadPage([seeded]), { sendResolve: resolver(seeded) });

    const dialog = openDialog("cursor/composer-2");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RESOLVE_LABEL }));
    });

    expect(entry("cursor/composer-2")).toHaveTextContent(RESOLVED_LINE);
    expect(within(entry("cursor/composer-2")).getByText(SIMULATED_MARK)).toBeInTheDocument();
  });

  it("is offered to no viewer", () => {
    draw(threadPage([...mockupEntries(), OPEN]), { mayContribute: false });

    expect(within(card()).queryByRole("button", { name: RESOLVE_LABEL })).toBeNull();
    expect(entry("Priya N")).toHaveTextContent(BLOCKING_PILL);
  });

  it("is offered on no resolved entry and never on the policy bot's", () => {
    draw(threadPage([...mockupEntries(), OPEN]));

    expect(within(card()).getAllByRole("button", { name: RESOLVE_LABEL })).toHaveLength(1);
    expect(within(entry("Priya N")).getByRole("button", { name: RESOLVE_LABEL })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
  });
});
