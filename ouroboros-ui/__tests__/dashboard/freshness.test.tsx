import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Freshness } from "@/app/dashboard/freshness";
import { clockTime } from "@/app/dashboard/view";

import { READ_AT } from "../helpers/dashboard";

/**
 * The boundary that keeps the last good render on screen (#86).
 *
 * This is the acceptance criterion *"killing REST mid-session shows the stale banner with the
 * previous data intact"*, as a component: the page it holds is a stand-in here, because what
 * is being asserted is **which** render the reader sees rather than what any card draws.
 *
 * The distinction every case below turns on is between *stale* and *unread*. A reader who had
 * data a moment ago must keep it; a reader who never had any must not be shown something
 * invented in its place.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** A page, told apart from the next one by what it says. */
function Page({ figure }: Readonly<{ figure: string }>) {
  return <p>{`Loops live: ${figure}`}</p>;
}

/** The banner, by the role it is announced under. */
function banner(): HTMLElement | null {
  return screen.queryByRole("status");
}

describe("a read that worked", () => {
  it("draws the page, and nothing else", () => {
    render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    expect(screen.getByText("Loops live: 3")).toBeInTheDocument();
    expect(banner()).toBeNull();
  });
});

describe("a read that failed after one that worked", () => {
  it("keeps the last good page on screen", () => {
    // The whole point of the boundary: a refresh that failed must not cost the reader the
    // figures they were reading.
    const { rerender } = render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    rerender(
      <Freshness ok={false} reason="The service is not available." readAt={READ_AT + 60_000}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(screen.getByText("Loops live: 3")).toBeInTheDocument();
    expect(screen.queryByText("Loops live: —")).toBeNull();
  });

  it("says how old it is, from the read that produced it", () => {
    // The held reading's `readAt`, never the failed render's — the failed render read
    // nothing, so its clock reading describes no data at all.
    const { rerender } = render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    rerender(
      <Freshness ok={false} reason="Nope." readAt={READ_AT + 3_600_000}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(banner()).toHaveTextContent(`Showing data from ${clockTime(READ_AT)}`);
    expect(banner()).not.toHaveTextContent(clockTime(READ_AT + 3_600_000));
  });

  it("explains it once, in the banner", () => {
    const { rerender } = render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    rerender(
      <Freshness ok={false} reason="The service is not available." readAt={READ_AT}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(screen.getAllByText("The service is not available.")).toHaveLength(1);
  });

  it("goes on holding it across a retry that failed too", () => {
    // `router.refresh()` merges a new server render without discarding client state, so a
    // second failure arrives here as another failed render — and the tree held is still the
    // one from before any of them.
    const { rerender } = render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    for (const attempt of [1, 2, 3]) {
      rerender(
        <Freshness ok={false} reason={`Attempt ${attempt} failed.`} readAt={READ_AT + attempt}>
          <Page figure="—" />
        </Freshness>,
      );
    }

    expect(screen.getByText("Loops live: 3")).toBeInTheDocument();
    expect(banner()).toHaveTextContent(`Showing data from ${clockTime(READ_AT)}`);
  });
});

describe("a read that worked again", () => {
  it("drops the banner and draws the new page", () => {
    const { rerender } = render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    rerender(
      <Freshness ok={false} reason="Nope." readAt={READ_AT}>
        <Page figure="—" />
      </Freshness>,
    );
    rerender(
      <Freshness ok reason={null} readAt={READ_AT + 120_000}>
        <Page figure="4" />
      </Freshness>,
    );

    expect(screen.getByText("Loops live: 4")).toBeInTheDocument();
    expect(banner()).toBeNull();
  });

  it("holds the new render rather than the one it recovered from", () => {
    const { rerender } = render(
      <Freshness ok reason={null} readAt={READ_AT}>
        <Page figure="3" />
      </Freshness>,
    );

    rerender(
      <Freshness ok reason={null} readAt={READ_AT + 120_000}>
        <Page figure="4" />
      </Freshness>,
    );
    rerender(
      <Freshness ok={false} reason="Nope." readAt={READ_AT + 180_000}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(screen.getByText("Loops live: 4")).toBeInTheDocument();
    expect(banner()).toHaveTextContent(`Showing data from ${clockTime(READ_AT + 120_000)}`);
  });
});

describe("a first paint that failed", () => {
  it("draws the page's own unread state rather than inventing one", () => {
    // Nothing in this browser has ever been read, so there is nothing to keep. The cards say
    // what they could not read, and the banner says why.
    render(
      <Freshness ok={false} reason="Choose a workspace first." readAt={READ_AT}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(screen.getByText("Loops live: —")).toBeInTheDocument();
    expect(banner()).toHaveTextContent("The dashboard could not be read.");
    expect(banner()).not.toHaveTextContent("Showing data from");
  });

  it("carries the reason and the retry", () => {
    render(
      <Freshness ok={false} reason="Choose a workspace first." readAt={READ_AT}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(screen.getByText("Choose a workspace first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("still says something when the service refused without a reason", () => {
    // Every refusal in the contract's envelope carries a message, so this is the guard rather
    // than the expected case — but a banner explaining nothing would look like a bug.
    render(
      <Freshness ok={false} reason={null} readAt={READ_AT}>
        <Page figure="—" />
      </Freshness>,
    );

    expect(banner()).toHaveTextContent("The service gave no reason.");
  });
});
