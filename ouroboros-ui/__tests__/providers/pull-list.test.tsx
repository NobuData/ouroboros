import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelPull } from "@/app/api/providers";
import { pullsPath } from "@/app/api/providers/[id]/pulls/path";
import { DETECTED_LABEL, modelsRegion } from "@/app/providers/cards";
import {
  PULLED,
  PULL_LATEST,
  PULL_POLL_MS,
  PULL_QUEUED,
  PULL_READ_ONLY,
  PULL_SETTLE_MS,
  PULL_STARTING,
} from "@/app/providers/live";
import type { PullOutcome } from "@/app/providers/live-actions";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { SEEDED_OLLAMA_ID, ollamaEntry, ollamaModels, providerModels, pullRecord } from "../helpers/providers";

/**
 * The Ollama card's pull-list ([#230](https://github.com/NobuData/ouroboros/issues/230)):
 * rows with their sizes, a pull that starts and is polled to done, a second one queued, the
 * records read with the page so a reload lands mid-transfer, and the re-read that follows a
 * landing.
 */

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  startPull: vi.fn<(id: string, modelId: string) => Promise<PullOutcome>>(),
  fetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/providers/live-actions", () => ({
  refreshModels: vi.fn(),
  startPull: (id: string, modelId: string) => state.startPull(id, modelId),
}));

const { ModelsRegion } = await import("@/app/providers/models-region");

/** The pull-list region for the seeded Ollama card, with whatever pulls a case hands it. */
function list(pulls: readonly ModelPull[] = [], models = ollamaModels()) {
  const region = modelsRegion(
    ollamaEntry(),
    { ok: true, value: providerModels(SEEDED_OLLAMA_ID, models) },
    pulls,
  );

  if (region.kind !== "pull-list") throw new Error("not the region under test");

  return region;
}

/** What the poll answers next. */
function answering(pulls: readonly ModelPull[]): void {
  state.fetch.mockResolvedValue(
    new Response(JSON.stringify({ connectionId: SEEDED_OLLAMA_ID, pulls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function row(name: string): HTMLElement {
  return screen.getByRole("list", { name: DETECTED_LABEL }).querySelector(`[data-model="${name}"]`) as HTMLElement;
}

beforeEach(() => {
  state.refresh.mockReset();
  state.startPull.mockReset();
  state.fetch.mockReset();
  vi.stubGlobal("fetch", state.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the rows", () => {
  it("draws the mockup's three rows: mono name, size tag, Pull latest", () => {
    render(<ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={list()} />);

    const items = within(screen.getByRole("list", { name: DETECTED_LABEL })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      `qwen3-coder:32b19 GB${PULL_LATEST}`,
      `llama4:scout63 GB${PULL_LATEST}`,
      `phi4:14b9.1 GB${PULL_LATEST}`,
    ]);
    expect(row("qwen3-coder:32b").querySelector(".providers-card__pull-size")).toHaveTextContent("19 GB");
  });

  it("draws a member's Pull latest inert, with the reason", () => {
    render(<ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister={false} region={list()} />);

    for (const button of screen.getAllByRole("button", { name: PULL_LATEST })) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", PULL_READ_ONLY);
    }
  });

  it("draws a stranded alias's model as a row too, with the flag and a Pull latest that mends the route", () => {
    const region = {
      ...list(),
      unlisted: [{ modelId: "gemma:2b", aliases: [{ id: "a", alias: "local-tiny" }] }],
    };
    render(<ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={region} />);

    const stranded = row("gemma:2b");
    expect(within(stranded).getByRole("link", { name: "local-tiny" })).toBeInTheDocument();
    expect(within(stranded).getByRole("button", { name: PULL_LATEST })).not.toHaveAttribute("aria-disabled");
  });
});

describe("a reload mid-pull", () => {
  it("lands on the bar at the transfer's real percentage, from the records read with the page", () => {
    render(
      <ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={list([pullRecord()])} />,
    );

    const running = row("llama4:scout");
    const bar = within(running).getByRole("progressbar", { name: "Pulling llama4:scout" });
    expect(bar).toHaveAttribute("aria-valuenow", "61");
    expect(bar).toHaveAttribute("aria-valuetext", "llama4:scout · 61%");
    expect(within(running).getByText("61%")).toHaveClass("providers-card__pull-percent");
    expect(within(running).queryByRole("button")).toBeNull();
    // The other rows are untouched.
    expect(within(row("phi4:14b")).getByRole("button", { name: PULL_LATEST })).toBeInTheDocument();
  });

  it("draws the indeterminate bar while the daemon has not sized the transfer", () => {
    render(
      <ModelsRegion
        connectionId={SEEDED_OLLAMA_ID}
        mayAdminister
        region={list([pullRecord({ percent: null, status: "pulling manifest" })])}
      />,
    );

    const running = row("llama4:scout");
    expect(running.querySelector(".providers-card__pull-bar--indeterminate")).not.toBeNull();
    expect(within(running).getByText(PULL_STARTING)).toBeInTheDocument();
  });

  it("draws a queued row as queued, a landed one as pulled, and a failed one with its sentence", () => {
    render(
      <ModelsRegion
        connectionId={SEEDED_OLLAMA_ID}
        mayAdminister
        region={list([
          pullRecord({ modelId: "qwen3-coder:32b", state: "queued", status: "queued", percent: null }),
          pullRecord({ modelId: "llama4:scout", state: "succeeded", percent: null }),
          pullRecord({ modelId: "phi4:14b", state: "failed", detail: "the host closed the stream" }),
        ])}
      />,
    );

    expect(within(row("qwen3-coder:32b")).getByRole("status")).toHaveTextContent(PULL_QUEUED);
    expect(within(row("llama4:scout")).getByRole("status")).toHaveTextContent(PULLED);
    expect(within(row("llama4:scout")).getByRole("button", { name: PULL_LATEST })).toBeInTheDocument();
    expect(within(row("phi4:14b")).getByRole("alert")).toHaveTextContent("the host closed the stream");
    expect(within(row("phi4:14b")).getByRole("button", { name: PULL_LATEST })).toBeInTheDocument();
  });
});

describe("pressing Pull latest", () => {
  it("asks the server hop, draws the record it answers, then polls to done and re-reads the card", async () => {
    vi.useFakeTimers();
    state.startPull.mockResolvedValue({
      ok: true,
      pull: pullRecord({ modelId: "phi4:14b", status: "starting", percent: null }),
    });
    render(<ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={list()} />);

    fireEvent.click(within(row("phi4:14b")).getByRole("button", { name: PULL_LATEST }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(state.startPull).toHaveBeenCalledWith(SEEDED_OLLAMA_ID, "phi4:14b");
    expect(within(row("phi4:14b")).getByRole("progressbar")).toBeInTheDocument();

    // One poll: the daemon is at 61%.
    answering([pullRecord({ modelId: "phi4:14b" })]);
    await act(async () => {
      vi.advanceTimersByTime(PULL_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.fetch).toHaveBeenCalledWith(pullsPath(SEEDED_OLLAMA_ID), { cache: "no-store" });
    expect(within(row("phi4:14b")).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "61");

    // The next: landed. The row says so, the list stops polling, and the card is re-read.
    answering([pullRecord({ modelId: "phi4:14b", state: "succeeded", percent: null })]);
    await act(async () => {
      vi.advanceTimersByTime(PULL_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(within(row("phi4:14b")).getByRole("status")).toHaveTextContent(PULLED);
    expect(state.refresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(PULL_SETTLE_MS);
    });
    expect(state.refresh).toHaveBeenCalledTimes(1);

    const polls = state.fetch.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(PULL_POLL_MS * 3);
    });
    expect(state.fetch.mock.calls.length).toBe(polls);
  });

  it("draws a second model queued while the first runs, and asks nothing of the daemon for it", async () => {
    state.startPull.mockResolvedValue({
      ok: true,
      pull: pullRecord({ modelId: "phi4:14b", state: "queued", status: "queued", percent: null }),
    });
    render(
      <ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={list([pullRecord()])} />,
    );

    fireEvent.click(within(row("phi4:14b")).getByRole("button", { name: PULL_LATEST }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(within(row("phi4:14b")).getByRole("status")).toHaveTextContent(PULL_QUEUED);
    expect(within(row("phi4:14b")).queryByRole("button")).toBeNull();
    expect(within(row("llama4:scout")).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "61");
  });

  it("says why a pull did not start, as an alert on its row, and leaves the action", async () => {
    state.startPull.mockResolvedValue({ ok: false, reason: "The pull could not be started." });
    render(<ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={list()} />);

    fireEvent.click(within(row("qwen3-coder:32b")).getByRole("button", { name: PULL_LATEST }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(within(row("qwen3-coder:32b")).getByRole("alert")).toHaveTextContent("could not be started");
    expect(within(row("qwen3-coder:32b")).getByRole("button", { name: PULL_LATEST })).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it("renders the same markup with a transfer in flight", () => {
    const [light, dark] = renderInBothPalettes(
      <ModelsRegion connectionId={SEEDED_OLLAMA_ID} mayAdminister region={list([pullRecord()])} />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
