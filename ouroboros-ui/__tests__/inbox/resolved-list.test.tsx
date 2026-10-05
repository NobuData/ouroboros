import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxResolved } from "@/app/api/inbox";
import { ResolvedList } from "@/app/inbox/resolved-list";
import { NO_EARLIER_DAY, READING_DAY } from "@/app/inbox/resolved-view";

import { resolvedDay, resolvedRow, utcClock } from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The **Resolved today** list (BO.3, #468): the seeded five as the mockup draws them, a policy's
 * answer set apart with the rule that fired, answers from elsewhere saying so, the fold, the day
 * pager, and the quiet line for a day with nothing.
 */

const onCollapse = vi.fn();
const onDay = vi.fn();

/** The list, over a day. */
function list(resolved: InboxResolved | null = resolvedDay(), props: Partial<Parameters<typeof ResolvedList>[0]> = {}) {
  return render(
    <ResolvedList
      clock={utcClock}
      collapsed={false}
      day={null}
      failure={null}
      onCollapse={onCollapse}
      onDay={onDay}
      resolved={resolved}
      {...props}
    />,
  );
}

/** The section. */
const section = () => screen.getByRole("region", { name: "Resolved decisions" });

/** Each row's text, as a reader sees it (the visually hidden words left out). */
function rows(): HTMLElement[] {
  return within(section()).getAllByRole("listitem");
}

beforeEach(() => {
  onCollapse.mockReset();
  onDay.mockReset();
});

describe("the seeded day", () => {
  it("heads the list *Resolved today · 5* and draws the five rows, newest first", () => {
    list();

    expect(screen.getByRole("button", { name: "Resolved today · 5" })).toHaveAttribute("aria-expanded", "true");
    expect(rows().map((row) => row.querySelector(".inbox-resolved__line")?.textContent)).toEqual([
      "Add watchdog reset on I²C lockup needed a human — retried with a note",
      "Split #490 into 6 tickets — approved",
      "Estimator re-size #479 M→L — kept the old size",
      "Estimator re-size #486 L→M — auto-accepted by policy",
      "Plan sign-off for Rework the OTA bootloader handoff — signed off",
    ]);
  });

  it("draws both mockup rows verbatim: the tick, the line with its key in mono, the mono time", () => {
    list();

    const [, split, , auto] = rows() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    expect(split.querySelector(".inbox-resolved__tick")).toHaveTextContent("✓");
    expect(split.querySelector(".inbox-resolved__line")).toHaveTextContent("Split #490 into 6 tickets — approved");
    expect(split.querySelector(".inbox-resolved__mono")).toHaveTextContent("#490");
    expect(split.querySelector(".inbox-resolved__when")).toHaveTextContent("09:12");

    expect(auto.querySelector(".inbox-resolved__line")).toHaveTextContent(
      "Estimator re-size #486 L→M — auto-accepted by policy",
    );
    expect(auto.querySelector(".inbox-resolved__mono")).toHaveTextContent("#486");
    expect(auto.querySelector(".inbox-resolved__when")).toHaveTextContent("08:47");
  });

  it("stamps each time as a machine-readable instant", () => {
    list();

    expect(rows()[1]!.querySelector("time")).toHaveAttribute("datetime", "2026-10-04T09:12:00.000Z");
  });

  it("renders the same markup in both palettes — every hue is a token", () => {
    const [light, dark] = renderInBothPalettes(
      <ResolvedList
        clock={utcClock}
        collapsed={false}
        day={null}
        failure={null}
        onCollapse={onCollapse}
        onDay={onDay}
        resolved={resolvedDay()}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("inbox-resolved__row");
  });
});

describe("the row is composed, not stored", () => {
  it("draws whatever line the service composed — change the row and the page changes", () => {
    list(
      resolvedDay({
        rows: [resolvedRow({ subject: "Split #512 into 3 tickets", verdict: "discarded" })],
      }),
    );

    expect(rows()[0]!.querySelector(".inbox-resolved__line")).toHaveTextContent(
      "Split #512 into 3 tickets — discarded",
    );
    expect(rows()[0]!.querySelector(".inbox-resolved__mono")).toHaveTextContent("#512");
  });
});

describe("what the system decided without anybody", () => {
  it("sets the policy's verdict apart from a person's", () => {
    list();

    const [, split, , auto] = rows() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    expect(auto.querySelector(".inbox-resolved__verdict")).toHaveClass("inbox-resolved__verdict--policy");
    expect(auto.querySelector(".inbox-resolved__verdict")).toHaveTextContent("auto-accepted by policy");
    expect(split.querySelector(".inbox-resolved__verdict")).not.toHaveClass("inbox-resolved__verdict--policy");
  });

  it("names the rule that fired, with a link to where it is configured", () => {
    list();

    const auto = rows()[3]!;
    const why = within(auto).getByRole("button", { name: "Why nobody was asked" });
    const note = within(auto).getByRole("note");

    expect(note).toHaveTextContent("Rule auto_accept_resize · org policy v7");
    expect(why).toHaveAccessibleDescription(expect.stringContaining("Rule auto_accept_resize · org policy v7"));
    expect(within(note).getByRole("link", { name: "Configure →" })).toHaveAttribute("href", "/settings#policies");
  });

  it("pins the note open on a press, and closes it on a second press or Escape", () => {
    list();

    const auto = rows()[3]!;
    const why = within(auto).getByRole("button", { name: "Why nobody was asked" });
    const tip = auto.querySelector(".inbox-resolved__policy")!;

    expect(why).toHaveAttribute("aria-expanded", "false");
    expect(tip).not.toHaveClass("inbox-resolved__policy--pinned");

    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(tip).toHaveClass("inbox-resolved__policy--pinned");

    fireEvent.keyDown(why, { key: "Escape" });
    expect(tip).not.toHaveClass("inbox-resolved__policy--pinned");

    fireEvent.click(why);
    fireEvent.click(why);
    expect(why).toHaveAttribute("aria-expanded", "false");
  });

  it("gives no note to a person's answer, or to an item its source settled", () => {
    list(
      resolvedDay({
        rows: [
          resolvedRow(),
          resolvedRow({
            itemId: "i-2",
            resolver: "policy",
            policy: "source_resolved",
            policyHref: null,
            verdict: "closed — settled elsewhere",
            actor: null,
            channel: "api",
          }),
        ],
      }),
    );

    expect(within(section()).queryByRole("button", { name: "Why nobody was asked" })).toBeNull();
    // Still a policy's doing, and still drawn apart — whole, dash and all.
    expect(rows()[1]!.querySelector(".inbox-resolved__verdict--policy")).toHaveTextContent("closed — settled elsewhere");
  });
});

describe("answer-from-anywhere, evidenced", () => {
  it("shows the channel of an answer that did not come from this page", () => {
    list();

    const [push, web, slack, policy, github] = rows() as HTMLElement[];

    expect(push!.querySelector(".inbox-resolved__channel")).toHaveTextContent("push");
    expect(slack!.querySelector(".inbox-resolved__channel")).toHaveTextContent("Slack");
    expect(github!.querySelector(".inbox-resolved__channel")).toHaveTextContent("GitHub");
    expect(github!.querySelector(".inbox-resolved__channel")).toHaveAttribute(
      "title",
      "Answered from GitHub by Maya Chen",
    );
    // The web is where this page is, and a policy answered from nowhere.
    expect(web!.querySelector(".inbox-resolved__channel")).toBeNull();
    expect(policy!.querySelector(".inbox-resolved__channel")).toBeNull();
  });

  it("shows email", () => {
    list(resolvedDay({ rows: [resolvedRow({ channel: "email", verdict: "allowed once" })] }));

    expect(rows()[0]!.querySelector(".inbox-resolved__channel")).toHaveTextContent("email");
  });
});

describe("the fold", () => {
  it("asks to fold when the heading is pressed, and to open when folded", () => {
    list();
    fireEvent.click(screen.getByRole("button", { name: "Resolved today · 5" }));
    expect(onCollapse).toHaveBeenLastCalledWith(true);
    cleanup();

    list(resolvedDay(), { collapsed: true });
    fireEvent.click(screen.getByRole("button", { name: "Resolved today · 5" }));
    expect(onCollapse).toHaveBeenLastCalledWith(false);
  });

  it("keeps the day and its count on the heading while folded, and hides the rows and the pager", () => {
    list(resolvedDay(), { collapsed: true });

    const heading = screen.getByRole("button", { name: "Resolved today · 5" });

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(heading.querySelector(".inbox-resolved__caret")).toHaveTextContent("▸");
    expect(within(section()).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(section()).queryByRole("group", { name: "Resolved history" })).toBeNull();
    expect(document.getElementById(heading.getAttribute("aria-controls")!)).not.toBeVisible();
  });
});

describe("the day pager", () => {
  it("steps back to the last day that had a resolution", () => {
    list();

    fireEvent.click(screen.getByRole("button", { name: "‹ Earlier" }));

    expect(onDay).toHaveBeenCalledExactlyOnceWith("2026-10-02");
    // Today has nowhere later to go.
    expect(screen.queryByRole("button", { name: "Later ›" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });

  it("is inert, with the reason, when no earlier day has any", () => {
    list(resolvedDay({ previousDay: null }));

    const earlier = screen.getByRole("button", { name: "‹ Earlier" });
    expect(earlier).toHaveAttribute("aria-disabled", "true");
    expect(earlier).toHaveAttribute("title", NO_EARLIER_DAY);

    fireEvent.click(earlier);
    expect(onDay).not.toHaveBeenCalled();
  });

  it("names a past day, and offers the day after and today", () => {
    list(
      resolvedDay({ day: "2026-10-02", rows: [resolvedRow()], previousDay: "2026-09-30", nextDay: "2026-10-03" }),
      { day: "2026-10-02" },
    );

    expect(screen.getByRole("button", { name: "Resolved Oct 2, 2026 · 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Later ›" }));
    expect(onDay).toHaveBeenLastCalledWith("2026-10-03");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onDay).toHaveBeenLastCalledWith(null);
  });
});

describe("a day with nothing to list", () => {
  it("is one quiet line — not an empty container", () => {
    list(resolvedDay({ rows: [] }));

    expect(screen.getByRole("button", { name: "Resolved today · 0" })).toBeInTheDocument();
    expect(within(section()).getByText("Nothing has been resolved today.")).toHaveClass("inbox-resolved__quiet");
    expect(within(section()).queryByRole("list")).toBeNull();
  });

  it("names a past day that had none", () => {
    list(resolvedDay({ day: "2026-10-03", rows: [], nextDay: "2026-10-04" }), { day: "2026-10-03" });

    expect(within(section()).getByText("Nothing was resolved on Oct 3, 2026.")).toBeInTheDocument();
  });

  it("says a day is being read, names it, and keeps a way back to today", () => {
    list(null, { day: "2026-09-30" });

    expect(screen.getByRole("button", { name: "Resolved Sep 30, 2026" })).toBeInTheDocument();
    expect(within(section()).getByText(READING_DAY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "‹ Earlier" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("says why when the day could not be read", () => {
    list(null, { failure: "The resolved list could not be reached." });

    expect(within(section()).getByText("The resolved list could not be reached.")).toBeInTheDocument();
  });
});
