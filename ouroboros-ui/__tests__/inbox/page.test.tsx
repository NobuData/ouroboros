import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetResolvedCollapsed } from "@/app/inbox/resolved-collapse";

import { inboxReadings } from "../helpers/inbox";

/**
 * The `/inbox` route (#466): the gate is asked first, then the queue — and today's resolved list
 * (#468) — is read for the first paint, and the reader's id goes to the screen.
 */

const requireWorkspace = vi.fn();
const readInbox = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/inbox/data", () => ({ readInbox: () => readInbox() }));
vi.mock("@/app/inbox/inbox-actions", () => ({
  snoozeAll: vi.fn(),
  readNotificationSettings: vi.fn(),
  updateNotificationSettings: vi.fn(),
  answerDecision: vi.fn(),
  snoozeDecision: vi.fn(),
}));

// The route passes the screen no test seam, so its poll is the real one, answering nothing here.
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

const Page = (await import("@/app/(app)/inbox/page")).default;

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue({ session: { user: { id: "user-ken" } } });
  window.localStorage.clear();
  readInbox.mockReset().mockResolvedValue(inboxReadings());
});

describe("the inbox route", () => {
  it("gates, reads once and renders the seeded head", async () => {
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledOnce();
    expect(readInbox).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("3 decisions. About 90 seconds of your time.");
  });

  it("draws today's resolved list from the same server read", async () => {
    render(await Page());

    expect(screen.getByRole("button", { name: "Resolved today · 5" })).toBeInTheDocument();
  });

  it("hands the screen the session's reader, whose fold of the resolved list it is", async () => {
    window.localStorage.setItem("ouro-inbox-resolved-collapsed", JSON.stringify({ "user-ken": true }));
    resetResolvedCollapsed();

    render(await Page());

    expect(await screen.findByRole("button", { name: "Resolved today · 5", expanded: false })).toBeInTheDocument();
  });

  it("does not read when the gate refuses", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(readInbox).not.toHaveBeenCalled();
  });
});
