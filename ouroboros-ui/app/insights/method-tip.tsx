import { type ReactNode, useId } from "react";

/**
 * A phrase that names how its figure was made in a tooltip
 * (BK.3, [#444](https://github.com/NobuData/ouroboros/issues/444)) — the projection footer's
 * *Projected month*, whose tooltip says the method is linear-to-date.
 *
 * The phrase is a button so a keyboard reaches it, and the method is its accessible
 * **description** (`aria-describedby` on a `role="tooltip"`), so it is announced on focus as
 * well as shown on hover. The bubble is in the DOM at all times and the stylesheet shows it on
 * hover and focus, so there is no state to keep and nothing to close.
 *
 * The rest of the sentence is passed as children and sits between the phrase and the bubble,
 * so a reader reading straight through hears the sentence whole and the method after it.
 *
 * @param props.label The phrase — the button's text.
 * @param props.method The method, in words.
 * @param props.children The rest of the sentence after the phrase.
 * @returns The sentence and its tooltip.
 */
export function MethodTip({
  label,
  method,
  children,
}: Readonly<{ label: string; method: string; children?: ReactNode }>) {
  const tipId = useId();

  return (
    <span className="insights-tip">
      <button aria-describedby={tipId} className="insights-tip__label" type="button">
        {label}
      </button>
      {children}
      <span className="insights-tip__bubble" id={tipId} role="tooltip">
        {method}
      </span>
    </span>
  );
}
