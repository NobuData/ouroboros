import { type SystemState, STATE_LABEL } from "./view";

/**
 * The mockup's status pill, in the three states this screen can report.
 *
 * It is a component rather than a class because two surfaces draw one — the system card's
 * summary in its head, and each dependency row beneath it — and a second copy of the
 * markup is a second place for the dot, the hue and the accessible reading to drift apart.
 *
 * **The dot is not decoration.** Colour alone would leave *operational* and *degraded*
 * indistinguishable to a reader who cannot separate the two hues, so the three states also
 * differ in shape: filled for up, filled for down against a different ground, and a ring
 * for unknown (`dashboard.css`). The label spells it out in words besides.
 *
 * @param props.state What is being reported.
 * @param props.children The pill's text. Defaults to the state's own name, which is what
 *   the summary pill wants; a row passes `up` / `down` instead.
 * @returns The pill.
 */
export function StatusPill({
  state,
  children,
}: Readonly<{ state: SystemState; children?: React.ReactNode }>) {
  return (
    <span className={`dash-pill dash-pill--${state}`}>
      <span className="dash-pill__dot" aria-hidden />
      {children ?? STATE_LABEL[state]}
    </span>
  );
}
