import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FirstIssueCard as FirstIssueCardRead, Onboarding } from "@/app/api/onboarding";
import type { FirstIssuePollOptions } from "@/app/get-started/first-issue-poll";
import {
  LAUNCHED_REASON,
  NO_CANDIDATES_REASON,
  ONLY_CANDIDATE_REASON,
  UNRANKED_NOTE,
  VIEWER_PICK_REASON,
} from "@/app/get-started/first-issue-view";
import type { PollAnswer } from "@/app/poll";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";
import {
  FIRST_ISSUE_READ_AT,
  ISSUE_485,
  ISSUE_488,
  ISSUE_491,
  REPO,
  candidate,
  candidate485,
  candidate491,
  dryRunOff,
  dryRunOn,
  dryRunUnset,
  emptyFirstIssue,
  firstIssueCard,
  noneSafeFirstIssue,
  pickedTicket,
  priced,
  seededAlternatives,
  seededFirstIssue,
  sizingFirstIssue,
  wizard,
} from "../helpers/onboarding";

/**
 * The *"Your first issue"* card (BC.4, #393, mockup 13): the seeded pick with its reasoning and
 * breakdown — cost absent when unpriced — the stored pick over the picker's, *↻ another* and the
 * safety-ranked sheet that store a pick, the safety rows read live from the policy, the cold
 * states with the estimator's real status, and keyboard reach throughout.
 */

const pickFirstIssue = vi.fn();

vi.mock("@/app/get-started/actions", () => ({
  pickFirstIssue: (repo: string, issueId: string) => pickFirstIssue(repo, issueId),
}));

const { FirstIssueCard } = await import("@/app/get-started/first-issue-card");

/** What the poll answers next; null never answers. */
let answer: PollAnswer<FirstIssueCardRead> | null = null;

const POLL: FirstIssuePollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

const OWNER = { contribute: true, administer: true };
const VIEWER = { contribute: false, administer: false };

type Picked = Onboarding["refs"]["pickedTicket"];

/**
 * The card over a first read.
 *
 * @param initial The first paint's card.
 * @param picked The wizard's stored pick.
 * @param extra Anything else to pass.
 * @returns The render.
 */
function card(
  initial: FirstIssueCardRead = firstIssueCard(),
  picked: Picked = pickedTicket(),
  extra: Partial<Parameters<typeof FirstIssueCard>[0]> = {},
) {
  return render(
    <FirstIssueCard
      abilities={OWNER}
      initial={{ ok: true, value: initial }}
      now={() => FIRST_ISSUE_READ_AT}
      pickedTicket={picked}
      poll={POLL}
      repo={REPO}
      stepStatus="todo"
      {...extra}
    />,
  );
}

/** The card's region. */
const region = () => screen.getByRole("region", { name: "Your first issue" });

/** The pick row. */
const row = () => region().querySelector<HTMLElement>(".pick-row")!;

/** The safety rows, in order. */
const safety = () => within(within(region()).getByRole("list", { name: "What keeps this safe" })).getAllByRole("listitem");

/** The sheet. */
const sheet = () => screen.getByRole("dialog", { name: "Pick your own first issue" });

/** A fresh poll answer. */
function fresh(payload: FirstIssueCardRead): PollAnswer<FirstIssueCardRead> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
}

/** Let the poll read its next answer now. */
async function pollNow(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
  });
}

beforeEach(() => {
  answer = null;
  pickFirstIssue.mockReset().mockImplementation((_repo: string, issueId: string) =>
    Promise.resolve({ ok: true, value: wizard({ refs: { detectionScan: null, templates: [], pickedTicket: pickedTicket({ id: issueId }) } }) }),
  );
});

afterEach(() => {
  cleanup();
});

describe("the seeded card", () => {
  it("matches the mockup: the tag, the pick row with key, title, XS chip, docs-loop tag and the reasoning line", () => {
    card();

    expect(within(region()).getByText("step 4 preview")).toBeInTheDocument();
    expect(within(region()).getByRole("link", { name: "Browse all issues →" })).toHaveAttribute("href", "/issues");
    expect(within(region()).getByText("We picked a safe one:")).toBeInTheDocument();

    expect(within(row()).getByRole("link", { name: "#488" })).toHaveAttribute(
      "href",
      "https://github.com/acme-robotics/helios-firmware/issues/488",
    );
    expect(row()).toHaveTextContent("Typo sweep in operator manual + pairing guide");
    expect(within(row()).getByText("XS")).toHaveAttribute("title", "Effort: XS");
    expect(within(row()).getByText("docs-loop")).toHaveClass("ou-tag");
    expect(row().querySelector(".pick-row__why")).toHaveTextContent("no code paths touched · est. 4 min");
  });

  it("prints no cost when the estimate is unpriced — no placeholder, no zero", () => {
    card();

    expect(region()).not.toHaveTextContent("$");
    expect(region()).not.toHaveTextContent(/est\. 0/);
    expect(region()).not.toHaveTextContent(/cost/i);
    expect(row().querySelector(".pick-row__why")).toHaveTextContent(/est\. 4 min$/);
  });

  it("prints the cost when the estimate carries real pricing", () => {
    card(firstIssueCard({ firstIssue: seededFirstIssue({ pick: priced() }), alternatives: seededAlternatives({ candidates: [priced(), candidate491()] }) }));

    expect(row().querySelector(".pick-row__why")).toHaveTextContent("no code paths touched · est. 4 min · est. $0.03");
  });

  it("shows the score's breakdown behind a keyboard-reachable control", () => {
    card();

    const toggle = within(row()).getByRole("button", { name: "Score breakdown for #488" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Score breakdown for #488" })).toBeNull();

    toggle.focus();
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("group", { name: "Score breakdown for #488" });
    expect(within(panel).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "XS effort — 35 of 35",
      "docs-loop workflow — 30 of 30",
      "no code paths touched — 25 of 25",
      "active 1d ago — 9.4 of 10",
    ]);
    expect(panel).toHaveTextContent("99.4 in all under safety-v1 · safety bar 45 · clears it");

    fireEvent.click(toggle);
    expect(screen.queryByRole("group", { name: "Score breakdown for #488" })).toBeNull();
  });

  it("wears the rail's pill — you are here, then done, when the pick can no longer change", () => {
    const { unmount } = card(firstIssueCard(), pickedTicket(), { stepStatus: "active" });
    expect(within(region()).getByText("step 4 · you are here")).toBeInTheDocument();
    unmount();

    card(firstIssueCard(), pickedTicket(), { stepStatus: "done" });
    expect(within(region()).getByText("✓ step 4 done")).toBeInTheDocument();
    expect(within(region()).getByRole("button", { name: "↻ another" })).toHaveAccessibleDescription(LAUNCHED_REASON);
    expect(within(region()).getByRole("button", { name: "or pick your own ▾" })).toHaveAccessibleDescription(LAUNCHED_REASON);
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <FirstIssueCard
        abilities={OWNER}
        initial={{ ok: true, value: firstIssueCard() }}
        now={() => FIRST_ISSUE_READ_AT}
        pickedTicket={pickedTicket()}
        poll={POLL}
        repo={REPO}
        stepStatus="todo"
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("pick-row");
    expect(light).toContain("safety__row--ok");
  });
});

describe("the pick on screen", () => {
  it("is the wizard's stored pick, not the picker's, with its own reasoning", () => {
    card(firstIssueCard(), pickedTicket({ externalKey: "#491", title: "Add CRC32 to config persistence layer" }));

    expect(within(region()).getByText("Your pick:")).toBeInTheDocument();
    expect(within(row()).getByRole("link", { name: "#491" })).toBeInTheDocument();
    expect(row().querySelector(".pick-row__why")).toHaveTextContent("2 code paths touched · est. 11 min");
    expect(within(row()).getByText("S")).toBeInTheDocument();
  });

  it("draws a stored pick nothing scored as picked by hand, inventing no reasoning", () => {
    card(firstIssueCard(), pickedTicket({ externalKey: "#512", title: "Rewrite the bootloader" }));

    expect(within(region()).getByText("Your pick:")).toBeInTheDocument();
    expect(row()).toHaveTextContent("#512");
    expect(row()).toHaveTextContent("Rewrite the bootloader");
    expect(row()).toHaveTextContent(UNRANKED_NOTE);
    expect(row().querySelector(".pick-row__why")).toBeNull();
    expect(within(row()).queryByRole("button")).toBeNull();
  });

  it("shows the picker's suggestion while nothing is stored, and hands it up for the launch", () => {
    const onSuggestion = vi.fn();
    const { rerender } = card(firstIssueCard(), null, { onSuggestion });

    expect(within(region()).getByText("We picked a safe one:")).toBeInTheDocument();
    expect(within(row()).getByRole("link", { name: "#488" })).toBeInTheDocument();
    expect(onSuggestion).toHaveBeenLastCalledWith(ISSUE_488);

    rerender(
      <FirstIssueCard
        abilities={OWNER}
        initial={{ ok: true, value: firstIssueCard() }}
        now={() => FIRST_ISSUE_READ_AT}
        onSuggestion={onSuggestion}
        pickedTicket={pickedTicket()}
        poll={POLL}
        repo={REPO}
        stepStatus="todo"
      />,
    );

    expect(onSuggestion).toHaveBeenLastCalledWith(null);
  });
});

describe("↻ another", () => {
  it("moves to the next candidate in safety order, stores it, and keeps the card where it is", async () => {
    const onChanged = vi.fn();
    card(firstIssueCard(), pickedTicket(), { onChanged });

    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    await settle();

    expect(pickFirstIssue).toHaveBeenCalledExactlyOnceWith(REPO, ISSUE_491);
    expect(within(row()).getByRole("link", { name: "#491" })).toBeInTheDocument();
    expect(within(region()).getByText("Your pick:")).toBeInTheDocument();
    expect(within(region()).getByRole("status")).toHaveTextContent("#491 picked. Run your first loop when you're ready.");
    expect(onChanged).toHaveBeenCalledOnce();

    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    await settle();
    expect(pickFirstIssue).toHaveBeenLastCalledWith(REPO, ISSUE_485);
    expect(within(row()).getByRole("link", { name: "#485" })).toBeInTheDocument();

    // Round the end of the ranking, back to the picker's own pick.
    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    await settle();
    expect(pickFirstIssue).toHaveBeenLastCalledWith(REPO, ISSUE_488);
    expect(within(region()).getByText("We picked a safe one:")).toBeInTheDocument();
  });

  it("lets the rail's next read take over from the pick it stored", async () => {
    const { rerender } = card();

    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    await settle();
    expect(within(row()).getByRole("link", { name: "#491" })).toBeInTheDocument();

    rerender(
      <FirstIssueCard
        abilities={OWNER}
        initial={{ ok: true, value: firstIssueCard() }}
        now={() => FIRST_ISSUE_READ_AT}
        pickedTicket={pickedTicket({ externalKey: "#491", title: "Add CRC32 to config persistence layer" })}
        poll={POLL}
        repo={REPO}
        stepStatus="todo"
      />,
    );

    expect(within(row()).getByRole("link", { name: "#491" })).toBeInTheDocument();
  });

  it("says why when the ranking holds nothing else, and when nothing qualifies", () => {
    const { unmount } = card(firstIssueCard({ alternatives: seededAlternatives({ candidates: [candidate()] }) }));
    expect(within(region()).getByRole("button", { name: "↻ another" })).toHaveAccessibleDescription(ONLY_CANDIDATE_REASON);
    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    expect(pickFirstIssue).not.toHaveBeenCalled();
    unmount();

    card(firstIssueCard({ alternatives: seededAlternatives({ candidates: [] }) }));
    expect(within(region()).getByRole("button", { name: "↻ another" })).toHaveAccessibleDescription(NO_CANDIDATES_REASON);
    expect(within(region()).getByRole("button", { name: "or pick your own ▾" })).toHaveAccessibleDescription(NO_CANDIDATES_REASON);
  });

  it("says the service's refusal and keeps the pick", async () => {
    pickFirstIssue.mockResolvedValue({ ok: false, reason: "Viewers cannot pick." });
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    await settle();

    expect(within(region()).getByRole("alert")).toHaveTextContent("Viewers cannot pick.");
    expect(within(row()).getByRole("link", { name: "#488" })).toBeInTheDocument();
  });

  it("tells a viewer why they cannot change the pick, and sends nothing", () => {
    card(firstIssueCard(), pickedTicket(), { abilities: VIEWER });

    const another = within(region()).getByRole("button", { name: "↻ another" });
    expect(another).toHaveAccessibleDescription(VIEWER_PICK_REASON);
    fireEvent.click(another);
    fireEvent.click(within(region()).getByRole("button", { name: "or pick your own ▾" }));

    expect(pickFirstIssue).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends one pick at a time", async () => {
    let land: (value: unknown) => void = () => {};
    pickFirstIssue.mockReturnValue(new Promise((resolve) => (land = resolve)));
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));
    fireEvent.click(within(region()).getByRole("button", { name: "↻ another" }));

    expect(pickFirstIssue).toHaveBeenCalledOnce();
    await act(async () => land({ ok: true, value: wizard() }));
  });
});

describe("or pick your own", () => {
  it("opens the backlog safety-ranked, each candidate with its reasoning, the current and the below-bar ones marked", () => {
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "or pick your own ▾" }));

    expect(sheet()).toHaveAccessibleDescription(
      "Safest first under safety-v1, each with its own reasoning; the safety bar is 45. 2 set aside: 2 are L or larger.",
    );
    const rows = within(within(sheet()).getByRole("list", { name: "Safety-ranked candidates" })).getAllByRole("button");
    expect(rows.map((one) => one.getAttribute("aria-label"))).toEqual([
      "#488 Typo sweep in operator manual + pairing guide",
      "#491 Add CRC32 to config persistence layer",
      "#485 Watchdog reset on I²C bus lockup",
    ]);
    expect(rows.map((one) => one.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(rows[0]).toHaveTextContent("current pick");
    expect(rows[0]).toHaveTextContent("no code paths touched · est. 4 min · score 99.4");
    expect(rows[1]).toHaveTextContent("2 code paths touched · est. 11 min · score 49.9");
    expect(rows[2]).toHaveTextContent("below the safety bar");
    expect(rows[2]).toHaveTextContent("3 code paths touched · est. 15 min · score 34.9");
    expect(rows[1]).not.toHaveTextContent("below the safety bar");
  });

  it("selecting swaps the pick and closes the sheet", async () => {
    const onChanged = vi.fn();
    card(firstIssueCard(), pickedTicket(), { onChanged });

    fireEvent.click(within(region()).getByRole("button", { name: "or pick your own ▾" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "#491 Add CRC32 to config persistence layer" }));
    await settle();

    expect(pickFirstIssue).toHaveBeenCalledExactlyOnceWith(REPO, ISSUE_491);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(row()).getByRole("link", { name: "#491" })).toBeInTheDocument();
    expect(within(region()).getByText("Your pick:")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("stays open with the refusal when the service refuses", async () => {
    pickFirstIssue.mockResolvedValue({ ok: false, reason: "#491 has no canonical ticket yet." });
    card();

    fireEvent.click(within(region()).getByRole("button", { name: "or pick your own ▾" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "#491 Add CRC32 to config persistence layer" }));
    await settle();

    expect(within(sheet()).getByRole("alert")).toHaveTextContent("#491 has no canonical ticket yet.");
    expect(within(row()).getByRole("link", { name: "#488" })).toBeInTheDocument();
  });

  it("is keyboard-operable: every row is a focusable button, Escape keeps the pick and returns focus", () => {
    card();

    const opener = within(region()).getByRole("button", { name: "or pick your own ▾" });
    opener.focus();
    fireEvent.click(opener);

    for (const button of within(within(sheet()).getByRole("list", { name: "Safety-ranked candidates" })).getAllByRole("button")) {
      button.focus();
      expect(button).toHaveFocus();
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
    expect(within(sheet()).getByRole("button", { name: "Keep the current pick" })).toBeInTheDocument();

    fireEvent.keyDown(sheet(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(pickFirstIssue).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });
});

describe("the safety rows", () => {
  it("read the live policy: on → the draft row holds and links the policy; the inbox and the flip are linked", () => {
    card();

    const [dryRun, inbox, policy] = safety();
    expect(dryRun).toHaveTextContent("Holds: Dry-run: opens a draft PR, never merges (policy)");
    expect(within(dryRun!).getByText("draft").tagName).toBe("STRONG");
    expect(within(dryRun!).getByRole("link", { name: "policy" })).toHaveAttribute("href", "/settings#policies");
    expect(dryRun).toHaveClass("safety__row--ok");

    expect(inbox).toHaveTextContent("Holds: Decisions that need you wait in the Needs-you inbox.");
    expect(within(inbox!).getByRole("link", { name: "Needs-you inbox" })).toHaveAttribute("href", "/inbox");
    expect(inbox).not.toHaveTextContent(/soon|placeholder|coming/i);

    expect(policy).toHaveTextContent("Holds: Flip to auto-merge whenever you're ready — Settings → Policies");
    expect(within(policy!).getByRole("link", { name: "Settings → Policies" })).toHaveAttribute("href", "/settings#policies");
  });

  it("change when dry-run is flipped off in Settings — on the poll, with no reload", async () => {
    card();
    expect(safety()[0]).toHaveTextContent("opens a draft PR, never merges");

    answer = fresh(firstIssueCard({ dryRun: { ok: true, value: dryRunOff() } }));
    await pollNow();

    await waitFor(() => expect(safety()[0]).toHaveClass("safety__row--warn"));
    expect(safety()[0]).toHaveTextContent(
      "Does not hold: Dry-run is off: PRs open ready for review, and a workflow that auto-merges will merge without a person — turn it on in Settings → Policies",
    );
    expect(safety()[0]).not.toHaveTextContent("draft");
    expect(within(safety()[0]!).getByRole("link", { name: "turn it on in Settings → Policies" })).toHaveAttribute("href", "/settings#policies");
    expect(safety()[2]).toHaveTextContent("Turn dry-run back on any time — Settings → Policies");

    answer = fresh(firstIssueCard({ dryRun: { ok: true, value: dryRunOn() } }));
    await pollNow();

    await waitFor(() => expect(safety()[0]).toHaveClass("safety__row--ok"));
    expect(safety()[0]).toHaveTextContent("opens a draft PR, never merges");
  });

  it("say the launch turns dry-run on for a workspace that never answered", () => {
    card(firstIssueCard({ dryRun: { ok: true, value: dryRunUnset() } }));

    expect(safety()[0]).toHaveClass("safety__row--pending");
    expect(safety()[0]).toHaveTextContent(
      "Pending: Dry-run is not set yet — running your first loop turns it on, so the PR opens as a draft and never merges (policy)",
    );
  });

  it("say so when the policy could not be read, rather than guessing", () => {
    card(firstIssueCard({ dryRun: { ok: false, reason: "The service is busy." } }));

    expect(safety()[0]).toHaveClass("safety__row--unknown");
    expect(safety()[0]).toHaveTextContent("Unknown: The dry-run policy could not be read. The service is busy. (policy)");
    expect(safety()).toHaveLength(3);
  });
});

describe("the cold states", () => {
  it("sizing: says so with the real nightly-job status, and offers no pick to change", () => {
    card(firstIssueCard({ firstIssue: sizingFirstIssue(), alternatives: seededAlternatives({ candidates: [] }) }), null);

    expect(within(region()).getByRole("heading", { level: 3 })).toHaveTextContent("We're sizing your backlog");
    expect(region()).toHaveTextContent("3 open issues, none sized yet — the nightly estimator sizes them, and the safest sized one is picked.");
    expect(region()).toHaveTextContent(
      "Nightly estimator: last run 10h ago ✓ — 4 found here, 4 queued, 0 in flight · runs nightly at 02:00 UTC, up to 200 issues.",
    );
    expect(within(region()).queryByRole("button", { name: "↻ another" })).toBeNull();
    expect(within(region()).queryByRole("button", { name: "or pick your own ▾" })).toBeNull();
    expect(region().querySelector(".pick-row")).toBeNull();
    expect(safety()).toHaveLength(3);
  });

  it("empty: points at planning", () => {
    card(firstIssueCard({ firstIssue: emptyFirstIssue(), alternatives: seededAlternatives({ candidates: [] }) }), null);

    expect(within(region()).getByRole("heading", { level: 3 })).toHaveTextContent("No open issues to pick from");
    expect(within(region()).getByRole("link", { name: "Open Planning →" })).toHaveAttribute("href", "/planning");
    expect(region()).not.toHaveTextContent("Nightly estimator");
  });

  it("nothing safe enough: stated plainly with what was set aside — and your own pick still offered, reasoning in view", () => {
    card(
      firstIssueCard({
        firstIssue: noneSafeFirstIssue(),
        alternatives: seededAlternatives({ candidates: [candidate485()], excluded: { protectedPath: 1, tooLarge: 1, belowBar: 1 } }),
      }),
      null,
    );

    expect(within(region()).getByRole("heading", { level: 3 })).toHaveTextContent("Nothing in the backlog is safe enough for a first loop");
    expect(region()).toHaveTextContent(
      "Of 3 sized issues, 1 touches a protected path, 1 is L or larger, 1 scored below the safety bar. 1 more is still being sized.",
    );
    expect(region()).toHaveTextContent("Nightly estimator: last run 10h ago ✓");
    expect(within(region()).queryByRole("button", { name: "↻ another" })).toBeNull();

    fireEvent.click(within(region()).getByRole("button", { name: "or pick your own ▾" }));
    const only = within(sheet()).getByRole("button", { name: "#485 Watchdog reset on I²C bus lockup" });
    expect(only).toHaveTextContent("below the safety bar");
    expect(only).toHaveTextContent("3 code paths touched · est. 15 min · score 34.9");
  });

  it("becomes a pick on the poll once the estimator has sized the backlog", async () => {
    card(firstIssueCard({ firstIssue: sizingFirstIssue(), alternatives: seededAlternatives({ candidates: [] }) }), null);
    expect(region().querySelector(".pick-row")).toBeNull();

    answer = fresh(firstIssueCard());
    await pollNow();

    await waitFor(() => expect(region().querySelector(".pick-row")).not.toBeNull());
    expect(within(row()).getByRole("link", { name: "#488" })).toBeInTheDocument();
  });
});

describe("when the card could not be read", () => {
  it("says why, draws no pick, and leaves the dry-run row unknown rather than guessed", () => {
    render(
      <FirstIssueCard
        abilities={OWNER}
        initial={{ ok: false, reason: "The picker is busy." }}
        pickedTicket={null}
        poll={POLL}
        repo={REPO}
        stepStatus="todo"
      />,
    );

    expect(within(region()).getByRole("alert")).toHaveTextContent("The picker is busy.");
    expect(region().querySelector(".pick-row")).toBeNull();
    expect(safety()[0]).toHaveTextContent("Unknown: Dry-run: not read yet — the policy decides whether the PR opens as a draft. (policy)");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
