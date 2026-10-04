import { afterEach, describe, expect, it, vi } from "vitest";

import { fragmentId, landOn, landOnFragment } from "@/app/shell/pane-anchor";

/**
 * Landing on the fragment a page was opened with (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): what a screen behind a
 * `loading.tsx` does for itself, because the router looked for the target in the skeleton.
 */

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

/**
 * Put an element on the page with a `scrollIntoView` to watch — jsdom has none of its own.
 *
 * @param id The element's id.
 * @returns The spy.
 */
function target(id: string) {
  const element = document.createElement("div");
  const scrollIntoView = vi.fn();

  element.id = id;
  element.scrollIntoView = scrollIntoView;
  document.body.append(element);

  return scrollIntoView;
}

describe("the fragment's id", () => {
  it.each([
    ["#repo-profile", "repo-profile"],
    ["repo-profile", "repo-profile"],
    ["", ""],
    ["#", ""],
    ["#playbook-5eed%2F1", "playbook-5eed/1"],
  ])("reads %j as %j", (hash, id) => {
    expect(fragmentId(hash)).toBe(id);
  });

  it("keeps a malformed escape as it is rather than throwing", () => {
    expect(fragmentId("#100%")).toBe("100%");
  });
});

describe("landing", () => {
  it("brings the element the address names to the top of the pane's reading area", () => {
    const scrollIntoView = target("repo-profile");
    window.history.replaceState(null, "", "/knowledge#repo-profile");

    const landed = landOnFragment();

    expect(landed).toBe(document.getElementById("repo-profile"));
    // The element's own scroll: it moves the nearest scroll container — the pane — and honours
    // its `scroll-padding-top`.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("does nothing for an address with no fragment", () => {
    const scrollIntoView = target("repo-profile");
    window.history.replaceState(null, "", "/knowledge");

    expect(landOnFragment()).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing for a fragment that names nothing on the page", () => {
    const scrollIntoView = target("repo-profile");
    window.history.replaceState(null, "", "/knowledge#elsewhere");

    expect(landOnFragment()).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("survives an engine with no scrollIntoView", () => {
    const element = document.createElement("div");

    expect(() => {
      landOn(element);
    }).not.toThrow();
  });
});
