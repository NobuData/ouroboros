import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AUDIT_LOG_LABEL } from "@/app/providers/view";

import { renderInBothPalettes } from "../helpers/palettes";

/**
 * The workshop's credential-trail story (#225).
 *
 * The story exists because AD.4's *the sheet renders seeded history in both themes* is a
 * criterion that needs a running surface, and the page it belongs to — `/providers` — is
 * AE.1's (#227) and has not landed. So this suite holds it to being that surface and nothing
 * more: mockup 07's head arrangement, the real trail behind the ghost action, and no invented
 * provider cards under it.
 *
 * What the sheet *draws* is `audit-trail.test.tsx`'s; the Server Action is mocked here for the
 * same reason it is there.
 */

vi.mock("@/app/providers/audit-actions", () => ({
  readAuditTrail: () => Promise.resolve({ ok: true, events: [], total: 0 }),
}));

const { AuditStory } = await import("@/app/workshop/audit-story");

describe("the story", () => {
  it("draws mockup 07's head arrangement: the ghost action beside the primary one", () => {
    render(<AuditStory />);

    expect(screen.getByRole("button", { name: AUDIT_LOG_LABEL })).toBeEnabled();
    // `aria-disabled` rather than `disabled` — the design system's inert control keeps its
    // place in the Tab order so a reader can reach the tooltip that says why it cannot act.
    expect(screen.getByRole("button", { name: "+ Add provider" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("says why the primary action cannot act, rather than omitting it", () => {
    // § 3.5: a control that cannot act explains itself. A head with one button would also not
    // show what the other one has to sit beside, which is the arrangement under demonstration.
    render(<AuditStory />);

    expect(screen.getByRole("button", { name: "+ Add provider" })).toHaveAttribute(
      "title",
      expect.stringContaining("#228"),
    );
  });

  it("draws no provider cards, because they are somebody else's page", () => {
    // Inventing them here would be a mock-up of a page AE.2 is building, and would be
    // indistinguishable in a screenshot from the real one.
    const { container } = render(<AuditStory />);

    expect(container.querySelectorAll(".ou-card")).toHaveLength(0);
  });

  it("renders identically under both palettes", () => {
    const [light, dark] = renderInBothPalettes(<AuditStory />);

    expect(light).toBe(dark);
  });
});
