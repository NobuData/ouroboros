import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_POLL_SECONDS, type SummaryAnswer } from "@/app/dashboard/summary";
import type { SummaryPollOptions } from "@/app/dashboard/summary-poll";
import { requestSummaryRefresh } from "@/app/dashboard/summary-refresh";
import {
  DashboardSummaryProvider,
  useDashboardSummary,
} from "@/app/dashboard/summary-store";

import { summary } from "../helpers/dashboard";

/**
 * The store, where the loop meets React
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * The issue's first acceptance criterion — *exactly one request per interval regardless of
 * how many components consume the store* — is a property of this file rather than of the
 * loop: the loop cannot know how many things are reading it, and the reason there is only
 * ever one is that the provider builds one and hands it down. So that is the case this
 * suite opens with, with three consumers rendered at once.
 *
 * What it does **not** re-assert is anything the loop already answers for — the interval,
 * the backoff, the hidden tab (`summary-poll.test.ts`). The seam between them is
 * {@link DashboardSummaryProviderProps.poll}, which is how a case here supplies a reader
 * without a network.
 */

const INTERVAL = DEFAULT_POLL_SECONDS * 1000;

/** How many times the reader was asked, this test. */
let asks = 0;

/** What it answers. Reassigned by the cases that care. */
let answer: SummaryAnswer = { state: "fresh", summary: summary(), etag: null, pollAfterSeconds: null };

/**
 * The provider's test seam — one stable object, so a re-render cannot be mistaken for a
 * reason to build a second poll.
 */
const OPTIONS: SummaryPollOptions = {
  read: () => {
    asks += 1;
    return Promise.resolve(answer);
  },
  visible: () => true,
};

/** One consumer, drawing whatever it was given. */
function Consumer({ label }: Readonly<{ label: string }>) {
  const { data, updatedAt, error } = useDashboardSummary();

  return (
    <p data-testid={label}>
      {data === null ? "nothing" : `live ${data.stats.loopsLive.total}`}
      {error === null ? "" : ` · ${error}`}
      {updatedAt === null ? "" : " · fresh"}
    </p>
  );
}

/**
 * Render a tree under the provider and let the first poll land.
 *
 * @param children What to render inside it.
 * @returns Nothing.
 */
async function mount(children: React.ReactNode): Promise<void> {
  render(<DashboardSummaryProvider poll={OPTIONS}>{children}</DashboardSummaryProvider>);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  asks = 0;
  answer = { state: "fresh", summary: summary(), etag: null, pollAfterSeconds: null };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the dashboard summary store", () => {
  it("makes one request per interval however many components read it", async () => {
    await mount(
      <>
        <Consumer label="pill" />
        <Consumer label="card" />
        <Consumer label="banner" />
      </>,
    );

    expect(asks).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    // Three consumers, two intervals, two requests. A hook per consumer would have made six.
    expect(asks).toBe(2);
  });

  it("gives every consumer the same answer", async () => {
    await mount(
      <>
        <Consumer label="pill" />
        <Consumer label="card" />
      </>,
    );

    // The point of one store rather than three: two surfaces on one screen cannot disagree
    // about how many loops are live.
    expect(screen.getByTestId("pill")).toHaveTextContent("live 3");
    expect(screen.getByTestId("card")).toHaveTextContent("live 3");
  });

  it("reports nothing until the first answer arrives", () => {
    // The server renders this, and so does the browser's first pass — the poll starts in an
    // effect, and effects do not run during hydration, so the two agree by construction.
    render(
      <DashboardSummaryProvider poll={OPTIONS}>
        <Consumer label="pill" />
      </DashboardSummaryProvider>,
    );

    expect(screen.getByTestId("pill")).toHaveTextContent("nothing");
  });

  it("carries a failure to its consumers beside the data it is about", async () => {
    answer = { state: "failed", reason: "The dashboard could not be reached.", pollAfterSeconds: null };

    await mount(<Consumer label="banner" />);

    expect(screen.getByTestId("banner")).toHaveTextContent("The dashboard could not be reached.");
    expect(screen.getByTestId("banner")).toHaveTextContent("nothing");
  });

  it("asks again when something says the summary is out of date", async () => {
    await mount(<Consumer label="pill" />);
    expect(asks).toBe(1);

    await act(async () => {
      requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
    });

    // The workspace switch and the auto-merge write both publish this signal — see
    // `app/dashboard/summary-refresh.ts` for why they say it rather than calling the poll.
    expect(asks).toBe(2);
  });

  it("stops polling, and stops listening, when it unmounts", async () => {
    const view = render(
      <DashboardSummaryProvider poll={OPTIONS}>
        <Consumer label="pill" />
      </DashboardSummaryProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    view.unmount();

    await act(async () => {
      requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });

    expect(asks).toBe(1);
  });
});

describe("a consumer outside the provider", () => {
  it("reads nothing rather than throwing", () => {
    // A pill drawing nothing is the honest answer for a screen the `(app)` layout does not
    // wrap, and it is what the pill does before the first answer anyway.
    render(<Consumer label="pill" />);

    expect(screen.getByTestId("pill")).toHaveTextContent("nothing");
  });
});
