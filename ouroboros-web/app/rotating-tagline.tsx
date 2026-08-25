"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Brand tagline phrasings, cycled in order. Each entry splits into an optional
 *  `lead` and a trailing `em` — the hero paints `em` in the accent color, so the
 *  emphasized words must always come last. A lead-less entry is all accent.
 *  `lang` marks non-English entries so screen readers pronounce them correctly. */
export const PHRASES: { lead?: string; em: string; lang?: string }[] = [
  { lead: "Infinity in", em: "Autonomy" },
  { lead: "Infinitas ", em: "Autonomia", lang: "la" },
  { em: "Ouroboros" },
];

const INTERVAL_MS = 5000;

/** Index into PHRASES plus the index it just replaced, so the outgoing phrase
 *  can scroll away while the incoming one scrolls in. `prev` is -1 until the
 *  first swap — nothing has left the stage yet. */
function useRotatingPhrase() {
  const [state, setState] = useState({ index: 0, prev: -1 });

  useEffect(() => {
    if (PHRASES.length < 2) return;
    const id = setInterval(() => {
      setState(({ index }) => ({ prev: index, index: (index + 1) % PHRASES.length }));
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return state;
}

/** Stacks the outgoing and incoming phrases so both animate at once. Keys force
 *  a remount on every swap, which restarts the CSS animations. */
function Rotator({
  className,
  render,
}: {
  className: string;
  render: (phrase: (typeof PHRASES)[number]) => ReactNode;
}) {
  const { index, prev } = useRotatingPhrase();
  return (
    <span className="phrase-rotate">
      {prev >= 0 && (
        <span
          key={`out-${prev}`}
          className={`${className} is-leaving`}
          lang={PHRASES[prev].lang}
          aria-hidden="true"
        >
          {render(PHRASES[prev])}
        </span>
      )}
      <span key={index} className={className} lang={PHRASES[index].lang}>
        {render(PHRASES[index])}
      </span>
    </span>
  );
}

/** Hero headline. Renders inside the existing `.hero h1`. */
export function RotatingHeadline() {
  return (
    <Rotator
      className="headline-phrase"
      render={(p) => (
        <>
          {p.lead ? `${p.lead} ` : null}
          <em>{p.em}</em>
        </>
      )}
    />
  );
}

/** Footer tagline. */
export default function RotatingTagline() {
  return (
    <div className="tagline">
      <Rotator className="tagline-phrase" render={(p) => (p.lead ? `${p.lead} ${p.em}` : p.em)} />
    </div>
  );
}
