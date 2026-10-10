import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRIEF_UNAVAILABLE_TITLE,
  DRAFT_EPIC_LABEL,
  EXPORT_LABEL,
  NO_BRIEF_TITLE,
  TRACKER_CONFIRM_LABEL,
  TRACKER_DIALOG_TITLE,
  UNKNOWN_CELL_NOTE,
  VIEWER_DRAFT_REASON,
} from "@/app/research/brief";
import type { FeaturedBriefSeatProps } from "@/app/research/brief-card";
import { RELOAD_LABEL } from "@/app/research/composer";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import {
  briefSource,
  featuredBrief,
  investigationDetail,
  seededBrief,
  seededLedger,
} from "../helpers/research";

/**
 * Mockup 22's featured investigation card as it is drawn (#630). The acceptance criteria this
 * suite holds, in the ticket's words: **seeded RS-127 reproduces the mockup card** — the head,
 * the five matrix rows with their glyphs, hues and gap chips, the four findings with their
 * markers, the five sources, the proposed chips; **clicking `[07]` scrolls to and highlights its
 * source row**; **`all ↗` opens the 44-record ledger with excerpts and retrieval times**; **a cell's
 * tooltip shows its citations, and `? unknown` is an honest state**; **Export brief downloads the
 * artifact**; **Draft epic from gaps creates the batch and navigates there — and files nothing**;
 * **open questions are distinct from findings**; **the three non-gap variants**; both palettes.
 */

const readBriefLedger = vi.fn();
const readTrackers = vi.fn();
const draftEpicFromGaps = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
const onLandPipeline = vi.fn();

vi.mock("@/app/research/brief-actions", () => ({
  readBriefLedger: (id: unknown) => readBriefLedger(id),
  readTrackers: () => readTrackers(),
  draftEpicFromGaps: (id: unknown, target: unknown) => draftEpicFromGaps(id, target),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { FeaturedBriefSeat } = await import("@/app/research/brief-card");

const RS127 = "5eed0084-0000-4000-8000-000000000127";

/** jsdom has no layout, so the scroll is watched rather than performed. */
const scrollIntoView = vi.fn();

function seat(over: Partial<FeaturedBriefSeatProps> = {}) {
  return (
    <FeaturedBriefSeat
      mayDraft
      onLandPipeline={onLandPipeline}
      reading={{ ok: true, value: featuredBrief() }}
      {...over}
    />
  );
}

function card(): HTMLElement {
  return screen.getByRole("region", { name: /RS-127/ });
}

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  readBriefLedger.mockReset().mockResolvedValue({ ok: true, total: 44, items: seededLedger() });
  readTrackers.mockReset().mockResolvedValue({
    ok: true,
    trackers: [
      { id: "src-github", displayName: "GitHub · acme-robotics", kind: "github" },
      { id: "src-jira", displayName: "Jira · ACME", kind: "jira" },
    ],
  });
  draftEpicFromGaps.mockReset().mockResolvedValue({ ok: true, href: "/planning?batch=batch-127", created: true });
  push.mockReset();
  refresh.mockReset();
  onLandPipeline.mockReset();
});

afterEach(() => {
  // @ts-expect-error — restoring jsdom's own absence of the method.
  delete Element.prototype.scrollIntoView;
});

describe("the seeded card", () => {
  it("reproduces the mockup's head: kind, number and title, the tag, the pill and the two actions", () => {
    render(seat());
    const head = card();

    expect(within(head).getByText("Gap analysis")).toHaveClass("research__kind-chip", "research__kind--gap");
    expect(within(head).getByRole("heading", { level: 2 })).toHaveTextContent(
      "RS-127 — Autonomous docking vs. the field",
    );
    expect(within(head).getByText("44 sources · deep dive")).toHaveClass("ou-tag");
    expect(within(head).getByText("✓ brief ready")).toHaveClass("ou-chip--ok");

    const exportLink = within(head).getByRole("link", { name: EXPORT_LABEL });
    expect(exportLink).toHaveAttribute("href", `/api/research/investigations/${RS127}/brief/export`);
    expect(exportLink).toHaveAttribute("download", "RS-127-brief.md");
    expect(within(head).getByRole("button", { name: DRAFT_EPIC_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("draws the matrix: five rows, our column first and accented, each cell's glyph and the gap chips", () => {
    render(seat());
    const table = screen.getByRole("table", { name: "Autonomous docking vs. the field" });

    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Capability",
      "Helios (us)",
      "Skylink",
      "AeroMesh",
      "Novum",
      "Gap",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Docking in >8 m/s gusts",
      "Visual-inertial approach (no beacon)",
      "Abort & retry recovery logic",
      "OTA resilience (A/B + rollback)",
      "Recovery beacon over BLE",
    ]);

    const first = rows[0]!;
    expect(within(first).getAllByRole("cell")[1]).toHaveClass("research__matrix-us");
    expect(within(first).getByRole("button", { name: "Helios: partial" })).toHaveTextContent("◐partial");
    expect(within(first).getByRole("button", { name: "Skylink: shipping" }).closest(".research__cap")).toHaveClass(
      "research__cap--have",
    );
    expect(within(first).getByRole("button", { name: "Novum: none" }).closest(".research__cap")).toHaveClass(
      "research__cap--none",
    );
    expect(within(rows[1]!).getByRole("button", { name: "Novum: beta" })).toBeInTheDocument();
    expect(within(rows[3]!).getByRole("button", { name: "Helios: in flight" })).toBeInTheDocument();

    const gaps = rows.map((row) => within(row).getAllByRole("cell").at(-1)!.firstElementChild!);
    expect(gaps.map((gap) => gap.textContent)).toEqual(["HIGH", "HIGH", "MED", "WIP", "LEAD"]);
    expect(gaps.map((gap) => gap.className)).toEqual([
      "research__gap research__gap--hi",
      "research__gap research__gap--hi",
      "research__gap research__gap--med",
      "research__gap research__gap--par",
      "research__gap research__gap--low",
    ]);
    expect(gaps[0]).toHaveAttribute("title", "Skylink ships it; we are partial → high.");
  });

  it("writes the four findings with their markers, the code reference mono and linked", () => {
    render(seat());
    const text = card().querySelector(".research__brief-text")!;

    expect(within(text as HTMLElement).getAllByRole("link", { name: /^\[/ }).map((ref) => ref.textContent)).toEqual([
      "[07]",
      "[12]",
      "[31]",
      "[git]",
      "[19]",
    ]);
    expect(within(text as HTMLElement).getByRole("link", { name: "[07]" })).toHaveAttribute(
      "href",
      "#research-source-7",
    );
    const code = within(text as HTMLElement).getByRole("link", { name: "dock_ctrl.c:214" });
    expect(code).toHaveClass("research__code");
    expect(code).toHaveAttribute("href", expect.stringContaining("dock_ctrl.c#L214"));
  });

  it("lists the five sources with their markers, titles and locators — a link where one opens", () => {
    render(seat());
    const panel = screen.getByRole("group", { name: "Sources — 44 cited" });
    const rows = within(panel).getAllByRole("listitem");

    expect(rows.map((row) => row.querySelector(".research__cite-n")?.textContent)).toEqual([
      "[07]",
      "[12]",
      "[19]",
      "[31]",
      "[git]",
    ]);
    expect(within(rows[0]!).getByRole("link", { name: "droneanalysts.example.com/s4-teardown" })).toHaveAttribute(
      "href",
      "https://droneanalysts.example.com/s4-teardown",
    );
    expect(within(rows[2]!).queryByRole("link")).toBeNull();
    expect(rows[2]).toHaveTextContent("issue-index://support/churn-2026-q2");
    expect(within(rows[4]!).getByRole("link", { name: "helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c" })).toBeInTheDocument();
  });

  it("previews what the draft would create: the epic, two tickets, +3 more, effort L", () => {
    render(seat());
    const row = screen.getByRole("group", { name: "Proposed from gaps:" });

    expect([...row.querySelectorAll(".ou-tag")].map((tag) => tag.textContent)).toEqual([
      "EPIC · Docking parity",
      "DOCK-1 wind-feedforward MPC",
      "DOCK-2 re-planned retry",
      "+3 more",
    ]);
    expect(within(row).getByText("L")).toHaveClass("research__proposed-effort");
  });

  it("renders the same markup under both palettes", () => {
    const [light, dark] = renderInBothPalettes(seat()).map(maskIds);

    expect(light).toBe(dark);
  });
});

describe("citations", () => {
  it("scrolls to and lights a source's row when its marker is pressed", () => {
    render(seat());
    const row = document.getElementById("research-source-7")!;
    expect(row).not.toHaveClass("research__cite--lit");

    fireEvent.click(screen.getByRole("link", { name: "[07]" }));

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "center" });
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
    expect(row).toHaveClass("research__cite--lit");

    fireEvent.click(screen.getByRole("link", { name: "[git]" }));
    expect(row).not.toHaveClass("research__cite--lit");
    expect(document.getElementById("research-source-git")).toHaveClass("research__cite--lit");
  });

  it("reveals a cell's citations as its description, each a press that lands on its record", async () => {
    render(seat());
    // Rows 1 and 3 both read `Helios: partial`; the first is the gusts row, cited [25] and [26].
    const face = screen.getAllByRole("button", { name: "Helios: partial" })[0]!;
    const tip = document.getElementById(face.getAttribute("aria-describedby")!)!;

    expect(tip).toHaveAttribute("role", "tooltip");
    expect(tip).toHaveTextContent("2 sources");
    expect(within(tip).getAllByRole("button").map((button) => button.textContent)).toEqual(["[25]", "[26]"]);

    // [25] is cited by the cell and by no claim: the panel does not list it, so the ledger opens on it.
    fireEvent.click(within(tip).getByRole("button", { name: "[26]" }));

    const sheet = await screen.findByRole("dialog", { name: "RS-127 — every source, 44 of them" });
    expect(readBriefLedger).toHaveBeenCalledExactlyOnceWith(RS127);
    await waitFor(() => expect(document.getElementById("research-ledger-26")).toHaveClass("research__ledger-row--lit"));
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.getElementById("research-ledger-26"));
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(44);
  });

  it("draws ? unknown as an honest state: dimmed, inert, and saying what unknown means", () => {
    render(seat());
    const unknown = screen.getByLabelText("AeroMesh: unknown");

    expect(unknown.tagName).toBe("SPAN");
    expect(unknown.closest(".research__cap")).toHaveClass("research__cap--unk");
    expect(document.getElementById(unknown.getAttribute("aria-describedby")!)).toHaveTextContent(UNKNOWN_CELL_NOTE);
  });

  it("opens the whole ledger from all ↗, with excerpts and retrieval times, the cited records marked", async () => {
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: "all ↗" }));

    const sheet = await screen.findByRole("dialog", { name: "RS-127 — every source, 44 of them" });
    const rows = await within(sheet).findAllByRole("listitem");
    expect(rows).toHaveLength(44);
    expect(rows[6]).toHaveClass("research__ledger-row--cited");
    expect(rows[6]).toHaveTextContent("Skylink S4 docking module — teardown & sensor BOM");
    expect(rows[6]).toHaveTextContent("Excerpt What was read of source 7.");
    expect(rows[6]).toHaveTextContent("Retrieved");
    expect(rows[6]).toHaveTextContent("12:07");
    expect(rows[24]).not.toHaveClass("research__ledger-row--cited");

    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when the ledger could not be read", async () => {
    readBriefLedger.mockResolvedValue({ ok: false, refusal: { code: "down", message: "The ledger is away." } });
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: "all ↗" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The ledger could not be read. The ledger is away.");
  });
});

describe("open questions", () => {
  it("are drawn apart from the findings, with their mark — demoted where a finding was offered", () => {
    render(seat());
    const paragraphs = card().querySelectorAll(".research__brief-para");

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).not.toHaveClass("research__brief-para--open");
    expect(paragraphs[0]).toHaveTextContent(/^Finding\./);
    expect(paragraphs[1]).toHaveClass("research__brief-para--open");
    expect(paragraphs[1]).toHaveTextContent(/^Open questions/);
    expect(paragraphs[1]!.querySelector(".research__claim--open")).toHaveTextContent("demoted");
    expect(paragraphs[1]!.querySelectorAll("a.research__ref")).toHaveLength(0);
  });
});

describe("Draft epic from gaps", () => {
  it("drafts the batch and navigates to it in Planning — filing nothing", async () => {
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: DRAFT_EPIC_LABEL }));

    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith("/planning?batch=batch-127"));
    expect(draftEpicFromGaps).toHaveBeenCalledExactlyOnceWith(RS127, undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks which tracker only when the service says the workspace has more than one", async () => {
    draftEpicFromGaps
      .mockResolvedValueOnce({
        ok: false,
        refusal: { code: "roadmap_target_required", message: "Name the tracker: this workspace has 3." },
      })
      .mockResolvedValueOnce({ ok: true, href: "/planning?batch=batch-127", created: true });
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: DRAFT_EPIC_LABEL }));

    const dialog = await screen.findByRole("dialog", { name: TRACKER_DIALOG_TITLE });
    const jira = await within(dialog).findByRole("radio", { name: /Jira · ACME/ });
    expect(within(dialog).getByRole("radio", { name: /GitHub · acme-robotics/ })).toBeChecked();
    expect(readTrackers).toHaveBeenCalledTimes(1);

    fireEvent.click(jira);
    fireEvent.click(within(dialog).getByRole("button", { name: TRACKER_CONFIRM_LABEL }));

    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith("/planning?batch=batch-127"));
    expect(draftEpicFromGaps).toHaveBeenLastCalledWith(RS127, "src-jira");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows any other refusal in the service's words", async () => {
    draftEpicFromGaps.mockResolvedValue({
      ok: false,
      refusal: { code: "gaps_nothing_proposed", message: "The brief proposes no epic from its gaps." },
    });
    render(seat());

    fireEvent.click(screen.getByRole("button", { name: DRAFT_EPIC_LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The brief proposes no epic from its gaps.");
    expect(push).not.toHaveBeenCalled();
  });

  it("is inert for a viewer, and says why", () => {
    render(seat({ mayDraft: false }));
    const button = screen.getByRole("button", { name: DRAFT_EPIC_LABEL });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", VIEWER_DRAFT_REASON);

    fireEvent.click(button);
    expect(draftEpicFromGaps).not.toHaveBeenCalled();
  });

  it("is not offered for a brief that proposes nothing", () => {
    render(seat({ reading: { ok: true, value: featuredBrief({ brief: seededBrief({ proposed: null }) }) } }));

    expect(screen.queryByRole("button", { name: DRAFT_EPIC_LABEL })).toBeNull();
    expect(screen.queryByRole("group", { name: "Proposed from gaps:" })).toBeNull();
  });
});

describe("the kind variants", () => {
  const RUN = "5eed0009-0000-4000-8000-000000000482";

  it("draws a bug root cause: no matrix, its fix draft in Planning and the run fixing it", () => {
    const brief = seededBrief({
      investigation: { ...seededBrief().investigation, displayId: "RS-118", kind: "bug_root_cause", kindLabel: "Bug root cause", tintKey: "bug" },
      matrix: null,
      proposed: null,
    });
    const detail = investigationDetail({
      displayId: "RS-118",
      deliverables: [{ kind: "brief", id: "b" }, { kind: "fix_draft", id: "d" }],
      links: { run: { kind: "run", label: "open run →", runId: RUN }, roadmap: null, brief: null, evidence: null },
    });
    render(seat({ reading: { ok: true, value: { brief, detail } } }));

    expect(screen.getByRole("region", { name: /RS-118/ })).toHaveTextContent("Why do our drones abort");
    expect(screen.queryByRole("table")).toBeNull();
    const strip = screen.getByRole("group", { name: "Led to:" });
    expect(within(strip).getByRole("link", { name: "fix draft" })).toHaveAttribute("href", "/planning");
    expect(within(strip).getByRole("link", { name: "open run →" })).toHaveAttribute("href", `/runs/${RUN}?from=research`);
    expect(screen.getByText("Bug root cause")).toHaveClass("research__kind--bug");
  });

  it("draws a roadmap: its document chip lands on the pipeline's seat, its batch opens in Planning", () => {
    const brief = seededBrief({
      investigation: { ...seededBrief().investigation, displayId: "RS-124", kind: "roadmap_improvements", kindLabel: "Roadmap & improvements", tintKey: "road", status: "issues_filed" },
      matrix: null,
      proposed: null,
    });
    const detail = investigationDetail({
      displayId: "RS-124",
      deliverables: [{ kind: "brief", id: "b" }, { kind: "draft_batch", id: "batch-124" }, { kind: "roadmap_doc", id: "doc-124" }],
    });
    render(seat({ reading: { ok: true, value: { brief, detail } } }));

    const strip = screen.getByRole("group", { name: "Led to:" });
    expect(within(strip).getByRole("link", { name: "drafted tickets" })).toHaveAttribute("href", "/planning?batch=batch-124");
    fireEvent.click(within(strip).getByRole("button", { name: "roadmap document" }));
    expect(onLandPipeline).toHaveBeenCalledTimes(1);
    expect(screen.getByText("✓ issues filed")).toBeInTheDocument();
  });

  it("draws forensics: the culprit its ledger names, as a fact", () => {
    const bisect = briefSource(3, {
      locator: "bisect://acme-robotics/helios-firmware/v2.0.4..nightly",
      locatorLabel: "bisected → a41f2c9",
      href: null,
    });
    const brief = seededBrief({
      investigation: { ...seededBrief().investigation, displayId: "RS-131", kind: "regression_forensics", kindLabel: "Regression forensics", tintKey: "reg" },
      matrix: null,
      proposed: null,
      sources: { cited: 9, panel: [briefSource(1), bisect] },
    });
    render(seat({ reading: { ok: true, value: { brief, detail: investigationDetail() } } }));

    const strip = screen.getByRole("group", { name: "Led to:" });
    expect(within(strip).getByText("culprit · bisected → a41f2c9")).toHaveClass("research__led-chip");
    expect(within(strip).queryByRole("link")).toBeNull();
  });
});

describe("the featured seat without a brief", () => {
  it("says no investigation has finished yet", () => {
    render(seat({ reading: { ok: true, value: null } }));

    expect(screen.getByRole("region", { name: "Featured brief" })).toHaveTextContent(NO_BRIEF_TITLE);
    expect(screen.queryByRole("link", { name: EXPORT_LABEL })).toBeNull();
  });

  it("says when the brief could not be read, and offers a reload", () => {
    render(seat({ reading: { ok: false, reason: "The research service is away." } }));

    expect(screen.getByText(BRIEF_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The research service is away.")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: RELOAD_LABEL }));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
