import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_LABEL,
  BACK_LABEL,
  CLOSING_CAPTION,
  HISTORY_LABEL,
  LIBRARY_TITLE,
  LIST_UNAVAILABLE_TITLE,
  NO_BRIEF_YET,
  NO_INVESTIGATIONS,
  NO_MATCHES,
} from "@/app/research/investigations";
import type { InvestigationsCardProps } from "@/app/research/investigations-card";
import { RELOAD_LABEL } from "@/app/research/composer";
import { NO_FILTERS } from "@/app/research/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  EVIDENCE_RUN_ID,
  FIX_RUN_ID,
  FakeProgressSource,
  investigationDetail,
  investigationList,
  investigationRow,
  openFakeSource,
  progress,
  seededBrief,
  seededInvestigations,
  seededKinds,
} from "../helpers/research";

/**
 * Mockup 22's investigations card as it is drawn (#632). The acceptance criteria this suite
 * holds, in the ticket's words: **the seeded four rows match the mockup** — kind chips, sub-lines,
 * source counts, pills and links; **a live row pulses and updates its source count without a
 * reload**; **each contextual link navigates to the right surface for its kind**; **row click
 * opens the full-width detail view**; **facets compose and are reflected in the URL**; **History
 * and Research library open the same view**; `23 this quarter` is the service's count; both
 * palettes.
 */

const readInvestigations = vi.fn();
const openInvestigation = vi.fn();
const refresh = vi.fn();
const push = vi.fn();
const onLand = vi.fn();

vi.mock("@/app/research/investigations-actions", () => ({
  readInvestigations: (filters: unknown, offset: unknown) => readInvestigations(filters, offset),
  openInvestigation: (id: unknown) => openInvestigation(id),
}));
vi.mock("@/app/research/brief-actions", () => ({
  readBriefLedger: () => Promise.resolve({ ok: true, total: 0, items: [] }),
  readTrackers: () => Promise.resolve({ ok: true, trackers: [] }),
  draftEpicFromGaps: () => Promise.resolve({ ok: false, refusal: { code: "x", message: "x" } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const { InvestigationsCard } = await import("@/app/research/investigations-card");

const [RS127, , RS121, RS118] = seededInvestigations();
const replaceState = vi.fn();

function card(over: Partial<InvestigationsCardProps> = {}) {
  return (
    <InvestigationsCard
      featuredId={RS127!.id}
      filters={NO_FILTERS}
      initial={{ ok: true, value: investigationList() }}
      kinds={seededKinds()}
      mayDraft
      onLand={onLand}
      openSource={openFakeSource}
      opened={null}
      view="page"
      {...over}
    />
  );
}

function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Investigations" })).getAllByRole("listitem");
}

/** The address the card last wrote. */
function address(): string {
  return String(replaceState.mock.calls.at(-1)?.[2] ?? "");
}

beforeEach(() => {
  readInvestigations.mockReset().mockResolvedValue({ ok: true, list: investigationList() });
  openInvestigation.mockReset().mockResolvedValue({
    ok: true,
    opened: { detail: investigationDetail({ displayId: "RS-127", status: "brief_ready" }), brief: seededBrief() },
  });
  refresh.mockReset();
  push.mockReset();
  onLand.mockReset();
  replaceState.mockReset();
  window.history.replaceState = replaceState;
  FakeProgressSource.reset();
});

afterEach(() => {
  // @ts-expect-error — restoring jsdom's own method.
  delete window.history.replaceState;
});

describe("the seeded card", () => {
  it("draws the four rows as the mockup does: numbers, chips, questions, sub-lines, pills, links", () => {
    render(card());

    expect(screen.getByRole("region", { name: "Investigations" })).toBeInTheDocument();
    expect(screen.getByText("4 active · 23 this quarter")).toHaveClass("ou-tag");
    expect(screen.getByRole("button", { name: HISTORY_LABEL })).toBeInTheDocument();
    expect(screen.getByText(CLOSING_CAPTION)).toHaveClass("research__inv-caption");

    const list = rows();
    expect(list.map((row) => row.querySelector(".research__inv-id")?.textContent)).toEqual([
      "RS-127",
      "RS-124",
      "RS-121",
      "RS-118",
    ]);
    expect(list.map((row) => row.querySelector(".research__kind-chip")?.textContent)).toEqual([
      "Gap analysis",
      "Roadmap & improvements",
      "Regression forensics",
      "Bug root cause",
    ]);
    expect(list[3]!.querySelector(".research__kind-chip")).toHaveClass("research__kind--bug");
    expect(list.map((row) => row.querySelector(".research__inv-sub")?.textContent)).toEqual([
      "44 sources · deep dive",
      "312 sources · deep dive",
      "9 sources · standard",
      "18 sources · deep dive",
    ]);
    expect(list.map((row) => row.querySelector(".ou-chip")?.textContent)).toEqual([
      "✓ brief ready",
      "✓ issues filed",
      "queued",
      "fix loop live",
    ]);
    expect(within(list[3]!).getByText("fix loop live")).toHaveClass("ou-chip--accent");
    expect(list[3]!.querySelector(".ou-chip__dot--pulse")).not.toBeNull();
    expect(list[0]!.querySelector(".ou-chip__dot--pulse")).toBeNull();
  });

  it("links each row to the surface that matters for it", () => {
    render(card());
    const list = rows();

    expect(within(list[3]!).getByRole("link", { name: "open run →" })).toHaveAttribute(
      "href",
      `/runs/${FIX_RUN_ID}?from=research`,
    );
    expect(within(list[2]!).getByRole("link", { name: "evidence →" })).toHaveAttribute(
      "href",
      `/runs/${EVIDENCE_RUN_ID}/tests?from=research`,
    );

    fireEvent.click(within(list[1]!).getByRole("button", { name: "to roadmap →" }));
    expect(onLand).toHaveBeenLastCalledWith("pipeline");

    fireEvent.click(within(list[0]!).getByRole("button", { name: "brief ↑" }));
    expect(onLand).toHaveBeenLastCalledWith("brief");
    expect(openInvestigation).not.toHaveBeenCalled();
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(card()).map(maskIds);

    expect(light).toBe(dark);
  });
});

describe("opening a row", () => {
  it("opens the investigation full-width — its brief card — and says so in the address", async () => {
    render(card());

    fireEvent.click(screen.getByRole("button", { name: "Open RS-127" }));

    expect(openInvestigation).toHaveBeenCalledExactlyOnceWith(RS127!.id);
    expect(address()).toBe(`/research?open=${RS127!.id}`);
    expect(await screen.findByRole("heading", { level: 2, name: /RS-127 — Autonomous docking/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Autonomous docking vs. the field" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Investigations" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: BACK_LABEL }));

    expect(rows()).toHaveLength(4);
    expect(address()).toBe("/research");
  });

  it("opens a row that has no brief yet with its progress and an honest note", async () => {
    openInvestigation.mockResolvedValue({
      ok: true,
      opened: {
        detail: investigationDetail({
          id: RS121!.id,
          displayId: "RS-121",
          kind: RS121!.kind,
          question: RS121!.question,
          status: "queued",
          pill: RS121!.pill,
          progress: progress({ status: "queued", iteration: null, sources: 9 }),
        }),
        brief: null,
      },
    });
    render(card());

    fireEvent.click(screen.getByRole("button", { name: "Open RS-121" }));

    expect(await screen.findByText(new RegExp(NO_BRIEF_YET))).toBeInTheDocument();
    expect(screen.getByText("queued · 9 sources")).toBeInTheDocument();
    expect(screen.getByText("RS-121")).toHaveClass("research__progress-id");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens brief ↑ on a row that is not the featured one", async () => {
    render(card({ featuredId: RS118!.id }));

    fireEvent.click(within(rows()[0]!).getByRole("button", { name: "brief ↑" }));

    expect(openInvestigation).toHaveBeenCalledExactlyOnceWith(RS127!.id);
    expect(await screen.findByRole("heading", { level: 2, name: /RS-127/ })).toBeInTheDocument();
    expect(onLand).not.toHaveBeenCalled();
  });

  it("shows the service's refusal when the row could not be opened", async () => {
    openInvestigation.mockResolvedValue({ ok: false, refusal: { code: "not_found", message: "Gone." } });
    render(card());

    fireEvent.click(screen.getByRole("button", { name: "Open RS-127" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Gone.");
  });

  it("opens the investigation the address names, read on the server", () => {
    render(
      card({
        opened: {
          id: RS127!.id,
          reading: { ok: true, value: { detail: investigationDetail({ displayId: "RS-127" }), brief: seededBrief() } },
        },
      }),
    );

    expect(screen.getByRole("heading", { level: 2, name: /RS-127 — Autonomous docking/ })).toBeInTheDocument();
    expect(openInvestigation).not.toHaveBeenCalled();
  });
});

describe("History and the library", () => {
  it("toggles into the library with its three facets, re-reads, and says so in the address", async () => {
    render(card());

    fireEvent.click(screen.getByRole("button", { name: HISTORY_LABEL }));

    expect(screen.getByRole("region", { name: LIBRARY_TITLE })).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Quarter")).toBeInTheDocument();
    expect(address()).toBe("/research?view=library");
    await waitFor(() => expect(readInvestigations).toHaveBeenCalledWith(NO_FILTERS, 0));

    fireEvent.click(screen.getByRole("button", { name: ACTIVE_LABEL }));

    expect(screen.getByRole("region", { name: "Investigations" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Kind")).toBeNull();
    expect(address()).toBe("/research");
    await waitFor(() =>
      expect(readInvestigations).toHaveBeenLastCalledWith({ kind: null, status: "active", quarter: null }, 0),
    );
  });

  it("opens on the library at its address, facets set from it", () => {
    render(card({ view: "library", filters: { kind: "gap_analysis", status: "brief_ready", quarter: "current" } }));

    expect(screen.getByRole("region", { name: LIBRARY_TITLE })).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toHaveValue("gap_analysis");
    expect(screen.getByLabelText("Status")).toHaveValue("brief_ready");
    expect(screen.getByLabelText("Quarter")).toHaveValue("current");
    expect(screen.getByRole("button", { name: ACTIVE_LABEL })).toBeInTheDocument();
  });

  it("composes the facets, re-reads for each, and writes all three into the address", async () => {
    render(card({ view: "library" }));

    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "gap_analysis" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "brief_ready" } });
    fireEvent.change(screen.getByLabelText("Quarter"), { target: { value: "2026-Q3" } });

    await waitFor(() =>
      expect(readInvestigations).toHaveBeenLastCalledWith(
        { kind: "gap_analysis", status: "brief_ready", quarter: "2026-Q3" },
        0,
      ),
    );
    expect(address()).toBe("/research?view=library&kind=gap_analysis&status=brief_ready&quarter=2026-Q3");
    expect(readInvestigations).toHaveBeenCalledTimes(3);
  });

  it("offers every kind, every status with Active first, and the quarters back from the current one", () => {
    render(card({ view: "library" }));

    expect([...screen.getByLabelText("Kind").querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All kinds",
      "Bug root cause",
      "Regression forensics",
      "Roadmap & improvements",
      "Gap analysis",
    ]);
    expect(
      [...screen.getByLabelText("Status").querySelectorAll("option")].map((option) => option.textContent),
    ).toEqual(["All statuses", "Active", "queued", "running", "✓ brief ready", "✓ issues filed", "failed", "cancelled"]);
    expect(
      [...screen.getByLabelText("Quarter").querySelectorAll("option")].slice(0, 4).map((option) => option.textContent),
    ).toEqual(["All quarters", "This quarter", "Q4 2026", "Q3 2026"]);
  });

  it("says when no investigation matches, and when there is none at all", () => {
    render(card({ view: "library", initial: { ok: true, value: investigationList({ items: [] }) } }));
    expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();
  });

  it("shows more rows a page at a time", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      investigationRow({ id: `5eed0084-0000-4000-8000-${String(index).padStart(12, "0")}`, displayId: `RS-${String(index)}` }),
    );
    readInvestigations.mockResolvedValue({
      ok: true,
      list: investigationList({ items: [investigationRow({ id: "x-26", displayId: "RS-26" })], total: 26, offset: 25 }),
    });
    render(card({ view: "library", initial: { ok: true, value: investigationList({ items: many, total: 26 }) } }));

    fireEvent.click(screen.getByRole("button", { name: "Show more — 25 of 26" }));

    await waitFor(() => expect(rows()).toHaveLength(26));
    expect(readInvestigations).toHaveBeenCalledWith(NO_FILTERS, 25);
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });
});

describe("live rows", () => {
  it("follows a queued row's stream, ticking its sources and pill without a reload", () => {
    render(card());
    const source = FakeProgressSource.latest();
    expect(source.url).toBe(`/api/research/investigations/${RS121!.id}/progress`);
    expect(FakeProgressSource.opened).toHaveLength(1);

    act(() => source.emit("progress", { kind: "progress", ...progress({ status: "running", sources: 5 }) }));

    const row = rows()[2]!;
    expect(within(row).getByText("running")).toHaveClass("ou-chip--accent");
    expect(row.querySelector(".ou-chip__dot--pulse")).not.toBeNull();
    expect(row.querySelector(".research__inv-sub")).toHaveTextContent("5 sources · standard");
  });

  it("re-reads the list when the run ends, for the pill and link the service derives", async () => {
    readInvestigations.mockResolvedValue({
      ok: true,
      list: investigationList({
        items: seededInvestigations().map((row) =>
          row.id === RS121!.id
            ? { ...row, status: "brief_ready", pill: { state: "brief_ready", label: "✓ brief ready", tone: "ok", live: false }, sources: 12 }
            : row,
        ),
      }),
    });
    render(card());
    const source = FakeProgressSource.latest();

    act(() => source.emit("done", { kind: "done", ...progress({ status: "brief_ready", sources: 12 }) }));

    await waitFor(() => expect(readInvestigations).toHaveBeenCalledWith({ kind: null, status: "active", quarter: null }, 0));
    await waitFor(() => expect(within(rows()[2]!).getByText("✓ brief ready")).toBeInTheDocument());
    expect(source.closed).toBe(true);
    expect(FakeProgressSource.opened).toHaveLength(1);
  });

  it("does not stream a finished row — fix loop live pulses on the service's word alone", () => {
    render(card({ initial: { ok: true, value: investigationList({ items: [RS118!, RS127!] }) } }));

    expect(FakeProgressSource.opened).toHaveLength(0);
    expect(rows()[0]!.querySelector(".ou-chip__dot--pulse")).not.toBeNull();
  });
});

describe("a card that could not be read", () => {
  it("says so, with the service's reason, and offers a reload", () => {
    render(card({ initial: { ok: false, reason: "The research service is away." } }));

    expect(screen.getByText(LIST_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The research service is away.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: RELOAD_LABEL }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says when the workspace has started nothing", () => {
    render(card({ initial: { ok: true, value: investigationList({ items: [], counts: { active: 0, thisQuarter: 0 } }) } }));

    expect(screen.getByText(NO_INVESTIGATIONS)).toBeInTheDocument();
    expect(screen.getByText("0 active · 0 this quarter")).toBeInTheDocument();
  });
});
