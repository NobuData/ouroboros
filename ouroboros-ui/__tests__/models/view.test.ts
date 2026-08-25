import { describe, expect, it } from "vitest";

import type { ProviderStatus } from "@/app/api/routing";
import {
  MODELS_TABS,
  NEVER_CHECKED,
  NO_KINDS_TO_SIMULATE,
  isLiveTab,
  providerChip,
  providerDetail,
  saveRoutesReason,
  simulateReason,
  utcStamp,
} from "@/app/models/view";
import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";

import { CHECKED_AT, CHECKED_STAMP, provider, seededProviders, unknownProvider } from "../helpers/models";

/**
 * Every decision the `/models` frame makes (#200).
 *
 * The page is a head, a tab set and a health strip, and three of those four things are
 * judgements rather than markup — so this is where the ticket's acceptance criteria are
 * actually met. What the DOM does with these values is
 * `__tests__/models/provider-strip.test.tsx`'s; what they *are* is here, where each one is a
 * function with an input and an output.
 */

/** The four statuses the contract publishes, so no sweep below can miss one. */
const STATUSES: readonly ProviderStatus[] = ["active", "paused", "error", "unknown"];

describe("a chip's treatment", () => {
  it("gives every status the contract publishes a treatment of its own", () => {
    // A status with no entry would render as `undefined` — which, in CSS, is a chip with no
    // tone class at all: the healthy treatment, by accident, on a state nobody measured.
    for (const status of STATUSES) {
      const chip = providerChip(provider({ status }));

      expect(chip.tone, status).toBeDefined();
      expect(chip.state, status).toMatch(/\S/);
    }
  });

  it("never renders an unknown provider as a healthy one", () => {
    // Decision M8, and the ticket's second acceptance criterion. `unknown` differs from
    // `active` in three ways here and **not one of them is a colour**: the tone, the dot's
    // shape, and the word. The stylesheet's half — a dashed border and a ring — is
    // `models-styles.test.ts`'s.
    const healthy = providerChip(provider({ status: "active" }));
    const nothing = providerChip(unknownProvider());

    expect(nothing.tone).toBe("unknown");
    expect(nothing.tone).not.toBe(healthy.tone);
    expect(nothing.dot).toBe("ring");
    expect(healthy.dot).toBe("filled");
    expect(nothing.state).toBe("unknown");
  });

  it("reserves the ring for the one state nobody reported", () => {
    // A ring says *nobody has looked*. Giving it to `error` or `paused` would blur the one
    // distinction the shape exists to carry, and both of those states were reported.
    for (const status of STATUSES) {
      expect(providerChip(provider({ status })).dot, status).toBe(
        status === "unknown" ? "ring" : "filled",
      );
    }
  });

  it("names a failed check `error` rather than the mockup's `degraded`", () => {
    // The correction this ticket makes, and the argument is in `view.ts`: `degraded` is a
    // traffic-derived state AB.2 (#208) introduces, V015 defines `error` as *the last check
    // failed*, and a screen that printed the nicer word would name a state the database does
    // not have.
    expect(providerChip(provider({ status: "error" })).state).toBe("error");
  });

  it("distinguishes an operator's intent from a conclusion about the provider", () => {
    // `paused` is somebody's decision and `error` is a measurement; a strip that drew them
    // alike would report an outage where a switch had been flipped.
    expect(providerChip(provider({ status: "paused" })).tone).toBe("paused");
    expect(providerChip(provider({ status: "error" })).tone).toBe("err");
  });

  it("carries the state in words for every status, so hue is never the only signal", () => {
    // The rule `app/ui/chip.tsx` states for the primitive and this composition inherits: the
    // palettes differ in lightness as much as in hue, and a reader who cannot separate two
    // colours must still be able to separate two states.
    const words = STATUSES.map((status) => providerChip(provider({ status })).state);

    expect(new Set(words).size).toBe(STATUSES.length);
  });
});

describe("what a chip prints", () => {
  it("renders the line the service composed rather than composing a second one", () => {
    // The contract serves `meta` already assembled so that the strip and the route inspector
    // cannot draw two different sentences from one row. Recomposing here would be exactly
    // the second sentence it exists to prevent.
    const chip = providerChip(provider({ latencyMs: 42, meta: "42ms" }));

    expect(chip.meta).toBe("42ms");
  });

  it("prints no latency where the check measured none, and invents no placeholder", () => {
    // The ticket's third acceptance criterion. `0ms` is an excellent latency for a provider
    // nothing has ever called, so absence has to survive as absence — not as a zero, not as
    // an em dash, and not as an empty element.
    const chip = providerChip(provider({ latencyMs: null, meta: null }));

    expect(chip.meta).toBeNull();
    expect(chip.detail).not.toMatch(/\d+ms/);
  });

  it("keeps null and not the empty string, so the screen draws no element at all", () => {
    // An empty `.meta` span has its own colour and spacing, and reads as a bug in the page.
    expect(providerChip(provider({ meta: null })).meta).toBeNull();
  });

  it("draws the seeded strip's five chips from the seeded rows", () => {
    // Mockup 06's strip as the shipped seed and the shipped service actually produce it. Two
    // of the meta lines carry a host the mockup does not draw — `chipMeta` prepends it — and
    // that divergence is upstream of this module; see `__tests__/helpers/models.ts`.
    const chips = seededProviders().map(providerChip);

    expect(chips.map((chip) => [chip.name, chip.tone, chip.meta])).toEqual([
      ["Anthropic Claude", "ok", "42ms"],
      ["Cursor", "ok", null],
      ["GitHub Copilot", "err", "elevated latency"],
      ["OpenAI-compatible · local vLLM", "ok", "10.0.4.20 · vLLM local"],
      ["Ollama · workstation", "ok", "ken-station.local · 3 models · workstation"],
    ]);
  });

  it("keeps the degraded Copilot chip's reason on the chip", () => {
    // The ticket's first acceptance criterion, in the part that survives the correction
    // above: whatever the chip is *called*, it must say why.
    const copilot = seededProviders().find((row) => row.displayName === "GitHub Copilot")!;

    expect(providerChip(copilot).meta).toBe("elevated latency");
  });

  it("draws the name the workspace chose rather than tidying it", () => {
    // Two Ollama daemons on two machines are two legitimate connections, and the name is
    // what tells them apart. A strip that shortened `Ollama · workstation` to `Ollama` to
    // match the mockup would make the two indistinguishable.
    expect(providerChip(provider({ displayName: "Ollama · laptop" })).name).toBe(
      "Ollama · laptop",
    );
  });
});

describe("the hover detail", () => {
  it("says when it was last checked, what was asked, and why", () => {
    expect(
      providerDetail(
        provider({ check: "key_validation", detail: "key rejected (401)", status: "error" }),
      ),
    ).toBe(`Last checked ${CHECKED_STAMP} · key validation · key rejected (401)`);
  });

  it("distinguishes the two questions, because they are different claims", () => {
    // *The socket answered* says nothing about a credential, and *the key is valid* says
    // almost nothing about whether a completion would succeed.
    expect(providerDetail(provider({ check: "reachability" }))).toContain("reachability check");
    expect(providerDetail(provider({ check: "key_validation" }))).toContain("key validation");
  });

  it("says so in words when nothing has ever checked the connection", () => {
    // The reader hovering a ringed dot is asking exactly this, and an empty tooltip answers
    // it with silence.
    expect(providerDetail(unknownProvider())).toBe(NEVER_CHECKED);
  });

  it("is never empty, whatever the row is missing", () => {
    expect(providerDetail(provider({ check: null, checkedAt: null, detail: null }))).toMatch(
      /\S/,
    );
  });

  it("omits the parts that were never measured rather than printing an empty slot", () => {
    expect(providerDetail(provider({ check: null, detail: null }))).toBe(
      `Last checked ${CHECKED_STAMP}`,
    );
  });
});

describe("the timestamp", () => {
  it("is absolute and UTC, so a server render and any later read agree", () => {
    expect(utcStamp(CHECKED_AT)).toBe(CHECKED_STAMP);
  });

  it("normalises an offset rather than slicing the string it was given", () => {
    // `2026-08-24T05:58:12.004-04:00` is the same instant; a formatter that cut the string
    // apart would print the local wall clock and label it UTC.
    expect(utcStamp("2026-08-24T05:58:12.004-04:00")).toBe(CHECKED_STAMP);
  });

  it("treats a value that does not parse as absent rather than throwing", () => {
    // A strip that failed to render because one row carried a malformed date would say
    // nothing about the four providers that are fine.
    expect(utcStamp("not a date")).toBeNull();
    expect(utcStamp(null)).toBeNull();
  });
});

describe("the page head's two actions", () => {
  it("disables Save routes while there are no pending changes", () => {
    // The ticket's fourth acceptance criterion. `reason` is what makes a button inert, so
    // this is both the disabling and its explanation — there is no way to switch a control
    // off in this product without saying what is missing.
    expect(saveRoutesReason(0)).toMatch(/Nothing to save/);
  });

  it("enables it the moment something has been staged", () => {
    // A rule rather than a constant: AA.3 (#202) supplies a figure above zero and the
    // control enables itself, with nothing here to remember to change.
    expect(saveRoutesReason(1)).toBeUndefined();
    expect(saveRoutesReason(8)).toBeUndefined();
  });

  it("disables Simulate routing only while there is no task kind to ask about", () => {
    // The same shape as the save rule since AA.4 (#203) built the panel: a number decides. A
    // workspace with no kinds — unseeded, or a matrix that could not be read — has nothing to
    // simulate, and the control says so rather than opening a panel with an empty select.
    expect(simulateReason(0)).toBe(NO_KINDS_TO_SIMULATE);
    expect(simulateReason(8)).toBeUndefined();
  });
});

describe("the tab set", () => {
  it("names mockup 06's four tabs, in its order", () => {
    expect(MODELS_TABS.map((tab) => tab.label)).toEqual([
      "Routing",
      "Model registry",
      "Providers & keys",
      "Spend",
    ]);
  });

  it("links exactly the three built surfaces", () => {
    // Routing is this roadmap's own; Providers & keys went live with AE.1 (#227) and Model
    // registry with CI.1 (#591), which are the two halves of the amendment AA.1 was filed
    // expecting. A tab becomes a link on the commit that builds its page and on no other — a
    // link without a page behind it is a 404 in the section's own navigation.
    expect(MODELS_TABS.filter(isLiveTab).map((tab) => tab.id)).toEqual([
      "routing",
      "registry",
      "providers",
    ]);
  });

  it("links each built surface to the route the rest of the product knows it by", () => {
    // Asserted against `app/paths.ts`'s constants rather than strings: the sidebar's entry,
    // the routes and these tabs have to name one path each, and a tab that spelled its own
    // would be a fourth copy waiting to be renamed.
    const hrefs = Object.fromEntries(
      MODELS_TABS.filter(isLiveTab).map((tab) => [tab.id, tab.href]),
    );

    expect(hrefs).toEqual({
      routing: MODELS_PATH,
      registry: REGISTRY_PATH,
      providers: PROVIDERS_PATH,
    });
  });

  it("keeps every sub-surface under the Models section", () => {
    // What keeps the sidebar's **Models** entry lit on all three pages: `isActiveRoute`
    // matches a URL under an entry's route, so each tab's destination has to be under
    // `/models`. Swept rather than sampled — a fourth surface added outside the section would
    // put the sidebar's highlight out on the page that needed it most.
    for (const tab of MODELS_TABS.filter(isLiveTab)) {
      if (tab.id === "routing") continue;

      expect(tab.href.startsWith(`${MODELS_PATH}/`), tab.id).toBe(true);
    }
  });

  it("makes the one unbuilt tab name the surface that owns it", () => {
    // Rendering it as a live link that goes nowhere is worse than not rendering it;
    // rendering it as an honest "soon" target tells the reader the shape of the product
    // without lying about its state. Spend is the last of the four, and AB.4 (#210) is what
    // moves it.
    const soon = MODELS_TABS.filter((tab) => !isLiveTab(tab));

    expect(soon.map((tab) => tab.id)).toEqual(["spend"]);

    for (const tab of soon) {
      expect(tab.note, tab.id).toMatch(/arrives with/);
      expect(tab.note, tab.id).toMatch(/mockup \d\d|#\d+/);
    }
  });

  it("has stopped saying the registry is coming, because it is here", () => {
    // The amendment on #200 and #227, from the other side: the tab said `soon` and named
    // #591 until #591 built the page. A note left behind on a live tab is impossible — the
    // two shapes are exclusive — and this is what fails if the tab is ever reverted to one
    // without its page being removed with it.
    const registry = MODELS_TABS.find((tab) => tab.id === "registry");

    expect(registry).toBeDefined();
    expect(registry && isLiveTab(registry)).toBe(true);
  });

  it("gives every tab a distinct id, because the ids are the React keys", () => {
    expect(new Set(MODELS_TABS.map((tab) => tab.id)).size).toBe(MODELS_TABS.length);
  });
});
