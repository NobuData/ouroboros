import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderTest } from "@/app/api/providers";
import { TEST_CONNECTION } from "@/app/providers/cards";
import {
  GLYPHS,
  MODELS_NOT_REFRESHED,
  RETRY_DELAY_MS,
  TESTING,
  TEST_READ_ONLY,
} from "@/app/providers/live";
import type { TestOutcome } from "@/app/providers/live-actions";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The card foot's **Test connection** ([#230](https://github.com/NobuData/ouroboros/issues/230)):
 * the note that draws what the provider said, the re-read that follows, the one bounded
 * retry, and a member's inert button.
 */

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  testConnection: vi.fn<(id: string) => Promise<TestOutcome>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/providers/live-actions", () => ({
  testConnection: (id: string) => state.testConnection(id),
}));

const { TestConnection } = await import("@/app/providers/test-connection");

const ID = "5eed000c-0000-4000-8000-000000000001";

function passed(over: Partial<ProviderTest> = {}): ProviderTest {
  return {
    connectionId: ID,
    checkedAt: "2026-08-25T10:00:12.004Z",
    status: "active",
    pill: { tone: "ok", label: "connected" },
    note: "200",
    latencyMs: 38,
    errorClass: null,
    retryable: false,
    detail: "200",
    ...over,
  };
}

function degraded(): ProviderTest {
  return passed({
    status: "error",
    pill: { tone: "warn", label: "degraded upstream" },
    note: "503 upstream · retrying",
    latencyMs: null,
    errorClass: "upstream",
    retryable: true,
    detail: "503 upstream",
  });
}

/** A write that resolves when the case says so. */
function deferredTest() {
  let resolve: (outcome: TestOutcome) => void = () => {};
  state.testConnection.mockReturnValue(
    new Promise<TestOutcome>((done) => {
      resolve = done;
    }),
  );
  return (outcome: TestOutcome) => act(async () => resolve(outcome));
}

beforeEach(() => {
  state.refresh.mockReset();
  state.testConnection.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pressing Test connection", () => {
  it("says testing while it waits, then draws `✓ 200 · 38ms` and re-reads the card", async () => {
    const settle = deferredTest();
    render(<TestConnection connectionId={ID} mayAdminister />);

    fireEvent.click(screen.getByRole("button", { name: TEST_CONNECTION }));

    const note = screen.getByRole("status");
    expect(note).toHaveTextContent(TESTING);
    expect(note).toHaveClass("providers-card__test-note--pending");
    expect(screen.getByRole("button", { name: TEST_CONNECTION })).toHaveAttribute("aria-disabled", "true");

    await settle({ ok: true, result: passed(), models: { ok: true, value: {} as never } });

    expect(state.testConnection).toHaveBeenCalledWith(ID);
    expect(note).toHaveTextContent(`${GLYPHS.ok} 200 · 38ms`);
    expect(note).toHaveClass("providers-card__test-note--ok");
    expect(note).not.toHaveClass("providers-card__test-note--pending");
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: TEST_CONNECTION })).not.toHaveAttribute("aria-disabled");
  });

  it("draws a refused key in the err tone, and still re-reads so the pill changes", async () => {
    const settle = deferredTest();
    render(<TestConnection connectionId={ID} mayAdminister />);

    fireEvent.click(screen.getByRole("button", { name: TEST_CONNECTION }));
    await settle({
      ok: true,
      result: passed({
        status: "error",
        pill: { tone: "err", label: "key rejected" },
        note: "key rejected (401)",
        latencyMs: null,
        errorClass: "auth",
      }),
      models: null,
    });

    const note = screen.getByRole("status");
    expect(note).toHaveTextContent(`${GLYPHS.err} key rejected (401)`);
    expect(note).toHaveClass("providers-card__test-note--err");
    expect(note).not.toHaveTextContent("ms");
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the pass and says beside it when the chips could not be refreshed", async () => {
    const settle = deferredTest();
    render(<TestConnection connectionId={ID} mayAdminister />);

    fireEvent.click(screen.getByRole("button", { name: TEST_CONNECTION }));
    await settle({ ok: true, result: passed(), models: { ok: false, reason: "the list is unchanged" } });

    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("200 · 38ms");
    expect(note.querySelector(".providers-card__test-aside")).toHaveTextContent(
      `${MODELS_NOT_REFRESHED}: the list is unchanged`,
    );
  });

  it("draws a refusal of the request as an alert, and re-reads nothing", async () => {
    const settle = deferredTest();
    render(<TestConnection connectionId={ID} mayAdminister />);

    fireEvent.click(screen.getByRole("button", { name: TEST_CONNECTION }));
    await settle({ ok: false, reason: "This provider has been removed. Reload the page." });

    expect(screen.getByRole("alert")).toHaveTextContent("This provider has been removed.");
    expect(state.refresh).not.toHaveBeenCalled();
  });
});

describe("the one bounded retry", () => {
  it("re-tests an upstream failure once after the delay, keeping the note busy meanwhile", async () => {
    vi.useFakeTimers();
    state.testConnection.mockResolvedValueOnce({ ok: true, result: degraded(), models: null });
    state.testConnection.mockResolvedValueOnce({ ok: true, result: passed(), models: null });
    render(<TestConnection connectionId={ID} mayAdminister />);

    fireEvent.click(screen.getByRole("button", { name: TEST_CONNECTION }));
    await act(async () => {
      await Promise.resolve();
    });

    const note = screen.getByRole("status");
    expect(note).toHaveTextContent(`${GLYPHS.warn} 503 upstream · retrying`);
    expect(note).toHaveClass("providers-card__test-note--warn");
    expect(note).toHaveAttribute("aria-busy", "true");
    expect(state.testConnection).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(RETRY_DELAY_MS);
      await Promise.resolve();
    });

    expect(state.testConnection).toHaveBeenCalledTimes(2);
    expect(note).toHaveTextContent(`${GLYPHS.ok} 200 · 38ms`);
    expect(note).not.toHaveAttribute("aria-busy");

    // Bounded: a second upstream failure would earn nothing more, and a pass earns nothing.
    await act(async () => {
      vi.advanceTimersByTime(RETRY_DELAY_MS * 2);
    });
    expect(state.testConnection).toHaveBeenCalledTimes(2);
  });

  it("retries nothing for a class a wait does not change", async () => {
    vi.useFakeTimers();
    state.testConnection.mockResolvedValue({
      ok: true,
      result: passed({ status: "error", errorClass: "rate_limit", retryable: true, latencyMs: null }),
      models: null,
    });
    render(<TestConnection connectionId={ID} mayAdminister />);

    fireEvent.click(screen.getByRole("button", { name: TEST_CONNECTION }));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(RETRY_DELAY_MS * 2);
    });

    expect(state.testConnection).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy");
  });
});

describe("a member's foot", () => {
  it("draws the button inert with the reason, and never calls", () => {
    render(<TestConnection connectionId={ID} mayAdminister={false} />);

    const button = screen.getByRole("button", { name: TEST_CONNECTION });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", TEST_READ_ONLY);

    fireEvent.click(button);
    expect(state.testConnection).not.toHaveBeenCalled();
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<TestConnection connectionId={ID} mayAdminister />);

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
