import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUDIT_EMPTY_TITLE,
  AUDIT_FORBIDDEN,
  AUDIT_LOADING,
  AUDIT_LOG_LABEL,
  AUDIT_SHEET_NOTE,
  AUDIT_SHEET_TITLE,
  AUDIT_UNAVAILABLE,
  NOBODY,
  type AuditReading,
} from "@/app/providers/view";

import { auditEvent, seededTrail } from "../helpers/audit";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The **Audit log** sheet (#225) — mockup 07's page-head action and what it opens.
 *
 * `view.test.ts` proves the *decisions*; this proves what reaches the DOM, which is the only
 * thing a reader ever sees. Four claims, and they are AD.4's own:
 *
 * - **the sheet renders seeded history**, which is what this suite drives it with;
 * - **a refusal is visibly a refusal**, because a failed rotation drawn as a completed one is
 *   the most consequential lie this surface can tell;
 * - **an event with no actor renders without one**, rather than with `undefined` or an id;
 * - **and it renders identically in both palettes**, which is #46's rule for every surface in
 *   this module and is what proves the theme is expressed in CSS rather than in JavaScript.
 *
 * The Server Action is mocked, not the API: what is under test is the sheet, and a suite that
 * stood up a stub REST as well would be asserting about `app/api/audit.ts` twice.
 * `audit-actions.test.ts` is that module's own suite.
 */

const readAuditTrail = vi.fn<() => Promise<AuditReading>>();

vi.mock("@/app/providers/audit-actions", () => ({
  readAuditTrail: () => readAuditTrail(),
}));

const { AuditTrail } = await import("@/app/providers/audit-trail");

/** A reading that answers with the seeded workspace's history. */
function seeded(): AuditReading {
  const events = seededTrail();

  return { ok: true, events, total: events.length };
}

beforeEach(() => {
  readAuditTrail.mockReset();
  readAuditTrail.mockResolvedValue(seeded());
});

/**
 * Press the head's ghost action and wait for the sheet to have finished reading.
 *
 * @returns The dialog.
 */
async function openSheet(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: AUDIT_LOG_LABEL }));

  const sheet = await screen.findByRole("dialog", { name: AUDIT_SHEET_TITLE });

  await waitFor(() => {
    expect(within(sheet).queryByText(AUDIT_LOADING)).not.toBeInTheDocument();
  });

  return sheet;
}

/**
 * The row a sentence appears in.
 *
 * @param sheet The dialog.
 * @param sentence The action's sentence, as `SENTENCES` spells it.
 * @returns The `<tr>`.
 */
function row(sheet: HTMLElement, sentence: string): HTMLElement {
  const cell = within(sheet).getByText(sentence);
  const found = cell.closest("tr");

  expect(found, `no row for ${sentence}`).not.toBeNull();
  return found as HTMLElement;
}

describe("the head action", () => {
  it("is the mockup's ghost button, and it opens nothing until it is pressed", () => {
    // The sheet is unmounted rather than hidden while closed — an overlay that is merely
    // invisible is one the keyboard can still reach and a screen reader can still read.
    render(<AuditTrail />);

    expect(screen.getByRole("button", { name: AUDIT_LOG_LABEL })).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reads the trail when pressed, and not before", async () => {
    render(<AuditTrail />);

    expect(readAuditTrail).not.toHaveBeenCalled();

    await openSheet();

    expect(readAuditTrail).toHaveBeenCalledTimes(1);
  });

  it("reads again on every open, because a trail is a moving surface", async () => {
    // Somebody opening it twice in an incident wants the second read to include what happened
    // in between; a cached first read would be stale at exactly the moment freshness matters.
    render(<AuditTrail />);

    await openSheet();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await openSheet();

    expect(readAuditTrail).toHaveBeenCalledTimes(2);
  });
});

describe("the sheet", () => {
  it("is a named dialog, so it is announced as something rather than as nothing", async () => {
    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(sheet).toHaveAccessibleName(AUDIT_SHEET_TITLE);
  });

  it("says what the trail is and what it never holds", async () => {
    // A reader looking at a list of *revealed the credential* rows has a reasonable question
    // about the second, and answering it in the interface is cheaper than in a support thread.
    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(within(sheet).getByText(AUDIT_SHEET_NOTE)).toBeInTheDocument();
  });

  it("closes on Escape and gives focus back to the button that opened it", async () => {
    render(<AuditTrail />);

    // Focused first, because `fireEvent.click` dispatches the event without the focus move a
    // real press performs — and the whole of `ShellOverlay`'s restoration is *put focus back
    // where it was*, which for a reader pressing this button is the button.
    const opener = screen.getByRole("button", { name: AUDIT_LOG_LABEL });
    opener.focus();

    await openSheet();

    expect(screen.getByRole("dialog")).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });
});

describe("the seeded history", () => {
  it("draws a row for every event, newest first", async () => {
    render(<AuditTrail />);

    const sheet = await openSheet();
    const rows = within(within(sheet).getByRole("table")).getAllByRole("row");

    // The head row, then one per event, in the order the service returned them.
    expect(rows).toHaveLength(seededTrail().length + 1);
    expect(rows[1]).toHaveTextContent("2026-08-24 16:13");
    expect(rows[rows.length - 1]).toHaveTextContent("2026-06-12 16:20");
  });

  it("reads as the mockup's own example row: time, actor, action, provider", async () => {
    render(<AuditTrail />);

    const sheet = await openSheet();
    const rotated = row(sheet, "rotated the credential");

    expect(rotated).toHaveTextContent("2026-08-22 10:53");
    expect(rotated).toHaveTextContent("Maya Chen");
    expect(rotated).toHaveTextContent("copilot");
  });

  it("names the zone once, in the heading, rather than on every row", async () => {
    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(within(sheet).getByRole("columnheader", { name: "When (UTC)" })).toBeInTheDocument();
    expect(within(sheet).queryAllByText(/\d{2}:\d{2} UTC/)).toHaveLength(0);
  });

  it("marks a refusal in words, not only in colour", async () => {
    // The most consequential lie this surface can tell is a refused rotation drawn as a
    // completed one — and a reader who cannot distinguish two hues would be told it.
    render(<AuditTrail />);

    const sheet = await openSheet();
    const refused = row(sheet, "rotated the credential");

    expect(refused).toHaveTextContent("refused · provider_validation_failed");
  });

  it("leaves a completed operation unmarked", async () => {
    render(<AuditTrail />);

    const sheet = await openSheet();
    const added = row(sheet, "connected the provider");

    expect(added).not.toHaveTextContent("refused");
  });

  it("renders the event that has no actor without inventing one", async () => {
    // A lease grant: a worker authenticates with a service key and is not somebody.
    render(<AuditTrail />);

    const sheet = await openSheet();
    const lease = row(sheet, "was granted a provider lease");

    expect(lease).toHaveTextContent(NOBODY);
    expect(lease).not.toHaveTextContent("undefined");
    expect(lease).not.toHaveTextContent("5eed0003");
  });

  it("leaves the provider column empty when the payload named none", async () => {
    readAuditTrail.mockResolvedValue({
      ok: true,
      events: [auditEvent({ detail: { outcome: "failure", reason: "step_up_required" } })],
      total: 1,
    });

    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(within(sheet).getByRole("table")).not.toHaveTextContent("anthropic");
    expect(within(sheet).getByText(/refused/)).toBeInTheDocument();
  });

  it("carries no key, no mask and no envelope", async () => {
    // The grep, on this side of the wire. `ouroboros-rest`'s own suites hold the rows to it;
    // this holds the renderer to not composing one out of what it was given.
    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(sheet.textContent ?? "").not.toMatch(/sk-|ouro\.v1\.|••••/);
  });
});

describe("what the sheet says when there are no rows", () => {
  it("distinguishes a workspace where nothing has happened from a trail nobody could read", async () => {
    readAuditTrail.mockResolvedValue({ ok: true, events: [], total: 0 });

    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(within(sheet).getByText(AUDIT_EMPTY_TITLE)).toBeInTheDocument();
    expect(within(sheet).queryByRole("table")).not.toBeInTheDocument();
  });

  it("tells a role that may not read it who to ask", async () => {
    readAuditTrail.mockResolvedValue({ ok: false, reason: AUDIT_FORBIDDEN });

    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(within(sheet).getByText(AUDIT_FORBIDDEN)).toBeInTheDocument();
  });

  it("says nothing was changed when the read simply failed", async () => {
    readAuditTrail.mockResolvedValue({ ok: false, reason: AUDIT_UNAVAILABLE });

    render(<AuditTrail />);

    const sheet = await openSheet();

    expect(within(sheet).getByText(AUDIT_UNAVAILABLE)).toBeInTheDocument();
  });

  it("announces the waiting state politely rather than as an alert", async () => {
    // A sheet that has just been opened and is reading is a fact about the surface the reader
    // asked for, not an interruption to announce over whatever they were doing.
    let answer: (reading: AuditReading) => void = () => {};
    readAuditTrail.mockReturnValue(
      new Promise<AuditReading>((resolve) => {
        answer = resolve;
      }),
    );

    render(<AuditTrail />);
    fireEvent.click(screen.getByRole("button", { name: AUDIT_LOG_LABEL }));

    const waiting = await screen.findByRole("status");
    expect(waiting).toHaveTextContent(AUDIT_LOADING);

    answer(seeded());
    await waitFor(() => {
      expect(screen.queryByText(AUDIT_LOADING)).not.toBeInTheDocument();
    });
  });
});

describe("both palettes", () => {
  it("renders the head action identically under each", () => {
    // #46's rule for every surface in this module: the theme is expressed entirely in CSS, so
    // what renders under `data-theme="dark"` is byte-identical to what renders under `light`.
    // A component that branched on the theme in JavaScript would be one the boot script could
    // not paint before hydration.
    const [light, dark] = renderInBothPalettes(<AuditTrail />);

    expect(light).toBe(dark);
  });

  it("renders the seeded sheet identically under each", async () => {
    const markup: string[] = [];

    for (const palette of PALETTES) {
      const { unmount } = renderInPalette(palette, <AuditTrail />);
      const sheet = await openSheet();

      markup.push(sheet.outerHTML);
      unmount();
    }

    expect(markup[0]).toBe(markup[1]);
  });
});
