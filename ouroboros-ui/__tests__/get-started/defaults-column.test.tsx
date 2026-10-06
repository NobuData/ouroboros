import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OnboardingDefaults } from "@/app/api/onboarding";
import { DefaultsColumn, ReassureStrip, TimelineCard } from "@/app/get-started/defaults-column";
import type { DefaultsPollOptions } from "@/app/get-started/defaults-poll";
import {
  BASIS_LINES,
  DEPLOYMENT_NOTES,
  FABRICATED_AGGREGATE,
  LOADING_DEFAULTS,
  PROJECTED_NOTE,
  claimNote,
  estimatorAffix,
} from "@/app/get-started/defaults-view";
import type { PollAnswer } from "@/app/poll";

import {
  FIRST_ISSUE_READ_AT,
  REPO,
  defaultRow,
  estimatorStatus,
  genericTimeline,
  mergingDefaults,
  projectedTimeline,
  reassureClaim,
  saasDefaults,
  selfHostedDefaults,
} from "../helpers/onboarding";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The right column (BC.5, #394, mockup 13): the *Smart Defaults* rows as the deployment selected
 * them — self-hosted shows BYOK and enroll-a-runner and no managed copy (O6), a SaaS fixture the
 * managed rows — the estimator row's real last run, the dim Slack row; the *What Happens Next*
 * timeline with every row `projected` (O7), the review and merge rows reflecting dry-run truth,
 * the live-upgrade slot, and no aggregate claim anywhere (O8); the reassure strip's claims each
 * linked to their mechanism, absent claims absent (O9); the loading, failed and polled states;
 * both themes.
 */

/** What the poll answers next; null never answers. */
let answer: PollAnswer<OnboardingDefaults> | null = null;

const POLL: DefaultsPollOptions = {
  read: () => (answer === null ? new Promise(() => {}) : Promise.resolve(answer)),
  visible: () => true,
};

const NOW = () => FIRST_ISSUE_READ_AT;

/**
 * The column over a first read.
 *
 * @param initial The first paint's column.
 * @param extra Anything else to pass.
 * @returns The render.
 */
function column(initial: OnboardingDefaults = selfHostedDefaults(), extra: Partial<Parameters<typeof DefaultsColumn>[0]> = {}) {
  return render(<DefaultsColumn initial={{ ok: true, value: initial }} now={NOW} poll={POLL} repo={REPO} {...extra} />);
}

/** The three regions. */
const defaults = () => screen.getByRole("region", { name: "Smart defaults" });
const timeline = () => screen.getByRole("region", { name: "What happens next" });
const strip = () => screen.getByRole("region", { name: "Why this is safe to try" });

/** The defaults rows, in order. */
const rows = () => within(within(defaults()).getByRole("list", { name: "What is set up for you" })).getAllByRole("listitem");

/** The timeline rows, in order. */
const steps = () => within(within(timeline()).getByRole("list", { name: "Projected first loop" })).getAllByRole("listitem");

/** Each timeline row's printed time. */
const times = () => steps().map((step) => step.querySelector(".timeline__time")!.textContent);

/** A fresh poll answer. */
function fresh(payload: OnboardingDefaults): PollAnswer<OnboardingDefaults> {
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
});

afterEach(() => {
  cleanup();
});

describe("the defaults card", () => {
  it("shows a self-hosted deployment the BYOK and enroll-a-runner rows and no trial-credit or hosted-runner copy (O6)", () => {
    column();

    expect(within(defaults()).getByText("zero config")).toHaveAttribute("title", DEPLOYMENT_NOTES.self_hosted);

    const [models, build] = rows();
    expect(rows()).toHaveLength(4);
    expect(models).toHaveTextContent("Ready: Models: bring your own keys → Providers");
    expect(within(models!).getByRole("link", { name: "Providers" })).toHaveAttribute("href", "/models/providers");
    expect(build).toHaveTextContent("Ready: Build: enroll a runner → Build Farm");
    expect(within(build!).getByRole("link", { name: "Build Farm" })).toHaveAttribute("href", "/build-farm");

    expect(defaults()).not.toHaveTextContent(/managed keys|hosted runner|trial/i);
    expect(defaults()).not.toHaveTextContent("$");
  });

  it("renders a SaaS-flagged fixture's managed rows as sent — forward-compatible with #397", () => {
    column(saasDefaults());

    expect(within(defaults()).getByText("zero config")).toHaveAttribute("title", DEPLOYMENT_NOTES.saas);

    const [models, build] = rows();
    expect(models).toHaveTextContent("Models: managed keys with $5 trial credit — bring your own keys anytime");
    expect(within(models!).getByRole("link", { name: "bring your own keys anytime" })).toHaveAttribute("href", "/models/providers");
    expect(build).toHaveTextContent("Build: hosted runner for your first loops — enroll your own farm later");
    expect(within(build!).getByRole("link", { name: "enroll your own farm later" })).toHaveAttribute("href", "/build-farm");
  });

  it("shows the estimator row's real nightly run, not a static string — and says when it has not run", () => {
    const { unmount } = column();

    const estimator = rows()[2]!;
    expect(estimator).toHaveTextContent("Estimator pre-sizes your backlog overnight");
    expect(estimator.querySelector(".defaults__affix")).toHaveTextContent(estimatorAffix(estimatorStatus(), new Date(FIRST_ISSUE_READ_AT)));
    expect(estimator.querySelector(".defaults__affix")).toHaveTextContent(/^last run \S+ ago ✓ · nightly at 02:00 UTC$/);
    unmount();

    column(
      selfHostedDefaults({
        rows: [defaultRow({ key: "models" }), defaultRow({ key: "build" }), defaultRow({ key: "estimator", estimator: estimatorStatus({ lastRun: null }) }), defaultRow({ key: "slack" })],
      }),
    );

    expect(rows()[2]!.querySelector(".defaults__affix")).toHaveTextContent("not run yet · nightly at 02:00 UTC");
  });

  it("draws the Slack row dim and optional, saying what it waits for, with no link until its surface exists", () => {
    const { unmount } = column();

    const slack = rows()[3]!;
    expect(slack).toHaveClass("defaults__row--optional");
    expect(slack).toHaveTextContent("Optional: Slack: connect after your first PR (optional)");
    expect(slack.querySelector(".defaults__affix")).toHaveTextContent("arrives with ChatOps");
    expect(within(slack).queryByRole("link")).toBeNull();
    unmount();

    // When the service sends the row linked (the ChatOps surface, #541), the link renders as sent.
    column(
      selfHostedDefaults({
        rows: [defaultRow({ key: "models" }), defaultRow({ key: "build" }), defaultRow({ key: "estimator" }), defaultRow({ key: "slack", link: { label: "ChatOps", path: "/chatops" } })],
      }),
    );

    expect(within(rows()[3]!).getByRole("link", { name: "ChatOps" })).toHaveAttribute("href", "/chatops");
  });

  it("marks ready rows with the tick and the optional row with the ring, hidden from the reader who hears the state", () => {
    column();

    expect(rows()[0]!.querySelector(".defaults__mark")).toHaveTextContent("✓");
    expect(rows()[0]!.querySelector(".defaults__mark")).toHaveAttribute("aria-hidden");
    expect(rows()[3]!.querySelector(".defaults__mark")).toHaveTextContent("○");
  });
});

describe("the timeline card", () => {
  it("labels every row projected in the MVP, and the card itself", () => {
    column();

    expect(steps()).toHaveLength(5);
    for (const step of steps()) expect(within(step).getByText("projected")).toHaveAttribute("title", PROJECTED_NOTE);
    expect(within(timeline()).getAllByText("projected")).toHaveLength(6);
  });

  it("prints the mockup's times from the issue's own estimate, and treats the review and merge rows", () => {
    column();

    expect(times()).toEqual(["0:00", "", "~4 min", "", ""]);
    expect(steps()[0]).toHaveTextContent("loop starts on #488");
    expect(steps()[2]).toHaveTextContent("draft PR opens");
    expect(steps()[3]).toHaveClass("timeline__row--you");
    expect(steps()[3]).toHaveTextContent("you review");
    expect(steps()[4]).toHaveClass("timeline__row--end");
    expect(steps()[4]).toHaveTextContent("merge — only when you say so; dry-run never merges");
    expect(steps()[4]!.querySelector(".timeline__node")).toHaveTextContent("○");
    expect(within(timeline()).getByText(BASIS_LINES.issue_estimate)).toBeInTheDocument();
  });

  it("reflects dry-run truth: off, the PR is not a draft and the merge row is the workflow's decision, not yours", () => {
    column(mergingDefaults());

    expect(steps()[2]).toHaveTextContent("pull request opens");
    expect(steps()[4]).toHaveTextContent("merge — as the workflow's final step decides");
    expect(steps()[4]!.querySelector(".timeline__node")).toHaveTextContent("●");
    expect(steps()[4]).toHaveClass("timeline__row--end");
  });

  it("is honest with no pick and no estimate — generic rows, no time beyond the origin", () => {
    column(selfHostedDefaults({ timeline: genericTimeline() }));

    expect(steps()[0]).toHaveTextContent("loop starts on your first issue");
    expect(times()).toEqual(["0:00", "", "", "", ""]);
    expect(timeline()).not.toHaveTextContent("~");
    expect(within(timeline()).getByText(BASIS_LINES.none)).toBeInTheDocument();
  });

  it("carries the live-upgrade slot (BD.1): a measured row prints its time and drops the label; all measured, the label goes", () => {
    const { unmount } = render(
      <TimelineCard failure={null} live={[{ key: "loop_starts", at: "0:00" }, { key: "plan_posted", at: "0:48" }]} timeline={projectedTimeline()} />,
    );

    expect(times()).toEqual(["0:00", "0:48", "~4 min", "", ""]);
    expect(within(steps()[0]!).queryByText("projected")).toBeNull();
    expect(within(steps()[1]!).queryByText("projected")).toBeNull();
    expect(within(steps()[2]!).getByText("projected")).toBeInTheDocument();
    expect(within(timeline()).getAllByText("projected")).toHaveLength(4);
    unmount();

    render(
      <TimelineCard
        failure={null}
        live={projectedTimeline().rows.map((row) => ({ key: row.key, at: "1:00" }))}
        timeline={projectedTimeline()}
      />,
    );

    expect(within(timeline()).queryByText("projected")).toBeNull();
    expect(timeline()).not.toHaveTextContent(BASIS_LINES.issue_estimate);
  });

  it("renders no average-time or percentage claim anywhere on the column (O8) — the mockup's footer does not ship", () => {
    for (const fixture of [selfHostedDefaults(), saasDefaults(), mergingDefaults(), selfHostedDefaults({ timeline: genericTimeline() })]) {
      const { container, unmount } = column(fixture);

      expect(container.textContent, fixture.deployment).not.toMatch(FABRICATED_AGGREGATE);
      expect(container.textContent).not.toMatch(/4m 10s/);
      unmount();
    }
  });
});

describe("the reassure strip", () => {
  it("links each claim to the surface that proves it, with the mechanism named for the tooltip and the reader", () => {
    column();

    const links = within(strip()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Nothing is written to main.",
      "The GitHub connection can be paused in one click.",
      "Your keys are sealed in the tenant vault and never leave the control plane.",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/settings/policies", "/settings/sources", "/models/providers"]);
    expect(links[0]).toHaveAttribute("title", claimNote(reassureClaim("draft_only")));
    expect(strip()).toHaveTextContent("(Because: The dry-run policy is on");
    expect(strip()).toHaveTextContent("(#222)");
  });

  it("renders only the claims this workspace has a mechanism for — one, or none at all", () => {
    const { unmount } = column(mergingDefaults());

    expect(within(strip()).getAllByRole("link")).toHaveLength(1);
    expect(strip()).not.toHaveTextContent("Nothing is written to main.");
    expect(strip()).not.toHaveTextContent(/paused|uninstalled/);
    unmount();

    column(selfHostedDefaults({ reassure: { claims: [], line: "" } }));

    expect(screen.queryByRole("region", { name: "Why this is safe to try" })).toBeNull();
  });

  it("prints a claim whose mechanism has no surface in this app as words, not a link", () => {
    const vault = reassureClaim("vault");
    render(<ReassureStrip claims={[{ ...vault, mechanism: { ...vault.mechanism, path: null } }]} />);

    expect(within(strip()).queryByRole("link")).toBeNull();
    expect(within(strip()).getByText(vault.text)).toHaveAttribute("title", claimNote(vault));
  });
});

describe("the states", () => {
  it("draws skeletons while the first read is in flight — and no strip, because nothing is claimed yet", () => {
    const { container } = render(<DefaultsColumn initial={null} now={NOW} poll={POLL} repo={REPO} />);

    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([LOADING_DEFAULTS, LOADING_DEFAULTS]);
    expect(container.querySelectorAll(".defaults-skeleton__bone")).toHaveLength(9);
    expect(screen.queryByRole("region", { name: "Why this is safe to try" })).toBeNull();
    expect(screen.queryByText("projected")).toBeNull();
  });

  it("says why the column could not be read — once as an alert, and quietly on the timeline", () => {
    render(<DefaultsColumn initial={{ ok: false, reason: "The defaults are busy." }} now={NOW} poll={POLL} repo={REPO} />);

    expect(screen.getByRole("alert")).toHaveTextContent("The defaults are busy.");
    expect(within(timeline()).getByText("The defaults are busy.")).not.toHaveAttribute("role");
    expect(screen.queryByRole("region", { name: "Why this is safe to try" })).toBeNull();
  });

  it("is re-read on the poll: a dry-run flip reaches the merge row and the draft-only claim without a reload", async () => {
    column();

    expect(within(strip()).getAllByRole("link")).toHaveLength(3);

    answer = fresh(mergingDefaults());
    await pollNow();

    expect(steps()[4]).toHaveTextContent("merge — as the workflow's final step decides");
    expect(screen.queryByText("Nothing is written to main.")).toBeNull();
    expect(within(strip()).getAllByRole("link")).toHaveLength(1);
  });
});

describe("both themes", () => {
  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <DefaultsColumn initial={{ ok: true, value: selfHostedDefaults() }} now={NOW} poll={POLL} repo={REPO} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("timeline__row--you");
    expect(light).toContain("reassure__claim");
  });
});
