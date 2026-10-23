import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FirstLoopCard } from "@/app/get-started/first-loop-card";
import {
  CONSOLE_LINK,
  FIRST_LOOP_PENDING,
  MERGE_GUIDANCE_TITLE,
  REVIEW_ACK,
  REVIEW_DRAFT_BECAUSE,
  REVIEW_LINK,
} from "@/app/get-started/first-loop-view";

import { FIRST_RUN_ID, after, firstConsole, firstLoop, firstPullRequest } from "../helpers/first-loop";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The first loop's card (BD.1, #396): every state says where the run stands with the console's
 * link; the guided review once the draft PR opens; the merge guidance only after the review.
 */

const NOW = Date.parse(after(120));

/** The card. */
const card = () => screen.getByRole("region", { name: "Your first loop" });

/**
 * Render the card.
 *
 * @param props What to change.
 * @returns The render.
 */
function draw(props: Partial<Parameters<typeof FirstLoopCard>[0]> = {}) {
  return render(
    <FirstLoopCard
      failure={null}
      loop={firstLoop()}
      now={NOW}
      onReviewed={() => {}}
      reviewedAt={null}
      runId={FIRST_RUN_ID}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("the first loop's card", () => {
  it("says it is reading before the first answer, and why when it cannot", () => {
    const { rerender } = draw({ loop: null });
    expect(within(card()).getByRole("status")).toHaveTextContent(FIRST_LOOP_PENDING);

    rerender(
      <FirstLoopCard failure="Down." loop={null} now={NOW} onReviewed={() => {}} reviewedAt={null} runId={FIRST_RUN_ID} />,
    );
    expect(within(card()).getByRole("alert")).toHaveTextContent("Down.");
  });

  it("says where a running loop is, with the run console's link", () => {
    draw();

    expect(within(card()).getByRole("status")).toHaveTextContent("The loop is running — now at Implement.");
    expect(within(card()).getByRole("link", { name: CONSOLE_LINK })).toHaveAttribute("href", `/runs/${FIRST_RUN_ID}`);
  });

  it.each([
    ["stalled", { now: Date.parse(after(65 + 20 * 60)) }, "The loop has not moved for 20 minutes."],
    ["failed", { loop: firstLoop({ console: firstConsole({ status: "failed", finishedAt: after(300) }, []) }) }, "The loop failed: Implement failed."],
    ["budget", { loop: firstLoop({ console: firstConsole({ status: "canceled", finishedAt: after(300) }), budget: "token_budget" }) }, "a stage reached its token budget"],
    ["cancelled", { loop: firstLoop({ console: firstConsole({ status: "canceled", finishedAt: after(300) }) }) }, "The loop was cancelled"],
  ])("states a %s loop honestly, as an alert, with the console's link", (_name, props, words) => {
    draw(props);

    expect(within(card()).getByRole("alert")).toHaveTextContent(words);
    expect(within(card()).getByRole("link", { name: CONSOLE_LINK })).toBeInTheDocument();
  });

  it("sends a loop waiting on a person to Needs you", () => {
    draw({ loop: firstLoop({ console: firstConsole({ status: "needs_human" }) }) });

    expect(within(card()).getByRole("alert")).toHaveTextContent("waiting on you");
    expect(within(card()).getByRole("link", { name: "Open Needs you →" })).toHaveAttribute("href", "/inbox");
  });

  it("walks the person to the diff and checks once the draft PR opens, and says dry-run is why it is a draft", () => {
    const pr = firstPullRequest();
    draw({ loop: firstLoop({ console: firstConsole({ status: "review" }), pullRequest: pr }) });

    const review = within(card()).getByRole("region", { name: `Review your first pull request — #${String(pr.number)}` });
    expect(within(review).getByRole("link", { name: REVIEW_LINK })).toHaveAttribute("href", `/prs/${pr.id}`);
    expect(review).toHaveTextContent(REVIEW_DRAFT_BECAUSE);
    expect(within(review).getByRole("link", { name: "the dry-run policy" })).toHaveAttribute("href", "/settings#policies");
  });

  it("offers the merge guidance only after the review is acknowledged", () => {
    const onReviewed = vi.fn();
    const loop = firstLoop({ console: firstConsole({ status: "review" }), pullRequest: firstPullRequest() });
    const { rerender } = draw({ loop, onReviewed });

    expect(screen.queryByText(MERGE_GUIDANCE_TITLE)).not.toBeInTheDocument();
    fireEvent.click(within(card()).getByRole("button", { name: REVIEW_ACK }));
    expect(onReviewed).toHaveBeenCalledTimes(1);

    rerender(
      <FirstLoopCard failure={null} loop={loop} now={NOW} onReviewed={onReviewed} reviewedAt={after(600)} runId={FIRST_RUN_ID} />,
    );

    const note = within(card()).getByRole("note");
    expect(note).toHaveTextContent(MERGE_GUIDANCE_TITLE);
    expect(within(note).getByRole("link", { name: "Settings → Policies →" })).toHaveAttribute("href", "/settings#policies");
    expect(within(card()).queryByRole("button", { name: REVIEW_ACK })).not.toBeInTheDocument();
  });

  it("says a closed PR was closed without merging, links it, and offers no review", () => {
    const pr = firstPullRequest({ state: "closed" });
    draw({ loop: firstLoop({ pullRequest: pr }) });

    expect(within(card()).getByRole("alert")).toHaveTextContent("closed without merging");
    expect(within(card()).getByRole("link", { name: REVIEW_LINK })).toHaveAttribute("href", `/prs/${pr.id}`);
    expect(within(card()).queryByRole("button", { name: REVIEW_ACK })).not.toBeInTheDocument();
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <FirstLoopCard
        failure={null}
        loop={firstLoop({ pullRequest: firstPullRequest() })}
        now={NOW}
        onReviewed={() => {}}
        reviewedAt={after(600)}
        runId={FIRST_RUN_ID}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("first-loop");
  });
});
