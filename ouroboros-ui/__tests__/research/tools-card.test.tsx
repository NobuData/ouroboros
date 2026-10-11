import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResearchToolCatalogEntry } from "@/app/api/research";
import {
  ENABLE_READ_ONLY,
  ENABLE_SUBMIT,
  NO_TOOLS,
  NOTHING_REQUIRED,
  PLANNED_TITLE,
  SECRET_NOTE,
  TOOL_CONFIG_INVALID,
  TOOLS_UNREADABLE,
} from "@/app/research/side";
import type { ToolsCardProps } from "@/app/research/tools-card";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { plainForm, seededCatalog, seededTools, tool } from "../helpers/research";

/**
 * The research tools card as it is drawn (CN.3, #629). The acceptance criteria this suite holds,
 * in the ticket's words: **the seeded card matches the mockup row-for-row, including the idle
 * sixth tool with its enable affordance**; **sub-line counts are computed** — the card prints the
 * service's line, so a changed registry is a changed row; **a stopped tool flips its dot** on the
 * next reading; **the enable flow connects a fixture tool using only its `configSchema()`**; **the
 * papers tool's enable shows the honest v2 note rather than a broken form**; both palettes.
 */

const enableTool = vi.fn();
const onChanged = vi.fn();

vi.mock("@/app/research/side-actions", () => ({
  enableTool: (slug: unknown, config: unknown) => enableTool(slug, config),
}));

const { ToolsCard } = await import("@/app/research/tools-card");

/** Not enabled: the idle dot, with the tool's own form behind **enable**. */
const IDLE = { state: "not_configured" as const, dot: "idle" as const, detail: "not configured" };

/** A fixture tool nobody wrote UI for: a select, a list, a URL and a credential. */
function fixtureTool(): ResearchToolCatalogEntry {
  const base = plainForm("x").fields[0];

  return tool("fixture", "Fixture warehouse", "✦", "0 tables indexed", {
    health: IDLE,
    configured: false,
    enable: {
      kind: "form",
      title: "Fixture warehouse",
      values: {},
      fields: [
        { ...base, name: "region", label: "Region", widget: "select", choices: ["eu", "us"], defaultValue: "eu" },
        { ...base, name: "endpoint", label: "Endpoint", widget: "url", required: true },
        { ...base, name: "schemas", label: "Schemas", widget: "list" },
        { ...base, name: "token", label: "Access token", widget: "secret" },
      ],
    },
  });
}

function card(over: Partial<ToolsCardProps> = {}) {
  return (
    <ToolsCard mayAdminister onChanged={onChanged} reading={{ ok: true, value: seededCatalog() }} {...over} />
  );
}

/** The card's rows, as `[name, sub-line, dot]`. */
function rows(): string[][] {
  return within(screen.getByRole("region", { name: "Research tools" }))
    .getAllByRole("listitem")
    .map((row) => [
      row.querySelector(".research__side-name")?.textContent ?? "",
      row.querySelector(".research__side-sub")?.textContent ?? "",
      within(row).getByRole("img").getAttribute("aria-label") ?? "",
    ]);
}

beforeEach(() => {
  enableTool.mockReset();
  onChanged.mockReset();
});

describe("the seeded card", () => {
  it("draws mockup 22's six rows, in order, each with its glyph, sub-line and dot", () => {
    render(card());

    expect(rows()).toEqual([
      ["Web search & page reader", "SearXNG · full-page extraction, robots-aware", "Healthy — 200 · 41ms"],
      ["Competitor tracker", "4 rivals watched · release notes, changelogs, filings", "Healthy — 200 · 41ms"],
      ["Codebase & git mining", "blame, bisect, dependency graph over helios-firmware", "Healthy — 200 · 41ms"],
      ["Issue & PR history index", "3,412 issues · support tickets · churn interviews", "Healthy — 200 · 41ms"],
      ["Build & test telemetry", "HIL bench measurements · 6 metrics", "Healthy — 200 · 41ms"],
      ["Docs, standards & papers", "datasheets, RFCs, arXiv — PDF reader with citations", "Not enabled — not configured"],
    ]);
    expect(
      [...document.querySelectorAll(".research__tool-glyph")].map((glyph) => glyph.textContent),
    ).toEqual(["◍", "⌖", "⌥", "▤", "∿", "§"]);
  });

  it("counts the connected tools in its tag, from the service", () => {
    render(card());

    expect(screen.getByText("5 connected")).toBeInTheDocument();
  });

  it("offers enable on the idle sixth row and on no other", () => {
    render(card());

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Enable Docs, standards & papers",
    ]);
  });

  it("gives each dot its own class, and the detail as its tooltip", () => {
    const states = [
      ["healthy", "ok"],
      ["degraded", "warn"],
      ["down", "err"],
      ["not_configured", "idle"],
    ] as const;
    render(
      card({
        reading: {
          ok: true,
          value: seededCatalog(
            states.map(([state, dot]) =>
              tool(state, state, "◍", "x", { health: { state, dot, detail: `${state} detail` } }),
            ),
          ),
        },
      }),
    );

    const dots = screen.getAllByRole("img");

    expect(dots.map((dot) => dot.className)).toEqual(states.map(([, dot]) => `research__dot research__dot--${dot}`));
    expect(dots.map((dot) => dot.getAttribute("title"))).toEqual(states.map(([state]) => `${state} detail`));
  });

  it("is the same card in both palettes", () => {
    const [light, dark] = renderInBothPalettes(card()).map(maskIds);

    expect(light).toBe(dark);
  });
});

describe("live facts", () => {
  it("prints a changed registry's sub-line and count on the next reading", () => {
    const { rerender } = render(card());
    const tools = seededTools();
    tools[1] = { ...tools[1], subLine: "5 rivals watched · release notes, changelogs, filings" };

    rerender(card({ reading: { ok: true, value: seededCatalog(tools) } }));

    expect(rows()[1][1]).toBe("5 rivals watched · release notes, changelogs, filings");
  });

  it("flips a stopped tool's dot, and the count with it, on the next reading", () => {
    const { rerender } = render(card());
    const tools = seededTools();
    tools[0] = { ...tools[0], health: { state: "down", dot: "err", detail: "unreachable: SearXNG did not answer" } };

    rerender(card({ reading: { ok: true, value: seededCatalog(tools) } }));

    expect(rows()[0][2]).toBe("Down — unreachable: SearXNG did not answer");
    expect(screen.getByText("4 connected")).toBeInTheDocument();
    // Down is not idle: a tool that stopped answering is not offered as one to enable.
    expect(screen.queryByRole("button", { name: "Enable Web search & page reader" })).toBeNull();
  });
});

describe("the papers tool's enable", () => {
  it("opens the honest v2 note and the issue to follow — no form", () => {
    render(card());

    fireEvent.click(screen.getByRole("button", { name: "Enable Docs, standards & papers" }));

    const dialog = screen.getByRole("dialog", { name: PLANNED_TITLE });
    expect(dialog).toHaveTextContent("Docs, standards & papers arrives in v2.");
    expect(within(dialog).getByRole("link", { name: "Follow #635" })).toHaveAttribute(
      "href",
      "https://github.com/NobuData/ouroboros/issues/635",
    );
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: ENABLE_SUBMIT })).toBeNull();
  });

  it("is open to a viewer too — reading a note changes nothing", () => {
    render(card({ mayAdminister: false }));

    fireEvent.click(screen.getByRole("button", { name: "Enable Docs, standards & papers" }));

    expect(screen.getByRole("dialog", { name: PLANNED_TITLE })).toBeInTheDocument();
    expect(enableTool).not.toHaveBeenCalled();
  });
});

describe("the enable flow", () => {
  function open() {
    render(card({ reading: { ok: true, value: seededCatalog([fixtureTool()]) } }));
    fireEvent.click(screen.getByRole("button", { name: "Enable Fixture warehouse" }));

    return screen.getByRole("dialog", { name: "Fixture warehouse" });
  }

  it("draws the fixture tool's form from its schema alone", () => {
    const dialog = open();

    expect(within(dialog).getByLabelText(/Region/)).toHaveValue("eu");
    expect(within(dialog).getByLabelText(/Endpoint/)).toBeRequired();
    expect(within(dialog).getByLabelText(/Schemas/).tagName).toBe("TEXTAREA");
    expect(within(dialog).getByLabelText(/Access token/)).toHaveAttribute("type", "password");
    expect(dialog).toHaveTextContent(SECRET_NOTE);
  });

  it("stores what was typed, closes, and asks the card to re-read", async () => {
    enableTool.mockResolvedValue({ ok: true, value: fixtureTool() });
    const dialog = open();

    fireEvent.change(within(dialog).getByLabelText(/Region/), { target: { value: "us" } });
    fireEvent.change(within(dialog).getByLabelText(/Endpoint/), { target: { value: "https://wh.example" } });
    fireEvent.change(within(dialog).getByLabelText(/Schemas/), { target: { value: "hil\nfleet" } });
    fireEvent.change(within(dialog).getByLabelText(/Access token/), { target: { value: "tok-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: ENABLE_SUBMIT }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(enableTool).toHaveBeenCalledWith("fixture", {
      region: "us",
      endpoint: "https://wh.example",
      schemas: ["hil", "fleet"],
      token: "tok-1",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prints the schema's refusal against its field and stays open", async () => {
    enableTool.mockResolvedValue({
      ok: false,
      refusal: {
        code: "research_tool_config_invalid",
        message: "The configuration does not satisfy this tool's schema.",
        details: { fields: { endpoint: ["must be a URL"] } },
      },
    });
    const dialog = open();

    fireEvent.change(within(dialog).getByLabelText(/Endpoint/), { target: { value: "https://x.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: ENABLE_SUBMIT }));

    expect(await within(dialog).findByText(TOOL_CONFIG_INVALID)).toHaveAttribute("role", "alert");
    expect(dialog).toHaveTextContent("must be a URL");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("enables a tool that needs nothing with one press", async () => {
    enableTool.mockResolvedValue({ ok: true, value: seededTools()[2] });
    render(
      card({
        reading: {
          ok: true,
          value: seededCatalog([tool("code", "Codebase & git mining", "⌥", "no repositories", { health: IDLE })]),
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable Codebase & git mining" }));
    const dialog = screen.getByRole("dialog", { name: "Codebase & git mining" });
    expect(dialog).toHaveTextContent(NOTHING_REQUIRED);
    fireEvent.click(within(dialog).getByRole("button", { name: ENABLE_SUBMIT }));

    await waitFor(() => expect(enableTool).toHaveBeenCalledWith("code", {}));
  });

  it("is inert, with the reason, for a reader who may not administer", () => {
    render(card({ mayAdminister: false, reading: { ok: true, value: seededCatalog([fixtureTool()]) } }));

    const button = screen.getByRole("button", { name: "Enable Fixture warehouse" });
    fireEvent.click(button);

    expect(button).toHaveAttribute("title", ENABLE_READ_ONLY);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("when there is nothing to draw", () => {
  it("says the catalog could not be read, in the service's words, and counts nothing", () => {
    render(card({ reading: { ok: false, reason: "The service failed." } }));

    expect(screen.getByText(TOOLS_UNREADABLE)).toBeInTheDocument();
    expect(screen.getByText("The service failed.")).toBeInTheDocument();
    expect(screen.queryByText(/connected$/)).toBeNull();
  });

  it("says so for an installation with no tools", () => {
    render(card({ reading: { ok: true, value: seededCatalog([]) } }));

    expect(screen.getByText(NO_TOOLS)).toBeInTheDocument();
    expect(screen.getByText("0 connected")).toBeInTheDocument();
  });
});
