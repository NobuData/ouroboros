import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderStrip } from "@/app/models/provider-strip";
import { PROVIDERS_PATH } from "@/app/paths";

import { CHECKED_STAMP, provider, seededProviders, unknownProvider } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The provider health strip (#200, over #196) — mockup 06's `.phealth`.
 *
 * The strip's whole value is that it is trustworthy, so this suite is organised around the
 * three ways a strip like this lies: it renders an unmeasured state as a healthy one, it
 * prints a number nobody measured, or it composes a second sentence from a row the service
 * already composed one for. `view.test.ts` proves the *decisions*; this proves what reaches
 * the DOM, which is the only thing a reader ever sees.
 */

/** Render the seeded workspace's strip. */
function seeded() {
  return render(<ProviderStrip providers={{ ok: true, value: seededProviders() }} />);
}

/**
 * The chip for one provider, found by the name it draws.
 *
 * Located through the name element rather than by role-and-name: a list item takes its
 * accessible name from an `aria-label`, not from its contents, and giving each chip one
 * would put the same words in the tree twice.
 *
 * @param name The provider's display name, as the chip draws it.
 * @returns The `<li>`.
 */
function chip(name: string): HTMLElement {
  const label = screen.getByText(name, { selector: ".models-health__name" });
  const item = label.closest("li");

  expect(item, `no chip for ${name}`).not.toBeNull();
  return item as HTMLElement;
}

describe("the strip", () => {
  it("is a named list, so five providers are announced as five things", () => {
    // A row of loose spans after the tab set is five facts a screen reader has to assemble;
    // "list, 5 items" is what the visual strip communicates instantly.
    seeded();

    const strip = screen.getByRole("list", { name: "Provider health" });

    expect(within(strip).getAllByRole("listitem")).toHaveLength(5);
  });

  it("draws the seeded workspace's five chips, in the order the service sends them", () => {
    seeded();

    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "Anthropic Claudehealthy42ms",
      "Cursorhealthy",
      "GitHub Copiloterror·elevated latency",
      "OpenAI-compatible · local vLLMhealthy10.0.4.20 · vLLM local",
      "Ollama · workstationhealthyken-station.local · 3 models · workstation",
    ]);
  });

  it("keeps the degraded Copilot chip's reason beside its name", () => {
    seeded();

    expect(chip("GitHub Copilot")).toHaveTextContent("elevated latency");
    expect(chip("GitHub Copilot")).toHaveClass("models-health__chip--err");
  });
});

describe("an unknown provider, which is the state this strip must not flatter", () => {
  it("differs from a healthy chip in three ways, none of them a colour", () => {
    // The ticket's second acceptance criterion. The tone class carries the stylesheet's
    // dashed border, the dot carries a ring rather than a disc, and the chip says the word.
    render(
      <ProviderStrip
        providers={{ ok: true, value: [provider({ status: "active" }), unknownProvider()] }}
      />,
    );

    const nothing = chip("Fresh connection");

    expect(nothing).toHaveClass("models-health__chip--unknown");
    expect(nothing.querySelector(".models-health__dot--ring")).not.toBeNull();
    expect(nothing).toHaveTextContent("unknown");

    const healthy = chip("Anthropic Claude");

    expect(healthy).toHaveClass("models-health__chip--ok");
    expect(healthy.querySelector(".models-health__dot--ring")).toBeNull();
  });

  it("says in words that nothing has ever looked at it", () => {
    render(<ProviderStrip providers={{ ok: true, value: [unknownProvider()] }} />);

    expect(chip("Fresh connection")).toHaveAttribute("title", "Never checked");
  });
});

describe("what a chip says without being hovered", () => {
  it("puts the state in the accessibility tree for every chip, healthy included", () => {
    // The mockup draws a bare `Anthropic ●`, so the word is `sr-only` there rather than
    // absent: hue must never be the only signal, and four chips shouting *healthy* would
    // drown the one that is not.
    seeded();

    const healthy = chip("Anthropic Claude");
    const state = healthy.querySelector(".models-health__state");

    expect(state).toHaveTextContent("healthy");
    expect(state).toHaveClass("sr-only");
    expect(chip("GitHub Copilot").querySelector(".models-health__state")).not.toHaveClass(
      "sr-only",
    );
  });

  it("hides the dot from the accessibility tree, because the word already says it", () => {
    seeded();

    expect(chip("Cursor").querySelector(".models-health__dot")).toHaveAttribute(
      "aria-hidden",
    );
  });

  it("hides the separator too — it is decoration between two elements", () => {
    seeded();

    expect(chip("GitHub Copilot").querySelector(".models-health__sep")).toHaveAttribute(
      "aria-hidden",
    );
  });
});

describe("what a chip does not print", () => {
  it("draws no meta element at all where nothing was measured", () => {
    // `Cursor ●` in the mockup. An empty `.meta` span has its own colour and spacing and
    // reads as a bug in the page, which is why the value is null rather than "".
    seeded();

    expect(chip("Cursor").querySelector(".models-health__meta")).toBeNull();
  });

  it("prints no latency anywhere a check measured none", () => {
    // The ticket's third acceptance criterion, at the DOM. Three of the five seeded rows
    // measured no latency, and `0ms` appears on none of them.
    const { container } = seeded();

    expect(container.textContent).not.toMatch(/0ms/);
    expect(container.textContent?.match(/\d+ms/g)).toEqual(["42ms"]);
  });

  it("prints no model count where nothing counted them", () => {
    // Null and `0` are different facts: one is *we could not read the list*, the other is
    // *the list was empty*.
    seeded();

    expect(chip("Anthropic Claude")).not.toHaveTextContent(/models/);
    expect(chip("Ollama · workstation")).toHaveTextContent("3 models");
  });
});

describe("the hover detail", () => {
  it("carries the last-checked time and the reason, on the whole chip", () => {
    seeded();

    expect(chip("GitHub Copilot")).toHaveAttribute(
      "title",
      `Last checked ${CHECKED_STAMP} · elevated latency`,
    );
  });

  it("names which question produced the state", () => {
    seeded();

    expect(chip("Anthropic Claude").getAttribute("title")).toContain("key validation");
    expect(chip("Ollama · workstation").getAttribute("title")).toContain("reachability check");
  });
});

describe("a strip with no chips on it", () => {
  it("says a workspace has connected nothing, and where connecting one will be", () => {
    // Not a blank region (§ 3.3), and not an error: a workspace part-way through setting
    // itself up has connected nothing, which is a state the product guides out of.
    render(<ProviderStrip providers={{ ok: true, value: [] }} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/No providers are connected/)).toBeInTheDocument();
    // A link, since AE.1 (#227) built the surface the note used to call *soon* (#205).
    expect(screen.getByRole("link", { name: "Providers & keys" })).toHaveAttribute("href", PROVIDERS_PATH);
    expect(screen.queryByText(/mockup 07/)).toBeNull();
  });

  it("says something different when the read failed, and carries the service's reason", () => {
    // *Nobody has connected a provider* and *nobody could ask* are different facts, and a
    // strip that drew them alike would report an outage as an empty workspace.
    render(<ProviderStrip providers={{ ok: false, reason: "Choose a workspace." }} />);

    const note = screen.getByRole("status");

    expect(note).toHaveTextContent("Provider health could not be read.");
    expect(note).toHaveTextContent("Choose a workspace.");
    expect(note).toHaveClass("models-health__note--failed");
  });

  it("announces a failed read politely rather than as an alert", () => {
    // It is a fact about a region of a page somebody is already reading, not an
    // interruption — the same reasoning the dashboard's stale banner is built on.
    render(<ProviderStrip providers={{ ok: false, reason: "Down." }} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the strip in the %s palette", (palette) => {
    renderInPalette(palette, <ProviderStrip providers={{ ok: true, value: seededProviders() }} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("list", { name: "Provider health" })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    // A strip that picked a hue in JavaScript would be one the boot script could not paint
    // before hydration, and would render differently on the server than in the browser — on
    // the one region of this page where being wrong matters.
    const [light, dark] = renderInBothPalettes(
      <ProviderStrip
        providers={{ ok: true, value: [...seededProviders(), unknownProvider()] }}
      />,
    );

    expect(light).toBe(dark);
  });
});
