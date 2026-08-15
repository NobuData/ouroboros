import Image from "next/image";

import type { Dashboard } from "@/app/api/dashboard";
import { type Membership, mayAdminister } from "@/app/api/membership";
import { Card, CardHead, Meter, Tag, cx } from "@/app/ui";

import { AUTO_MERGE_LABEL, AutoMergeSwitch } from "./auto-merge-switch";
import { NO_VALUE, PULSE_UNMEASURED, type Reading, pulseIsUnmeasured, pulseMeters } from "./view";

/**
 * *Loop pulse* ([#83](https://github.com/NobuData/ouroboros/issues/83)) — the mockup's `c-4`
 * card: the qualitative read on the loop, and the one control on this page that changes what
 * the loop does.
 *
 * Everything above it on the grid counts things. This card is about *how well* — how often
 * the loop finishes without a person, how long a cycle takes, how often it stops for one —
 * and it is the only card whose bars are ratios against denominators this product chose
 * rather than figures the service reports. Those two denominators are written down and
 * exported (`app/dashboard/view.ts`: `CYCLE_TIME_TARGET_SECONDS`, `INTERVENTION_BUDGET_7D`),
 * because a bar whose width nobody can explain is a bar nobody can check.
 *
 * ### The glyph is the asset, not an effect
 *
 * The mockup hangs `mix-blend-mode: screen` and a 24px `drop-shadow` on its mark, and the two
 * are one workaround rather than two effects: that crop still had its ground attached, so it
 * had to be blended onto the card and then given back the halo the blend flattened. The #14
 * pair is de-grounded and carries its own glow in the artwork, and `docs/BRAND.md` § Rules
 * bans both tricks on it by name. So this places the picture and paints nothing over it —
 * which is also what makes it correct on a *light* card, where a screen blend would have
 * erased the mark entirely.
 *
 * Both treatments are laid out at all times and CSS chooses between them
 * (`dashboard.css`), exactly as the shell's header mark and the login lockup do: the right
 * one is painted before any JavaScript runs, and neither can move the card.
 *
 * ### Three meters, two windows
 *
 * The head's tag says `7 days`, as the mockup draws it, and the merge rate is **not**
 * measured over seven — the contract publishes it as fourteen, because the mockup's own
 * figures cannot all be true of one window. So every row prints the window it was measured
 * over beside its caption rather than inheriting the tag, which is what the roadmap asks
 * this card for by name.
 *
 * @param props.aggregate The dashboard aggregate, or why it could not be read.
 * @param props.workspace The active workspace, for the roles that decide whether the switch
 *   is a control or an indicator.
 * @returns The card.
 */
export function PulseCard({
  aggregate,
  workspace,
}: Readonly<{ aggregate: Reading<Dashboard>; workspace: Membership }>) {
  // Narrowed once rather than at each branch, which is what lets every part of this card
  // answer the same question — *was it read* — the same way.
  const pulse = aggregate.ok ? aggregate.value.pulse : null;

  return (
    <Card as="section" fill className="dash-col--4" aria-labelledby={TITLE_ID}>
      <CardHead title={TITLE} titleId={TITLE_ID} trailing={<Tag>{PULSE_WINDOW_TAG}</Tag>} />

      <div className="dash-pulse">
        <span className="dash-pulse__glyph">
          {/*
            One picture drawn twice, and decorative both times: the card is already named
            *Loop pulse*, and a mark announced inside it would be describing the technique
            rather than the page. The login screen's lockup carries alt text because there
            the brand *is* the content.
          */}
          <Image
            className="dash-pulse__mark dash-pulse__mark--light"
            src="/brand/glyph-light.png"
            alt=""
            width={GLYPH.width}
            height={GLYPH.height}
          />
          <Image
            className="dash-pulse__mark dash-pulse__mark--dark"
            src="/brand/glyph-dark.png"
            alt=""
            width={GLYPH.width}
            height={GLYPH.height}
          />
        </span>

        {pulse === null ? (
          <p className="dash-pulse__note dash-pulse__note--err">{PULSE_NOT_READ}</p>
        ) : (
          <>
            <div className="dash-pulse__meters">
              {pulseMeters(pulse).map((meter) => (
                <div className="dash-pulse__meter" key={meter.id}>
                  <div className="dash-pulse__row">
                    <span className="dash-pulse__label">
                      {meter.label}
                      {/* The window this row was measured over — never the head's tag. */}
                      <span className="dash-pulse__window">{meter.window}</span>
                    </span>
                    <span
                      className={cx("dash-pulse__value", `dash-pulse__value--${meter.tone}`)}
                      // Hidden from the accessibility tree, because the bar under it is
                      // announced with this figure in words. Announcing both would read the
                      // same measurement twice — the inverse of the active-loops table,
                      // where the caption speaks and the bar is decoration.
                      aria-hidden
                    >
                      {meter.value}
                    </span>
                  </div>
                  <Meter
                    value={meter.fill}
                    tone={meter.tone}
                    label={meter.label}
                    valueText={meter.valueText}
                  />
                </div>
              ))}
            </div>

            {pulseIsUnmeasured(pulse) && (
              <p className="dash-pulse__note">{PULSE_UNMEASURED}</p>
            )}
          </>
        )}

        <hr className="dash-pulse__divider" />

        {pulse === null ? (
          // The switch's position is the aggregate's, so an aggregate nobody could read has
          // no position to draw. A switch defaulted to `off` here would be this card
          // inventing the one fact on the page that changes what the loop does — so the row
          // keeps its place, says it could not be read, and offers nothing to press.
          <div className="dash-pulse__control">
            <div className="dash-pulse__switch">
              <span className="dash-pulse__switch-label">{AUTO_MERGE_LABEL}</span>
              {/*
                Announced, unlike the figures above it: those are each spoken by the bar
                under them, and this em dash is the only statement there is that the
                setting's position was not read.
              */}
              <span className="dash-pulse__value">{NO_VALUE}</span>
            </div>
          </div>
        ) : (
          <AutoMergeSwitch
            enabled={pulse.autoMerge}
            canAdminister={mayAdminister(workspace.roles)}
          />
        )}
      </div>
    </Card>
  );
}

/** What the card is called, as the mockup titles it. */
const TITLE = "Loop pulse";

/**
 * What the card says when the aggregate was refused.
 *
 * It names *what* could not be read and stops there. **Why** is the page banner's, once
 * (`app/dashboard/stale-banner.tsx`) — before
 * [#86](https://github.com/NobuData/ouroboros/issues/86) the service's sentence was repeated
 * here and in eight other places on one page, which reads as nine problems rather than one
 * and buries the single retry that would fix them.
 */
const PULSE_NOT_READ = "The pulse could not be read.";

/** The id the card's `aria-labelledby` points at. */
const TITLE_ID = "dash-pulse-title";

/**
 * The mockup's head tag.
 *
 * It describes the card's default window, which two of the three meters are measured over.
 * The third says so itself — see this file's header — rather than this tag being widened to
 * a range that would be wrong for all three.
 */
const PULSE_WINDOW_TAG = "7 days";

/**
 * The glyph's intrinsic size (`docs/brand/glyph-*.png`).
 *
 * Passed to `next/image` so the box is reserved before the file arrives; the size it is
 * *drawn* at is the sheet's, which is how it stays a fraction of the card rather than a
 * fixed number of pixels beside type that scales.
 */
const GLYPH = { width: 512, height: 296 } as const;
