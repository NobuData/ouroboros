import type { WhySegment } from "./card-view";

/**
 * A sentence the service composed, drawn with its code-like stretches in mono (BO.2, BO.3) — a
 * card's why paragraph and a resolved row's line are the same shape, cut by different rules
 * (`whySegments`, `summarySegments`) and drawn by this one component.
 *
 * @param props.segments The sentence, in order.
 * @param props.monoClassName The class a mono stretch wears — the surface's own, so each sheet
 *   sizes it against its own text.
 * @returns The sentence.
 */
export function Segments({
  segments,
  monoClassName,
}: Readonly<{ segments: readonly WhySegment[]; monoClassName: string }>) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.mono ? (
          // The sentence never reorders, so a stretch's place in it is its identity.
          <span className={monoClassName} key={`${String(index)}:${segment.text}`}>
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
