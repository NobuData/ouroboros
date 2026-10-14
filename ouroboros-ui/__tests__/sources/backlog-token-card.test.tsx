import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BacklogTokenOutcome } from "@/app/sources/actions";
import {
  BACKLOG_TOKEN_ANCHOR,
  BACKLOG_TOKEN_FIELD_LABEL,
  BACKLOG_TOKEN_MAX_LENGTH,
  BACKLOG_TOKEN_MIN_LENGTH,
  BACKLOG_TOKEN_NONE,
  BACKLOG_TOKEN_PATTERN,
  BACKLOG_TOKEN_READ_ONLY,
  BACKLOG_TOKEN_REMOVE,
  BACKLOG_TOKEN_REMOVED,
  BACKLOG_TOKEN_REMOVE_CANCEL,
  BACKLOG_TOKEN_REMOVE_CONFIRM,
  BACKLOG_TOKEN_REMOVE_QUESTION,
  BACKLOG_TOKEN_REPLACE,
  BACKLOG_TOKEN_SAVE,
  BACKLOG_TOKEN_SAVED,
  BACKLOG_TOKEN_SHAPE,
  BACKLOG_TOKEN_TITLE,
  BACKLOG_TOKEN_UNREAD,
  backlogTokenState,
} from "@/app/sources/view";

import { NO_BACKLOG_TOKEN, SEEDED_TOKEN_MASK, backlogToken } from "../helpers/sources";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  set: vi.fn<(token: string) => Promise<BacklogTokenOutcome>>(),
  clear: vi.fn<() => Promise<BacklogTokenOutcome>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/sources/actions", () => ({
  setBacklogToken: (token: string) => state.set(token),
  clearBacklogToken: () => state.clear(),
}));

const { BacklogTokenCard } = await import("@/app/sources/backlog-token-card");

/**
 * The **Backlog token** card ([#1250](https://github.com/NobuData/ouroboros/issues/1250)):
 * the one place the workspace's backlog token is set, replaced and removed.
 */

/** A token of the shape the service takes. */
const TYPED = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";

const STORED = { ok: true, value: backlogToken() } as const;
const NONE = { ok: true, value: NO_BACKLOG_TOKEN } as const;

function field(): HTMLInputElement {
  return screen.getByLabelText(BACKLOG_TOKEN_FIELD_LABEL);
}

function stateLine(): HTMLElement {
  return screen.getByTestId("backlog-token-state");
}

/** Type a token and submit the form. */
function save(token = TYPED): void {
  fireEvent.change(field(), { target: { value: token } });
  fireEvent.submit(field().closest("form")!);
}

beforeEach(() => {
  state.refresh.mockReset();
  state.set.mockReset().mockResolvedValue({ ok: true, token: backlogToken() });
  state.clear.mockReset().mockResolvedValue({ ok: true, token: NO_BACKLOG_TOKEN });
});

describe("BacklogTokenCard", () => {
  it("is a named region at the anchor the Issues page links to", () => {
    render(<BacklogTokenCard mayAdminister reading={NONE} />);

    const heading = screen.getByRole("heading", { name: BACKLOG_TOKEN_TITLE });
    const card = heading.closest(`#${BACKLOG_TOKEN_ANCHOR}`);

    expect(card).not.toBeNull();
    expect(card).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("says nothing is stored, and offers to save one", () => {
    render(<BacklogTokenCard mayAdminister reading={NONE} />);

    expect(stateLine()).toHaveTextContent(BACKLOG_TOKEN_NONE);
    expect(screen.getByRole("button", { name: BACKLOG_TOKEN_SAVE })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BACKLOG_TOKEN_REMOVE })).toBeNull();
  });

  it("shows a stored token by its mask and offers to replace or remove it", () => {
    render(<BacklogTokenCard mayAdminister reading={STORED} />);

    expect(stateLine()).toHaveTextContent(`${SEEDED_TOKEN_MASK} · set 2026-09-01`);
    expect(screen.getByRole("button", { name: BACKLOG_TOKEN_REPLACE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BACKLOG_TOKEN_REMOVE })).toBeInTheDocument();
  });

  it("takes the token in a masked input that accepts only the service's shape", () => {
    render(<BacklogTokenCard mayAdminister reading={NONE} />);

    expect(field()).toHaveAttribute("type", "password");
    expect(field()).toHaveAttribute("autocomplete", "off");
    expect(field()).toBeRequired();
    expect(field()).toHaveAttribute("pattern", BACKLOG_TOKEN_PATTERN);
    expect(field()).toHaveAttribute("minlength", String(BACKLOG_TOKEN_MIN_LENGTH));
    expect(field()).toHaveAttribute("maxlength", String(BACKLOG_TOKEN_MAX_LENGTH));
  });

  it("stores what was typed, draws the mask it was answered, and keeps nothing typed", async () => {
    render(<BacklogTokenCard mayAdminister reading={NONE} />);

    save();

    expect(await screen.findByRole("status")).toHaveTextContent(BACKLOG_TOKEN_SAVED);
    expect(state.set).toHaveBeenCalledExactlyOnceWith(TYPED);
    expect(stateLine()).toHaveTextContent(SEEDED_TOKEN_MASK);
    expect(field()).toHaveValue("");
    expect(document.body).not.toHaveTextContent(TYPED);
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: BACKLOG_TOKEN_REPLACE })).toBeInTheDocument();
  });

  it("says why a refused value was not stored, and changes nothing", async () => {
    state.set.mockResolvedValue({ ok: false, reason: BACKLOG_TOKEN_SHAPE });
    render(<BacklogTokenCard mayAdminister reading={NONE} />);

    save();

    expect(await screen.findByRole("alert")).toHaveTextContent(BACKLOG_TOKEN_SHAPE);
    expect(stateLine()).toHaveTextContent(BACKLOG_TOKEN_NONE);
    expect(state.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("asks before removing, and removes nothing on a no", () => {
    render(<BacklogTokenCard mayAdminister reading={STORED} />);

    fireEvent.click(screen.getByRole("button", { name: BACKLOG_TOKEN_REMOVE }));

    expect(screen.getByText(BACKLOG_TOKEN_REMOVE_QUESTION)).toBeInTheDocument();
    expect(state.clear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: BACKLOG_TOKEN_REMOVE_CANCEL }));

    expect(screen.queryByText(BACKLOG_TOKEN_REMOVE_QUESTION)).toBeNull();
    expect(state.clear).not.toHaveBeenCalled();
    expect(stateLine()).toHaveTextContent(SEEDED_TOKEN_MASK);
  });

  it("removes the token on a yes, and says the backlog is paused", async () => {
    render(<BacklogTokenCard mayAdminister reading={STORED} />);

    fireEvent.click(screen.getByRole("button", { name: BACKLOG_TOKEN_REMOVE }));
    fireEvent.click(screen.getByRole("button", { name: BACKLOG_TOKEN_REMOVE_CONFIRM }));

    expect(await screen.findByRole("status")).toHaveTextContent(BACKLOG_TOKEN_REMOVED);
    expect(state.clear).toHaveBeenCalledOnce();
    expect(stateLine()).toHaveTextContent(BACKLOG_TOKEN_NONE);
    expect(state.refresh).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: BACKLOG_TOKEN_SAVE })).toBeInTheDocument(),
    );
  });

  it("keeps the form when the state could not be read, and says so", () => {
    render(<BacklogTokenCard mayAdminister reading={{ ok: false, reason: "Down." }} />);

    expect(stateLine()).toHaveTextContent(BACKLOG_TOKEN_UNREAD);
    expect(screen.getByRole("button", { name: BACKLOG_TOKEN_SAVE })).toBeInTheDocument();
  });

  it("tells a reader who may not change it who can, and draws no form", () => {
    render(<BacklogTokenCard mayAdminister={false} reading={null} />);

    expect(screen.getByTestId("backlog-token-read-only")).toHaveTextContent(BACKLOG_TOKEN_READ_ONLY);
    expect(screen.queryByLabelText(BACKLOG_TOKEN_FIELD_LABEL)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("backlogTokenState", () => {
  it("is the mask and the day it was set", () => {
    expect(backlogTokenState(backlogToken())).toBe(`${SEEDED_TOKEN_MASK} · set 2026-09-01`);
  });

  it("adds the day it was last replaced, once it has been", () => {
    expect(backlogTokenState(backlogToken({ updatedAt: "2026-10-02T08:00:00.000Z" }))).toBe(
      `${SEEDED_TOKEN_MASK} · set 2026-09-01 · replaced 2026-10-02`,
    );
  });
});

describe("BACKLOG_TOKEN_PATTERN", () => {
  const shape = new RegExp(`^(?:${BACKLOG_TOKEN_PATTERN})$`);

  it.each(["ghp_abc123", "github_pat_11ABC_def", "gho_x", "ghu_x", "ghs_x", "ghr_x", "a".repeat(40)])(
    "takes %s",
    (token) => {
      expect(shape.test(token)).toBe(true);
    },
  );

  it.each(["https://github.com/acme/repo", "ghp_with space", "glpat-abc", "A".repeat(40), ""])(
    "refuses %s",
    (token) => {
      expect(shape.test(token)).toBe(false);
    },
  );
});
