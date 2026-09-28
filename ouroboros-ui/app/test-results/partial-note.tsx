import { Chip } from "@/app/ui";

import { PARTIAL_LABEL } from "./states";

/**
 * What a running build's figures wear ([#342](https://github.com/NobuData/ouroboros/issues/342))
 * — the word *partial*, and the sentence saying what that means.
 *
 * Results arrive as they parse, and partial truth is better than a spinner provided it is
 * labelled: a strip reading `40/63` mid-parse is a count so far, not a verdict. Drawn directly
 * above the strip it qualifies, as a polite status, so a screen reader hears it once.
 *
 * @param props.note The sentence, from `partialNote`.
 * @returns The note.
 */
export function PartialNote({ note }: Readonly<{ note: string }>) {
  return (
    <p className="tests__partial" role="status">
      <Chip dot="pulse" tone="accent">
        {PARTIAL_LABEL}
      </Chip>
      <span className="tests__partial-text">{note}</span>
    </p>
  );
}
