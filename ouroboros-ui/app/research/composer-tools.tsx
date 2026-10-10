"use client";

import type { ResearchToolCatalogEntry } from "@/app/api/research";
import { cx } from "@/app/ui";

import {
  CHIP_GLYPH,
  TOOLS_LABEL,
  TOOLS_PREFIX,
  TOOLS_SEAT_HREF,
  chipState,
  idleChipTip,
} from "./composer";

/** What the chips take. */
export interface ToolChipsProps {
  /** Every tool the installation answers to, in the composer's order. */
  readonly tools: readonly ResearchToolCatalogEntry[];
  /** The slugs that are on. */
  readonly on: ReadonlySet<string>;
  /** Told the tool pressed. */
  readonly onToggle: (slug: string) => void;
  /** Whether the chips can act — not while a run is being started. */
  readonly disabled?: boolean;
}

/**
 * Mockup 22's `src-chip` row (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)):
 * one chip per research tool, a toggle for every tool this build has an adapter for, and the
 * **idle** treatment for one it does not — the sixth chip, `Docs, standards & papers`, whose
 * adapter has not shipped.
 *
 * **An idle chip is not a toggle that refuses to turn on.** It is a link to the tools card's
 * seat, where the enable flow lives (#629), and it says so: its tooltip names the tool and
 * where to connect it. A connected chip is a button with `aria-pressed`, the tick its pressed
 * mark and the dot its released one, so the two states differ by more than hue.
 *
 * @param props See {@link ToolChipsProps}.
 * @returns The group.
 */
export function ToolChips({ tools, on, onToggle, disabled = false }: ToolChipsProps) {
  return (
    <div aria-label={TOOLS_LABEL} className="research__tools" role="group">
      <span className="research__tools-label">{TOOLS_PREFIX}</span>
      {tools.map((tool) => {
        const state = chipState(tool, on);
        const glyph = (
          <span aria-hidden="true" className="research__chip-glyph">
            {CHIP_GLYPH[state]}
          </span>
        );

        if (state === "idle") {
          return (
            <a
              className="research__chip research__chip--idle"
              href={TOOLS_SEAT_HREF}
              key={tool.slug}
              title={idleChipTip(tool)}
            >
              {glyph}
              {tool.name}
            </a>
          );
        }

        return (
          <button
            aria-disabled={disabled || undefined}
            aria-pressed={state === "on"}
            className={cx("research__chip", state === "on" && "research__chip--on")}
            key={tool.slug}
            onClick={disabled ? undefined : () => onToggle(tool.slug)}
            type="button"
          >
            {glyph}
            {tool.name}
          </button>
        );
      })}
    </div>
  );
}
