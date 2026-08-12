import { Chip, type ChipDot, type ChipTone } from "@/app/ui";

import { type SystemState, STATE_LABEL } from "./view";

/**
 * What a dependency is reporting, as a chip.
 *
 * It is a component rather than a call to {@link Chip} at each site because two surfaces
 * draw one — the system card's summary in its head, and each dependency row beneath it —
 * and a second mapping from state to hue is a second place for the two to drift apart.
 * Since #46 the chip itself is the primitive; what is left here is exactly the mapping,
 * which is this screen's own.
 *
 * **The dot is not decoration.** Colour alone would leave *operational* and *degraded*
 * indistinguishable to a reader who cannot separate the two hues, so the three states also
 * differ in shape: a filled dot for a state that was reported, a ring for one nobody could
 * report. The label spells it out in words besides.
 *
 * @param props.state What is being reported.
 * @param props.children The chip's text. Defaults to the state's own name, which is what
 *   the summary chip wants; a row passes `up` / `down` instead.
 * @returns The chip.
 */
export function StatusPill({
  state,
  children,
}: Readonly<{ state: SystemState; children?: React.ReactNode }>) {
  return (
    <Chip tone={STATE_TONE[state]} dot={STATE_DOT[state]}>
      {children ?? STATE_LABEL[state]}
    </Chip>
  );
}

/**
 * The hue each state takes.
 *
 * *unknown* is a warning rather than a neutral: a dependency nobody could ask about is a
 * gap in what the screen knows, not a quiet third state.
 */
const STATE_TONE: Record<SystemState, ChipTone> = {
  up: "ok",
  down: "err",
  unknown: "warn",
};

/** The shape each state takes — filled for a reading, a ring for the absence of one. */
const STATE_DOT: Record<SystemState, ChipDot> = {
  up: "filled",
  down: "filled",
  unknown: "ring",
};
