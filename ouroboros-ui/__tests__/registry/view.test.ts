import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Reading } from "@/app/api/reading";
import type { ProviderHealth } from "@/app/api/routing";
import { PROVIDERS_PATH } from "@/app/paths";
import {
  CONNECT_PROVIDER_HREF,
  CONNECT_PROVIDER_LABEL,
  IMPORT_ITEM_REASON,
  IMPORT_LABEL,
  MEMBER_REASON,
  NEW_ALIAS_LABEL,
  NEW_ALIAS_REASON,
  NO_PROVIDERS_REASON,
  PROVIDERS_UNREADABLE_REASON,
  REGISTRY_SUBLINE,
  REGISTRY_TITLE,
  importSources,
  importState,
  newAliasReason,
  tableState,
} from "@/app/registry/view";

import { provider, seededProviders } from "../helpers/models";
import { seededRegistry } from "../helpers/registry";

/**
 * The registry frame's copy and its one judgement (#591).
 *
 * Two things are worth asserting here and they are different in kind.
 *
 * The **copy** is checked against `docs/mockups/21-model-registry.html` itself rather than
 * against a string typed twice. The head is the product's argument — *every model gets a name,
 * and every route points at the name* — and a paraphrase in implementation would weaken it
 * quietly, which is exactly the kind of change a review does not catch. Reading the mockup is
 * what makes a change to one that is not a change to both fail the suite, the same technique
 * `__tests__/providers/view.test.ts` uses against `docs/SECURITY_MODEL.md`.
 *
 * The **judgement** is {@link importState}, and its whole value is that it keeps three unlike
 * reasons apart. Collapsing them would send an admin looking for a permission they already
 * have, or a member to a page that will refuse them.
 */

/** The mockup this page is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "21-model-registry.html"),
  "utf8",
);

/** A read that succeeded, carrying these connections. */
function read(providers: readonly ProviderHealth[]): Reading<readonly ProviderHealth[]> {
  return { ok: true, value: providers };
}

/** A read that did not. */
const FAILED: Reading<readonly ProviderHealth[]> = { ok: false, reason: "upstream refused" };

describe("the head copy", () => {
  it("takes the h1 from the mockup, verbatim", () => {
    // The sentence the rest of the page defends. Compared against the drawing rather than
    // against itself, so a paraphrase cannot pass by matching the constant it changed.
    expect(MOCKUP).toContain(`<h1>${REGISTRY_TITLE}</h1>`);
  });

  it("takes the BYOK subline from the mockup, verbatim", () => {
    // Including the apostrophe in "That's": the copy is not the UI's to tidy.
    expect(MOCKUP).toContain(REGISTRY_SUBLINE);
  });

  it("says what an alias buys, which is why the page exists", () => {
    expect(REGISTRY_SUBLINE).toMatch(/swap the provider behind it and nothing else changes/);
    expect(REGISTRY_SUBLINE).toMatch(/bring-your-own-key/);
  });

  it("labels both head actions as the mockup does", () => {
    // The primary action whole, and the ghost action less its caret — the caret is a picture
    // of a menu rather than a word in a name, and `import-menu.tsx` draws it aria-hidden.
    expect(MOCKUP).toContain(NEW_ALIAS_LABEL);
    expect(MOCKUP).toContain(`${IMPORT_LABEL} ▾`);
  });
});

describe("the table's seat (#592)", () => {
  it("is populated with the rows decided from a read that succeeded", () => {
    const state = tableState({ ok: true, value: seededRegistry() });

    expect(state.kind).toBe("populated");
    if (state.kind === "populated") expect(state.rows.map((row) => row.alias)).toContain("coder-max");
  });

  it("is empty for a workspace that has created nothing", () => {
    expect(tableState({ ok: true, value: [] })).toEqual({ kind: "empty" });
  });

  it("is failed, with the service's sentence, for a read that was refused", () => {
    // *Could not be read* and *no aliases yet* are different facts; drawing one as the other
    // would hide an outage or accuse an empty workspace of an error it has not had.
    expect(tableState({ ok: false, reason: "registry away" })).toEqual({
      kind: "failed",
      reason: "registry away",
    });
  });
});

describe("why + New alias cannot act", () => {
  it("names the issue that builds the dialog, for somebody who may use it", () => {
    expect(newAliasReason(true)).toBe(NEW_ALIAS_REASON);
    expect(newAliasReason(true)).toMatch(/#594/);
  });

  it("gives a member the reason that is actually true of them", () => {
    // Two blockers, and only one of them is CI.4's to remove. A member told *"the dialog
    // arrives with #594"* would come back when it did and still be refused.
    expect(newAliasReason(false)).toBe(MEMBER_REASON);
  });

  it("says who may, rather than only that this reader may not", () => {
    expect(MEMBER_REASON).toMatch(/owners and admins/);
  });
});

describe("what the import action may do", () => {
  it("offers every connected provider when there is one and the reader may import", () => {
    const state = importState(read(seededProviders()), true);

    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" ? state.sources.map((source) => source.name) : []).toEqual([
      "Anthropic Claude",
      "Cursor",
      "GitHub Copilot",
      "OpenAI-compatible · local vLLM",
      "Ollama · workstation",
    ]);
  });

  it("blocks a member before it looks at the providers at all", () => {
    // The order is the judgement: a member offered *"connect a provider →"* is being pointed
    // at a page that would also refuse them.
    const state = importState(read(seededProviders()), false);

    expect(state).toEqual({ kind: "blocked", reason: MEMBER_REASON, connect: false });
  });

  it("blocks a member with no providers for the reason that is about them", () => {
    expect(importState(read([]), false)).toEqual({
      kind: "blocked",
      reason: MEMBER_REASON,
      connect: false,
    });
  });

  it("says nothing is connected when nothing is, and offers the link that fixes it", () => {
    // The state the mockup does not draw and a fresh workspace hits immediately.
    expect(importState(read([]), true)).toEqual({
      kind: "blocked",
      reason: NO_PROVIDERS_REASON,
      connect: true,
    });
  });

  it("says the list could not be read when it could not, and offers no fix", () => {
    // *No providers* and *nobody could read the providers* are different facts. There is
    // nothing to do about the second but try again, so it carries no link.
    expect(importState(FAILED, true)).toEqual({
      kind: "blocked",
      reason: PROVIDERS_UNREADABLE_REASON,
      connect: false,
    });
  });

  it("offers the fix link for exactly one blocked state", () => {
    // Asserted as an exclusive property rather than three separate cases: a link on the
    // wrong state is a reader sent somewhere that cannot help them.
    const blocked = [
      importState(read(seededProviders()), false),
      importState(read([]), false),
      importState(read([]), true),
      importState(FAILED, true),
      importState(FAILED, false),
    ].filter((state) => state.kind === "blocked");

    expect(blocked.filter((state) => state.connect)).toHaveLength(1);
  });

  it("gives the three blocked states three distinct sentences", () => {
    // Collapsing any two into *"unavailable"* is the failure this function exists to prevent.
    expect(new Set([MEMBER_REASON, NO_PROVIDERS_REASON, PROVIDERS_UNREADABLE_REASON]).size).toBe(3);
  });

  it("points the fix at the providers page the rest of the product knows", () => {
    // From `app/paths.ts`, never typed out: a fourth spelling of the route is a fourth thing
    // to rename.
    expect(CONNECT_PROVIDER_HREF).toBe(PROVIDERS_PATH);
    expect(CONNECT_PROVIDER_LABEL).toMatch(/Connect a provider/);
  });

  it("names the issue that wires a chosen provider to something", () => {
    expect(IMPORT_ITEM_REASON).toMatch(/#594/);
  });
});

describe("which providers the menu offers", () => {
  it("keeps the order the service served, which is by name", () => {
    // So the menu is scanned the same way the health strip on /models is.
    expect(importSources(seededProviders()).map((source) => source.name)).toEqual(
      seededProviders().map((health) => health.displayName),
    );
  });

  it("carries the connection id, which is what CI.4 will scope its wizard by", () => {
    expect(importSources(seededProviders())[0].id).toBe(seededProviders()[0].id);
  });

  it("does not filter by health, because the question is which providers exist", () => {
    // A paused or unreachable connection is still a connection this workspace has. Hiding it
    // would answer *which providers are up right now* instead, and leave a reader wondering
    // where their provider went.
    const unhealthy = [
      provider({ id: "a", displayName: "Paused", status: "paused" }),
      provider({ id: "b", displayName: "Broken", status: "error" }),
      provider({ id: "c", displayName: "Unchecked", status: "unknown" }),
    ];

    expect(importSources(unhealthy).map((source) => source.name)).toEqual([
      "Paused",
      "Broken",
      "Unchecked",
    ]);
  });

  it("offers nothing for a workspace that has connected nothing", () => {
    expect(importSources([])).toEqual([]);
  });
});
