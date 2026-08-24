import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIT_LOG_LABEL } from "@/app/providers/view";

import { membership, sessionUser } from "../helpers/login";

/**
 * The credential-trail story's route (#225).
 *
 * It is two lines, and this suite is about both: the gate is asked first, and what it returns
 * is not passed anywhere — the story reads nothing, because the sheet behind its head action
 * fetches its own rows when somebody opens it.
 *
 * The gate is replaced: it has its own suite (`__tests__/api/access.test.ts`), and driving it
 * through this route would test it a second time while testing the wiring not at all.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/providers/audit-actions", () => ({
  readAuditTrail: () => Promise.resolve({ ok: true, events: [], total: 0 }),
}));

const Page = (await import("@/app/(app)/workshop/providers-audit/page")).default;

beforeEach(() => {
  requireWorkspace.mockReset();
  requireWorkspace.mockResolvedValue({ user: sessionUser(), membership: membership() });
});

describe("the route", () => {
  it("asks the gate before it draws anything", async () => {
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: AUDIT_LOG_LABEL })).toBeInTheDocument();
  });

  it("lets the gate's redirect travel rather than drawing a story behind it", async () => {
    // The trail is organization-scoped, so a session acting in no workspace would open the
    // sheet onto a `400` — which makes the gate load-bearing here rather than conventional.
    const redirect = new Error("NEXT_REDIRECT");

    requireWorkspace.mockRejectedValue(redirect);

    await expect(Page()).rejects.toBe(redirect);
  });
});
