import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Onboarding } from "@/app/api/onboarding";
import type { OnboardingPollOptions } from "@/app/get-started/poll";
import type { PollAnswer } from "@/app/poll";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";
import { source } from "../helpers/sources";
import {
  ISSUE_488,
  REPO,
  completed,
  firstIssueCard,
  fresh,
  launchReceipt,
  mirrored,
  readyToRun,
  regressed,
  seededCard,
  seededTiles,
  selfHostedDefaults,
  sourcesReadings,
  step,
  wizard,
} from "../helpers/onboarding";

/**
 * `/get-started` (BC.1, #390, mockup 13): the head's promise, the rail that displays the service's
 * derived answer — regressions explained — and the action bar whose primary action changes per
 * step and states its reason when it cannot be pressed.
 */

const continueStep = vi.fn();
const enableRepository = vi.fn();
const launchFirstLoop = vi.fn();
const skipWizard = vi.fn();
const setRepositoryEnabled = vi.fn();
const readSourceCatalog = vi.fn();
const addSource = vi.fn();
const setSourceStatus = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/get-started/actions", () => ({
  continueStep: (repo: string, step: number) => continueStep(repo, step),
  enableRepository: (repo: string) => enableRepository(repo),
  launchFirstLoop: (repo: string, pick: string | null) => launchFirstLoop(repo, pick),
  skipWizard: (repo: string) => skipWizard(repo),
  dismissWizard: vi.fn(),
  rescanRepository: vi.fn(),
  saveProtectedPaths: vi.fn(),
  previewProtectedPaths: vi.fn(),
  selectTemplate: vi.fn(),
  pickFirstIssue: vi.fn(),
  setRepositoryEnabled: (formData: FormData) => setRepositoryEnabled(formData),
}));
// Step 1's embedded flow is `app/sources`' own dialog and rows (#395); their actions are server-only.
vi.mock("@/app/sources/actions", () => ({
  readSourceCatalog: () => readSourceCatalog(),
  addSource: (body: unknown) => addSource(body),
  testSource: vi.fn(),
  syncSource: vi.fn(),
  readSourceStatus: vi.fn(),
  setSourceStatus: (id: string, status: string) => setSourceStatus(id, status),
  setSourceCredentials: vi.fn(),
  updateSourceConfig: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

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
function frame(
  initial: Onboarding | null = wizard(),
  abilities = OWNER,
  repo: string | null = REPO,
  extra: Partial<Pick<Parameters<typeof GetStartedScreen>[0], "sources" | "enablement">> = {},
) {
  return render(
    <GetStartedScreen
      abilities={abilities}
      defaults={{ ok: true, value: selfHostedDefaults() }}
      defaultsPoll={{ read: () => new Promise(() => {}), visible: () => true }}
      detection={{ ok: true, value: seededCard() }}
      detectionPoll={{ read: () => new Promise(() => {}), visible: () => true }}
      enablement={{ ok: true, value: mirrored() }}
      firstIssue={{ ok: true, value: firstIssueCard() }}
      firstIssuePoll={{ read: () => new Promise(() => {}), visible: () => true }}
      poll={POLL}
      repo={repo}
      reposFailure={null}
      sources={{ ok: true, value: sourcesReadings() }}
      templates={{ ok: true, value: seededTiles() }}
      templatesPoll={{ read: () => new Promise(() => {}), visible: () => true }}
      wizard={initial === null ? null : { ok: true, value: initial }}
      {...extra}
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
  for (const mock of [continueStep, enableRepository, launchFirstLoop, skipWizard, setRepositoryEnabled, readSourceCatalog, addSource, setSourceStatus, push, refresh]) {
    mock.mockReset();
  }
  readSourceCatalog.mockResolvedValue({ ok: true, entries: [] });
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

    expect(launchFirstLoop).toHaveBeenCalledWith(REPO, null);
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
  it("says so, draws no rail of its own, and offers to connect GitHub — here, and in Settings", () => {
    frame(null, OWNER, null, { sources: { ok: true, value: sourcesReadings({ sources: { ok: true, value: [] } }) } });

    expect(screen.queryByRole("navigation", { name: "Get Started steps" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "No repository is connected yet" })).toBeInTheDocument();
    expect(within(bar()).getByRole("link", { name: "Connect GitHub →" })).toHaveAttribute("href", "/settings/sources");
    expect(within(bar()).getByText("Step 1 of 4")).toBeInTheDocument();
    // Steps 1 and 2's surfaces both draw, so a workspace starts from zero on this page (#395).
    expect(screen.getByRole("region", { name: "Connect GitHub" })).toHaveTextContent("No GitHub source is connected yet.");
    expect(screen.getByRole("button", { name: "+ Add source" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pick a repo" })).toHaveTextContent("Connect GitHub first");
  });

  it("says why when the wizard could not be read", () => {
    render(
      <GetStartedScreen
        abilities={OWNER}
        detectionPoll={{ read: () => new Promise(() => {}), visible: () => true }}
        poll={POLL}
        repo={REPO}
        reposFailure={null}
        templatesPoll={{ read: () => new Promise(() => {}), visible: () => true }}
        wizard={{ ok: false, reason: "The service is busy." }}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("The service is busy.");
  });
});

describe("the detection card (#391)", () => {
  it("sits in the scrolling step content, tagged step 2 done when the rail says so", () => {
    const { container } = frame();

    const card = screen.getByRole("region", { name: "We already figured this out" });
    expect(container.querySelector(".wizard__content")).toContainElement(card);
    expect(within(card).getByText("✓ step 2 done")).toBeInTheDocument();
    expect(within(card).getByText("scanned in 38s")).toBeInTheDocument();
  });

  it("drops the step tag while step 2 is not done", () => {
    frame(wizard({ steps: [step({ step: 1, status: "done" }), step({ step: 2, status: "active" }), step({ step: 3 }), step({ step: 4 })] }));

    expect(within(screen.getByRole("region", { name: "We already figured this out" })).queryByText("✓ step 2 done")).toBeNull();
  });

  it("is not drawn without a repository", () => {
    frame(null, OWNER, null);

    expect(screen.queryByRole("region", { name: "We already figured this out" })).toBeNull();
  });
});

describe("the template tiles (#392)", () => {
  it("sit in the scrolling step content under the detection card, with step 3's pill", () => {
    const { container } = frame();

    const tiles = screen.getByRole("region", { name: "Choose a starting workflow" });
    const detection = screen.getByRole("region", { name: "We already figured this out" });
    expect(container.querySelector(".wizard__content")).toContainElement(tiles);
    expect(detection.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(tiles).getByText("step 3 · you are here")).toBeInTheDocument();
    expect(within(tiles).getAllByRole("button", { pressed: true }).map((b) => b.textContent)).toHaveLength(1);
  });

  it("wear the done tag once the rail says step 3 is done", () => {
    frame(readyToRun());

    expect(within(screen.getByRole("region", { name: "Choose a starting workflow" })).getByText("✓ step 3 done")).toBeInTheDocument();
  });

  it("are not drawn without a repository", () => {
    frame(null, OWNER, null);

    expect(screen.queryByRole("region", { name: "Choose a starting workflow" })).toBeNull();
  });
});

describe("the right column (#394)", () => {
  it("sits beside the step cards in the scrolling step content, a labelled landmark holding the three cards", () => {
    const { container } = frame();

    const aside = screen.getByRole("complementary", { name: "What is set up, what happens next, and why it is safe" });
    const columns = container.querySelector(".wizard__columns")!;
    expect(container.querySelector(".wizard__content")).toContainElement(aside);
    expect(aside).toHaveClass("wizard__aside");
    expect(columns).toContainElement(aside);
    expect(columns.querySelector(".wizard__main")).toContainElement(screen.getByRole("region", { name: "We already figured this out" }));
    expect(columns.querySelector(".wizard__main")).toContainElement(screen.getByRole("region", { name: "Your first issue" }));
    for (const name of ["Smart defaults", "What happens next", "Why this is safe to try"]) {
      expect(aside).toContainElement(screen.getByRole("region", { name }));
    }
  });

  it("shows the self-hosted rows and no managed copy, and labels every timeline row projected (O6, O7)", () => {
    frame();

    const aside = screen.getByRole("complementary", { name: "What is set up, what happens next, and why it is safe" });
    expect(within(aside).getByRole("link", { name: "Providers" })).toHaveAttribute("href", "/models/providers");
    expect(within(aside).getByRole("link", { name: "Build Farm" })).toHaveAttribute("href", "/build-farm");
    expect(aside).not.toHaveTextContent(/trial credit|hosted runner|average|%/i);
    expect(within(aside).getAllByText("projected")).toHaveLength(6);
  });

  it("is not drawn without a repository", () => {
    frame(null, OWNER, null);

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("region", { name: "Smart defaults" })).toBeNull();
  });
});

describe("the first-issue card (#393)", () => {
  it("sits in the scrolling step content under the tiles, with step 4's pill and the stored pick", () => {
    const { container } = frame(readyToRun());

    const card = screen.getByRole("region", { name: "Your first issue" });
    const tiles = screen.getByRole("region", { name: "Choose a starting workflow" });
    expect(container.querySelector(".wizard__content")).toContainElement(card);
    expect(tiles.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText("step 4 · you are here")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "#488" })).toBeInTheDocument();
    expect(within(card).getByText("We picked a safe one:")).toBeInTheDocument();
  });

  it("stores the picker's suggestion on launch when the wizard stores no pick — the mockup's one press", async () => {
    launchFirstLoop.mockResolvedValue({ ok: true, value: launchReceipt() });
    const unpicked = wizard({
      steps: readyToRun().steps,
      choices: { ...readyToRun().choices, pickedTicketId: null },
      refs: { detectionScan: null, templates: [], pickedTicket: null },
    });
    frame(unpicked);

    const primary = within(bar()).getByRole("button", { name: "Run my first loop →" });
    expect(primary).not.toHaveAttribute("aria-disabled");

    fireEvent.click(primary);
    await settle();

    expect(launchFirstLoop).toHaveBeenCalledWith(REPO, ISSUE_488);
  });

  it("stays blocked with the service's reason while nothing is stored and the backlog offers no pick", () => {
    const unpicked = wizard({
      steps: readyToRun().steps,
      choices: { ...readyToRun().choices, pickedTicketId: null },
      refs: { detectionScan: null, templates: [], pickedTicket: null },
    });
    render(
      <GetStartedScreen
        abilities={OWNER}
        detection={{ ok: true, value: seededCard() }}
        detectionPoll={{ read: () => new Promise(() => {}), visible: () => true }}
        firstIssue={{ ok: false, reason: "The picker is busy." }}
        firstIssuePoll={{ read: () => new Promise(() => {}), visible: () => true }}
        poll={POLL}
        repo={REPO}
        reposFailure={null}
        templates={{ ok: true, value: seededTiles() }}
        templatesPoll={{ read: () => new Promise(() => {}), visible: () => true }}
        wizard={{ ok: true, value: unpicked }}
      />,
    );

    const primary = within(bar()).getByRole("button", { name: "Run my first loop →" });
    expect(primary).toHaveAttribute("aria-disabled", "true");
    expect(primary).toHaveAccessibleDescription("#488 has not been queued yet.");
  });

  it("is not drawn without a repository", () => {
    frame(null, OWNER, null);

    expect(screen.queryByRole("region", { name: "Your first issue" })).toBeNull();
  });
});

describe("standalone", () => {
  it("renders outside the shell — no shell header, sidebar or pane", () => {
    const { container } = frame();

    expect(container.querySelector(".app-shell, .shell-nav, .shell-header, .app-shell__pane")).toBeNull();
    // The wizard's own head is the first banner — any other is a card's head in the step content
    // (jsdom does not scope a header inside a section) — and the only navigation is its rail.
    const [head, ...cardHeads] = screen.getAllByRole("banner");
    expect(head).toHaveClass("wizard__head");
    for (const other of cardHeads) expect(other).toHaveClass("ou-card__head");
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

/* ------------------------------------------------------- the states the mockup cannot show (#395) */

describe("steps 1 and 2 before they are done (#395)", () => {
  it("draws step 1's surface — the sources module's rows and opener — on step 1, with its done pill once the rail says so", () => {
    frame();

    // The seeded wizard is on step 3: nothing of steps 1–2 is on screen until asked.
    expect(screen.queryByRole("region", { name: "Connect GitHub" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Pick a repo" })).toBeNull();

    fireEvent.click(stepButtons()[0]!);

    const connect = screen.getByRole("region", { name: "Connect GitHub" });
    expect(within(connect).getByText("✓ step 1 done")).toBeInTheDocument();
    expect(within(connect).getByRole("heading", { name: "GitHub · acme-robotics" })).toBeInTheDocument();
    expect(within(connect).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(within(connect).getByRole("button", { name: "+ Add source" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pick a repo" })).toBeNull();
  });

  it("draws step 2's surface — the enablement switches — on step 2, this wizard's repository first", () => {
    frame();

    fireEvent.click(stepButtons()[1]!);

    const picker = screen.getByRole("region", { name: "Pick a repo" });
    expect(within(picker).getByText("✓ step 2 done")).toBeInTheDocument();
    expect(within(picker).getAllByRole("listitem")[0]).toHaveAttribute("data-repo", REPO);
    expect(within(picker).getByRole("switch", { name: `Disable Ouroboros in ${REPO}` })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("region", { name: "Connect GitHub" })).toBeNull();
  });

  it("opens on step 1 with its surface active when nothing covers the repository, and the bar still links Settings", () => {
    frame(fresh(), OWNER, REPO, { sources: { ok: true, value: sourcesReadings({ sources: { ok: true, value: [] } }) } });

    const connect = screen.getByRole("region", { name: "Connect GitHub" });
    expect(within(connect).getByText("step 1 · you are here")).toBeInTheDocument();
    expect(connect).toHaveTextContent("No GitHub source is connected yet.");
    expect(within(bar()).getByRole("link", { name: "Connect GitHub →" })).toHaveAttribute("href", "/settings/sources");
  });

  it("draws both surfaces for a workspace that has mirrored nothing, and the picker offers what the source names", () => {
    frame(null, OWNER, null, { enablement: { ok: true, value: { orgTotal: 0, orgs: [] } } });

    expect(screen.getByRole("region", { name: "Connect GitHub" })).toBeInTheDocument();
    const picker = screen.getByRole("region", { name: "Pick a repo" });
    expect(within(picker).getAllByRole("listitem")).toHaveLength(4);
    for (const row of within(picker).getAllByRole("listitem")) expect(row).toHaveTextContent("not recorded yet — switching on records it");
  });
});

describe("regression, fixed (#395)", () => {
  it("leads from the banner to the step whose surface owns the problem — the source's own Resume", () => {
    frame(regressed(), OWNER, REPO, {
      sources: { ok: true, value: sourcesReadings({ sources: { ok: true, value: [source({ status: "paused" })] } }) },
    });

    const banner = screen.getByRole("region", { name: "A step that was done is not any more" });

    // Wherever the person has gone on the rail, the banner's fix leads back to the step that owns the problem.
    fireEvent.click(stepButtons()[2]!);
    expect(within(bar()).getByText("Step 3 of 4")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Connect GitHub" })).toBeNull();

    fireEvent.click(within(banner).getByRole("button", { name: "Fix step 1 →" }));

    expect(within(bar()).getByText("Step 1 of 4")).toBeInTheDocument();
    const connect = screen.getByRole("region", { name: "Connect GitHub" });
    expect(within(connect).getByText("step 1 · you are here")).toBeInTheDocument();
    expect(within(connect).getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});

describe("completion (#395)", () => {
  it("leads the step content with the receipt once the launch answers, and offers the dashboard from the bar", async () => {
    launchFirstLoop.mockResolvedValue({ ok: true, value: launchReceipt() });
    answer = { state: "fresh", payload: completed(), etag: null, pollAfterSeconds: null };
    frame(readyToRun());

    fireEvent.click(within(bar()).getByRole("button", { name: "Run my first loop →" }));
    await settle();

    const receipt = screen.getByRole("region", { name: "Your first loop is queued" });
    expect(receipt).toHaveTextContent("#488 queued under quick-fixes@v1");
    expect(receipt).toHaveTextContent("Dry-run is on");
    expect(within(receipt).getByRole("link", { name: "Open the dashboard →" })).toHaveAttribute("href", "/dashboard");
    expect(within(receipt).getByRole("link", { name: "acme-robotics/helios-console →" })).toHaveAttribute(
      "href",
      "/get-started?repo=acme-robotics%2Fhelios-console",
    );
    // The receipt is the first thing in the scrolling region, above the step panel and the cards.
    const content = document.querySelector(".wizard__content")!;
    expect(content.firstElementChild).toBe(receipt);
    await waitFor(() => expect(within(bar()).getByRole("link", { name: "Open the dashboard →" })).toHaveAttribute("href", "/dashboard"));
  });

  it("stays on a reload, drawn from the rail's own evidence, and the wizard remains reachable", () => {
    frame(completed());

    const receipt = screen.getByRole("region", { name: "Your first loop is queued" });
    expect(receipt).toHaveTextContent("#488 · queued");
    expect(receipt).not.toHaveTextContent("queue position");
    expect(within(bar()).getByText("Step 4 of 4")).toBeInTheDocument();
    expect(within(bar()).getByRole("link", { name: "Open the dashboard →" })).toBeInTheDocument();
  });

  it("flips to run started on the poll once a loop claims the issue", async () => {
    answer = {
      state: "fresh",
      payload: wizard({ ...completed(), steps: completed().steps.map((one) => (one.step === 4 ? { ...one, evidence: "#488 · run started" } : one)) }),
      etag: null,
      pollAfterSeconds: null,
    };
    frame(completed());

    await waitFor(() => expect(screen.getByRole("region", { name: "Your first loop is queued" })).toHaveTextContent("#488 · run started"));
  });
});

describe("dismissed (#395)", () => {
  it("renders a dismissed wizard unchanged — dismissal governs the dashboard's offer, not this page", () => {
    frame(wizard({ choices: { ...wizard().choices, dismissed: true }, surfacing: { offer: false, reason: "wizard_finished" } }));

    expect(rail()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Choose a starting workflow" })).toBeInTheDocument();
    expect(within(bar()).getByText("Step 3 of 4")).toBeInTheDocument();
  });
});
