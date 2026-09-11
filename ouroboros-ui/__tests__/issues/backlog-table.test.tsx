import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BacklogListing, SyncStatus } from "@/app/api/backlog";
import type { Reading } from "@/app/api/reading";
import { requestSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { type BacklogPage, UNREACHABLE_BACKLOG } from "@/app/issues/backlog-poll";
import { onClearFilters } from "@/app/issues/clear-filters";
import { type BacklogFilter, DEFAULT_FILTER } from "@/app/issues/filter";
import {
  CHECKING_LABEL,
  CHECK_AGAIN_LABEL,
  CHOOSE_REPOS_LABEL,
  CLEAR_FILTERS_LABEL,
  CLEAR_TITLE,
  FIRST_SYNC_TITLE,
  NO_REPOS_MEMBER_NOTE,
  NO_REPOS_TITLE,
  NO_TOKEN_MEMBER_NOTE,
  NO_TOKEN_TITLE,
  OPEN_SETTINGS_LABEL,
  OPEN_SETTINGS_SOON,
  PAUSE_HEADLINE,
  SYNC_UNREAD_HEADLINE,
  firstSyncProgress,
} from "@/app/issues/states";
import {
  FIRST_PAGE_LABEL,
  FIRST_PAGE_REASON,
  LAST_PAGE_REASON,
  NEXT_LABEL,
  PAGES_LABEL,
  PAGE_SIZE,
  PAST_END,
  PREVIOUS_LABEL,
} from "@/app/issues/paging";
import {
  BACKLOG_UNREAD,
  NOTHING_MIRRORED,
  NO_MATCHES,
  REFRESH_FAILED,
  SELECT_ALL_LABEL,
  SIZING,
  SYNCING,
  SYNC_ROLE_REASON,
  SYNC_STARTED,
  SYNC_TITLE,
  TABLE_CAPTION,
  UNESTIMATED,
  selectLabel,
} from "@/app/issues/table";
import { type HeadOutcome, queueLabel } from "@/app/issues/view";
import { DEFAULT_POLL_SECONDS, type PollAnswer } from "@/app/poll";

import {
  ESTIMATING_ROW,
  PAUSE_MESSAGES,
  READ_AT,
  SEEDED_ROWS,
  SEEDED_SYNCED_AT,
  SYNCED,
  UNCOUNTED_REASON,
  UNPAGED,
  UNSYNCED,
  UNSYNCED_REASON,
  backlogListing,
  issueId,
  paged,
  paused,
  synced,
} from "../helpers/issues";
import { membership } from "../helpers/login";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The backlog table (#117), as a component.
 *
 * The issue's criteria that a render can show: the seeded nine drawn row for row with the
 * mockup's treatments — the mono number, the tag row, the effort chip and its confidence, the
 * `sizing…` placeholder, the four pills in their hues; select all, none and one, with the count
 * flowing to the page head and the selection surviving a filter change; the keyboard's three
 * verbs; the freshness tag reading the mockup's `synced 40s ago`, ticking, and pressable; an
 * `estimating…` row flipping to `sized` on the next poll with its pill marked to animate; and the
 * footer for a backlog beyond a page. The poll's reader and the sync's server hop are the seams
 * replaced; what each does with the wire is its own suite's.
 */

/** What the sync action answers, per case. */
const syncBacklog = vi.fn();

vi.mock("@/app/issues/head-actions", () => ({
  syncBacklog: () => syncBacklog(),
  queueSelected: vi.fn(),
  queueUnder: vi.fn(),
  reestimateAll: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

const { BacklogTable } = await import("@/app/issues/backlog-table");
const { QueueSelectedButton } = await import("@/app/issues/queue-selected");
const { IssueSelectionProvider, useSeenRows } = await import("@/app/issues/selection");

/** The reader's queue, per case: each ask takes the next answer, the last repeating. */
let answers: PollAnswer<BacklogPage>[] = [];

/** How many times the reader was asked. */
let asks = 0;

/** A reader that never answers, for the cases about what the server rendered. */
const NEVER: PollAnswer<BacklogPage>[] = [];

/**
 * The poll's seam: answers from the queue, or a promise that never settles once it is empty.
 *
 * @returns The options the table is rendered with.
 */
function poll() {
  return {
    read: () => {
      asks += 1;
      const answer = answers[Math.min(asks - 1, answers.length - 1)];
      return answer === undefined ? new Promise<PollAnswer<BacklogPage>>(() => {}) : Promise.resolve(answer);
    },
    visible: () => true,
  };
}

/**
 * A fresh answer carrying a listing, and the status beside it.
 *
 * @param listing The page's listing.
 * @param sync The status reading. Defaults to the seeded loop between cycles.
 * @returns The answer.
 */
function fresh(listing: BacklogListing, sync: Reading<SyncStatus> = SYNCED): PollAnswer<BacklogPage> {
  return { state: "fresh", payload: { listing, sync }, etag: null, pollAfterSeconds: null };
}

/** The table's props, with the seeded page unless a case says otherwise. */
type Props = Parameters<typeof BacklogTable>[0];

/** The seeded workspace's slug, for the guidance's link. */
const SLUG = membership().slug;

/**
 * The table beside the head's queue button, inside one provider — the shape the screen has.
 *
 * @param over The props this case is about.
 * @returns The element to render.
 */
function table(over: Partial<Props> = {}) {
  return (
    <IssueSelectionProvider>
      <QueueSelectedButton mayContribute />
      <BacklogTable
        filter={DEFAULT_FILTER}
        listing={paged()}
        mayAdminister
        mayContribute
        page={1}
        poll={poll()}
        readAt={READ_AT}
        sync={SYNCED}
        workspaceSlug={SLUG}
        {...over}
      />
    </IssueSelectionProvider>
  );
}

/** A listing with no rows, in a scope that has nothing open — the empty workspace. */
function nothing(): Reading<BacklogListing> {
  return paged({ items: [], total: 0, openCount: 0, sizedCount: 0 });
}

/**
 * Render, and let the poll's first ask land.
 *
 * @param over The props this case is about.
 * @returns The render result.
 */
async function mounted(over: Partial<Props> = {}) {
  const view = render(table(over));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

/** The grid's body rows. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("grid", { name: TABLE_CAPTION })).getAllByRole("row").slice(1);
}

/** One body row, by its issue number. */
function row(number: number): HTMLElement {
  const found = rows().find((candidate) => candidate.dataset.rowKey === issueId(number));
  if (found === undefined) throw new Error(`no row for #${number}`);
  return found;
}

/** A row's checkbox. */
function box(number: number): HTMLInputElement {
  return screen.getByRole("checkbox", { name: selectLabel(number) });
}

/** The header's checkbox. */
function selectAll(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: SELECT_ALL_LABEL });
}

/** The head's queue button, whatever count it carries. */
function queueButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Queue [\d,]+ selected/ });
}

/** The freshness tag. */
function tag(): HTMLElement {
  return screen.getByRole("button", { name: /synced|never synced|syncing/ });
}

/** The seeded listing with `#483` sized, as the pipeline finishing would leave it. */
function sizedListing(): BacklogListing {
  return backlogListing({
    items: [
      ...SEEDED_ROWS.slice(0, -1),
      {
        ...ESTIMATING_ROW,
        sizingStatus: "sized",
        estimate: {
          effort: "m",
          confidence: 74,
          suggestedWorkflow: "standard-fix",
          routedModel: "claude-sonnet-5",
          estMinutes: 40,
        },
      },
    ],
    sizedCount: 8,
  });
}

/** A listing two pages long, for the footer. */
function longListing(page: number): BacklogListing {
  return backlogListing({
    items: page === 1 ? SEEDED_ROWS : SEEDED_ROWS.slice(0, 3),
    total: 42,
    offset: (page - 1) * PAGE_SIZE,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(READ_AT);
  answers = NEVER;
  asks = 0;
  syncBacklog.mockReset().mockResolvedValue({ ok: true, message: SYNC_STARTED } satisfies HeadOutcome);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the seeded rows", () => {
  it("draws all nine, row for row, in the listing's order", async () => {
    await mounted();

    expect(rows().map((one) => one.dataset.rowKey)).toEqual(SEEDED_ROWS.map((one) => one.id));

    for (const seeded of SEEDED_ROWS) {
      const drawn = within(row(seeded.number));

      expect(drawn.getByText(`#${seeded.number}`)).toHaveClass("issues-table__number");
      expect(drawn.getByText(seeded.title)).toHaveClass("issues-table__title");
      for (const label of seeded.labels) expect(drawn.getByText(label)).toHaveClass("ou-tag");
    }
  });

  it("draws the effort chip beside its mono confidence, the workflow as a tag and the model as a pill", async () => {
    await mounted();

    const drawn = within(row(485));

    expect(drawn.getByText("M")).toHaveClass("ou-chip--effort");
    expect(drawn.getByText("92%")).toHaveClass("issues-table__conf");
    expect(drawn.getByText("standard-fix")).toHaveClass("ou-tag");
    expect(drawn.getByText("claude-fable-5")).toHaveClass("ou-chip--model");
  });

  it("draws the mid-flight row as sizing, with nothing invented beside it", async () => {
    await mounted();

    const drawn = within(row(483));

    expect(drawn.getByText(SIZING)).toHaveClass("issues-table__sizing");
    expect(drawn.getAllByText(UNESTIMATED)).toHaveLength(2);
    expect(drawn.queryByText("standard-fix")).toBeNull();
    expect(drawn.getByText("estimating…")).toHaveClass("ou-chip--warn");
  });

  it("wears the four pills in the ticket's hues", async () => {
    await mounted();

    expect(within(row(484)).getByText("sized")).toHaveClass("ou-chip");
    expect(within(row(484)).getByText("sized").className).not.toMatch(/ou-chip--/);
    expect(within(row(486)).getByText("queued")).toHaveClass("ou-chip--accent");
    expect(within(row(483)).getByText("estimating…")).toHaveClass("ou-chip--warn");
    expect(within(row(490)).getByText("queued")).toHaveClass("ou-chip--accent");
  });

  it("animates no pill on a first paint", async () => {
    const { container } = await mounted();

    expect(container.querySelector("[data-swapped]")).toBeNull();
  });

  it("names the card, and the grid inside it", async () => {
    await mounted();

    expect(screen.getByRole("region", { name: /backlog · as ouroboros sees it/i })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: TABLE_CAPTION })).toHaveAttribute("aria-multiselectable", "true");
  });
});

describe("the selection", () => {
  it("checks one row, flows the count to the head, and glows the row", async () => {
    await mounted();

    fireEvent.click(box(485));

    expect(queueButton()).toHaveTextContent(queueLabel(1));
    expect(box(485)).toBeChecked();
    expect(row(485)).toHaveAttribute("aria-selected", "true");
    expect(row(485)).toHaveClass("ou-table__row--selected");
    expect(screen.getByRole("grid")).toHaveClass("ou-table--accent");

    fireEvent.click(box(485));

    expect(queueButton()).toHaveTextContent(queueLabel(0));
    expect(row(485)).toHaveAttribute("aria-selected", "false");
  });

  it("selects every row on the page from the header, and none again", async () => {
    await mounted();

    fireEvent.click(selectAll());

    expect(queueButton()).toHaveTextContent(queueLabel(9));
    expect(selectAll()).toBeChecked();
    expect(selectAll().indeterminate).toBe(false);
    for (const seeded of SEEDED_ROWS) expect(box(seeded.number)).toBeChecked();

    fireEvent.click(selectAll());

    expect(queueButton()).toHaveTextContent(queueLabel(0));
    for (const seeded of SEEDED_ROWS) expect(box(seeded.number)).not.toBeChecked();
  });

  it("is indeterminate in the header while some of the page is selected, and fills from there", async () => {
    await mounted();

    fireEvent.click(box(485));
    fireEvent.click(box(484));

    expect(selectAll()).not.toBeChecked();
    expect(selectAll().indeterminate).toBe(true);

    fireEvent.click(selectAll());

    expect(queueButton()).toHaveTextContent(queueLabel(9));
    expect(selectAll().indeterminate).toBe(false);
  });

  it("survives a filter change, keeping what is no longer on the page", async () => {
    const view = await mounted();

    fireEvent.click(box(485));
    fireEvent.click(box(483));

    const narrowed: BacklogFilter = { ...DEFAULT_FILTER, labels: ["docs"] };
    view.rerender(table({ filter: narrowed, listing: paged({ items: [SEEDED_ROWS[0]!], total: 1 }) }));

    expect(queueButton()).toHaveTextContent(queueLabel(2));
    expect(rows()).toHaveLength(1);
    expect(selectAll()).not.toBeChecked();
    expect(selectAll().indeterminate).toBe(false);
  });
});

describe("the keyboard", () => {
  it("puts one row in the tab order, and moves it with the arrows", async () => {
    await mounted();

    expect(row(488).tabIndex).toBe(0);
    expect(row(491).tabIndex).toBe(-1);

    fireEvent.keyDown(row(488), { key: "ArrowDown" });

    expect(row(491)).toHaveFocus();
    expect(row(491).tabIndex).toBe(0);
    expect(row(488).tabIndex).toBe(-1);
  });

  it("checks the focused row on Space, without opening it", async () => {
    const { container } = await mounted();

    fireEvent.keyDown(row(485), { key: " " });

    expect(box(485)).toBeChecked();
    expect(queueButton()).toHaveTextContent(queueLabel(1));
    expect(container.querySelector(".issues-table__row--inspected")).toBeNull();
  });

  it("opens the focused row's detail on Enter, without checking it", async () => {
    await mounted();

    fireEvent.keyDown(row(485), { key: "Enter" });

    expect(row(485)).toHaveClass("issues-table__row--inspected");
    expect(box(485)).not.toBeChecked();
    expect(queueButton()).toHaveTextContent(queueLabel(0));
  });

  it("opens a row's detail on a click, and moves the detail rather than adding to it", async () => {
    await mounted();

    fireEvent.click(within(row(485)).getByText("Watchdog reset on I²C bus lockup"));
    expect(row(485)).toHaveClass("issues-table__row--inspected");

    fireEvent.click(within(row(484)).getByText("#484"));
    expect(row(484)).toHaveClass("issues-table__row--inspected");
    expect(row(485)).not.toHaveClass("issues-table__row--inspected");
  });

  it("leaves a click on the checkbox to the checkbox", async () => {
    const { container } = await mounted();

    fireEvent.click(box(485));

    expect(box(485)).toBeChecked();
    expect(container.querySelector(".issues-table__row--inspected")).toBeNull();
  });

  it("keeps the row's checkbox out of the tab order, the row being the stop", async () => {
    await mounted();

    expect(box(485).tabIndex).toBe(-1);
    expect(selectAll().tabIndex).toBe(0);
  });
});

describe("the freshness tag", () => {
  it("reads the mockup's tag on the seeds, and ticks", async () => {
    await mounted();

    expect(tag()).toHaveTextContent("synced 40s ago");
    expect(tag()).toHaveClass("ou-tag", "issues-table__sync");
    expect(tag()).toHaveAttribute("title", SYNC_TITLE);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(tag()).toHaveTextContent("synced 1m ago");
  });

  it("asks for a sync when pressed, reports it, and asks the poll now", async () => {
    answers = [fresh(backlogListing())];
    await mounted();
    const before = asks;

    fireEvent.click(tag());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("status")).toHaveTextContent(SYNC_STARTED);
    expect(syncBacklog).toHaveBeenCalledOnce();
    expect(asks).toBe(before + 1);
  });

  it("reads syncing while the press is in flight, and takes one press at a time", async () => {
    let answer!: (outcome: HeadOutcome) => void;
    syncBacklog.mockReturnValue(new Promise<HeadOutcome>((resolve) => (answer = resolve)));
    await mounted();

    fireEvent.click(tag());
    await settle();

    expect(tag()).toHaveTextContent(SYNCING);
    expect(tag()).toHaveAttribute("aria-busy", "true");

    fireEvent.click(tag());
    expect(syncBacklog).toHaveBeenCalledOnce();

    await act(async () => {
      answer({ ok: false, reason: "The backlog was synced moments ago. Try again in 12 seconds." });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/Try again in 12 seconds/);
    expect(tag()).toHaveTextContent("synced 40s ago");
  });

  it("is inert for a viewer, with the role as its reason", async () => {
    await mounted({ mayContribute: false });

    expect(tag()).toHaveAttribute("aria-disabled", "true");
    expect(tag()).toHaveAttribute("title", SYNC_ROLE_REASON);

    fireEvent.click(tag());

    expect(syncBacklog).not.toHaveBeenCalled();
  });

  it("says never synced over a backlog no sync has stamped", async () => {
    await mounted({ listing: paged({ syncedAt: null }) });

    expect(tag()).toHaveTextContent("never synced");
  });

  it("reads syncing while the status says a cycle is in flight, and takes no press it would refuse (#120)", async () => {
    await mounted({ sync: synced({ running: true }) });

    expect(tag()).toHaveTextContent(SYNCING);
    expect(tag()).toHaveAttribute("aria-busy", "true");

    fireEvent.click(tag());

    expect(syncBacklog).not.toHaveBeenCalled();
  });
});

describe("the seen rows (#118)", () => {
  /** A reader of the store the table publishes to, standing in for the selection bar. */
  function SeenProbe() {
    const seen = useSeenRows();

    return (
      <output aria-label="Seen">
        {[...seen.values()].map((row) => `${row.number}:${row.estMinutes ?? "—"}`).join(" ")}
      </output>
    );
  }

  it("publishes every row it draws, and the fresh estimate when the poll moves one", async () => {
    answers = [fresh(backlogListing()), fresh(sizedListing())];
    render(
      <IssueSelectionProvider>
        <BacklogTable
          filter={DEFAULT_FILTER}
          listing={paged()}
          mayAdminister
          mayContribute
          page={1}
          poll={poll()}
          readAt={READ_AT}
          sync={SYNCED}
          workspaceSlug={SLUG}
        />
        <SeenProbe />
      </IssueSelectionProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const seen = screen.getByRole("status", { name: "Seen" });

    expect(seen).toHaveTextContent("485:45");
    expect(seen).toHaveTextContent("483:—");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(seen).toHaveTextContent("483:40");
    expect(seen.textContent?.split(" ")).toHaveLength(SEEDED_ROWS.length);
  });
});

describe("the poll", () => {
  it("flips an estimating row to sized within one poll of the pipeline finishing, and marks the pill", async () => {
    answers = [fresh(backlogListing()), fresh(sizedListing())];
    const { container } = await mounted();

    expect(within(row(483)).getByText("estimating…")).toBeInTheDocument();
    expect(container.querySelector("[data-swapped]")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    const drawn = within(row(483));
    expect(drawn.getByText("sized")).toBeInTheDocument();
    expect(drawn.queryByText("estimating…")).toBeNull();
    expect(drawn.getByText("M")).toHaveClass("ou-chip--effort");
    expect(drawn.getByText("74%")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-swapped]")).toHaveLength(1);
    expect(row(483).querySelector("[data-swapped]")).not.toBeNull();
  });

  it("keeps the rows and says so when a poll fails, and clears the line when the next one lands", async () => {
    answers = [
      fresh(backlogListing()),
      { state: "failed", reason: UNREACHABLE_BACKLOG, pollAfterSeconds: null },
      fresh(backlogListing()),
    ];
    await mounted();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(rows()).toHaveLength(9);
    expect(screen.getByRole("status")).toHaveTextContent(`${REFRESH_FAILED} ${UNREACHABLE_BACKLOG}`);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("heals a page the route could not read once the poll can", async () => {
    answers = [fresh(backlogListing())];
    render(table({ listing: UNPAGED }));

    expect(screen.getByText(BACKLOG_UNREAD)).toBeInTheDocument();
    expect(screen.getByText(UNCOUNTED_REASON)).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(rows()).toHaveLength(9);
    expect(screen.queryByText(BACKLOG_UNREAD)).toBeNull();
  });

  it("asks again at once when the address moves, and when the workspace does", async () => {
    answers = [fresh(backlogListing())];
    const view = await mounted();
    expect(asks).toBe(1);

    view.rerender(table({ filter: { ...DEFAULT_FILTER, labels: ["bug"] } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(asks).toBe(2);

    await act(async () => {
      requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(asks).toBe(3);
  });
});

describe("a page with no rows", () => {
  it("says nothing matched when the filter emptied it", async () => {
    await mounted({
      filter: { ...DEFAULT_FILTER, labels: ["zephyr", "docs"] },
      listing: paged({ items: [], total: 0 }),
    });

    expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByRole("navigation", { name: PAGES_LABEL })).toBeNull();
  });

  it("says there are no issues yet when the workspace mirrors none and nothing has ever synced", async () => {
    await mounted({ listing: nothing(), sync: synced({ syncedAt: null }) });

    expect(screen.getByText(NOTHING_MIRRORED)).toBeInTheDocument();
  });

  it("says the backlog is clear instead, once a sync has run over it (#120)", async () => {
    await mounted({ listing: nothing() });

    expect(screen.getByText(CLEAR_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(NOTHING_MIRRORED)).toBeNull();
  });

  it("says the address ran past the end, with the way back", async () => {
    await mounted({ listing: paged({ items: [], total: 42, offset: PAGE_SIZE * 2 }), page: 3 });

    expect(screen.getByText(PAST_END)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: FIRST_PAGE_LABEL })).toHaveAttribute("href", "/issues");
  });
});

describe("the guidance states (#120)", () => {
  /** The empty state's well, wherever it is. */
  function well(): HTMLElement {
    return document.querySelector(".ou-empty") as HTMLElement;
  }

  it("offers a Clear filters control under no matches, which asks the bar to clear", async () => {
    const heard = vi.fn();
    const stop = onClearFilters(heard);
    await mounted({
      filter: { ...DEFAULT_FILTER, labels: ["zephyr", "docs"] },
      listing: paged({ items: [], total: 0 }),
    });

    fireEvent.click(screen.getByRole("button", { name: CLEAR_FILTERS_LABEL }));

    expect(heard).toHaveBeenCalledOnce();
    stop();
  });

  it("tells an admin to connect GitHub over a workspace with no token, with the control labelled rather than linked nowhere", async () => {
    await mounted({ listing: nothing(), sync: paused("not_configured") });

    expect(screen.getByText(NO_TOKEN_TITLE)).toHaveClass("ou-empty__title");

    const control = screen.getByRole("button", { name: OPEN_SETTINGS_LABEL });

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", OPEN_SETTINGS_SOON);
    expect(screen.queryByRole("link")).toBeNull();
    // Said once: the empty state is the explanation, so no banner repeats it.
    expect(screen.queryByText(PAUSE_HEADLINE.not_configured)).toBeNull();
  });

  it("tells a member who can connect GitHub, without an actionless admin button", async () => {
    await mounted({ listing: nothing(), mayAdminister: false, sync: paused("not_configured") });

    expect(screen.getByText(NO_TOKEN_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_TOKEN_MEMBER_NOTE)).toHaveClass("issues-guidance__note");
    expect(screen.queryByRole("button", { name: OPEN_SETTINGS_LABEL })).toBeNull();
  });

  it("sends an admin to sign-in's step 2, opened on this workspace, over a token pointed at nothing", async () => {
    await mounted({ listing: nothing(), sync: paused("no_repositories") });

    expect(screen.getByText(NO_REPOS_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: CHOOSE_REPOS_LABEL })).toHaveAttribute(
      "href",
      `/login?workspace=${SLUG}`,
    );
    expect(screen.queryByText(PAUSE_HEADLINE.no_repositories)).toBeNull();
  });

  it("tells a member who can enable a repository, without the link", async () => {
    await mounted({ listing: nothing(), mayAdminister: false, sync: paused("no_repositories") });

    expect(screen.getByText(NO_REPOS_MEMBER_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: CHOOSE_REPOS_LABEL })).toBeNull();
  });

  it("shows the seeded personal workspace — enabled repositories, no token — the no-token guidance, not an empty table", async () => {
    await mounted({ listing: nothing(), sync: paused("not_configured") });

    expect(screen.getByText(NO_TOKEN_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByText(NOTHING_MIRRORED)).toBeNull();
  });

  it("says the first sync is running while a cycle runs over a backlog never stamped, as a busy status", async () => {
    await mounted({ listing: nothing(), sync: synced({ running: true, syncedAt: null }) });

    const status = screen.getByRole("status");

    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toContainElement(well());
    expect(screen.getByText(FIRST_SYNC_TITLE)).toBeInTheDocument();
    expect(tag()).toHaveTextContent(SYNCING);
  });

  it("celebrates a synced scope with nothing open, in the good hue rather than the error tone", async () => {
    await mounted({ listing: nothing(), sync: synced({ syncedAt: SEEDED_SYNCED_AT }) });

    expect(well()).toHaveTextContent(CLEAR_TITLE);
    expect(well().querySelector(".issues-guidance__mark")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to no issues yet under a pause the banner explains, so the reason is said once", async () => {
    await mounted({ listing: nothing(), sync: paused("rate_limited") });

    expect(screen.getByText(NOTHING_MIRRORED)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(PAUSE_HEADLINE.rate_limited);
    expect(screen.getAllByText(new RegExp(PAUSE_MESSAGES.rate_limited.slice(0, 30)))).toHaveLength(1);
  });
});

describe("the sync banner (#120)", () => {
  it("is not drawn over a loop running normally", async () => {
    await mounted();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the pause over the rows, with the service's reason and the wait counting down", async () => {
    await mounted({ sync: paused("rate_limited", { retryAfterSeconds: 1180 }) });

    const banner = screen.getByRole("status");

    expect(banner).toHaveClass("ou-retry", "issues-sync");
    expect(banner).toHaveTextContent(PAUSE_HEADLINE.rate_limited);
    expect(banner).toHaveTextContent(PAUSE_MESSAGES.rate_limited);
    expect(banner).toHaveTextContent("Resumes in about 20 minutes.");
    expect(rows()).toHaveLength(9);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(banner).toHaveTextContent("Resumes in about 19 minutes.");
  });

  it("says a token was cleared over rows that were mirrored before it was", async () => {
    await mounted({ sync: paused("not_configured") });

    expect(screen.getByRole("status")).toHaveTextContent(PAUSE_HEADLINE.not_configured);
    expect(rows()).toHaveLength(9);
  });

  it("says the status could not be read, with the reason, over the rows", async () => {
    await mounted({ sync: UNSYNCED });

    const banner = screen.getByRole("status");

    expect(banner).toHaveTextContent(SYNC_UNREAD_HEADLINE);
    expect(banner).toHaveTextContent(UNSYNCED_REASON);
    expect(rows()).toHaveLength(9);
  });

  it("reports the first sync's progress over rows already mirrored, and the count moves with the poll", async () => {
    answers = [
      fresh(backlogListing({ syncedAt: null }), synced({ running: true, syncedAt: null })),
      fresh(backlogListing({ syncedAt: null, openCount: 120 }), synced({ running: true, syncedAt: null })),
    ];
    await mounted();

    expect(screen.getByRole("status")).toHaveTextContent(firstSyncProgress(9));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(screen.getByRole("status")).toHaveTextContent(firstSyncProgress(120));
  });

  it("asks the poll now when Check again is pressed, says so until the answer lands, and clears with it", async () => {
    answers = [
      fresh(backlogListing(), paused("upstream_error")),
      fresh(backlogListing(), SYNCED),
    ];
    await mounted();
    const before = asks;

    fireEvent.click(screen.getByRole("button", { name: CHECK_AGAIN_LABEL }));

    expect(screen.getByRole("button", { name: CHECKING_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(asks).toBe(before + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears on its own when a later poll says the pause ended", async () => {
    answers = [fresh(backlogListing(), paused("rate_limited")), fresh(backlogListing(), SYNCED)];
    await mounted();

    expect(screen.getByRole("status")).toHaveTextContent(PAUSE_HEADLINE.rate_limited);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_SECONDS * 1000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the footer", () => {
  it("is not drawn for a backlog that fits a page", async () => {
    await mounted();

    expect(screen.queryByRole("navigation", { name: PAGES_LABEL })).toBeNull();
  });

  it("on the first page: the range, an inert previous, a next that keeps the filter", async () => {
    const filtered: BacklogFilter = { ...DEFAULT_FILTER, labels: ["bug"] };
    await mounted({ filter: filtered, listing: { ok: true, value: longListing(1) } });

    const footer = within(screen.getByRole("navigation", { name: PAGES_LABEL }));

    // Nine seeded rows stand in for a full page here; the arithmetic is `paging.test.ts`'s.
    expect(footer.getByText("1–9 of 42")).toHaveClass("issues-table__range");
    expect(footer.getByRole("button", { name: PREVIOUS_LABEL })).toHaveAttribute("title", FIRST_PAGE_REASON);
    expect(footer.getByRole("link", { name: NEXT_LABEL })).toHaveAttribute("href", "/issues?labels=bug&page=2");
  });

  it("on the last page: a previous that goes back, an inert next", async () => {
    await mounted({ listing: { ok: true, value: longListing(2) }, page: 2 });

    const footer = within(screen.getByRole("navigation", { name: PAGES_LABEL }));

    expect(footer.getByText("26–28 of 42")).toBeInTheDocument();
    expect(footer.getByRole("link", { name: PREVIOUS_LABEL })).toHaveAttribute("href", "/issues");
    expect(footer.getByRole("button", { name: NEXT_LABEL })).toHaveAttribute("title", LAST_PAGE_REASON);
  });
});

describe("both palettes", () => {
  it("render the same markup, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(table());

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
