import { describe, expect, it } from "vitest";

import {
  LEAVE_CANCEL,
  LEAVE_CONFIRM,
  LEAVE_TITLE,
  type LinkFacts,
  leaveBody,
  leavingPath,
} from "@/app/settings/leave";

/**
 * Leaving the settings page with unsaved changes, as decisions (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491), decision S7): which press on a
 * link takes this tab away from this page, and what the question says.
 */

/** A plain primary click. */
const PLAIN = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

/** The page the reader is on. */
const PAGE = { origin: "http://localhost:3000", pathname: "/settings", search: "" };

/**
 * A link, as an anchor element reports it.
 *
 * @param href Its resolved address.
 * @param rest Its target and whether it is a download.
 * @returns The facts.
 */
function link(href: string, rest: Partial<LinkFacts> = {}): LinkFacts {
  return { href, target: "", download: false, ...rest };
}

describe("a press that leaves", () => {
  it("is a plain press on a link to another page of this application", () => {
    expect(leavingPath(PLAIN, link("http://localhost:3000/dashboard"), PAGE)).toBe("/dashboard");
  });

  it("keeps the destination's query and fragment, so the reader arrives where the link said", () => {
    expect(
      leavingPath(PLAIN, link("http://localhost:3000/runs/7f00?from=dashboard#log"), PAGE),
    ).toBe("/runs/7f00?from=dashboard#log");
  });

  it("includes a mounted tab of this very section", () => {
    expect(leavingPath(PLAIN, link("http://localhost:3000/settings/sources"), PAGE)).toBe(
      "/settings/sources",
    );
  });

  it("includes the same path under a different query", () => {
    expect(leavingPath(PLAIN, link("http://localhost:3000/settings?tab=x"), PAGE)).toBe(
      "/settings?tab=x",
    );
  });

  it("is still one with target=_self spelled out", () => {
    expect(
      leavingPath(PLAIN, link("http://localhost:3000/dashboard", { target: "_self" }), PAGE),
    ).toBe("/dashboard");
  });
});

describe("a press that does not", () => {
  it("is a fragment of this page — the section nav's own anchors discard nothing", () => {
    expect(leavingPath(PLAIN, link("http://localhost:3000/settings#policies"), PAGE)).toBeNull();
    expect(leavingPath(PLAIN, link("http://localhost:3000/settings"), PAGE)).toBeNull();
  });

  it.each([
    ["a meta-click", { ...PLAIN, metaKey: true }],
    ["a ctrl-click", { ...PLAIN, ctrlKey: true }],
    ["a shift-click", { ...PLAIN, shiftKey: true }],
    ["an alt-click", { ...PLAIN, altKey: true }],
    ["a middle click", { ...PLAIN, button: 1 }],
  ])("is %s, which opens the link somewhere else", (_name, click) => {
    expect(leavingPath(click, link("http://localhost:3000/dashboard"), PAGE)).toBeNull();
  });

  it("is a link that opens in another tab, or downloads", () => {
    expect(
      leavingPath(PLAIN, link("http://localhost:3000/dashboard", { target: "_blank" }), PAGE),
    ).toBeNull();
    expect(
      leavingPath(PLAIN, link("http://localhost:3000/audit.csv", { download: true }), PAGE),
    ).toBeNull();
  });

  it("is another origin — a real unload, which only the browser's own prompt can hold", () => {
    expect(leavingPath(PLAIN, link("https://github.com/NobuData/ouroboros"), PAGE)).toBeNull();
  });

  it("is an address that is not one", () => {
    expect(leavingPath(PLAIN, link(""), PAGE)).toBeNull();
    expect(leavingPath(PLAIN, link("not a url"), PAGE)).toBeNull();
  });
});

describe("the question", () => {
  it("says how much would be lost, in the singular and the plural", () => {
    expect(leaveBody(1)).toBe(
      "This page has 1 unsaved change. Leaving discards it — nothing is saved until you press Save changes.",
    );
    expect(leaveBody(3)).toBe(
      "This page has 3 unsaved changes. Leaving discards them — nothing is saved until you press Save changes.",
    );
  });

  it("offers staying and leaving in words that say what each does", () => {
    expect(LEAVE_TITLE).toBe("Leave without saving?");
    expect(LEAVE_CONFIRM).toBe("Discard changes and leave");
    expect(LEAVE_CANCEL).toBe("Stay on this page");
  });
});
