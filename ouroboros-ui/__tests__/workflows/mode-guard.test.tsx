import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workflowCodePath, workflowPath } from "@/app/paths";
import {
  SWITCH_PROMPT_CANCEL,
  SWITCH_PROMPT_TITLE,
  switchPromptBody,
} from "@/app/workflows/mode-switch";
import { STUDIO_EYEBROW } from "@/app/workflows/view";

/**
 * The guard on a switch between the studio's editors (V.1, #169), driven the way a reader drives
 * it: through the segmented control, with an editor holding — or not holding — code that has not
 * parsed.
 *
 * The ticket's criterion: **an unsaved, unparsed buffer prompts before a mode switch discards
 * it**. The suite holds both halves of that sentence — a held buffer is never discarded without
 * an answer, and a switch that discards nothing is never interrupted.
 */

/** Where a link navigated, and where the router was pushed. */
const { navigate, push } = vi.hoisted(() => ({ navigate: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// `next/link` wants the App Router to navigate. This stand-in keeps the one behaviour the guard
// relies on — a click whose default was prevented does not navigate — and records the rest.
vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));

const { StudioModeGuard, createBufferHolder, useUnsavedBuffer } = await import(
  "@/app/workflows/mode-guard"
);
const { StudioSubnav } = await import("@/app/workflows/studio-subnav");

/**
 * A stand-in for the code editor: it holds a buffer or it does not.
 *
 * @param props.holding Whether it holds code that has not parsed.
 * @returns Nothing drawn.
 */
function Editor({ holding }: Readonly<{ holding: boolean }>) {
  useUnsavedBuffer(holding ? { surface: "code" } : null);
  return null;
}

/**
 * The code view, reduced to what the guard is about: the guard, an editor, and the tab row.
 *
 * @param props.holding Whether the editor holds a buffer.
 * @param props.editor Whether the editor is mounted at all.
 * @returns The tree.
 */
function CodePage({ holding = true, editor = true }: Readonly<{ holding?: boolean; editor?: boolean }>) {
  return (
    <StudioModeGuard>
      {editor && <Editor holding={holding} />}
      <StudioSubnav current="code" slug="standard-fix" />
    </StudioModeGuard>
  );
}

/** A segment of the tab row, by name. */
function segment(name: string): HTMLElement {
  return within(screen.getByRole("navigation", { name: STUDIO_EYEBROW })).getByRole("link", { name });
}

/** The prompt, if it is open. */
function prompt(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: SWITCH_PROMPT_TITLE });
}

beforeEach(() => {
  navigate.mockReset();
  push.mockReset();
});

describe("a switch that discards nothing", () => {
  it("navigates with nothing asked when no buffer is held — both editors read the one draft", () => {
    render(<CodePage holding={false} />);

    fireEvent.click(segment("Visual"));

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(workflowPath("standard-fix"));
  });

  it("navigates with nothing asked for a press on the tab already open", () => {
    render(<CodePage />);

    fireEvent.click(segment("Code"));

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(workflowCodePath("standard-fix"));
  });

  it("never stops a modified click, which opens the link elsewhere and leaves this page as it is", () => {
    render(<CodePage />);

    fireEvent.click(segment("Visual"), { metaKey: true });

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("asks nothing once the editor releases its buffer — a successful parse", () => {
    const { rerender } = render(<CodePage />);

    rerender(<CodePage holding={false} />);
    fireEvent.click(segment("Visual"));

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("asks nothing once the editor that held the buffer has unmounted, so a hold cannot outlive its page", () => {
    const { rerender } = render(<CodePage />);

    rerender(<CodePage editor={false} />);
    fireEvent.click(segment("Visual"));

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledOnce();
  });
});

describe("a switch that would discard a buffer", () => {
  it("asks first, saying what is lost and why the draft never had it, and does not navigate", () => {
    render(<CodePage />);

    fireEvent.click(segment("Visual"));

    const dialog = prompt();

    expect(dialog).not.toBeNull();
    expect(dialog).toHaveTextContent(switchPromptBody("visual"));
    expect(navigate).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the buffer and the page when the reader keeps editing — and asks again next time", () => {
    render(<CodePage />);

    fireEvent.click(segment("Visual"));
    fireEvent.click(within(prompt()!).getByRole("button", { name: SWITCH_PROMPT_CANCEL }));

    expect(prompt()).toBeNull();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(segment("Visual"));

    expect(prompt()).not.toBeNull();
  });

  it("treats Escape as keeping editing", () => {
    render(<CodePage />);

    fireEvent.click(segment("Visual"));
    fireEvent.keyDown(prompt()!, { key: "Escape" });

    expect(prompt()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("discards the buffer and switches when the reader says so", () => {
    render(<CodePage />);

    fireEvent.click(segment("Visual"));
    fireEvent.click(within(prompt()!).getByRole("button", { name: "Discard and open Visual" }));

    expect(prompt()).toBeNull();
    expect(push).toHaveBeenCalledExactlyOnceWith(workflowPath("standard-fix"));

    // Released: a later switch from the same page is not asked about the same discarded buffer.
    fireEvent.click(segment("Visual"));

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledOnce();
  });
});

describe("outside a guard", () => {
  it("is a plain link, and holding a buffer does nothing — the landing has no editor to guard", () => {
    render(
      <>
        <Editor holding />
        <StudioSubnav current="visual" slug="standard-fix" />
      </>,
    );

    expect(segment("Visual")).toHaveAttribute("aria-current", "page");
    expect(segment("Code")).not.toHaveAttribute("aria-current");

    fireEvent.click(segment("Code"));

    expect(prompt()).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(workflowCodePath("standard-fix"));
  });
});

describe("createBufferHolder", () => {
  it("starts empty, holds what it is given, and releases on null", () => {
    const holder = createBufferHolder();

    expect(holder.get()).toBeNull();
    holder.set({ surface: "code" });
    expect(holder.get()).toEqual({ surface: "code" });
    holder.set(null);
    expect(holder.get()).toBeNull();
  });

  it("keeps each guard's hold its own", () => {
    const first = createBufferHolder();
    const second = createBufferHolder();

    first.set({ surface: "code" });

    expect(second.get()).toBeNull();
  });
});
