import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ErrorEnvelope } from "@/app/api/errors";
import { workflowCodePath, workflowCopilotPath, workflowPath } from "@/app/paths";
import {
  ACTIONS_NEED_PROMOTION,
  ACTIONS_NEED_WORKFLOW,
  BLOCKED_HEADING,
  BLOCKED_REASON,
  BLOCKERS_HEADING,
  CONVERSATION_FAILED_HEADLINE,
  COPILOT_EMPTY_NOTE,
  COPILOT_EYEBROW,
  COPILOT_MISSING_TITLE,
  COPILOT_SEATS,
  COPILOT_SUBLINE,
  COPILOT_TITLE,
  DISCARDED_NOTICE,
  DISCARDED_TRANSCRIPT_NOTE,
  DISCARD_CANCEL,
  DISCARD_CONFIRM,
  DISCARD_LABEL,
  DISCARD_MEMBER_REASON,
  DISCARD_TITLE,
  DRAFT_TERM,
  DRY_RUN_IN_PROGRESS_MESSAGE,
  DRY_RUN_ONLY_NOTE,
  FLAGGED_NOTE,
  FLAGS_HEADING,
  GUARDS_HEADING,
  NOTHING_TO_DISCARD_MESSAGE,
  NOTHING_TO_DISCARD_REASON,
  NO_DRAFT_REASON,
  NO_GUARDS,
  OPEN_VISUAL_LABEL,
  PROMOTE_FINDINGS_MESSAGE,
  PROMOTE_MEMBER_REASON,
  PROMOTION_FAILED_HEADLINE,
  PUBLISHES_TERM,
  PUBLISHING_HEADING,
  RESOLVE_LABEL,
  ROLE_TRANSCRIPT_NOTE,
  TRANSCRIPT_EMPTY,
  discardBody,
  promotedNotice,
  promotedTranscriptNote,
} from "@/app/workflows/copilot/copilot-view";
import {
  COMPOSER_LABEL,
  CONVERSATION_CAPTION,
  EMPTY_READER_TITLE,
  EMPTY_TITLE,
  GATEWAY_NOTICE_TITLE,
  GATEWAY_REASON,
  MESSAGES_LABEL,
  SEND_LABEL,
} from "@/app/workflows/copilot/conversation";
import { DRAFT_FAILED_HEADLINE, STAGES_LABEL, VIEW_AS_CODE_LABEL, stagesTitle } from "@/app/workflows/copilot/stages";
import { CHANGE_NOTE_LABEL, DISMISS_TOAST_LABEL, FINDINGS_LABEL, PUBLISH_CANCEL } from "@/app/workflows/publish";
import { RAIL_FAILED_HEADLINE } from "@/app/workflows/states";
import { COPILOT_NEEDS_WORKFLOW_NOTE, NEW_WORKFLOW_LABEL, RAIL_LABEL, STUDIO_EYEBROW } from "@/app/workflows/view";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../../helpers/palettes";
import { settle } from "../../helpers/settle";
import {
  ADVISORY_REFERENCE,
  COPILOT_REPLY,
  NEVER_AUTO_MERGE,
  NO_GATEWAY,
  SECURITY_PATCH_ID,
  SPEND_GUARD,
  closedConversation,
  copilotMessage,
  copilotPromotion,
  copilotReadings,
  copilotReadingsWith,
  copilotReference,
  copilotSession,
  seededConversation,
  seededStageDraft,
} from "../../helpers/workflow-copilot";

/**
 * The copilot's frame as it is drawn (CE.1, #565) — mockup 20's page head, promote and discard.
 *
 * One acceptance criterion a `describe`, more or less: **the head matches the mockup, inside the
 * shell, with no chrome of its own**; **the segment is live on all three surfaces**; **promote
 * runs the shared publish path and its confirmation names the guards, with where each is
 * enforced**; **findings anchor to their stage rows**; **unresolved references block or flag,
 * named, before the press**; **discard confirms, discards, and keeps the transcript read-only**;
 * **viewers get a read-only surface with an explanation**; and the three regions later tickets
 * fill are **labelled seats**, not pictures.
 *
 * The Server Actions are mocked, not the API: what is under test is the page. The judgements are
 * `copilot-view.test.ts`'s and the reads are `copilot-data.test.ts`'s.
 */

/** What the shared publish action answers, per case. */
const publishWorkflow = vi.fn();

/** What the discard action answers, per case. */
const discardCopilotDraft = vi.fn();

/** What re-reads the page after an action. */
const refresh = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
// Publish is S.6's shared Server Action on the server-only client — the one path the canvas and the code view use.
vi.mock("@/app/workflows/draft-actions", () => ({
  publishWorkflow: (...args: unknown[]) => publishWorkflow(...args),
}));
vi.mock("@/app/workflows/copilot/copilot-actions", () => ({
  discardCopilotDraft: (...args: unknown[]) => discardCopilotDraft(...args),
}));
// The rail's tile and the empty seat's Start blank open S.1's create dialog, on a Server Action.
vi.mock("@/app/workflows/create-actions", () => ({ createWorkflow: vi.fn() }));
// The stage list's poll is its own suite's (`stages-card.test.tsx`); here it never asks.
vi.mock("@/app/workflows/copilot/stages-poll", async () => {
  const { inertStagesPoll } = await import("../../helpers/workflow-copilot");

  return { createStagesPoll: inertStagesPoll };
});
// `next/link` wants the App Router; an anchor carries everything asserted here.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a {...rest} href={href}>
      {children}
    </a>
  ),
}));

const { CopilotScreen } = await import("@/app/workflows/copilot/copilot-screen");

/** The promote button's name on the seeded draft. */
const PROMOTE = "Promote draft → security-patch v1";

/** A refusal, as an action hands it back. */
function refusal(code: string, message = "The service's sentence.", details: ErrorEnvelope["details"] = {}) {
  return { ok: false as const, refusal: { code, message, details } };
}

/** The head's `<h1>`. */
function title(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

/** The segmented control. */
function segments(): HTMLElement {
  return screen.getByRole("navigation", { name: STUDIO_EYEBROW });
}

/** The promote button. */
function promote(name: string = PROMOTE): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The discard button in the head. */
function discard(): HTMLElement {
  return screen.getByRole("button", { name: DISCARD_LABEL });
}

/** One seat, by the heading it carries — the stage list's card is titled for its draft (#567). */
function seat(id: keyof typeof COPILOT_SEATS): HTMLElement {
  const name = id === "stages" ? stagesTitle("security-patch", null) : COPILOT_SEATS[id].title;

  return screen.getByRole("region", { name });
}

/** Render the page as an owner sees it. */
function renderOwner(readings = copilotReadings()) {
  return render(<CopilotScreen mayAdminister readings={readings} role="owner" />);
}

beforeEach(() => {
  publishWorkflow.mockReset().mockResolvedValue({ ok: true, value: { version: 1 } });
  discardCopilotDraft.mockReset().mockResolvedValue({
    ok: true,
    value: { workflowId: SECURITY_PATCH_ID, draftDiscarded: true, session: copilotSession({ status: "discarded" }) },
  });
  refresh.mockReset();
  push.mockReset();
});

describe("the page head", () => {
  it("is mockup 20's: the eyebrow, the title and the subline, verbatim", () => {
    renderOwner();

    expect(screen.getByText("Workflow Studio · Copilot", { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(COPILOT_EYEBROW).toBe("Workflow Studio · Copilot");
    expect(title()).toHaveTextContent(/^Describe the workflow\. Watch it build\. Test it before it touches anything\.$/);
    expect(title()).toHaveTextContent(COPILOT_TITLE);
    expect(screen.getByText(COPILOT_SUBLINE, { selector: ".studio__sub" })).toBeInTheDocument();
  });

  it("draws the mockup's two actions — Discard draft (ghost) and Promote draft → security-patch v1 (primary)", () => {
    const { container } = renderOwner();

    expect(discard()).toHaveClass("ou-btn--ghost");
    expect(promote()).toHaveClass("ou-btn--primary");
    for (const control of [discard(), promote()]) {
      expect(control).not.toHaveAttribute("aria-disabled");
      expect(control).not.toHaveAttribute("title");
    }
    expect(container.querySelectorAll(".studio__actions .copilot-view__buttons button")).toHaveLength(2);
  });

  it("labels Promote with what the service says it publishes — the next version of a published workflow", () => {
    renderOwner(
      copilotReadingsWith({
        promotion: { ok: true, value: copilotPromotion({ publishes: { version: 15, label: "security-patch v15" } }) },
      }),
    );

    expect(promote("Promote draft → security-patch v15")).toBeInTheDocument();
  });

  it("draws the same head in every state — it is copy, and depends on no read", () => {
    renderOwner(copilotReadings({ rail: { ok: false, reason: "Down." }, selected: null }));

    expect(title()).toHaveTextContent(COPILOT_TITLE);
    expect(screen.getByText(COPILOT_SUBLINE)).toBeInTheDocument();
  });
});

describe("the segment", () => {
  it("is live on all three surfaces, with Copilot marked current", () => {
    renderOwner();

    const [visual, code, copilot] = ["Visual", "Code", "Copilot"].map((name) =>
      within(segments()).getByRole("link", { name }),
    );

    expect(visual).toHaveAttribute("href", workflowPath("security-patch"));
    expect(code).toHaveAttribute("href", workflowCodePath("security-patch"));
    expect(copilot).toHaveAttribute("href", workflowCopilotPath("security-patch"));
    expect(copilot).toHaveAttribute("aria-current", "page");
    expect(visual).not.toHaveAttribute("aria-current");
    expect(code).not.toHaveAttribute("aria-current");
    expect(segments()).not.toHaveTextContent(/soon/);
  });

  it("keeps the rail on this surface: each workflow links to its own conversation", () => {
    renderOwner();

    const rail = screen.getByRole("navigation", { name: RAIL_LABEL });

    expect(within(rail).getByRole("link", { name: /standard-fix/ })).toHaveAttribute(
      "href",
      workflowCopilotPath("standard-fix"),
    );
    expect(within(rail).getByRole("link", { current: "page" })).toHaveAttribute(
      "href",
      workflowCopilotPath("security-patch"),
    );
    expect(within(rail).getByRole("button", { name: NEW_WORKFLOW_LABEL })).toBeInTheDocument();
  });
});

describe("the seats", () => {
  it("are mockup 20's two columns: the conversation over its caption, then the stage list over the dry run", () => {
    const { container } = renderOwner();

    const body = container.querySelector(".copilot-view__body");

    expect(body?.children).toHaveLength(2);
    expect(body?.firstElementChild).toContainElement(seat("conversation"));
    expect(body?.firstElementChild).toHaveTextContent(CONVERSATION_CAPTION);
    expect([...(container.querySelector(".copilot-view__side")?.children ?? [])]).toEqual([
      seat("stages"),
      seat("dry-run"),
    ]);
  });

  it("the one a later ticket fills says which issue does, and fakes nothing", () => {
    renderOwner();

    expect(seat("dry-run")).toHaveTextContent(/#568/);
  });

  it("draws the stage list in its seat, from the draft the route read (#567)", () => {
    renderOwner(copilotReadingsWith({ draft: { ok: true, value: seededStageDraft() } }));

    const rows = within(within(seat("stages")).getByRole("list", { name: STAGES_LABEL })).getAllByRole("listitem");

    expect(rows).toHaveLength(9);
    expect(rows[6]).toHaveTextContent("added by copilot");
    expect(within(seat("stages")).getByRole("link", { name: VIEW_AS_CODE_LABEL })).toHaveAttribute(
      "href",
      workflowCodePath("security-patch"),
    );
  });

  it("draws the stage list with no conversation at all — the draft is its own read", () => {
    renderOwner(
      copilotReadingsWith({ conversation: { ok: true, value: null }, draft: { ok: true, value: seededStageDraft() } }),
    );

    expect(within(seat("stages")).getAllByRole("listitem")).toHaveLength(9);
  });

  it("names models through the workspace's aliases, and names the alias when they could not be read", () => {
    const { unmount } = renderOwner(copilotReadingsWith({ draft: { ok: true, value: seededStageDraft() } }));
    expect(within(seat("stages")).getByText("claude-sonnet-5")).toBeInTheDocument();
    unmount();

    renderOwner(
      copilotReadingsWith({
        draft: { ok: true, value: seededStageDraft() },
        aliases: { ok: false, reason: "The registry is unavailable." },
      }),
    );
    expect(within(seat("stages")).getByText("coder-std")).toBeInTheDocument();
    expect(screen.queryByText("The registry is unavailable.")).toBeNull();
  });

  it("is the same list for a viewer: nothing in it writes", () => {
    render(
      <CopilotScreen readings={copilotReadingsWith({ draft: { ok: true, value: seededStageDraft() } })} role="viewer" />,
    );

    expect(within(seat("stages")).getAllByRole("listitem")).toHaveLength(9);
    expect(within(seat("stages")).getAllByRole("link", { name: /^Edit .* on the canvas$/ })).toHaveLength(9);
  });

  it("carry stable ids, so a link to a region lands on the same element whatever is mounted in it", () => {
    renderOwner();

    expect(seat("conversation")).toHaveAttribute("id", "copilot-conversation");
    expect(seat("stages")).toHaveAttribute("id", "copilot-stages");
    expect(seat("dry-run")).toHaveAttribute("id", "copilot-dry-run");
  });
});

describe("the conversation", () => {
  /** The conversation's messages, in order. */
  function bubbles(): HTMLElement[] {
    return within(within(seat("conversation")).getByRole("group", { name: MESSAGES_LABEL })).getAllByRole("listitem");
  }

  it("is the card, drawn from what the route read: the bubbles, and a composer for a reader who may write", () => {
    renderOwner(copilotReadingsWith({ conversation: { ok: true, value: seededConversation() } }));

    expect(bubbles()).toHaveLength(6);
    expect(within(seat("conversation")).getByRole("textbox", { name: COMPOSER_LABEL })).toBeInTheDocument();
    expect(within(seat("conversation")).getByRole("button", { name: SEND_LABEL })).toBeInTheDocument();
    expect(within(seat("conversation")).getByText("claude-fable-5")).toBeInTheDocument();
    expect(seat("conversation")).not.toHaveTextContent(/#566/);
  });

  it("invites a first message for a workflow that never had a conversation", () => {
    renderOwner(copilotReadingsWith({ conversation: { ok: true, value: null } }));

    expect(seat("conversation")).toHaveTextContent(EMPTY_TITLE);
    expect(within(seat("conversation")).getByRole("textbox", { name: COMPOSER_LABEL })).toBeInTheDocument();
  });

  it("takes the composer's reasons from the service's readiness, not from constants here", () => {
    renderOwner(copilotReadingsWith({ readiness: { ok: true, value: NO_GATEWAY } }));

    expect(within(seat("conversation")).getByRole("status")).toHaveTextContent(GATEWAY_NOTICE_TITLE);
    expect(within(seat("conversation")).getByRole("textbox", { name: COMPOSER_LABEL })).toHaveAccessibleDescription(
      GATEWAY_REASON,
    );
  });

  it("gates nothing when the readiness could not be read — the service still refuses what it must", () => {
    renderOwner(copilotReadingsWith({ readiness: { ok: false, reason: "Readiness is unavailable." } }));

    const box = within(seat("conversation")).getByRole("textbox", { name: COMPOSER_LABEL });

    expect(box).not.toHaveAttribute("aria-disabled");
    expect(seat("conversation")).not.toHaveTextContent("Readiness is unavailable.");
  });

  it.each([
    ["discarded", DISCARDED_TRANSCRIPT_NOTE],
    ["promoted", promotedTranscriptNote("security-patch")],
  ] as const)("keeps a %s conversation readable, with the reason where the composer would be", (status, note) => {
    renderOwner(copilotReadingsWith({ conversation: { ok: true, value: closedConversation(status) } }));

    const conversation = seat("conversation");

    expect(within(conversation).getByRole("note")).toHaveTextContent(note);
    expect(bubbles()).toHaveLength(2);
    expect(bubbles()[0]).toHaveTextContent("You");
    expect(bubbles()[0]).toHaveTextContent(copilotMessage().body);
    expect(bubbles()[1]).toHaveTextContent("Copilot");
    expect(bubbles()[1]).toHaveTextContent("Both guards are recorded.");
    expect(within(conversation).queryByRole("textbox")).toBeNull();
    expect(within(conversation).queryByRole("button", { name: SEND_LABEL })).toBeNull();
  });

  it("says a closed conversation with nothing in it was silent", () => {
    renderOwner(
      copilotReadingsWith({
        conversation: { ok: true, value: { ...closedConversation("discarded"), messages: [] } },
      }),
    );

    expect(seat("conversation")).toHaveTextContent(TRANSCRIPT_EMPTY);
  });

  it("keeps the order the messages were said in, whatever order they arrived in", () => {
    renderOwner(
      copilotReadingsWith({
        conversation: {
          ok: true,
          value: { ...closedConversation("discarded"), messages: [COPILOT_REPLY, copilotMessage()] },
        },
      }),
    );

    expect(bubbles()[0]).toHaveTextContent("You");
    expect(bubbles()[1]).toHaveTextContent("Copilot");
  });
});

describe("an unpublishable draft says so before the press", () => {
  const blocked = copilotReadingsWith({
    promotion: {
      ok: true,
      value: copilotPromotion({
        blocked: true,
        blockedReasons: ["1 unresolved reference blocks publishing under this workspace's validation policy."],
        references: [copilotReference(), ADVISORY_REFERENCE],
      }),
    },
  });

  it("makes Promote inert, and lists the reasons in the page — not only in its tooltip", () => {
    renderOwner(blocked);

    expect(promote()).toHaveAttribute("aria-disabled", "true");
    expect(promote()).toHaveAttribute("title", BLOCKED_REASON);

    const gate = screen.getByRole("group", { name: BLOCKED_HEADING });

    expect(gate).toBeVisible();
    expect(gate).toHaveTextContent("1 unresolved reference blocks publishing under this workspace's validation policy.");
  });

  it("names the specific references that block, by stage and by name", () => {
    renderOwner(blocked);

    const gate = screen.getByRole("group", { name: BLOCKED_HEADING });

    expect(gate).toHaveTextContent(BLOCKERS_HEADING);
    expect(gate).toHaveTextContent("stage patch · dependency-bump — No skill called dependency-bump is registered.");
    // The advisory one is not a blocker, and is not listed as one.
    expect(gate).not.toHaveTextContent("fast-triage");
  });

  it("gives a path to resolve them: this workflow's Visual surface", () => {
    renderOwner(blocked);

    expect(
      within(screen.getByRole("group", { name: BLOCKED_HEADING })).getByRole("link", { name: RESOLVE_LABEL }),
    ).toHaveAttribute("href", workflowPath("security-patch"));
  });

  it("does not open the confirmation when pressed", () => {
    renderOwner(blocked);

    fireEvent.click(promote());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(publishWorkflow).not.toHaveBeenCalled();
  });

  it("treats a missing draft the same way, with that reason and the way to make one", () => {
    renderOwner(
      copilotReadingsWith({
        promotion: {
          ok: true,
          value: copilotPromotion({ draft: { present: false, label: "v0.0", etag: "" }, session: null }),
        },
      }),
    );

    expect(promote()).toHaveAttribute("aria-disabled", "true");
    expect(promote()).toHaveAttribute("title", NO_DRAFT_REASON);

    const gate = screen.getByRole("group", { name: BLOCKED_HEADING });

    expect(gate).toHaveTextContent(NO_DRAFT_REASON);
    expect(within(gate).getByRole("link", { name: OPEN_VISUAL_LABEL })).toHaveAttribute(
      "href",
      workflowPath("security-patch"),
    );
  });

  it("flags advisory references beside the button — count and names — and leaves it live", () => {
    const second = copilotReference({ node: "open-pr", name: "release-notes", blocking: false, message: "Unknown." });

    renderOwner(
      copilotReadingsWith({
        promotion: { ok: true, value: copilotPromotion({ references: [ADVISORY_REFERENCE, second] }) },
      }),
    );

    expect(promote()).not.toHaveAttribute("aria-disabled");

    const flags = screen.getByRole("group", { name: "2 unresolved references are flagged" });

    expect(flags).toHaveTextContent("stage triage · fast-triage");
    expect(flags).toHaveTextContent("stage open-pr · release-notes");
    expect(flags).toHaveTextContent(FLAGGED_NOTE);
    expect(screen.queryByRole("group", { name: BLOCKED_HEADING })).toBeNull();
  });

  it("draws no gate at all for a draft that neither blocks nor flags", () => {
    const { container } = renderOwner();

    // The conversation card has groups of its own; the gate's are the head's.
    expect(container.querySelector(".copilot-view__gate")).toBeNull();
    expect(container.querySelector('.copilot-view__actions [role="group"]')).toBeNull();
  });
});

describe("the promote confirmation", () => {
  /** Open it. */
  function openPromote(readings = copilotReadings()): HTMLElement {
    renderOwner(readings);
    fireEvent.click(promote());

    return screen.getByRole("dialog", { name: PROMOTE });
  }

  it("is the shared publish dialog, titled with what it does", () => {
    const dialog = openPromote();

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(PROMOTE);
    expect(within(dialog).getByLabelText(CHANGE_NOTE_LABEL)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: PUBLISH_CANCEL })).toBeInTheDocument();
  });

  it("states plainly what is being published: the version and the draft it comes from", () => {
    const summary = within(openPromote()).getByRole("region", { name: PUBLISHING_HEADING });

    expect(summary).toHaveTextContent(`${PUBLISHES_TERM}security-patch v1`);
    expect(summary).toHaveTextContent(`${DRAFT_TERM}v0.3`);
  });

  it("names each guard with where it is enforced", () => {
    const guards = within(openPromote()).getByRole("list", { name: GUARDS_HEADING });
    const [merge, spend] = within(guards).getAllByRole("listitem");

    expect(merge).toHaveTextContent(NEVER_AUTO_MERGE.label);
    expect(merge).toHaveTextContent("set in the conversation");
    expect(merge).toHaveTextContent("Enforced on real runs");
    expect(merge).toHaveTextContent(NEVER_AUTO_MERGE.enforcedBy);

    expect(spend).toHaveTextContent(SPEND_GUARD.label);
    expect(spend).toHaveTextContent(SPEND_GUARD.enforcedBy);
  });

  it("marks the dry-run-only guard as not enforced on real runs yet — never as protection", () => {
    const guards = within(openPromote()).getByRole("list", { name: GUARDS_HEADING });
    const [merge, spend] = within(guards).getAllByRole("listitem");

    expect(spend).toHaveTextContent("Not enforced on real runs yet");
    expect(spend).toHaveTextContent(DRY_RUN_ONLY_NOTE);
    expect(spend).not.toHaveTextContent("Enforced on real runs");
    expect(spend).toHaveClass("copilot-view__guard--unenforced");
    expect(spend).not.toHaveClass("copilot-view__guard--enforced");

    expect(merge).toHaveClass("copilot-view__guard--enforced");
    expect(merge).not.toHaveTextContent(DRY_RUN_ONLY_NOTE);
  });

  it("says where a guard came from when the definition, not the conversation, set it", () => {
    const dialog = openPromote(
      copilotReadingsWith({
        promotion: {
          ok: true,
          value: copilotPromotion({ guards: [{ ...NEVER_AUTO_MERGE, source: "definition" }] }),
        },
      }),
    );

    expect(within(dialog).getByRole("list", { name: GUARDS_HEADING })).toHaveTextContent("from the definition");
  });

  it("says so when the version carries no guards, rather than drawing an empty list", () => {
    const dialog = openPromote(
      copilotReadingsWith({ promotion: { ok: true, value: copilotPromotion({ guards: [] }) } }),
    );

    expect(dialog).toHaveTextContent(NO_GUARDS);
    expect(within(dialog).queryByRole("list", { name: GUARDS_HEADING })).toBeNull();
  });

  it("lists advisory references as flags, by stage and by name", () => {
    const dialog = openPromote(
      copilotReadingsWith({
        promotion: { ok: true, value: copilotPromotion({ references: [ADVISORY_REFERENCE] }) },
      }),
    );

    expect(within(dialog).getByRole("list", { name: FLAGS_HEADING })).toHaveTextContent(
      "stage triage · fast-triage — No model alias called fast-triage exists yet.",
    );
    expect(within(dialog).queryByRole("list", { name: BLOCKERS_HEADING })).toBeNull();
  });

  it("closes without publishing on Cancel", () => {
    const dialog = openPromote();

    fireEvent.click(within(dialog).getByRole("button", { name: PUBLISH_CANCEL }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(publishWorkflow).not.toHaveBeenCalled();
  });
});

describe("promoting", () => {
  /** Open the confirmation and confirm it. */
  async function confirmPromote(note = ""): Promise<void> {
    fireEvent.click(promote());

    const dialog = screen.getByRole("dialog", { name: PROMOTE });

    if (note !== "") fireEvent.change(within(dialog).getByLabelText(CHANGE_NOTE_LABEL), { target: { value: note } });
    fireEvent.click(within(dialog).getByRole("button", { name: PROMOTE }));
    await settle();
  }

  it("runs the shared publish path with the workflow's id, and no note when none was written", async () => {
    renderOwner();

    await confirmPromote();

    expect(publishWorkflow).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID, undefined);
  });

  it("sends the change note as written", async () => {
    renderOwner();

    await confirmPromote("  The first version, from the conversation.  ");

    expect(publishWorkflow).toHaveBeenCalledExactlyOnceWith(
      SECURITY_PATCH_ID,
      "The first version, from the conversation.",
    );
  });

  it("on success closes the dialog, says what was published, and re-reads the page", async () => {
    renderOwner();

    await confirmPromote();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(promotedNotice("security-patch v1"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("lets the notice be dismissed", async () => {
    renderOwner();
    await confirmPromote();

    fireEvent.click(await screen.findByRole("button", { name: DISMISS_TOAST_LABEL }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a refused definition in the dialog, each finding anchored to its stage's row", async () => {
    publishWorkflow.mockResolvedValue(
      refusal("workflow_definition_invalid", "The definition is invalid.", {
        findings: [
          { source: "dsl", code: "node.missing_task", message: "The stage names no task.", node: "patch" },
          { source: "engine", code: "edge.unreachable", message: "This edge is never taken.", edge: { from: "triage", to: "patch" } },
          { source: "registry", code: "graph.no_terminal", message: "The graph has no terminal stage." },
        ],
      }),
    );
    renderOwner();

    await confirmPromote();

    const dialog = screen.getByRole("dialog", { name: PROMOTE });

    expect(within(dialog).getByRole("alert")).toHaveTextContent(PROMOTE_FINDINGS_MESSAGE);

    const findings = within(dialog).getByRole("list", { name: FINDINGS_LABEL });
    const [byNode, byEdge] = within(findings).getAllByRole("link");

    expect(byNode).toHaveAttribute("href", "#stage-patch");
    expect(byNode).toHaveTextContent("The stage names no task.");
    expect(byNode).toHaveTextContent("Go to stage Patch the dependency");
    // An edge is anchored to the stage it leaves.
    expect(byEdge).toHaveAttribute("href", "#stage-triage");
    expect(byEdge).toHaveTextContent("Go to stage Triage the advisory");
    // A finding about the document as a whole has no row to lead to, and is listed as text.
    expect(within(findings).getAllByRole("link")).toHaveLength(2);
    expect(findings).toHaveTextContent("The graph has no terminal stage.");
    expect(within(findings).queryByRole("button")).toBeNull();

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes the dialog when a finding is followed, so the row it leads to is not behind it", async () => {
    publishWorkflow.mockResolvedValue(
      refusal("workflow_definition_invalid", "Invalid.", {
        findings: [{ source: "dsl", code: "node.missing_task", message: "The stage names no task.", node: "patch" }],
      }),
    );
    renderOwner();
    await confirmPromote();

    fireEvent.click(within(screen.getByRole("dialog", { name: PROMOTE })).getByRole("link"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says another refusal in the dialog, in the shared path's own words", async () => {
    publishWorkflow.mockResolvedValue(refusal("engine_unavailable"));
    renderOwner();

    await confirmPromote();

    expect(within(screen.getByRole("dialog", { name: PROMOTE })).getByRole("alert")).toHaveTextContent(
      /engine could not check this definition/,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Discard draft", () => {
  /** Open the confirmation. */
  function openDiscard(readings = copilotReadings()): HTMLElement {
    renderOwner(readings);
    fireEvent.click(discard());

    return screen.getByRole("dialog", { name: DISCARD_TITLE });
  }

  it("asks first, saying the draft goes, the workflow stays and the conversation is kept read-only", () => {
    const dialog = openDiscard();

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(DISCARD_TITLE);
    expect(dialog).toHaveTextContent(discardBody("security-patch", null));
    expect(dialog).toHaveTextContent(/thrown away/);
    expect(dialog).toHaveTextContent(/having never been published, is left empty/);
    expect(dialog).toHaveTextContent(/The conversation is kept, read-only/);
    expect(within(dialog).getByRole("button", { name: DISCARD_CONFIRM })).toHaveClass("ou-btn--danger");
    expect(discardCopilotDraft).not.toHaveBeenCalled();
  });

  it("says a published workflow returns to its version in force", () => {
    renderOwner(
      copilotReadingsWith({
        entry: { ...copilotReadings().selected!.entry, currentVersion: 3 },
      }),
    );
    fireEvent.click(discard());

    expect(screen.getByRole("dialog", { name: DISCARD_TITLE })).toHaveTextContent(
      /returns to its published version, v3/,
    );
  });

  it("keeps everything on Keep the draft", () => {
    const dialog = openDiscard();

    fireEvent.click(within(dialog).getByRole("button", { name: DISCARD_CANCEL }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(discardCopilotDraft).not.toHaveBeenCalled();
  });

  it("on confirm discards by the workflow's id, closes, says so, and re-reads the page", async () => {
    const dialog = openDiscard();

    fireEvent.click(within(dialog).getByRole("button", { name: DISCARD_CONFIRM }));
    await settle();

    expect(discardCopilotDraft).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(DISCARDED_NOTICE);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["dry_run_in_progress", DRY_RUN_IN_PROGRESS_MESSAGE],
    ["copilot_nothing_to_discard", NOTHING_TO_DISCARD_MESSAGE],
  ])("keeps a 409 %s in the dialog, in words, and discards nothing", async (code, message) => {
    discardCopilotDraft.mockResolvedValue(refusal(code));
    const dialog = openDiscard();

    fireEvent.click(within(dialog).getByRole("button", { name: DISCARD_CONFIRM }));
    await settle();

    expect(within(screen.getByRole("dialog", { name: DISCARD_TITLE })).getByRole("alert")).toHaveTextContent(message);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is inert, with the reason, when there is neither a draft nor an active conversation", () => {
    renderOwner(
      copilotReadingsWith({
        promotion: {
          ok: true,
          value: copilotPromotion({
            draft: { present: false, label: "v0.0", etag: "" },
            session: { id: "s", status: "discarded" },
          }),
        },
        conversation: { ok: true, value: closedConversation("discarded") },
      }),
    );

    expect(discard()).toHaveAttribute("aria-disabled", "true");
    expect(discard()).toHaveAttribute("title", NOTHING_TO_DISCARD_REASON);

    fireEvent.click(discard());

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can still close an open conversation that has no draft", () => {
    renderOwner(
      copilotReadingsWith({
        promotion: { ok: true, value: copilotPromotion({ draft: { present: false, label: "v0.0", etag: "" } }) },
      }),
    );

    expect(discard()).not.toHaveAttribute("aria-disabled");
  });
});

describe("a reader who may not edit", () => {
  /** Render as a viewer. */
  function renderViewer(readings = copilotReadings()) {
    return render(<CopilotScreen readings={readings} role="viewer" />);
  }

  it("is told once what they are, as on the other two surfaces", () => {
    renderViewer(copilotReadingsWith({ conversation: { ok: true, value: null } }));

    expect(screen.getByRole("note")).toHaveTextContent("Viewing the studio as a viewer.");
  });

  it("finds both actions present and inert, each with the role's reason", () => {
    renderViewer();

    expect(promote()).toHaveAttribute("aria-disabled", "true");
    expect(promote()).toHaveAttribute("title", PROMOTE_MEMBER_REASON);
    expect(discard()).toHaveAttribute("aria-disabled", "true");
    expect(discard()).toHaveAttribute("title", DISCARD_MEMBER_REASON);

    fireEvent.click(promote());
    fireEvent.click(discard());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(publishWorkflow).not.toHaveBeenCalled();
    expect(discardCopilotDraft).not.toHaveBeenCalled();
  });

  it("reads an open conversation in the same card, read-only, with the reason it cannot be continued", () => {
    renderViewer();

    const conversation = seat("conversation");

    expect(within(conversation).getByRole("note")).toHaveTextContent(ROLE_TRANSCRIPT_NOTE);
    expect(within(conversation).getByRole("group", { name: MESSAGES_LABEL })).toHaveTextContent(copilotMessage().body);
    expect(within(conversation).queryByRole("textbox")).toBeNull();
    expect(within(conversation).queryByRole("button", { name: SEND_LABEL })).toBeNull();
  });

  it("is told there is no conversation yet, for a workflow that never had one", () => {
    renderViewer(copilotReadingsWith({ conversation: { ok: true, value: null } }));

    expect(seat("conversation")).toHaveTextContent(EMPTY_READER_TITLE);
    expect(within(seat("conversation")).queryByRole("textbox")).toBeNull();
  });

  it("is still shown what blocks the draft, for whoever they ask to promote it", () => {
    renderViewer(
      copilotReadingsWith({
        promotion: {
          ok: true,
          value: copilotPromotion({ blocked: true, blockedReasons: ["Blocked."], references: [copilotReference()] }),
        },
      }),
    );

    expect(promote()).toHaveAttribute("title", PROMOTE_MEMBER_REASON);
    expect(screen.getByRole("group", { name: BLOCKED_HEADING })).toHaveTextContent("stage patch · dependency-bump");
  });

  it("defaults to the page a viewer sees when the caller forgot the role", () => {
    render(<CopilotScreen readings={copilotReadings()} />);

    expect(promote()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByRole("note")[0]).toHaveTextContent("Viewing the studio as a viewer.");
  });

  it("draws no read-only note for an owner", () => {
    renderOwner();

    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the states with no workflow open", () => {
  it("names a slug the workspace does not have, beside the rail that leads back", () => {
    renderOwner(copilotReadings({ requested: "retired-loop", selected: null }));

    expect(screen.getByText(COPILOT_MISSING_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/no workflow called retired-loop/)).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: RAIL_LABEL })).getAllByRole("link")).toHaveLength(6);
    expect(screen.queryByRole("region", { name: COPILOT_SEATS.conversation.title })).toBeNull();
    for (const control of [promote("Promote draft"), discard()]) {
      expect(control).toHaveAttribute("title", ACTIONS_NEED_WORKFLOW);
    }
  });

  it("wears the banner for a rail nobody could read", () => {
    renderOwner(copilotReadings({ rail: { ok: false, reason: "The service is down." }, selected: null }));

    expect(screen.getByText(RAIL_FAILED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("The service is down.")).toBeInTheDocument();
    expect(promote("Promote draft")).toHaveAttribute("aria-disabled", "true");
  });

  it("points an empty workspace at the create flow", () => {
    renderOwner(copilotReadings({ rail: { ok: true, value: [] }, selected: null }));

    expect(screen.getByText(COPILOT_EMPTY_NOTE)).toBeInTheDocument();
  });

  it("makes Copilot's own segment a link to the slug the URL named, as the code view does", () => {
    renderOwner(copilotReadings({ requested: "retired-loop", selected: null }));

    expect(within(segments()).getByRole("link", { name: "Copilot" })).toHaveAttribute(
      "href",
      workflowCopilotPath("retired-loop"),
    );
    expect(COPILOT_NEEDS_WORKFLOW_NOTE).toMatch(/pick one from the rail/);
  });
});

describe("one failed read is one degraded region", () => {
  it("wears the banner for a promotion summary that could not be read, and switches both actions off", () => {
    renderOwner(copilotReadingsWith({ promotion: { ok: false, reason: "The summary is unavailable." } }));

    expect(screen.getByText(PROMOTION_FAILED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("The summary is unavailable.")).toBeInTheDocument();
    // The label still names the workflow, counted from the rail.
    expect(promote()).toHaveAttribute("title", ACTIONS_NEED_PROMOTION);
    expect(discard()).toHaveAttribute("title", ACTIONS_NEED_PROMOTION);
    // The seats stand.
    expect(seat("stages")).toBeInTheDocument();
  });

  it("wears the banner for a draft that could not be read, and takes only the stage list's seat with it", () => {
    renderOwner(copilotReadingsWith({ draft: { ok: false, reason: "The draft is unavailable." } }));

    expect(screen.getByText(DRAFT_FAILED_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("The draft is unavailable.")).toBeInTheDocument();

    const failed = screen.getByRole("region", { name: COPILOT_SEATS.stages.title });
    expect(failed).toHaveAttribute("id", "copilot-stages");
    expect(failed).toHaveTextContent(COPILOT_SEATS.stages.note);
    expect(within(failed).queryByRole("listitem")).toBeNull();
    // The conversation and promote are untouched.
    expect(seat("conversation")).toBeInTheDocument();
    expect(promote()).not.toHaveAttribute("aria-disabled");
  });

  it("wears the banner for a conversation that could not be read, and leaves promote working", () => {
    renderOwner(copilotReadingsWith({ conversation: { ok: false, reason: "The conversation is unavailable." } }));

    expect(screen.getByText(CONVERSATION_FAILED_HEADLINE)).toBeInTheDocument();
    expect(promote()).not.toHaveAttribute("aria-disabled");
    expect(seat("conversation")).toHaveTextContent(COPILOT_SEATS.conversation.note);
  });
});

describe("the shell", () => {
  it("mounts in the content pane and draws no chrome of its own", () => {
    const { container } = renderOwner();

    expect(screen.getByRole("main")).toHaveClass("studio");
    expect(container.querySelector(".topbar, .sidebar, .appshell")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("MAIN");
  });

  it("has two navigation regions of its own — the tab row and the rail — named apart from the sidebar", () => {
    renderOwner();

    expect(screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"))).toEqual([
      STUDIO_EYEBROW,
      RAIL_LABEL,
    ]);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <CopilotScreen mayAdminister readings={copilotReadings()} role="owner" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(title()).toHaveTextContent(COPILOT_TITLE);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const blockedAndFlagged = copilotReadingsWith({
      promotion: {
        ok: true,
        value: copilotPromotion({
          blocked: true,
          blockedReasons: ["Blocked."],
          references: [copilotReference(), ADVISORY_REFERENCE],
        }),
      },
      conversation: { ok: true, value: closedConversation("discarded") },
    });
    const [light, dark] = renderInBothPalettes(<CopilotScreen readings={blockedAndFlagged} role="member" />);

    expect(light).toContain("copilot-view__gate--blocked");
    expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
  });

  it("draws the same confirmation in both", () => {
    const html = PALETTES.map((palette) => {
      const { unmount } = renderInPalette(
        palette,
        <CopilotScreen mayAdminister readings={copilotReadings()} role="owner" />,
      );
      fireEvent.click(promote());
      const dialog = screen.getByRole("dialog", { name: PROMOTE }).outerHTML;
      unmount();

      return maskIds(dialog);
    });

    expect(html[0]).toContain("copilot-view__guard--unenforced");
    expect(html[0]).toBe(html[1]);
  });
});
