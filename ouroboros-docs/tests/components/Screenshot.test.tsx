// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Screenshot, { resolveScreenshot } from "../../src/components/Screenshot";
import type { ScreenshotIndex } from "../../plugins/screenshots";
import { SCREENSHOTS_PLUGIN } from "../../site.constants";
import { setPluginData } from "../support/useGlobalData";

/** The component's stylesheet, for the rules the DOM cannot show (jsdom applies no CSS). */
const css = readFileSync(
  join(import.meta.dirname, "../../src/components/Screenshot/styles.module.css"),
  "utf8",
);

/** A one-entry index, as the plugin would publish it. */
const INDEX: ScreenshotIndex = {
  screenshots: {
    "user-guide.inbox": {
      alt: "The needs-you inbox listing three decisions.",
      caption: "The needs-you inbox.",
      sources: {
        light: "img/screenshots/user-guide/inbox.light.png",
        dark: "img/screenshots/user-guide/inbox.dark.png",
      },
      width: 1440,
      height: 900,
    },
  },
};

describe("resolveScreenshot", () => {
  it("returns the manifest's entry", () => {
    expect(resolveScreenshot(INDEX, "user-guide.inbox")).toEqual(
      INDEX.screenshots["user-guide.inbox"],
    );
  });

  it("lets the page override alt text and caption", () => {
    expect(
      resolveScreenshot(INDEX, "user-guide.inbox", { alt: " Inbox. ", caption: "Here." }),
    ).toMatchObject({ alt: "Inbox.", caption: "Here." });
    expect(resolveScreenshot(INDEX, "user-guide.inbox", { caption: "" }).caption).toBe("");
  });

  it("throws on an id the manifest does not list, naming the ones it does", () => {
    expect(() => resolveScreenshot(INDEX, "user-guide.nope")).toThrow(
      /user-guide\.nope.*not in screenshots\/screenshots\.manifest\.json \(known: user-guide\.inbox\)/,
    );
    expect(() => resolveScreenshot({ screenshots: {} }, "home.x")).toThrow(/known: none/);
  });

  it("is not fooled by inherited property names", () => {
    expect(() => resolveScreenshot(INDEX, "constructor")).toThrow(/not in/);
  });

  it("throws when the plugin published nothing", () => {
    expect(() => resolveScreenshot(undefined, "user-guide.inbox")).toThrow(/known: none/);
  });

  it.each(["", "   "])("requires alt text — %j is refused", (alt) => {
    expect(() => resolveScreenshot(INDEX, "user-guide.inbox", { alt })).toThrow(/needs alt text/);
    const blank: ScreenshotIndex = {
      screenshots: { x: { ...INDEX.screenshots["user-guide.inbox"], alt } },
    };
    expect(() => resolveScreenshot(blank, "x")).toThrow(/needs alt text/);
  });
});

describe("<Screenshot>", () => {
  beforeEach(() => {
    setPluginData(SCREENSHOTS_PLUGIN, INDEX);
  });

  afterEach(() => {
    setPluginData(SCREENSHOTS_PLUGIN, undefined);
    vi.restoreAllMocks();
  });

  /**
   * The images in the figure (not the zoom dialog), one per theme.
   *
   * @returns the light and dark images.
   */
  function figureImages(): HTMLElement[] {
    return screen
      .getAllByAltText("The needs-you inbox listing three decisions.")
      .filter((image) => !image.closest("dialog"));
  }

  it("swaps the light and dark captures with the theme", () => {
    render(<Screenshot id="user-guide.inbox" />);
    const [light, dark] = figureImages();
    expect(light).toHaveAttribute("data-theme-variant", "light");
    expect(light).toHaveAttribute("src", "/img/screenshots/user-guide/inbox.light.png");
    expect(dark).toHaveAttribute("data-theme-variant", "dark");
    expect(dark).toHaveAttribute("src", "/img/screenshots/user-guide/inbox.dark.png");
  });

  it("uses the manifest's alt text and caption in a figure", () => {
    render(<Screenshot id="user-guide.inbox" />);
    const figure = screen.getByRole("figure");
    expect(figure).toHaveTextContent("The needs-you inbox.");
    expect(screen.getByText("The needs-you inbox.").tagName).toBe("FIGCAPTION");
  });

  it("takes the page's alt text and caption over the manifest's", () => {
    render(<Screenshot id="user-guide.inbox" alt="The inbox, empty." caption="Nothing to do." />);
    expect(screen.getAllByAltText("The inbox, empty.").length).toBeGreaterThan(0);
    expect(screen.getByText("Nothing to do.")).toBeInTheDocument();
  });

  it("leaves the caption out when the page blanks it", () => {
    const { container } = render(<Screenshot id="user-guide.inbox" caption="" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("reserves its box before loading: intrinsic size, lazy, height follows width", () => {
    render(<Screenshot id="user-guide.inbox" />);
    for (const image of figureImages()) {
      expect(image).toHaveAttribute("width", "1440");
      expect(image).toHaveAttribute("height", "900");
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveClass("image");
    }
    // The class keeps the attributes' aspect ratio when the column is narrower.
    expect(css).toMatch(/\.image \{[^}]*width: 100%;[^}]*height: auto;/);
  });

  it("frames the image with tokens only", () => {
    expect(css).toMatch(/\.zoom \{[^}]*border: 1px solid var\(--line-strong\);/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("enlarges in a dialog on click, and closes on a click inside it", () => {
    const showModal = vi.fn();
    const close = vi.fn();
    // jsdom has no modal dialogs; the browser's own showModal/close are what run on the site.
    Object.assign(HTMLDialogElement.prototype, { showModal, close });
    render(<Screenshot id="user-guide.inbox" />);

    fireEvent.click(screen.getByRole("button", { name: /needs-you inbox listing/ }));
    expect(showModal).toHaveBeenCalledTimes(1);

    const dialog = document.querySelector("dialog");
    expect(dialog).toHaveAttribute("aria-label", "The needs-you inbox listing three decisions.");
    fireEvent.click(dialog!);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails the render on an unknown id", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Screenshot id="user-guide.missing" />)).toThrow(/not in/);
  });

  it("fails the render on blank alt text", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Screenshot id="user-guide.inbox" alt=" " />)).toThrow(/needs alt text/);
  });
});
