import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GLOBS_MAX,
  GLOB_MAX_LENGTH,
  GLOB_PROBLEMS,
  type GlobPreview,
  type GlobPreviewRepository,
  PREVIEW_LOADING,
  PREVIEW_NO_GLOBS,
  PREVIEW_NO_REPOSITORIES,
} from "@/app/globs/glob";
import {
  ADD_BUTTON,
  ADD_LABEL,
  CANCEL_LABEL,
  GlobEditor,
  NOT_ADDED,
  PREVIEW_DEBOUNCE_MS,
  PREVIEW_FAILED,
  PREVIEW_LABEL,
  SAVE_LABEL,
  matchesNothing,
} from "@/app/globs/glob-editor";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The shared glob editor, rendered (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)):
 * a pattern that fails the grammar never reaches `onChange`, and the match preview is the
 * service's answer for the list as it stands — debounced, with a late answer for an older list
 * dropped.
 */

const GLOBS = ["boot/**", "keys/**"] as const;

/**
 * A listed repository's answer for some patterns.
 *
 * @param counts Each pattern's match count.
 * @param overrides Fields to replace.
 * @returns The answer.
 */
function repository(
  counts: Readonly<Record<string, number>>,
  overrides: Partial<GlobPreviewRepository> = {},
): GlobPreviewRepository {
  return {
    repository: "acme/helios-firmware",
    status: "listed",
    reason: null,
    fileCount: 1234,
    truncated: false,
    globs: Object.entries(counts).map(([glob, matchCount]) => ({
      glob,
      matchCount,
      samples: Array.from({ length: Math.min(matchCount, 7) }, (_, index) =>
        glob.replace("**", `file-${String(index)}.c`),
      ),
    })),
    ...overrides,
  };
}

/**
 * A preview that answers every pattern asked about with three matches.
 *
 * @returns The fetch spy.
 */
function answering() {
  return vi.fn((globs: readonly string[]): Promise<GlobPreview> =>
    Promise.resolve({
      ok: true,
      repositories: [repository(Object.fromEntries(globs.map((glob) => [glob, 3])))],
    }),
  );
}

/**
 * Draw the editor.
 *
 * @param options The list, the preview fetch and whether it is inert.
 * @returns The `onChange` spy, the preview spy and a way to redraw with a new list.
 */
function draw(
  options: {
    globs?: readonly string[];
    preview?: (globs: readonly string[]) => Promise<GlobPreview>;
    readOnly?: boolean;
  } = {},
) {
  const onChange = vi.fn<(globs: readonly string[]) => void>();
  const preview = options.preview ?? answering();
  const element = (globs: readonly string[]) => (
    <GlobEditor
      globs={globs}
      id="paths"
      label="Protected path patterns"
      onChange={onChange}
      preview={preview}
      readOnly={options.readOnly}
    />
  );
  const view = render(element(options.globs ?? GLOBS));

  return {
    onChange,
    preview,
    redraw: (globs: readonly string[]) => {
      view.rerender(element(globs));
    },
    unmount: view.unmount,
  };
}

/** Let timers of `ms` fire and every settled promise's continuation run. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The add input. */
function addInput(): HTMLInputElement {
  return screen.getByLabelText(ADD_LABEL);
}

/**
 * Type into the add input.
 *
 * @param text What to type.
 */
function type(text: string): void {
  fireEvent.change(addInput(), { target: { value: text } });
}

/** The preview region. */
function previewRegion(): HTMLElement {
  return screen.getByRole("status", { name: PREVIEW_LABEL });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the list", () => {
  it("draws every pattern as written, under the list's name, with its two controls", async () => {
    draw();
    await settle();

    const list = screen.getByRole("list", { name: "Protected path patterns" });

    expect(within(list).getByText("boot/**")).toBeTruthy();
    expect(within(list).getByText("keys/**")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit boot/**" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove keys/**" })).toBeTruthy();
    expect(addInput().id).toBe("paths-add");
  });

  it("removes a pattern", async () => {
    const { onChange } = draw();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Remove boot/**" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(["keys/**"]);
  });

  it("renders identically under both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <GlobEditor
        globs={GLOBS}
        id="paths"
        label="Protected path patterns"
        onChange={() => {}}
        preview={() => new Promise(() => {})}
      />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("adding", () => {
  it("adds a valid pattern with the button, and clears the input", async () => {
    const { onChange } = draw();
    await settle();

    type(".github/**");
    fireEvent.click(screen.getByRole("button", { name: ADD_BUTTON }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(["boot/**", "keys/**", ".github/**"]);
    expect(addInput().value).toBe("");
  });

  it("adds on Enter", async () => {
    const { onChange } = draw();
    await settle();

    type("drivers/can/**");
    fireEvent.keyDown(addInput(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(["boot/**", "keys/**", "drivers/can/**"]);
  });

  it.each([
    ["", "empty"],
    ["a".repeat(GLOB_MAX_LENGTH + 1), "too_long"],
    ["/boot/**", "absolute"],
    ["boot dir/**", "whitespace"],
    ["boot/../keys", "parent"],
    ["boot/**", "duplicate"],
  ] as const)("keeps %j out of the list and says why (%s)", async (text, problem) => {
    const { onChange } = draw();
    await settle();

    type(text);
    fireEvent.keyDown(addInput(), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(GLOB_PROBLEMS[problem])).toBeTruthy();
    expect(addInput().getAttribute("aria-invalid")).toBe("true");
    expect(addInput().value).toBe(text);
  });

  it("refuses a pattern past the cap", async () => {
    const full = Array.from({ length: GLOBS_MAX }, (_, index) => `dir${String(index)}/**`);
    const { onChange } = draw({ globs: full });
    await settle();

    type("one-more/**");
    fireEvent.click(screen.getByRole("button", { name: ADD_BUTTON }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(GLOB_PROBLEMS.full)).toBeTruthy();
  });

  it("drops the reason as soon as the text changes", async () => {
    draw();
    await settle();

    type("/abs");
    fireEvent.keyDown(addInput(), { key: "Enter" });
    type("abs");

    expect(screen.queryByText(GLOB_PROBLEMS.absolute)).toBeNull();
  });
});

describe("editing in place", () => {
  /**
   * Open a pattern's editor.
   *
   * @param glob The pattern.
   * @returns Its input.
   */
  function edit(glob: string): HTMLInputElement {
    fireEvent.click(screen.getByRole("button", { name: `Edit ${glob}` }));

    return screen.getByLabelText(`Pattern ${glob}`);
  }

  it("replaces the pattern where it stands", async () => {
    const { onChange } = draw();
    await settle();

    const input = edit("boot/**");
    fireEvent.change(input, { target: { value: "bootloader/**" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_LABEL }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(["bootloader/**", "keys/**"]);
  });

  it("saves on Enter and cancels on Escape", async () => {
    const { onChange } = draw();
    await settle();

    fireEvent.change(edit("keys/**"), { target: { value: "secrets/**" } });
    fireEvent.keyDown(screen.getByLabelText("Pattern keys/**"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["boot/**", "secrets/**"]);

    fireEvent.change(edit("boot/**"), { target: { value: "x/**" } });
    fireEvent.keyDown(screen.getByLabelText("Pattern boot/**"), { key: "Escape" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Pattern boot/**")).toBeNull();
  });

  it("validates against the other patterns, and keeps an invalid edit out of the list", async () => {
    const { onChange } = draw();
    await settle();

    const input = edit("boot/**");

    fireEvent.change(input, { target: { value: "keys/**" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_LABEL }));
    expect(screen.getByText(GLOB_PROBLEMS.duplicate)).toBeTruthy();

    fireEvent.change(input, { target: { value: "/boot" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_LABEL }));
    expect(screen.getByText(GLOB_PROBLEMS.absolute)).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_LABEL }));
    expect(screen.getByText(GLOB_PROBLEMS.empty)).toBeTruthy();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes without a change when the text is what it was, and on Cancel", async () => {
    const { onChange } = draw();
    await settle();

    edit("boot/**");
    fireEvent.click(screen.getByRole("button", { name: SAVE_LABEL }));
    expect(screen.queryByLabelText("Pattern boot/**")).toBeNull();

    fireEvent.change(edit("boot/**"), { target: { value: "other/**" } });
    fireEvent.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    expect(onChange).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("list", { name: "Protected path patterns" })).getByText("boot/**"),
    ).toBeTruthy();
  });

  it("edits a pattern in a full list — capacity is a rule about adding", async () => {
    const full = Array.from({ length: GLOBS_MAX }, (_, index) => `dir${String(index)}/**`);
    const { onChange } = draw({ globs: full });
    await settle();

    fireEvent.change(edit("dir0/**"), { target: { value: "renamed/**" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_LABEL }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(["renamed/**", ...full.slice(1)]);
  });
});

describe("read-only", () => {
  it("shows the list and the preview, and nothing that changes them", async () => {
    const { preview } = draw({ readOnly: true });
    await settle();

    expect(screen.getByText("boot/**", { selector: ".glob-editor__list *" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(ADD_LABEL)).toBeNull();
    expect(preview).toHaveBeenCalledExactlyOnceWith(GLOBS);
  });
});

describe("the match preview", () => {
  it("is fetched on mount, saying so while it is, then draws each repository's matches", async () => {
    const { preview } = draw();

    expect(previewRegion().textContent).toBe(PREVIEW_LOADING);

    await settle();

    expect(preview).toHaveBeenCalledExactlyOnceWith(GLOBS);
    expect(within(previewRegion()).getByText("acme/helios-firmware — 1,234 files checked")).toBeTruthy();
    expect(within(previewRegion()).getAllByText("matches 3 files")).toHaveLength(2);
    expect(within(previewRegion()).getByText("boot/file-0.c")).toBeTruthy();
  });

  it("draws at most five sample paths per pattern", async () => {
    draw({
      globs: ["boot/**"],
      preview: () => Promise.resolve({ ok: true, repositories: [repository({ "boot/**": 40 })] }),
    });
    await settle();

    expect(previewRegion().querySelectorAll(".glob-editor__sample")).toHaveLength(5);
    expect(within(previewRegion()).getByText("matches 40 files")).toBeTruthy();
  });

  it("is never fetched for an empty list", async () => {
    const { preview } = draw({ globs: [] });
    await settle(PREVIEW_DEBOUNCE_MS * 2);

    expect(preview).not.toHaveBeenCalled();
    expect(previewRegion().textContent).toBe(PREVIEW_NO_GLOBS);
  });

  it("waits for the list to be quiet before fetching again", async () => {
    const { preview, redraw } = draw();
    await settle();

    redraw(["boot/**"]);
    await settle(PREVIEW_DEBOUNCE_MS - 1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(previewRegion().textContent).toBe(PREVIEW_LOADING);

    redraw(["boot/**", "docs/**"]);
    await settle(PREVIEW_DEBOUNCE_MS - 1);
    expect(preview).toHaveBeenCalledTimes(1);

    await settle(1);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenLastCalledWith(["boot/**", "docs/**"]);
  });

  it("previews the pattern being typed once it is valid, marked as not added yet", async () => {
    const { preview, onChange } = draw();
    await settle();

    type("/docs");
    await settle(PREVIEW_DEBOUNCE_MS);
    expect(preview).toHaveBeenCalledTimes(1);

    type("docs/**");
    await settle(PREVIEW_DEBOUNCE_MS);

    expect(preview).toHaveBeenLastCalledWith(["boot/**", "keys/**", "docs/**"]);
    expect(onChange).not.toHaveBeenCalled();

    const row = within(previewRegion()).getByText("docs/**").closest("li") as HTMLElement;

    expect(within(row).getByText(NOT_ADDED)).toBeTruthy();
    expect(within(previewRegion()).getAllByText(NOT_ADDED)).toHaveLength(1);
  });

  it("drops an answer for a list that has since changed", async () => {
    const answers: ((preview: GlobPreview) => void)[] = [];
    const preview = vi.fn(
      () =>
        new Promise<GlobPreview>((resolve) => {
          answers.push(resolve);
        }),
    );
    const { redraw } = draw({ preview });
    await settle();

    redraw(["docs/**"]);
    await settle(PREVIEW_DEBOUNCE_MS);
    expect(answers).toHaveLength(2);

    // The first list's answer arrives last.
    answers[1]({ ok: true, repositories: [repository({ "docs/**": 9 })] });
    await settle();
    answers[0]({ ok: true, repositories: [repository({ "boot/**": 1, "keys/**": 1 })] });
    await settle();

    expect(within(previewRegion()).getByText("matches 9 files")).toBeTruthy();
    expect(within(previewRegion()).queryByText("matches 1 file")).toBeNull();
  });

  it("says a truncated tree's counts are a minimum", async () => {
    draw({
      preview: () =>
        Promise.resolve({
          ok: true,
          repositories: [repository({ "boot/**": 2, "keys/**": 1 }, { truncated: true })],
        }),
    });
    await settle();

    expect(previewRegion().textContent).toContain("the tree is larger, so counts are a minimum");
  });

  it("says which repository could not be listed, and still draws the ones that could", async () => {
    draw({
      preview: () =>
        Promise.resolve({
          ok: true,
          repositories: [
            repository({ "boot/**": 2, "keys/**": 1 }),
            repository(
              {},
              {
                repository: "acme/docs",
                status: "unavailable",
                reason: "The host refused the token.",
                fileCount: null,
              },
            ),
          ],
        }),
    });
    await settle();

    expect(
      within(previewRegion()).getByText("acme/docs — could not be listed. The host refused the token."),
    ).toBeTruthy();
    expect(within(previewRegion()).getByText("matches 2 files")).toBeTruthy();
  });

  it("flags, in words, a pattern that matches nothing in any repository checked", async () => {
    draw({
      preview: () =>
        Promise.resolve({
          ok: true,
          repositories: [
            repository({ "boot/**": 4, "keys/**": 0 }),
            repository({ "boot/**": 0, "keys/**": 0 }, { repository: "acme/docs" }),
          ],
        }),
    });
    await settle();

    expect(within(previewRegion()).getByText(matchesNothing("keys/**"))).toBeTruthy();
    expect(within(previewRegion()).queryByText(matchesNothing("boot/**"))).toBeNull();
    expect(within(previewRegion()).getAllByText("matches no files")).toHaveLength(3);
  });

  it("flags nothing when no repository could be listed — nothing was checked", async () => {
    draw({
      preview: () =>
        Promise.resolve({
          ok: true,
          repositories: [repository({}, { status: "unavailable", reason: null, fileCount: null })],
        }),
    });
    await settle();

    expect(previewRegion().querySelector(".glob-editor__flag")).toBeNull();
  });

  it("says there is nothing to preview against when no repository is enabled", async () => {
    draw({ preview: () => Promise.resolve({ ok: true, repositories: [] }) });
    await settle();

    expect(previewRegion().textContent).toBe(PREVIEW_NO_REPOSITORIES);
  });

  it("shows why there is no preview — the service's reason, or that the fetch failed", async () => {
    const first = draw({
      preview: () => Promise.resolve({ ok: false, reason: "Only an owner or admin can preview." }),
    });
    await settle();
    expect(previewRegion().textContent).toBe("Only an owner or admin can preview.");
    first.unmount();

    draw({ preview: () => Promise.reject(new Error("offline")) });
    await settle();
    expect(previewRegion().textContent).toBe(PREVIEW_FAILED);
  });

  it("leaves no timer running, and draws nothing late, once unmounted", async () => {
    const { preview, redraw, unmount } = draw();
    await settle();

    redraw(["docs/**"]);
    unmount();
    await settle(PREVIEW_DEBOUNCE_MS * 2);

    expect(preview).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
