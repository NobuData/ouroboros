import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY_FEEDBACK_MS, CopyBranch } from "@/app/runs/copy-branch";
import { COPIED_BRANCH, COPY_BRANCH_FAILED, COPY_BRANCH_LABEL } from "@/app/runs/view";

/**
 * The branch name and its copy control (#309): the branch reaches the clipboard exactly, and the
 * outcome is said in words as well as by the icon — then fades back.
 */

/**
 * Give the page a clipboard.
 *
 * @param writeText What a write does.
 * @returns The stub.
 */
function clipboard(writeText: (text: string) => Promise<void>) {
  const stub = { writeText: vi.fn(writeText) };
  Object.defineProperty(navigator, "clipboard", { value: stub, configurable: true });
  return stub;
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  vi.useRealTimers();
});

/** The control. */
function control(): HTMLElement {
  return screen.getByRole("button", { name: COPY_BRANCH_LABEL });
}

describe("the copy control", () => {
  it("shows the branch in mono beside it", () => {
    render(<CopyBranch branch="loop/482-canbus-flake" />);

    expect(screen.getByText("loop/482-canbus-flake")).toBeInTheDocument();
    expect(control()).toHaveAttribute("type", "button");
  });

  it("copies the branch exactly and says so, then goes back to offering", async () => {
    vi.useFakeTimers();
    const stub = clipboard(() => Promise.resolve());
    render(<CopyBranch branch="loop/482-canbus-flake" />);

    await act(async () => {
      fireEvent.click(control());
    });

    expect(stub.writeText).toHaveBeenCalledExactlyOnceWith("loop/482-canbus-flake");
    expect(screen.getByRole("status")).toHaveTextContent(COPIED_BRANCH);

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says so when the browser refuses the clipboard", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    render(<CopyBranch branch="loop/1" />);

    await act(async () => {
      fireEvent.click(control());
    });

    expect(screen.getByRole("status")).toHaveTextContent(COPY_BRANCH_FAILED);
  });

  it("says so when the page has no clipboard at all", async () => {
    render(<CopyBranch branch="loop/1" />);

    await act(async () => {
      fireEvent.click(control());
    });

    expect(screen.getByRole("status")).toHaveTextContent(COPY_BRANCH_FAILED);
  });
});
