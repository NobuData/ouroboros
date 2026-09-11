import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueDetail } from "@/app/api/backlog";
import { QUEUE_ISSUE_CODES, type QueueOutcome, queuedToast } from "@/app/issues/bar";
import { UNREACHABLE_ISSUE } from "@/app/issues/detail-poll";
import {
  BREAKDOWN_EYEBROW,
  CLOSE_PANEL_LABEL,
  FILES_LABEL,
  FILES_PENDING_NOTE,
  FIRST_ESTIMATE_PENDING,
  ISSUE_STALE,
  ISSUE_UNREAD,
  NEEDS_HUMAN_TITLE,
  NO_BODY,
  NO_ISSUE_OPEN,
  NO_SIGNALS,
  OPEN_ON_GITHUB_LABEL,
  OPEN_ON_GITHUB_UNLINKED,
  QUEUE_ALREADY_QUEUED,
  QUEUE_NOT_SIZED,
  QUEUE_ONE_LABEL,
  READ_MORE,
  READING_ISSUE,
  REESTIMATE_ONE_BUSY,
  REESTIMATE_ONE_LABEL,
  REESTIMATE_ONE_ROLE_REASON,
  REESTIMATE_ONE_STARTED,
  SHOW_LESS,
  SIZING_NOW,
  TRACE_LABEL,
  needsHumanLine,
  quoted,
} from "@/app/issues/panel";
import { tableRows } from "@/app/issues/table";
import { type HeadOutcome, NOTHING_QUEUED, QUEUE_ROLE_REASON } from "@/app/issues/view";
import { DEFAULT_POLL_SECONDS, type PollAnswer } from "@/app/poll";

import {
  READ_AT,
  SEEDED_BODY,
  SEEDED_FILES,
  SEEDED_RISK_NOTE,
  SEEDED_ROWS,
  estimatingDetail,
  issueDetail,
  issueId,
  needsHumanDetail,
  queuedSelection,
} from "../helpers/issues";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The detail panel (#119), as a component.
 *
 * The issue's criteria that a render can show: the seeded `#485` drawn as the mockup's panel
 * field for field, with the honest trace; the four sizing states, one case each; a re-estimate
 * that round-trips — the press, `estimating…` on the next answer, the new version on the one
 * after, with no reload; the single queue with the bar's own refusal sentences; **Open on
 * GitHub ↗** as a new-tab link; the panel opening on the row's own facts before its detail
 * lands, closing, and following a change of row; a viewer's two inert actions; and both
 * palettes. The table is stood in for by a picker that writes the same store and publishes
 * the seeded rows as seen; the poll's reader and the two server hops are the seams replaced.
 */

/** What the two actions answer, per case. */
const queueUnder = vi.fn();
const reestimateIssue = vi.fn();

vi.mock("@/app/issues/head-actions", () => ({
  queueUnder: (ids: readonly string[], workflow: string | null) => queueUnder(ids, workflow),
  reestimateIssue: (id: string) => reestimateIssue(id),
  queueSelected: vi.fn(),
  reestimateAll: vi.fn(),
  syncBacklog: vi.fn(),
}));

const { DetailPanel } = await import("@/app/issues/detail-panel");
const { IssueSelectionProvider, useIssueSelection } = await import("@/app/issues/selection");

/** The reader's queue, per case: each ask takes the next answer, the last repeating. */
let answers: PollAnswer<IssueDetail>[] = [];

/** How many times the reader was asked. */
let asks = 0;

/** A reader that never answers, for the cases about what is known before the detail lands. */
const NEVER: PollAnswer<IssueDetail>[] = [];

/**
 * The poll's seam: answers from the queue, or a promise that never settles once it is empty.
 *
 * @returns The options the panel is rendered with.
 */
function poll() {
  return {
    read: () => {
      asks += 1;
      const answer = answers[Math.min(asks - 1, answers.length - 1)];
      return answer === undefined ? new Promise<PollAnswer<IssueDetail>>(() => {}) : Promise.resolve(answer);
    },
    visible: () => true,
  };
}

/** A fresh answer carrying an issue. */
function fresh(detail: IssueDetail): PollAnswer<IssueDetail> {
  return { state: "fresh", payload: detail, etag: null, pollAfterSeconds: null };
}

/** The table's stand-in: one opener per seeded issue, a closer, and the seeded rows published. */
function Table() {
  const { inspect, seen } = useIssueSelection();

  useEffect(() => {
    seen.publish(tableRows(SEEDED_ROWS));
  }, [seen]);

  return (
    <div>
      {SEEDED_ROWS.map((row) => (
        <button key={row.id} onClick={() => inspect(row.id)} type="button">
          {`Open ${row.number}`}
        </button>
      ))}
    </div>
  );
}

/** The panel's props, with a member's rights unless a case says otherwise. */
type Props = Parameters<typeof DetailPanel>[0];

/**
 * The panel beside the stand-in, inside one provider — the shape the screen has.
 *
 * @param over The props this case is about.
 * @returns The element to render.
 */
function panel(over: Partial<Props> = {}) {
  return (
    <IssueSelectionProvider>
      <Table />
      <DetailPanel mayContribute poll={poll()} readAt={READ_AT} {...over} />
    </IssueSelectionProvider>
  );
}

/**
 * Render, open one issue, and let the poll's first ask land.
 *
 * @param number The issue to open.
 * @param over The props this case is about.
 * @returns The render result.
 */
async function opened(number: number, over: Partial<Props> = {}) {
  const view = render(panel(over));
  fireEvent.click(screen.getByRole("button", { name: `Open ${number}` }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

/** The panel's region. */
function region(): HTMLElement {
  return screen.getByRole("region", { name: /issue detail/i });
}

/** One of the panel's three actions. */
function action(name: string): HTMLElement {
  return within(region()).getByRole("button", { name });
}

/** The seeded `#485`, not yet queued — the mockup's own state, with **Queue for loop** live. */
function unqueued(): IssueDetail {
  return issueDetail({ issue: { queued: false } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(READ_AT);
  answers = NEVER;
  asks = 0;
  queueUnder.mockReset().mockResolvedValue({ ok: true, queued: queuedSelection(1) } satisfies QueueOutcome);
  reestimateIssue
    .mockReset()
    .mockResolvedValue({ ok: true, message: REESTIMATE_ONE_STARTED } satisfies HeadOutcome);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("with no row open", () => {
  it("holds its seat as a named region, says how to open a row, and asks nothing", () => {
    render(panel());

    expect(region()).toHaveClass("issues-panel");
    expect(within(region()).getByText(NO_ISSUE_OPEN)).toBeInTheDocument();
    expect(within(region()).queryByRole("button", { name: CLOSE_PANEL_LABEL })).toBeNull();
    expect(asks).toBe(0);
  });
});

describe("opening a row", () => {
  it("draws the row's own head at once, over a skeleton, and asks for the detail", async () => {
    await opened(485);

    const drawn = within(region());

    expect(drawn.getByText("#485")).toHaveClass("issues-panel__meta");
    expect(drawn.getByRole("heading", { level: 3 })).toHaveTextContent("Watchdog reset on I²C bus lockup");
    expect(drawn.getByText("priority-high")).toHaveClass("ou-tag");
    expect(drawn.getByText("queued")).toHaveClass("ou-chip--accent");
    expect(drawn.getByRole("status")).toHaveTextContent(READING_ISSUE);
    expect(region().querySelector(".issues-panel__skeleton")).not.toBeNull();
    expect(drawn.queryByText(BREAKDOWN_EYEBROW)).toBeNull();
    expect(asks).toBe(1);
  });

  it("closes from its head, and stops asking", async () => {
    answers = [fresh(issueDetail())];
    await opened(485);

    fireEvent.click(action(CLOSE_PANEL_LABEL));

    expect(within(region()).getByText(NO_ISSUE_OPEN)).toBeInTheDocument();
    const before = asks;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });
    expect(asks).toBe(before);
  });

  it("follows a change of row with a new loop, drawing the new row's head at once", async () => {
    answers = [fresh(issueDetail())];
    await opened(485);
    expect(within(region()).getByText("#485 · opened 2d ago by field-support")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open 484" }));

    expect(within(region()).getByRole("heading", { level: 3 })).toHaveTextContent("Motor PID integral windup");
    expect(within(region()).queryByText(/opened 2d ago/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(asks).toBe(2);
  });
});

describe("the seeded #485 — the sized state, and the mockup's panel", () => {
  it("draws the head, the excerpt, the breakdown, the routing and the actions field for field", async () => {
    answers = [fresh(unqueued())];
    await opened(485);

    const drawn = within(region());

    expect(drawn.getByText("#485 · opened 2d ago by field-support")).toHaveClass("issues-panel__meta");
    expect(drawn.getByText("sized")).toHaveClass("ou-chip");
    expect(drawn.getByText(quoted(SEEDED_BODY))).toBeInTheDocument();
    expect(drawn.queryByRole("button", { name: READ_MORE })).toBeNull();

    expect(drawn.getByText(BREAKDOWN_EYEBROW)).toBeInTheDocument();
    expect(drawn.getByText(FILES_LABEL)).toBeInTheDocument();
    expect(drawn.getAllByRole("listitem").map((item) => item.textContent)).toEqual(SEEDED_FILES);

    expect(drawn.getByText("~180k")).toBeInTheDocument();
    expect(drawn.getByText("12–18 min")).toBeInTheDocument();
    expect(drawn.getByText("M")).toHaveClass("ou-chip--effort");
    expect(drawn.getByText("conf 92%")).toHaveClass("issues-panel__conf");

    expect(drawn.getByText("low")).toHaveAttribute("data-risk", "low");
    expect(region().querySelector(".ou-meter--ok")).not.toBeNull();
    expect(drawn.getByText(SEEDED_RISK_NOTE)).toHaveClass("issues-panel__risk-note");

    expect(drawn.getByText("standard-fix")).toHaveClass("ou-tag");
    expect(drawn.getByText("claude-fable-5")).toHaveClass("ou-chip--model");

    expect(drawn.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "×",
      QUEUE_ONE_LABEL,
      REESTIMATE_ONE_LABEL,
    ]);
    expect(action(QUEUE_ONE_LABEL)).not.toHaveAttribute("aria-disabled");
    expect(action(REESTIMATE_ONE_LABEL)).not.toHaveAttribute("aria-disabled");
  });

  it("tells the trace honestly: the rule engine, two minutes ago, no signals — open, and a disclosure", async () => {
    answers = [fresh(unqueued())];
    await opened(485);

    const trace = region().querySelector("details.issues-panel__trace") as HTMLDetailsElement;

    expect(trace.open).toBe(true);
    expect(within(trace).getByText(TRACE_LABEL).tagName).toBe("SUMMARY");
    expect(within(trace).getByText("sized by heuristic-v0 · 2m ago")).toHaveClass("issues-panel__trace-line");
    expect(within(trace).getByText(NO_SIGNALS)).toBeInTheDocument();
    expect(trace.textContent).not.toMatch(/claude|tokens|similar closed/);
  });

  it("ticks the two ages on the reader's clock", async () => {
    answers = [fresh(unqueued())];
    await opened(485);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(within(region()).getByText("sized by heuristic-v0 · 3m ago")).toBeInTheDocument();
  });

  it("wears the seed's queued pill where the mockup draws sized, and inerts the queue button for it", async () => {
    answers = [fresh(issueDetail())];
    await opened(485);

    expect(within(region()).getByText("queued")).toHaveClass("ou-chip--accent");
    expect(action(QUEUE_ONE_LABEL)).toHaveAttribute("title", QUEUE_ALREADY_QUEUED);
  });

  it("opens the issue on GitHub in a new tab, from the address the service sent", async () => {
    answers = [fresh(unqueued())];
    await opened(485);

    const link = within(region()).getByRole("link", { name: OPEN_ON_GITHUB_LABEL });

    expect(link).toHaveAttribute("href", "https://github.com/acme-robotics/helios-firmware/issues/485");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("ou-btn--ghost");
  });

  it("refuses to link an address that is not a web address, and says so", async () => {
    answers = [fresh(issueDetail({ issue: { ghUrl: "javascript:alert(1)" } }))];
    await opened(485);

    expect(within(region()).queryByRole("link")).toBeNull();
    expect(action(OPEN_ON_GITHUB_LABEL)).toHaveAttribute("title", OPEN_ON_GITHUB_UNLINKED);
  });

  it("draws a live estimate's empty file list as the sentence that says why", async () => {
    answers = [fresh(issueDetail({ issue: { queued: false }, estimate: { breakdown: { ...issueDetail().estimate!.breakdown, files: [] } } }))];
    await opened(485);

    expect(within(region()).getByText(FILES_PENDING_NOTE)).toHaveClass("issues-panel__note");
    expect(within(region()).queryByRole("list")).toBeNull();
  });
});

describe("the other three states", () => {
  it("unsized: the issue's content and the pending note, a live re-estimate, no trace", async () => {
    answers = [fresh(estimatingDetail("unsized"))];
    await opened(483);

    const drawn = within(region());

    expect(drawn.getByText("unsized")).toHaveClass("ou-chip");
    expect(drawn.getByText("#483 · opened 5d ago by jorge-reyes")).toBeInTheDocument();
    expect(drawn.getByText(FIRST_ESTIMATE_PENDING)).toBeInTheDocument();
    expect(drawn.queryByText(BREAKDOWN_EYEBROW)).toBeNull();
    expect(region().querySelector(".issues-panel__trace")).toBeNull();
    expect(action(QUEUE_ONE_LABEL)).toHaveAttribute("title", QUEUE_NOT_SIZED.unsized);
    expect(action(REESTIMATE_ONE_LABEL)).not.toHaveAttribute("aria-disabled");
  });

  it("estimating: the warn pill, the skeleton breakdown, both writes inert with their reasons", async () => {
    answers = [fresh(estimatingDetail())];
    await opened(483);

    const drawn = within(region());

    expect(drawn.getByText("estimating…")).toHaveClass("ou-chip--warn");
    expect(drawn.getByRole("status")).toHaveTextContent(SIZING_NOW);
    expect(region().querySelector(".issues-panel__skeleton")).not.toBeNull();
    expect(drawn.queryByText(BREAKDOWN_EYEBROW)).toBeNull();
    expect(action(QUEUE_ONE_LABEL)).toHaveAttribute("title", QUEUE_NOT_SIZED.estimating);
    expect(action(REESTIMATE_ONE_LABEL)).toHaveAttribute("title", REESTIMATE_ONE_BUSY);
  });

  it("needs human: the err pill, the estimate that sent it there, and the trace opening with why", async () => {
    answers = [fresh(needsHumanDetail({ queued: false }))];
    await opened(490);

    const drawn = within(region());
    const detail = needsHumanDetail();

    expect(drawn.getByText("needs human")).toHaveClass("ou-chip--err");
    expect(drawn.getByText("XL")).toHaveClass("ou-chip--effort");
    expect(drawn.getByText("conf 61%")).toBeInTheDocument();
    expect(drawn.getByText("high")).toHaveAttribute("data-risk", "high");
    expect(region().querySelector(".ou-meter--err")).not.toBeNull();
    expect(drawn.getByText(needsHumanLine(detail.estimate))).toHaveClass("issues-panel__trace-line--err");
    expect(drawn.getByText("sized by heuristic-v0 · 1h ago")).toBeInTheDocument();
    expect(action(QUEUE_ONE_LABEL)).toHaveAttribute("title", QUEUE_NOT_SIZED.needs_human);
    expect(action(REESTIMATE_ONE_LABEL)).not.toHaveAttribute("aria-disabled");
  });

  it("needs human with no estimate at all: the failure, said in the breakdown's place", async () => {
    const failed = needsHumanDetail({ queued: false });
    answers = [fresh({ ...failed, estimate: null, history: [] })];
    await opened(490);

    expect(within(region()).getByText(NEEDS_HUMAN_TITLE)).toBeInTheDocument();
    expect(within(region()).getByText(needsHumanLine(null))).toBeInTheDocument();
    expect(region().querySelector(".issues-panel__trace")).toBeNull();
  });
});

describe("Re-estimate", () => {
  it("says sizing started, and asks the poll now — the line stays while the issue has not moved", async () => {
    answers = [fresh(unqueued())];
    await opened(485);
    expect(asks).toBe(1);

    fireEvent.click(action(REESTIMATE_ONE_LABEL));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(reestimateIssue).toHaveBeenCalledExactlyOnceWith(issueId(485));
    expect(asks).toBe(2);
    expect(within(region()).getByRole("status")).toHaveTextContent(REESTIMATE_ONE_STARTED);
    expect(within(region()).getByText("sized")).toBeInTheDocument();
  });

  it("round-trips: the press, estimating on the next answer, the new version on the one after — no reload", async () => {
    const before = unqueued();
    const inFlight: IssueDetail = { ...before, issue: { ...before.issue, sizingStatus: "estimating" } };
    const after = issueDetail({
      issue: { queued: false },
      estimate: {
        version: 2,
        confidence: 74,
        trace: { estimator: "heuristic-v0", sizedAt: "2026-09-10T15:41:52.000Z", tokensUsed: 0, signals: ["label-map", "title-verb"] },
      },
      history: [
        { version: 1, estimator: "heuristic-v0", createdAt: "2026-09-10T15:39:52.000Z" },
        { version: 2, estimator: "heuristic-v0", createdAt: "2026-09-10T15:41:52.000Z" },
      ],
    });
    answers = [fresh(before), fresh(inFlight), fresh(after)];
    await opened(485);
    expect(asks).toBe(1);

    fireEvent.click(action(REESTIMATE_ONE_LABEL));
    await settle();

    // The press asked every poll now, and the answer already says `estimating` — so the
    // line that said sizing started has said its piece, and the skeleton says the rest.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reestimateIssue).toHaveBeenCalledExactlyOnceWith(issueId(485));
    expect(asks).toBe(2);
    expect(within(region()).getByText("estimating…")).toHaveClass("ou-chip--warn");
    expect(within(region()).getByRole("status")).toHaveTextContent(SIZING_NOW);
    expect(within(region()).queryByText(REESTIMATE_ONE_STARTED)).toBeNull();
    expect(action(REESTIMATE_ONE_LABEL)).toHaveAttribute("title", REESTIMATE_ONE_BUSY);

    // The pipeline finished; the next interval draws the new version.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });
    expect(within(region()).getByText("sized")).toBeInTheDocument();
    expect(within(region()).getByText("conf 74%")).toBeInTheDocument();
    // Sized at the instant the page was read, and the clock has moved one interval since.
    expect(within(region()).getByText(`sized by heuristic-v0 · ${DEFAULT_POLL_SECONDS}s ago · v2`)).toBeInTheDocument();
    expect(within(region()).getByText("signals: label-map · title-verb")).toBeInTheDocument();
    expect(action(REESTIMATE_ONE_LABEL)).not.toHaveAttribute("aria-disabled");
  });

  it("reports a refusal under the actions, and takes one press at a time", async () => {
    let answer!: (outcome: HeadOutcome) => void;
    reestimateIssue.mockReturnValue(new Promise<HeadOutcome>((resolve) => (answer = resolve)));
    answers = [fresh(unqueued())];
    await opened(485);

    fireEvent.click(action(REESTIMATE_ONE_LABEL));
    await settle();
    expect(action(REESTIMATE_ONE_LABEL)).toHaveAttribute("aria-busy", "true");

    fireEvent.click(action(REESTIMATE_ONE_LABEL));
    fireEvent.click(action(QUEUE_ONE_LABEL));
    expect(reestimateIssue).toHaveBeenCalledOnce();
    expect(queueUnder).not.toHaveBeenCalled();

    await act(async () => {
      answer({ ok: false, reason: "This workspace has asked for too many estimates in the last minute. Try again in 24 seconds." });
    });

    expect(within(region()).getByRole("alert")).toHaveTextContent(/Try again in 24 seconds/);
    expect(action(REESTIMATE_ONE_LABEL)).not.toHaveAttribute("aria-busy");
  });
});

describe("Queue for loop", () => {
  it("sends this one issue under its own suggestion, and reports the service's own number", async () => {
    answers = [fresh(unqueued())];
    await opened(485);

    fireEvent.click(action(QUEUE_ONE_LABEL));
    await settle();

    expect(queueUnder).toHaveBeenCalledExactlyOnceWith([issueId(485)], null);
    expect(within(region()).getByRole("status")).toHaveTextContent(queuedToast(queuedSelection(1)));
  });

  it("explains a refusal in the bar's own words for the issue it names", async () => {
    queueUnder.mockResolvedValue({
      ok: false,
      reason: "The queue already holds one of those issues. Nothing was queued.",
      offenders: [{ issueId: issueId(485), code: QUEUE_ISSUE_CODES.alreadyQueued, issueNumber: 485, sizingStatus: null }],
    } satisfies QueueOutcome);
    answers = [fresh(unqueued())];
    await opened(485);

    fireEvent.click(action(QUEUE_ONE_LABEL));
    await settle();

    expect(within(region()).getByRole("alert")).toHaveTextContent(`#485 is already in the queue. ${NOTHING_QUEUED}`);
  });

  it("carries a refusal that names no issue as it came", async () => {
    queueUnder.mockResolvedValue({ ok: false, reason: "Choose a workspace. Nothing was queued.", offenders: [] } satisfies QueueOutcome);
    answers = [fresh(unqueued())];
    await opened(485);

    fireEvent.click(action(QUEUE_ONE_LABEL));
    await settle();

    expect(within(region()).getByRole("alert")).toHaveTextContent("Choose a workspace. Nothing was queued.");
  });
});

describe("a viewer", () => {
  it("has both writes inert with the role as the reason, and the link as a link", async () => {
    answers = [fresh(unqueued())];
    await opened(485, { mayContribute: false });

    expect(action(QUEUE_ONE_LABEL)).toHaveAttribute("title", QUEUE_ROLE_REASON);
    expect(action(REESTIMATE_ONE_LABEL)).toHaveAttribute("title", REESTIMATE_ONE_ROLE_REASON);
    expect(within(region()).getByRole("link", { name: OPEN_ON_GITHUB_LABEL })).toBeInTheDocument();

    fireEvent.click(action(QUEUE_ONE_LABEL));
    fireEvent.click(action(REESTIMATE_ONE_LABEL));

    expect(queueUnder).not.toHaveBeenCalled();
    expect(reestimateIssue).not.toHaveBeenCalled();
  });
});

describe("the excerpt", () => {
  it("cuts a long body and shows the rest in place", async () => {
    const body = `${"A long paragraph of reproduction steps. ".repeat(12)}The end.`;
    answers = [fresh(issueDetail({ issue: { body } }))];
    await opened(485);

    const drawn = within(region());

    expect(drawn.getByText(/…”$/)).toBeInTheDocument();
    const more = drawn.getByRole("button", { name: READ_MORE });
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);

    expect(drawn.getByText(quoted(body))).toBeInTheDocument();
    expect(drawn.getByRole("button", { name: SHOW_LESS })).toHaveAttribute("aria-expanded", "true");
  });

  it("says when there is no description rather than quoting nothing", async () => {
    answers = [fresh(issueDetail({ issue: { body: null } }))];
    await opened(485);

    expect(within(region()).getByText(NO_BODY)).toHaveClass("issues-panel__note");
    expect(region().querySelector("blockquote")).toBeNull();
  });
});

describe("the poll", () => {
  it("says the issue could not be read when the first ask fails, keeping the row's head", async () => {
    answers = [{ state: "failed", reason: UNREACHABLE_ISSUE, pollAfterSeconds: null }];
    await opened(485);

    expect(within(region()).getByText(ISSUE_UNREAD)).toBeInTheDocument();
    expect(within(region()).getByText(UNREACHABLE_ISSUE)).toBeInTheDocument();
    expect(within(region()).getByRole("heading", { level: 3 })).toHaveTextContent("Watchdog reset");
    expect(region().querySelector(".issues-panel__skeleton")).toBeNull();
  });

  it("keeps the issue and says so when a later ask fails, and clears the line when the next one lands", async () => {
    answers = [fresh(unqueued()), { state: "failed", reason: UNREACHABLE_ISSUE, pollAfterSeconds: null }, fresh(unqueued())];
    await opened(485);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(within(region()).getByText(BREAKDOWN_EYEBROW)).toBeInTheDocument();
    expect(within(region()).getByRole("status")).toHaveTextContent(`${ISSUE_STALE} ${UNREACHABLE_ISSUE}`);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(within(region()).queryByText(ISSUE_STALE, { exact: false })).toBeNull();
  });
});

describe("both palettes", () => {
  it("render the same markup, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(panel());

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
