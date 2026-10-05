import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Onboarding } from "@/app/api/onboarding";
import type { OnboardingPollOptions } from "@/app/get-started/poll";
import type { PollAnswer } from "@/app/poll";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";
import { REPO, launchReceipt, readyToRun, regressed, step, wizard } from "../helpers/onboarding";

/**
 * `/get-started` (BC.1, #390, mockup 13): the head's promise, the rail that displays the service's
 * derived answer — regressions explained — and the action bar whose primary action changes per
 * step and states its reason when it cannot be pressed.
 */

const continueStep = vi.fn();
const enableRepository = vi.fn();
const launchFirstLoop = vi.fn();
const skipWizard = vi.fn();
const push = vi.fn();

vi.mock("@/app/get-started/actions", () => ({
  continueStep: (repo: string, step: number) => continueStep(repo, step),
  enableRepository: (repo: string) => enableRepository(repo),
  launchFirstLoop: (repo: string) => launchFirstLoop(repo),
  skipWizard: (repo: string) => skipWizard(repo),
  dismissWizard: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { GetStartedScreen } = await import("@/app/get-started/get-started-screen");

/** What the poll answers next; null never answers. */
let answer: PollAnswer<Onboarding> | null = null;
let reads = 0;

const POLL: OnboardingPollOptions = {
  read: () => {
    reads += 1;
    return answer === null ? new Promise(() => {}) : Promise.resolve(answer);
  },
  visible: () => true,
};

const OWNER = { contribute: true, administer: true };

/** The frame over a first read. */
function frame(initial: Onboarding | null = wizard(), abilities = OWNER, repo: string | null = REPO) {
  return render(
    <GetStartedScreen
      abilities={abilities}
      poll={POLL}
      repo={repo}
      reposFailure={null}
      wizard={initial === null ? null : { ok: true, value: initial }}
    />,
  );
}

/** The rail. */
const rail = () => screen.getByRole("navigation", { name: "Get Started steps" });

/** The rail's step buttons, in order. */
const stepButtons = () => within(rail()).getAllByRole("button");

/** The action bar. */
const bar = () => screen.getByRole("group", { name: "Wizard actions" });

beforeEach(() => {
  answer = null;
  reads = 0;
  for (const mock of [continueStep, enableRepository, launchFirstLoop, skipWizard, push]) mock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the head", () => {
  it("is the mockup's eyebrow, headline and promise, with dry-run in bold", () => {
    frame();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your first loop in about 4 minutes.");
    expect(screen.getByText("Get Started")).toBeInTheDocument();

    const sub = screen.getByText(/it opens draft PRs/);

    expect(sub).toHaveTextContent(
      "Ouroboros starts in dry-run: it opens draft PRs and never merges until you say so. Nothing here is irreversible.",
    );
    expect(within(sub).getByText("dry-run").tagName).toBe("STRONG");
  });

  it("offers the skip honestly — it does not claim to import, and it goes where the service says", async () => {
    skipWizard.mockResolvedValue({ ok: true, value: "/settings" });
    frame();

    const skip = screen.getByRole("button", { name: /I've done this before/ });

    expect(skip).not.toHaveTextContent(/import/i);
    expect(skip).toHaveAccessibleDescription(/Nothing is imported/);

    fireEvent.click(skip);
    await settle();

    expect(skipWizard).toHaveBeenCalledWith(REPO);
    expect(push).toHaveBeenCalledWith("/settings");
  });

  it("says why when the skip is refused", async () => {
    skipWizard.mockResolvedValue({ ok: false, reason: "Viewers cannot skip the wizard." });
    frame();

    fireEvent.click(screen.getByRole("button", { name: /I've done this before/ }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Viewers cannot skip the wizard.");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the rail", () => {
  it("draws the service's rail — done steps with their result lines, the active one, the rest", () => {
    frame();

    const [one, two, three, four] = within(rail()).getAllByRole("listitem");

    expect(one).toHaveClass("wizard-step--done");
    expect(one).toHaveTextContent("Step 1Connect GitHub, doneacme-robotics · token");
    expect(two).toHaveTextContent("helios-firmware · auto-detected below");
    expect(three).toHaveClass("wizard-step--active");
    expect(four).toHaveClass("wizard-step--todo");
    expect(four).not.toHaveTextContent("·");
  });

  it("states step 1's connection kind as the service does — token today", () => {
    frame();

    expect(within(rail()).getByText("acme-robotics · token")).toBeInTheDocument();
    expect(rail()).not.toHaveTextContent(/GitHub App installed/);
  });

  it("is reached by keyboard: every step is a button that puts its step on screen", () => {
    frame();

    expect(stepButtons()).toHaveLength(4);
    expect(stepButtons()[2]).toHaveAttribute("aria-current", "step");

    stepButtons()[0]!.focus();
    expect(stepButtons()[0]).toHaveFocus();
    fireEvent.click(stepButtons()[0]!);

    expect(stepButtons()[0]).toHaveAttribute("aria-current", "step");
    expect(within(bar()).getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAccessibleName("Step 1 Connect GitHub");
  });
});

describe("regression", () => {
  it("never un-ticks silently: a step that went back is explained in the service's words", () => {
    frame(regressed());

    const banner = screen.getByRole("region", { name: "A step that was done is not any more" });

    expect(banner).toHaveTextContent(
      'Step 1 · Connect GitHub — The GitHub source "GitHub · acme-robotics" is paused, so acme-robotics/helios-firmware is not being read.',
    );
    expect(within(rail()).getAllByRole("listitem")[0]).toHaveClass("wizard-step--regressed");
    expect(within(rail()).getAllByRole("listitem")[0]).toHaveTextContent("no longer done");
  });

  it("regresses live — a source disconnected elsewhere reaches the rail on the poll, with no reload", async () => {
    answer = { state: "fresh", payload: regressed(), etag: null, pollAfterSeconds: null };
    frame();

    expect(screen.queryByRole("region", { name: "A step that was done is not any more" })).toBeNull();

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "A step that was done is not any more" })).toBeInTheDocument(),
    );
    expect(within(rail()).getAllByRole("listitem")[0]).toHaveClass("wizard-step--todo");
    expect(reads).toBeGreaterThan(0);
  });
});

describe("the action bar", () => {
  it("counts the step on screen and goes Back through the steps, then to the dashboard", () => {
    frame();

    expect(within(bar()).getByText("Step 3 of 4")).toBeInTheDocument();

    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    expect(within(bar()).getByText("Step 2 of 4")).toBeInTheDocument();

    fireEvent.click(within(bar()).getByRole("button", { name: "Back" }));
    expect(within(bar()).getByRole("link", { name: "Back" })).toHaveAttribute("href", "/dashboard");
  });

  it("is disabled with the service's reason until step 3's workflow exists", () => {
    frame();

    const primary = within(bar()).getByRole("button", { name: "Continue →" });

    expect(primary).toHaveAttribute("aria-disabled", "true");
    expect(primary).toHaveAccessibleDescription("No starting workflow has been chosen yet.");

    fireEvent.click(primary);
    expect(continueStep).not.toHaveBeenCalled();
  });

  it("continues through the guard and moves to the next step", async () => {
    continueStep.mockResolvedValue({ ok: true, value: readyToRun() });
    frame(readyToRun());

    fireEvent.click(stepButtons()[2]!);
    fireEvent.click(within(bar()).getByRole("button", { name: "Continue →" }));
    await settle();

    expect(continueStep).toHaveBeenCalledWith(REPO, 3);
    expect(within(bar()).getByText("Step 4 of 4")).toBeInTheDocument();
  });

  it("says the guard's refusal and stays", async () => {
    continueStep.mockResolvedValue({ ok: false, reason: "No workflow has been created from the quick-fixes template yet." });
    frame(readyToRun());

    fireEvent.click(stepButtons()[2]!);
    fireEvent.click(within(bar()).getByRole("button", { name: "Continue →" }));
    await settle();

    expect(within(bar()).getByRole("alert")).toHaveTextContent("No workflow has been created from the quick-fixes template yet.");
    expect(within(bar()).getByText("Step 3 of 4")).toBeInTheDocument();
  });

  it("changes per step: connect, enable, continue, run", () => {
    const fresh = wizard({
      steps: [step({ step: 1, status: "active", reason: "No GitHub source covers it yet." }), step({ step: 2 }), step({ step: 3 }), step({ step: 4 })],
    });
    const { unmount } = frame(fresh);

    expect(within(bar()).getByRole("link", { name: "Connect GitHub →" })).toHaveAttribute("href", "/settings/sources");
    unmount();

    frame(wizard({ steps: [step({ step: 1, status: "done", evidence: "acme-robotics · token" }), step({ step: 2, status: "active" }), step({ step: 3 }), step({ step: 4 })] }));
    expect(within(bar()).getByRole("button", { name: "Enable helios-firmware →" })).not.toHaveAttribute("aria-disabled");
    cleanup();

    frame(readyToRun());
    expect(within(bar()).getByRole("button", { name: "Run my first loop →" })).not.toHaveAttribute("aria-disabled");
  });

  it("enables the repository on step 2 and re-reads the rail", async () => {
    enableRepository.mockResolvedValue({ ok: true, value: wizard() });
    frame(wizard({ steps: [step({ step: 1, status: "done", evidence: "acme-robotics · token" }), step({ step: 2, status: "active" }), step({ step: 3 }), step({ step: 4 })] }));

    fireEvent.click(within(bar()).getByRole("button", { name: "Enable helios-firmware →" }));
    await settle();

    expect(enableRepository).toHaveBeenCalledWith(REPO);
  });

  it("runs the first loop and says what was queued, dry-run note included", async () => {
    launchFirstLoop.mockResolvedValue({ ok: true, value: launchReceipt() });
    frame(readyToRun());

    fireEvent.click(within(bar()).getByRole("button", { name: "Run my first loop →" }));
    await settle();

    expect(launchFirstLoop).toHaveBeenCalledWith(REPO);
    expect(within(bar()).getByRole("status")).toHaveTextContent(
      "#488 queued under quick-fixes. Dry-run is on: the PR opens as a draft and nothing merges until you say so.",
    );
  });

  it("sends one write at a time", async () => {
    let land: (value: unknown) => void = () => {};

    launchFirstLoop.mockReturnValue(new Promise((resolve) => (land = resolve)));
    frame(readyToRun());

    const primary = within(bar()).getByRole("button", { name: "Run my first loop →" });

    fireEvent.click(primary);
    fireEvent.click(within(bar()).getByRole("button", { name: "Working…" }));
    expect(launchFirstLoop).toHaveBeenCalledOnce();

    await act(async () => land({ ok: true, value: launchReceipt() }));
  });

  it("tells a viewer why they cannot move the wizard on", () => {
    frame(readyToRun(), { contribute: false, administer: false });

    expect(within(bar()).getByRole("button", { name: "Run my first loop →" })).toHaveAccessibleDescription(
      /Viewers can follow the wizard/,
    );
    expect(screen.getByRole("button", { name: /I've done this before/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("a workspace with no repository yet", () => {
  it("says so, draws no rail of its own, and offers to connect GitHub", () => {
    frame(null, OWNER, null);

    expect(screen.queryByRole("navigation", { name: "Get Started steps" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("No repository is connected yet");
    expect(within(bar()).getByRole("link", { name: "Connect GitHub →" })).toHaveAttribute("href", "/settings/sources");
    expect(within(bar()).getByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("says why when the wizard could not be read", () => {
    render(
      <GetStartedScreen abilities={OWNER} poll={POLL} repo={REPO} reposFailure={null} wizard={{ ok: false, reason: "The service is busy." }} />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("The service is busy.");
  });
});

describe("standalone", () => {
  it("renders outside the shell — no shell header, sidebar or pane", () => {
    const { container } = frame();

    expect(container.querySelector(".app-shell, .shell-nav, .shell-header, .app-shell__pane")).toBeNull();
    // The only banner is the wizard's own head, and the only navigation is its rail.
    expect(screen.getByRole("banner")).toHaveClass("wizard__head");
    expect(screen.getAllByRole("navigation")).toEqual([rail()]);
    expect(container.firstElementChild).toHaveClass("wizard");
  });

  it("puts the step content alone in the scrolling region, between the fixed rail and bar", () => {
    const { container } = frame();
    const parts = [...container.firstElementChild!.children].map((child) => child.className);

    expect(parts).toEqual(["wizard__head", "wizard-rail", "wizard__content", "wizard-bar"]);
  });
});

describe("both themes", () => {
  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <GetStartedScreen abilities={OWNER} poll={POLL} repo={REPO} reposFailure={null} wizard={{ ok: true, value: regressed() }} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("wizard-regress");
  });
});
