import { cx } from "@/app/ui";

import { type ModelsReadings, type ProviderChip, providerChip } from "./view";

import "./models.css";

/**
 * Mockup 06's `.phealth` strip: one chip per provider connection, above the routing matrix
 * ([#200](https://github.com/NobuData/ouroboros/issues/200), over
 * [#196](https://github.com/NobuData/ouroboros/issues/196)).
 *
 * A Server Component, like everything else on this page. The strip reads stored snapshots
 * that the service's own scheduler writes on a jittered cadence, so there is nothing here to
 * poll and nothing to press — see `app/api/routing.ts` for why a *check now* button is a
 * decision against rather than a feature missing.
 *
 * ### It is a list, because it is a list
 *
 * `<ul>`/`<li>` rather than a row of `<span>`s: five providers and their states are an
 * enumeration, and a screen reader that announces *"list, 5 items"* has told its reader the
 * one thing the visual strip communicates instantly. The list is named, so it is reachable
 * as a region rather than as five loose facts after the tab set.
 *
 * ### Where the state lives
 *
 * Each chip carries its state **in words** as well as in hue, because the light and dark
 * palettes differ in lightness as much as in hue and a reader who cannot separate two
 * colours must still be able to separate two states — the rule `app/ui/chip.tsx` states for
 * the primitive and this composition inherits. The word is visible for every state but the
 * healthy one, where mockup 06 draws a bare `Anthropic ●` and putting *healthy* on four
 * chips out of five would drown the one that is not; there it is `sr-only`, so it is in the
 * accessibility tree either way. The dot is the second non-colour signal: a disc for a state
 * something reported, a **ring** for one nobody has — which is what makes an `unknown` chip
 * tellable from a healthy one at a glance and with no colour at all.
 *
 * ### Two things that are not the same, and do not look the same
 *
 * A workspace with no providers reads successfully and answers an empty strip; a workspace
 * whose strip could not be read has answered nothing. The first is a state the product
 * guides out of (AA.6, [#205](https://github.com/NobuData/ouroboros/issues/205), owns the
 * guidance path), the second is a failure carrying the service's own sentence. Neither is a
 * blank region — `docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3.
 */

/** The strip's accessible name, and what its two absent states are about. */
const LABEL = "Provider health";

/**
 * The strip.
 *
 * @param props.providers The read: every connection in the workspace, or why none could be
 *   listed.
 * @returns The chips, or the one line that says why there are none.
 */
export function ProviderStrip({
  providers,
}: Readonly<{ providers: ModelsReadings["providers"] }>) {
  if (!providers.ok) {
    return (
      <p className="models-health__note models-health__note--failed" role="status">
        <span className="models-health__note-head">{LABEL} could not be read.</span>{" "}
        {providers.reason}
      </p>
    );
  }

  if (providers.value.length === 0) {
    return (
      <p className="models-health__note">
        <span className="models-health__note-head">No providers are connected.</span> Routes
        resolve to aliases, and an alias needs a provider behind it — connecting one arrives
        with Providers &amp; keys (mockup 07).
      </p>
    );
  }

  return (
    <ul aria-label={LABEL} className="models-health">
      {providers.value.map((provider) => (
        <ProviderChipItem chip={providerChip(provider)} key={provider.id} />
      ))}
    </ul>
  );
}

/** The modifier each tone adds. Every tone has one — a chip never falls back to another's. */
const TONE_CLASS: Record<ProviderChip["tone"], string> = {
  ok: "models-health__chip--ok",
  paused: "models-health__chip--paused",
  err: "models-health__chip--err",
  unknown: "models-health__chip--unknown",
};

/**
 * One chip: a dot, a name, the state, and whatever the last check measured.
 *
 * The `title` is the hover detail the issue asks for — when it was last checked, which
 * question was asked, and the reason it is in this state. It is on the chip rather than on
 * the dot so that the whole chip is the hover target, which is what a reader will aim at.
 *
 * @param props.chip The decided chip, from `providerChip()`.
 * @returns The list item.
 */
function ProviderChipItem({ chip }: Readonly<{ chip: ProviderChip }>) {
  return (
    <li className={cx("models-health__chip", TONE_CLASS[chip.tone])} title={chip.detail}>
      {/* Hidden from the accessibility tree: it repeats in shape what the state word beside
          it already says in words. */}
      <span
        aria-hidden
        className={cx(
          "models-health__dot",
          chip.dot === "ring" && "models-health__dot--ring",
        )}
      />
      <span className="models-health__name">{chip.name}</span>
      <span className={cx("models-health__state", chip.tone === "ok" && "sr-only")}>
        {chip.state}
      </span>
      {chip.meta !== null && (
        <>
          {/* The separator is decoration between two facts that are already separate
              elements, so it is kept out of what a screen reader reads. The mockup draws it
              inside the meta string; drawing it here is what lets the state word and the
              measured line be two elements with two colours. */}
          {chip.tone !== "ok" && (
            <span aria-hidden className="models-health__sep">
              ·
            </span>
          )}
          <span className="models-health__meta">{chip.meta}</span>
        </>
      )}
    </li>
  );
}
