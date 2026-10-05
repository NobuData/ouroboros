import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportDialog } from "@/app/audit-log/export-dialog";
import {
  EXPORT_BOUND_NOTE,
  EXPORT_LOGGED_NOTE,
  EXPORT_NO_FILTERS,
  EXPORT_RANGE_REQUIRED,
  EXPORT_RANGE_TOO_LONG,
  EXPORT_ROUTE,
  EXPORT_TITLE,
  RANGE_REVERSED,
  actorOptions,
} from "@/app/audit-log/view";

import { SERVICE_LIST, membersPage } from "../helpers/members";

/**
 * **Export CSV** (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)): a bounded
 * range with the rule explained, the applied filters listed, the note that the export is itself
 * logged — and a download that is a real link only while the range is one the service takes.
 */

const ACTORS = actorOptions(membersPage(), SERVICE_LIST);
const RANGE = { from: "2026-09-06", to: "2026-10-05" };

/** The download link's query, by parameter. */
function linkQuery(): Record<string, string> {
  const link = screen.getByRole("link", { name: "Download CSV" });
  const url = new URL(link.getAttribute("href") ?? "", "http://ui.test");

  expect(url.pathname).toBe(EXPORT_ROUTE);
  return Object.fromEntries(url.searchParams);
}

describe("the export dialog", () => {
  it("renders nothing while closed", () => {
    render(<ExportDialog actors={ACTORS} filter={{}} initial={null} onClose={() => {}} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains the bound, says the export is logged, and names an unfiltered export as one", () => {
    render(<ExportDialog actors={ACTORS} filter={{}} initial={RANGE} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: EXPORT_TITLE })).toBeTruthy();
    expect(screen.getByText(EXPORT_BOUND_NOTE)).toBeTruthy();
    expect(EXPORT_BOUND_NOTE).toMatch(/366 days/);
    expect(screen.getByText(EXPORT_LOGGED_NOTE)).toBeTruthy();
    expect(screen.getByText(EXPORT_NO_FILTERS)).toBeTruthy();
  });

  it("downloads through a real link to this origin's route — the range's last day inclusive", () => {
    render(<ExportDialog actors={ACTORS} filter={{}} initial={RANGE} onClose={() => {}} />);

    expect(linkQuery()).toEqual({ from: "2026-09-06T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" });
    expect(screen.getByRole("link", { name: "Download CSV" }).hasAttribute("download")).toBe(true);
  });

  it("lists the applied filters and sends them, so the file matches the view", () => {
    render(
      <ExportDialog
        actors={ACTORS}
        filter={{ from: "2020-01-01T00:00:00.000Z", actorId: "user-maya", action: "policy.*", ref: "pr:509" }}
        initial={RANGE}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Actor: Maya Chen")).toBeTruthy();
    expect(screen.getByText("Plane or action: policy.*")).toBeTruthy();
    expect(screen.getByText("Reference: pr:509")).toBeTruthy();
    expect(screen.queryByText(EXPORT_NO_FILTERS)).toBeNull();
    expect(linkQuery()).toEqual({
      from: "2026-09-06T00:00:00.000Z",
      to: "2026-10-06T00:00:00.000Z",
      actorId: "user-maya",
      action: "policy.*",
      ref: "pr:509",
    });
  });

  it("follows the range as it is edited", () => {
    render(<ExportDialog actors={ACTORS} filter={{}} initial={RANGE} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("From (UTC day)"), { target: { value: "2026-01-01" } });

    expect(linkQuery().from).toBe("2026-01-01T00:00:00.000Z");
  });

  it("offers no address for a range the service would refuse — the button is inert with its reason", () => {
    render(<ExportDialog actors={ACTORS} filter={{}} initial={RANGE} onClose={() => {}} />);

    for (const [from, to, reason] of [
      ["2025-01-01", "2026-10-05", EXPORT_RANGE_TOO_LONG],
      ["2026-10-06", "2026-10-05", RANGE_REVERSED],
      ["", "2026-10-05", EXPORT_RANGE_REQUIRED],
    ] as const) {
      fireEvent.change(screen.getByLabelText("From (UTC day)"), { target: { value: from } });
      fireEvent.change(screen.getByLabelText("To (UTC day, inclusive)"), { target: { value: to } });

      expect(screen.queryByRole("link", { name: "Download CSV" }), reason).toBeNull();
      expect(screen.getByRole("alert").textContent).toBe(reason);

      const button = screen.getByRole("button", { name: "Download CSV" });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.getAttribute("title")).toBe(reason);
    }
  });

  it("accepts exactly 366 days", () => {
    render(
      <ExportDialog
        actors={ACTORS}
        filter={{}}
        initial={{ from: "2026-01-01", to: "2027-01-01" }}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(linkQuery()).toEqual({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-02T00:00:00.000Z" });
  });

  it("closes on its button, and each opening starts from the range it is given", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ExportDialog actors={ACTORS} filter={{}} initial={RANGE} onClose={onClose} />,
    );

    fireEvent.change(screen.getByLabelText("From (UTC day)"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<ExportDialog actors={ACTORS} filter={{}} initial={null} onClose={onClose} />);
    rerender(<ExportDialog actors={ACTORS} filter={{}} initial={RANGE} onClose={onClose} />);

    expect((screen.getByLabelText("From (UTC day)") as HTMLInputElement).value).toBe("2026-09-06");
  });
});
