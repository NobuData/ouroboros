/**
 * The breakdown's geometry with nothing in it yet — what the detail panel draws while the
 * estimator is working, and while an opened row's detail is on its way
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * **Every bar is the breakdown's own shape, not a generic stack** (the dashboard's rule, #86):
 * the file list's caption, the three `.breakdown-row` lines and the risk meter, at the heights
 * the real ones take, so the panel does not jump when the estimate lands. It is hidden from
 * the accessibility tree: the sentence above it says what is happening, once, and a screen
 * reader is not read five empty bars. It pulses only for a reader who has not asked for less
 * motion — the sheet's guard, not this component's.
 *
 * @returns The bars.
 */
export function PanelSkeleton() {
  return (
    <div aria-hidden className="issues-panel__skeleton">
      <span className="issues-panel__skeleton-bar issues-panel__skeleton-bar--caption" />
      <span className="issues-panel__skeleton-bar issues-panel__skeleton-bar--row" />
      <span className="issues-panel__skeleton-bar issues-panel__skeleton-bar--row" />
      <span className="issues-panel__skeleton-bar issues-panel__skeleton-bar--row" />
      <span className="issues-panel__skeleton-bar issues-panel__skeleton-bar--meter" />
    </div>
  );
}
