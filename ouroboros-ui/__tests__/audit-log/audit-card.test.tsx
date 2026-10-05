import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLogFilter } from "@/app/api/settings-audit";
import {
  ACTOR_KIND_CLASS,
  type AuditLogReading,
  EXPORT_TITLE,
  FILTERED_TAG,
  LOG_EMPTY,
  LOG_LOADING,
  TODAY_EMPTY,
  TODAY_MORE,
  TODAY_MORE_ACTION,
  TODAY_TAG,
  actorOptions,
} from "@/app/audit-log/view";

import { AUDIT_DAY, auditLogEvents, auditLogPage, auditToday } from "../helpers/audit-log";
import { SERVICE_LIST, membersPage } from "../helpers/members";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The Audit Log card, rendered (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)):
 * the mockup's five rows with an actor styled per kind, the filters round-tripping to the one
 * read, paging that appends and always says how the list ends, and a footer drawn from the tier.
 */

const readAuditLog = vi.fn<(filter: AuditLogFilter, cursor?: string) => Promise<AuditLogReading>>();

vi.mock("@/app/audit-log/audit-actions", () => ({
  readAuditLog: (filter: AuditLogFilter, cursor?: string) => readAuditLog(filter, cursor),
}));

const { AuditCard } = await import("@/app/audit-log/audit-card");

const ACTORS = actorOptions(membersPage(), SERVICE_LIST);

/** Let every pending answer land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Open the filter expansion. */
function openFilters(): void {
  fireEvent.click(screen.getByRole("button", { name: /^filters/ }));
}

/** Press **Apply**, and let the read answer. */
async function applyFilters(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await settle();
}

/** The text of each drawn row, as `time actor event`. */
function rows(): string[] {
  return screen.getAllByRole("listitem").map((row) =>
    [...row.querySelectorAll(":scope > span")]
      .map((cell) => [...cell.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)?.textContent ?? "")
      .join(" "),
  );
}

beforeEach(() => {
  readAuditLog.mockReset().mockResolvedValue({ ok: true, page: auditLogPage() });
});

describe("today's rows", () => {
  it("reproduces the mockup's five rows exactly, in order", () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);

    expect(rows()).toEqual([
      "14:31 ouroboros-app[bot] pushed PR #514 rev 2",
      "14:12 Ken rotated Anthropic API key",
      "13:48 Ken enabled auto-merge (policy v7)",
      "13:22 Maya approved waiver on PR #509",
      "12:04 system runner forge-03 marked offline",
    ]);
    expect(screen.getByRole("region", { name: "Audit log" })).toBeTruthy();
    expect(screen.getByText(TODAY_TAG)).toBeTruthy();
  });

  it("styles the actor by kind, and says the kind in text as well", () => {
    render(
      <AuditCard
        actors={ACTORS}
        today={auditToday({
          rows: [
            ...auditToday().rows,
            {
              id: "svc",
              occurredAt: `${AUDIT_DAY}T11:00:00.000Z`,
              time: "11:00",
              actorKind: "service",
              actor: "service:devops-bot",
              event: "submitted a farm job",
            },
          ],
        })}
      />,
    );

    const actor = (name: string): HTMLElement =>
      screen.getAllByText(name, { selector: "[data-actor-kind]" })[0];

    expect(actor("ouroboros-app[bot]").className).toContain(ACTOR_KIND_CLASS.bot);
    expect(actor("Ken").className).toContain(ACTOR_KIND_CLASS.human);
    expect(actor("system").className).toContain(ACTOR_KIND_CLASS.system);
    expect(actor("service:devops-bot").className).toContain(ACTOR_KIND_CLASS.service);
    expect(actor("ouroboros-app[bot]").textContent).toBe("ouroboros-app[bot] (bot)");
    expect(actor("Ken").textContent).toBe("Ken (person)");
  });

  it("draws the retention tag from the tier, never a constant", () => {
    const { unmount } = render(<AuditCard actors={ACTORS} today={auditToday()} />);
    expect(screen.getByText("retained 400d")).toBeTruthy();
    unmount();

    render(<AuditCard actors={ACTORS} today={auditToday({ retainedDays: 730 })} />);
    expect(screen.getByText("retained 730d")).toBeTruthy();
    expect(screen.queryByText("retained 400d")).toBeNull();
  });

  it("says so on a day with nothing recorded", () => {
    render(<AuditCard actors={ACTORS} today={auditToday({ rows: [] })} />);

    expect(screen.getByText(TODAY_EMPTY)).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("never truncates silently: more events today are named, and one press shows all of them", async () => {
    render(<AuditCard actors={ACTORS} today={auditToday({ more: true })} />);

    expect(screen.getByText(TODAY_MORE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: TODAY_MORE_ACTION }));
    await settle();

    expect(readAuditLog).toHaveBeenCalledExactlyOnceWith({ from: `${AUDIT_DAY}T00:00:00.000Z` }, undefined);
    expect((screen.getByLabelText("From (UTC day)") as HTMLInputElement).value).toBe(AUDIT_DAY);
    expect(screen.getByText(FILTERED_TAG)).toBeTruthy();
  });

  it("says nothing about more when today is complete", () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);

    expect(screen.queryByText(TODAY_MORE)).toBeNull();
  });

  it("draws the SIEM control it is handed between the tag and the export", () => {
    render(<AuditCard actors={ACTORS} siem={<button type="button">Stream to SIEM</button>} today={auditToday()} />);

    const foot = screen.getByText("retained 400d").parentElement as HTMLElement;
    expect(within(foot).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Stream to SIEM",
      "Export CSV",
    ]);
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<AuditCard actors={ACTORS} today={auditToday()} />);

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});

describe("the filters", () => {
  it("are closed until asked for, and the toggle says which", () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);

    const toggle = screen.getByRole("button", { name: /^filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("form")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("form", { name: "Filter the audit log" }).id).toBe(toggle.getAttribute("aria-controls"));
  });

  it("round-trip every dimension to the one read", async () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();

    fireEvent.change(screen.getByLabelText("From (UTC day)"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To (UTC day, inclusive)"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Actor kind"), { target: { value: "human" } });
    fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "id:user-ken" } });
    fireEvent.change(screen.getByLabelText("Plane or action"), { target: { value: "policy" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "#509" } });
    await applyFilters();

    expect(readAuditLog).toHaveBeenCalledExactlyOnceWith(
      {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-06T00:00:00.000Z",
        actorKind: "human",
        actorId: "user-ken",
        action: "policy.*",
        ref: "pr:509",
      },
      undefined,
    );
    // The log's rows carry their date, because they span days.
    expect(rows()).toEqual(["2026-10-05 14:12 Ken rotated Anthropic API key"]);
    expect(screen.getByText(FILTERED_TAG)).toBeTruthy();
  });

  it("offers every actor the page knows, the bot among them", () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();

    const options = within(screen.getByLabelText("Actor")).getAllByRole("option");
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
      "",
      ...ACTORS.map((actor) => actor.value),
    ]);
  });

  it("refuse a form the service would, at the field, and send nothing", async () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();

    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "five oh nine" } });
    await applyFilters();

    expect(readAuditLog).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reference").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/A reference is/);
    // Today's rows are still what is drawn.
    expect(screen.getByText(TODAY_TAG)).toBeTruthy();
  });

  it("say that the log is being read, then that nothing matched", async () => {
    let answer: (reading: AuditLogReading) => void = () => {};
    readAuditLog.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("status").textContent).toBe(LOG_LOADING);

    await act(async () => {
      answer({ ok: true, page: auditLogPage([]) });
    });
    await settle();

    expect(screen.getByText(LOG_EMPTY)).toBeTruthy();
  });

  it("keep a refusal as a sentence in the card", async () => {
    readAuditLog.mockResolvedValue({ ok: false, reason: "The audit log could not be read just now." });

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    await applyFilters();

    expect(screen.getByRole("alert").textContent).toBe("The audit log could not be read just now.");
  });

  it("clear back to today's rows", async () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    fireEvent.change(screen.getByLabelText("Plane or action"), { target: { value: "policy" } });
    await applyFilters();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText(TODAY_TAG)).toBeTruthy();
    expect(rows()).toHaveLength(5);
    expect((screen.getByLabelText("Plane or action") as HTMLInputElement).value).toBe("");
  });

  it("drop an answer to filters that have since changed", async () => {
    const answers: ((reading: AuditLogReading) => void)[] = [];
    readAuditLog.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();

    fireEvent.change(screen.getByLabelText("Plane or action"), { target: { value: "policy" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.change(screen.getByLabelText("Plane or action"), { target: { value: "webhook" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // The newer answer lands first, then the older one arrives late.
    await act(async () => {
      answers[1]({ ok: true, page: auditLogPage(auditLogEvents(1, "webhook")) });
    });
    await act(async () => {
      answers[0]({ ok: true, page: auditLogPage(auditLogEvents(2, "policy")) });
    });
    await settle();

    expect(rows()).toEqual(["2026-10-05 14:00 Ken event webhook 0"]);
  });
});

describe("paging", () => {
  it("follows the cursor, appends, and ends by saying so", async () => {
    readAuditLog
      .mockResolvedValueOnce({ ok: true, page: auditLogPage(auditLogEvents(2, "one"), "cursor-2") })
      .mockResolvedValueOnce({ ok: true, page: auditLogPage(auditLogEvents(1, "two"), null) });

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    await applyFilters();

    expect(rows()).toHaveLength(2);
    // A list with more behind it offers the next page rather than claiming an end.
    expect(screen.queryByText(/End of log/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await settle();

    expect(readAuditLog).toHaveBeenLastCalledWith({}, "cursor-2");
    expect(rows()).toHaveLength(3);
    expect(screen.getByText("End of log · 3 events")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("is stable while new events arrive: a row sent twice is drawn once", async () => {
    const first = auditLogEvents(2, "one");
    readAuditLog
      .mockResolvedValueOnce({ ok: true, page: auditLogPage(first, "cursor-2") })
      .mockResolvedValueOnce({ ok: true, page: auditLogPage([first[1], ...auditLogEvents(1, "two")], null) });

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    await applyFilters();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await settle();

    expect(rows()).toHaveLength(3);
    expect(screen.getByText("End of log · 3 events")).toBeTruthy();
  });

  it("asks for a page once, however often the button is pressed while it is in flight", async () => {
    let answer: (reading: AuditLogReading) => void = () => {};
    readAuditLog
      .mockResolvedValueOnce({ ok: true, page: auditLogPage(auditLogEvents(2, "one"), "cursor-2") })
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    await applyFilters();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    fireEvent.click(screen.getByRole("button", { name: "Loading…" }));
    expect(readAuditLog).toHaveBeenCalledTimes(2);

    await act(async () => {
      answer({ ok: true, page: auditLogPage(auditLogEvents(1, "two"), null) });
    });
    await settle();
    expect(rows()).toHaveLength(3);
  });

  it("keeps what is drawn when the next page fails, and lets it be asked for again", async () => {
    readAuditLog
      .mockResolvedValueOnce({ ok: true, page: auditLogPage(auditLogEvents(2, "one"), "cursor-2") })
      .mockResolvedValueOnce({ ok: false, reason: "The service is restarting." });

    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    await applyFilters();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await settle();

    expect(rows()).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toBe("The service is restarting.");
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });
});

describe("the export", () => {
  it("opens the range dialog carrying the applied filters", async () => {
    render(<AuditCard actors={ACTORS} today={auditToday()} />);
    openFilters();
    fireEvent.change(screen.getByLabelText("From (UTC day)"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("To (UTC day, inclusive)"), { target: { value: "2026-08-14" } });
    fireEvent.change(screen.getByLabelText("Actor kind"), { target: { value: "bot" } });
    await applyFilters();

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    const dialog = screen.getByRole("dialog", { name: EXPORT_TITLE });
    expect(within(dialog).getByText("Actor kind: bot")).toBeTruthy();

    const link = within(dialog).getByRole("link", { name: "Download CSV" });
    const url = new URL(link.getAttribute("href") ?? "", "http://ui.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-15T00:00:00.000Z",
      actorKind: "bot",
    });
  });
});
