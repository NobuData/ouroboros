import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderModel, UnlistedModel } from "@/app/api/providers";
import { MODELS_LABEL, NO_MODELS, modelsRegion } from "@/app/providers/cards";
import {
  CHIP_LEAVE_MS,
  REFRESHING,
  REFRESH_MODELS,
  REFRESH_READ_ONLY,
  UNLISTED_FLAG,
} from "@/app/providers/live";
import type { RefreshOutcome } from "@/app/providers/live-actions";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  SEEDED_VLLM_ID,
  anthropicEntry,
  copilotEntry,
  openaiCompatibleEntry,
  providerModel,
  providerModels,
} from "../helpers/providers";

/**
 * The chips, live ([#230](https://github.com/NobuData/ouroboros/issues/230)): the refresh
 * over the server hop, the flag on a stranded alias with its link, and the enter/leave
 * animation when a re-read changes the list.
 */

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  refreshModels: vi.fn<(id: string) => Promise<RefreshOutcome>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/providers/live-actions", () => ({
  refreshModels: (id: string) => state.refreshModels(id),
  startPull: vi.fn(),
}));

const { ModelsRegion } = await import("@/app/providers/models-region");

const VLLM = [
  providerModel({ modelId: "llama-4-maverick", display: "local/llama-4-maverick" }),
  providerModel({ modelId: "deepseek-v3.2", display: "local/deepseek-v3.2" }),
];

const STRANDED: UnlistedModel = {
  modelId: "deepseek-v3.2",
  aliases: [{ id: "a", alias: "local-ds" }],
};

/** The chips region for a vLLM catalog, as `cards.ts` decides it. */
function chips(models: readonly ProviderModel[], unlisted: readonly UnlistedModel[] = []) {
  const region = modelsRegion(openaiCompatibleEntry(), {
    ok: true,
    value: providerModels(SEEDED_VLLM_ID, models, unlisted),
  });

  if (region.kind === "unavailable") throw new Error("not the region under test");

  return region;
}

beforeEach(() => {
  state.refresh.mockReset();
  state.refreshModels.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the chips", () => {
  it("draws each model as a mono chip under the label, with the refresh beside it", () => {
    render(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(VLLM)} />);

    const list = screen.getByRole("list", { name: MODELS_LABEL });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "local/llama-4-maverick",
      "local/deepseek-v3.2",
    ]);
    expect(screen.getByRole("button", { name: REFRESH_MODELS })).not.toHaveAttribute("aria-disabled");
  });

  it("hides the refresh where discovery is a constant, and says so to a member", () => {
    const fixed = modelsRegion(copilotEntry(), {
      ok: true,
      value: providerModels("c", [providerModel({ modelId: "gpt-5-codex" })]),
    });
    if (fixed.kind === "unavailable") throw new Error("unexpected");

    const { unmount } = render(<ModelsRegion connectionId="c" mayAdminister region={fixed} />);
    expect(screen.queryByRole("button", { name: REFRESH_MODELS })).toBeNull();
    unmount();

    render(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister={false} region={chips(VLLM)} />);
    const refresh = screen.getByRole("button", { name: REFRESH_MODELS });
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    expect(refresh).toHaveAttribute("title", REFRESH_READ_ONLY);
  });

  it("says no models were discovered yet, rather than drawing an empty list", () => {
    render(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips([])} />);

    expect(screen.getByText(NO_MODELS)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("draws the tier pill only where discovery reported one", () => {
    const tiered = modelsRegion(anthropicEntry(), {
      ok: true,
      value: providerModels("a", [providerModel({ meta: { tier: "priority" } })]),
    });
    if (tiered.kind === "unavailable") throw new Error("unexpected");

    render(<ModelsRegion connectionId="a" mayAdminister region={tiered} />);

    expect(screen.getByText("priority tier")).toHaveClass("ou-chip--ok");
  });
});

describe("the flag on a stranded alias", () => {
  it("draws the model in the warn tone with the warning, and links to the alias", () => {
    render(
      <ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips([VLLM[0]], [STRANDED])} />,
    );

    const flag = screen.getByText(UNLISTED_FLAG, { exact: false });
    expect(flag).toHaveClass("providers-card__unlisted-flag");
    expect(screen.getByText("deepseek-v3.2")).toHaveClass("ou-chip--warn");

    const link = screen.getByRole("link", { name: "local-ds" });
    expect(link).toHaveAttribute("href", "/models/registry?alias=local-ds");
    expect(link).toHaveClass("providers-card__alias-link");
  });

  it("is drawn even when every chip is gone, because the route is still broken", () => {
    render(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips([], [STRANDED])} />);

    expect(screen.queryByText(NO_MODELS)).toBeNull();
    expect(screen.getByRole("link", { name: "local-ds" })).toBeInTheDocument();
  });
});

describe("refreshing", () => {
  it("asks the server hop, says so while it waits, then re-reads the card", async () => {
    let settle: (outcome: RefreshOutcome) => void = () => {};
    state.refreshModels.mockReturnValue(
      new Promise<RefreshOutcome>((done) => {
        settle = done;
      }),
    );
    render(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(VLLM)} />);

    fireEvent.click(screen.getByRole("button", { name: REFRESH_MODELS }));

    const busy = screen.getByRole("button", { name: REFRESHING });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(state.refreshModels).toHaveBeenCalledWith(SEEDED_VLLM_ID);

    await act(async () => settle({ ok: true, discovery: {} as never }));

    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: REFRESH_MODELS })).not.toHaveAttribute("aria-busy");
  });

  it("says why the list is unchanged, as an alert, and re-reads nothing", async () => {
    state.refreshModels.mockResolvedValue({ ok: false, reason: "the provider did not answer" });
    render(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(VLLM)} />);

    fireEvent.click(screen.getByRole("button", { name: REFRESH_MODELS }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("the provider did not answer");
    expect(state.refresh).not.toHaveBeenCalled();
  });
});

describe("a re-read that changed the chips", () => {
  it("draws a new chip entering and keeps a removed one leaving until the motion is over", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(VLLM)} />,
    );

    const next = [VLLM[0], providerModel({ modelId: "qwen3-coder:32b", display: "local/qwen3" })];
    await act(async () => {
      rerender(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(next)} />);
    });

    const list = screen.getByRole("list", { name: MODELS_LABEL });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "local/llama-4-maverick",
      "local/qwen3",
      "local/deepseek-v3.2",
    ]);
    expect(items[1]).toHaveClass("providers-card__chip--enter");
    expect(items[2]).toHaveClass("providers-card__chip--leave");

    await act(async () => {
      vi.advanceTimersByTime(CHIP_LEAVE_MS);
    });

    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "local/llama-4-maverick",
      "local/qwen3",
    ]);
    expect(within(list).queryByText("local/qwen3")?.closest("li")).not.toHaveClass(
      "providers-card__chip--enter",
    );
  });

  it("animates nothing on a re-read that changed nothing", async () => {
    const { rerender } = render(
      <ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(VLLM)} />,
    );

    await act(async () => {
      rerender(<ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips(VLLM)} />);
    });

    for (const item of screen.getAllByRole("listitem")) {
      expect(item).not.toHaveClass("providers-card__chip--enter");
      expect(item).not.toHaveClass("providers-card__chip--leave");
    }
  });
});

describe("both palettes", () => {
  it("renders the same markup, flag and all", () => {
    const [light, dark] = renderInBothPalettes(
      <ModelsRegion connectionId={SEEDED_VLLM_ID} mayAdminister region={chips([VLLM[0]], [STRANDED])} />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
