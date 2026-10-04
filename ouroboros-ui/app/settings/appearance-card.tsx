"use client";

import { useId, useState } from "react";

import { type FontScale, setFontScale } from "@/app/font-scale";
import { saveFontScale } from "@/app/shell/preference-actions";
import { parseTheme, resolveTheme } from "@/app/theme";
import { useTheme } from "@/app/theme-provider";
import { Card, CardHead, SelectField, Tag } from "@/app/ui";
import { useFontScale } from "@/app/use-font-scale";

import {
  APPEARANCE_TAG,
  FONT_SIZE_HINT,
  FONT_SIZE_LABEL,
  FONT_SIZE_STEPS,
  PREVIEW_CODE,
  PREVIEW_LABEL,
  PREVIEW_SENTENCE,
  THEME_HINT,
  THEME_LABEL,
  THEME_OPTIONS,
  fontSizeAnnouncement,
  fontSizeLabel,
  themeAnnouncement,
} from "./appearance";
import { sectionTitleId, settingsSection } from "./view";

import "./settings.css";

/**
 * The Appearance card — mockup 17's theme choice, full font-size control and preview
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491); the App Shell roadmap's
 * amendment, CQ.2 [#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * ### It holds no state of its own
 *
 * The font size is `useFontScale()`'s — the store #649 built, which the profile menu's stepper
 * (CP.3, #645) reads and writes too. That is the whole of how the two controls stay in sync
 * without a reload: neither holds the value, so a step taken in one is the other's next
 * render. The theme is the #17 engine's, through `useTheme()`, exactly as the menu's radios
 * are.
 *
 * ### Everything here applies at once, and none of it is the workspace's
 *
 * These are the reader's own display preferences, not settings of the workspace: a step is
 * live the moment it is pressed — the press *is* the preview — and persisted quietly behind
 * it, as the menu does it. So under the page's save model (decision S7) the section is
 * immediate (`app/settings/view.ts`), nothing in it can be *unsaved*, and **Save changes**
 * never sends it. No confirmation either: nothing here has a consequence for anybody else, and
 * the way back is the neighbouring segment.
 *
 * It follows that the card is the same for every role. A viewer may not change a workspace,
 * and may certainly choose how large their own text is.
 *
 * @returns The card.
 */
export function AppearanceCard() {
  const section = settingsSection("appearance");
  const titleId = sectionTitleId(section.id);
  const base = useId();
  const sizeLabelId = `${base}-size`;
  const sizeHintId = `${base}-size-hint`;
  const previewLabelId = `${base}-preview`;

  const scale = useFontScale();
  const { theme, setTheme } = useTheme();
  /** What a screen reader is told about the last change — the only report it gets of one. */
  const [announcement, setAnnouncement] = useState("");

  /**
   * Take a font-size step, live, then make it durable.
   *
   * @param next The step pressed.
   */
  function pickScale(next: FontScale): void {
    if (next === scale) return;

    setFontScale(next);
    setAnnouncement(fontSizeAnnouncement(next));
    // Quietly: the reader is already reading at the size they chose, and a failed write must
    // not take that away or interrupt it.
    void saveFontScale(next);
  }

  /**
   * Choose a theme, through the #17 engine.
   *
   * @param value The select's value.
   */
  function pickTheme(value: string): void {
    const next = parseTheme(value);

    setTheme(next);
    // resolveTheme rather than the hook's `resolved`, which still describes the palette being
    // left behind: this render happens before the state change is applied.
    setAnnouncement(themeAnnouncement(next, resolveTheme(next)));
  }

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        title={section.title}
        titleId={titleId}
        trailing={<Tag>{APPEARANCE_TAG}</Tag>}
      />

      <p className="sr-only" role="status">
        {announcement}
      </p>

      <div className="settings-appearance">
        <SelectField
          className="settings-appearance__theme"
          hint={THEME_HINT}
          id={`${base}-theme`}
          label={THEME_LABEL}
          onChange={(event) => {
            pickTheme(event.target.value);
          }}
          value={theme}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>

        {/* The field anatomy of `app/ui/field.tsx` — label, control, hint — around a control
            that is a group of buttons rather than an input, so it cannot be a `<label for>`. */}
        <div className="ou-field">
          <span className="ou-field__label" id={sizeLabelId}>
            {FONT_SIZE_LABEL}
          </span>
          <div
            aria-describedby={sizeHintId}
            aria-labelledby={sizeLabelId}
            className="settings-appearance__steps"
            role="group"
          >
            {FONT_SIZE_STEPS.map((step) => (
              <button
                aria-pressed={step === scale}
                className="settings-appearance__step"
                key={step}
                onClick={() => {
                  pickScale(step);
                }}
                type="button"
              >
                {fontSizeLabel(step)}
              </button>
            ))}
          </div>
          <p className="ou-field__hint" id={sizeHintId}>
            {FONT_SIZE_HINT}
          </p>
        </div>

        <div className="ou-field settings-appearance__preview-field">
          <span className="ou-field__label" id={previewLabelId}>
            {PREVIEW_LABEL}
          </span>
          <p aria-labelledby={previewLabelId} className="settings-appearance__preview" role="note">
            {PREVIEW_SENTENCE} <span className="settings-appearance__code">{PREVIEW_CODE}</span>
          </p>
        </div>
      </div>
    </Card>
  );
}
