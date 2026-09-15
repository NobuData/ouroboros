import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProviderConnection } from "@/app/api/providers";
import type { Reading } from "@/app/api/reading";
import { connectedNote } from "@/app/models/states";
import { PROVIDERS_PATH } from "@/app/paths";
import {
  CONNECT_STEP_LINK,
  CONNECT_STEP_UNKNOWN_NOTE,
  GUIDANCE_CARD_TITLE,
  GUIDANCE_READ_ONLY,
  IMPORT_LABEL,
  NEW_ALIAS_LABEL,
  NO_ALIASES_NOTE,
  NO_ALIASES_TITLE,
  NO_PROVIDERS_NOTE,
  NO_PROVIDERS_TITLE,
  PROVIDERS_UNREADABLE_REASON,
  guidanceState,
  importSources,
  importState,
} from "@/app/registry/view";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { seededCards } from "../helpers/providers";

// The two controls inside the card write through Server Actions on the server-only client; their
// own suites are `new-alias.test.tsx` and `import-menu.test.tsx`.
vi.mock("@/app/registry/create-actions", () => ({
  createAlias: vi.fn(),
  readModelOptions: () => new Promise(() => {}),
  readParamSchema: () => new Promise(() => {}),
}));
vi.mock("@/app/registry/import-actions", () => ({
  importAliases: vi.fn(),
  readCandidates: () => new Promise(() => {}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const { RegistryGuidance } = await import("@/app/registry/registry-guidance");

/**
 * **Name your first model** (#596) — the guidance card an empty registry gets in the table's
 * seat. What each step *says* is `view.test.ts`'s; what is here is what only a render shows:
 * which step is marked next, which controls each step offers, and that a member gets the path
 * without a single control in it.
 */

/** A provider read that worked, carrying these connections. */
function read(providers: readonly ProviderConnection[]): Reading<readonly ProviderConnection[]> {
  return { ok: true, value: providers };
}

/** …and one that did not. */
const FAILED: Reading<readonly ProviderConnection[]> = { ok: false, reason: "upstream refused" };

/**
 * Render the card for a provider read and a role.
 *
 * @param providers The provider read.
 * @param mayAdminister Whether the reader may create aliases.
 * @returns The Testing Library render result.
 */
function guidance(providers: Reading<readonly ProviderConnection[]>, mayAdminister = true) {
  return render(
    <RegistryGuidance
      aliasNames={[]}
      importing={importState(providers, mayAdminister)}
      mayAdminister={mayAdminister}
      sources={providers.ok ? importSources(providers.value) : []}
      state={guidanceState(providers, mayAdminister)}
    />,
  );
}

/** The two steps, in order. */
function steps(): HTMLElement[] {
  return [...screen.getByRole("region", { name: GUIDANCE_CARD_TITLE }).querySelectorAll("li")];
}

describe("the card", () => {
  it("is titled with the instruction and a true count of zero", () => {
    guidance(read(seededCards()));

    const card = screen.getByRole("region", { name: GUIDANCE_CARD_TITLE });

    expect(within(card).getByText("0 aliases")).toBeInTheDocument();
  });

  it("always draws both steps, with exactly one marked as next", () => {
    for (const providers of [read([]), read(seededCards()), FAILED]) {
      const view = guidance(providers);

      expect(steps()).toHaveLength(2);
      expect(steps().filter((step) => step.getAttribute("aria-current") === "step")).toHaveLength(1);

      view.unmount();
    }
  });
});

describe("a workspace with a connection", () => {
  it("explains why naming a model matters", () => {
    guidance(read(seededCards()));

    expect(screen.getByText(NO_ALIASES_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_ALIASES_NOTE)).toBeInTheDocument();
  });

  it("ticks the provider step with the count, and marks naming a model as next", () => {
    guidance(read(seededCards()));

    const [provider, alias] = steps();

    expect(provider).toHaveClass("models-foundations__step--done");
    expect(provider).toHaveTextContent("done");
    expect(provider).toHaveTextContent(connectedNote(seededCards().length));
    expect(alias).toHaveAttribute("aria-current", "step");
    expect(alias).toHaveClass("registry-guidance__step--current");
    expect(alias).toHaveTextContent("next");
  });

  it("offers both ways in on the next step: + New alias and the import menu", () => {
    guidance(read(seededCards()));

    const [provider, alias] = steps();

    expect(within(provider!).queryAllByRole("button")).toHaveLength(0);
    expect(within(alias!).getByRole("button", { name: NEW_ALIAS_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(within(alias!).getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute("aria-haspopup", "menu");
  });
});

describe("a workspace with no connection", () => {
  it("leads with connecting a provider, and says a name can be reserved meanwhile", () => {
    guidance(read([]));

    expect(screen.getByText(NO_PROVIDERS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_PROVIDERS_NOTE)).toBeInTheDocument();
  });

  it("marks connecting as next, with the one link to Providers & keys", () => {
    guidance(read([]));

    const [provider] = steps();

    expect(provider).toHaveAttribute("aria-current", "step");
    expect(within(provider!).getByRole("link", { name: CONNECT_STEP_LINK })).toHaveAttribute(
      "href",
      PROVIDERS_PATH,
    );
  });

  it("offers + New alias on the step after it, and no import — there is nothing to import from", () => {
    guidance(read([]));

    const [, alias] = steps();

    expect(alias).toHaveClass("models-foundations__step--pending");
    expect(within(alias!).getByRole("button", { name: NEW_ALIAS_LABEL })).toBeInTheDocument();
    expect(within(alias!).queryByRole("button", { name: IMPORT_LABEL })).toBeNull();
  });
});

describe("a workspace whose providers could not be read", () => {
  it("marks the provider step unknown rather than done or next", () => {
    guidance(FAILED);

    const [provider, alias] = steps();

    expect(provider).toHaveClass("models-foundations__step--unknown");
    expect(provider).toHaveTextContent(CONNECT_STEP_UNKNOWN_NOTE);
    expect(within(provider!).queryByRole("link")).toBeNull();
    expect(alias).toHaveAttribute("aria-current", "step");
  });

  it("keeps the import control, inert with the reason that is true", () => {
    guidance(FAILED);

    const [, alias] = steps();

    expect(within(alias!).getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute(
      "title",
      PROVIDERS_UNREADABLE_REASON,
    );
  });
});

describe("a member", () => {
  it("reads the same path with no controls in it, and one sentence in their place", () => {
    for (const providers of [read([]), read(seededCards()), FAILED]) {
      const view = guidance(providers, false);
      const card = screen.getByRole("region", { name: GUIDANCE_CARD_TITLE });

      expect(steps()).toHaveLength(2);
      expect(within(card).queryAllByRole("button")).toHaveLength(0);
      expect(within(card).queryAllByRole("link")).toHaveLength(0);
      expect(within(card).getByText(GUIDANCE_READ_ONLY)).toBeInTheDocument();

      view.unmount();
    }
  });

  it("gets no read-only sentence when they may create", () => {
    guidance(read(seededCards()));

    expect(screen.queryByText(GUIDANCE_READ_ONLY)).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <RegistryGuidance
        aliasNames={[]}
        importing={importState(read([]), true)}
        mayAdminister
        sources={[]}
        state={guidanceState(read([]), true)}
      />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("region", { name: GUIDANCE_CARD_TITLE })).toBeInTheDocument();
  });

  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(
      <RegistryGuidance
        aliasNames={[]}
        importing={importState(read(seededCards()), true)}
        mayAdminister
        sources={importSources(seededCards())}
        state={guidanceState(read(seededCards()), true)}
      />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
