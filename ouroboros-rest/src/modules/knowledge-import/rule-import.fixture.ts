/**
 * Fixture rules files for the import's goldens and service suite
 * ([#413](https://github.com/NobuData/ouroboros/issues/413)) — the roadmap's
 * `import(helios-firmware): CLAUDE.md(3 sections) + .cursorrules(12 bullets)`.
 */

import type { ImportBaseline } from "./rule-import.plan";

/** The repository the fixtures belong to. */
export const IMPORT_REPO = "acme-robotics/helios-firmware";

/**
 * A `CLAUDE.md` with a title, a preamble, and three `##` sections — one holding a `###` subsection
 * and one a fenced block whose `-` lines and `#` line are code, not rules.
 */
export const CLAUDE_MD = [
  "# Helios firmware",
  "",
  "Guidance for agents working in this repository.",
  "",
  "- Run `west update` before the first build of the day.",
  "",
  "## Kconfig",
  "",
  "Every feature is gated behind a **Kconfig** symbol,",
  "declared in the module that owns it.",
  "",
  "- Use `CONFIG_HELIOS_` as the prefix for every new symbol.",
  "- Never enable `CONFIG_ASSERT` in release builds.",
  "",
  "## Devicetree",
  "",
  "- Board overlays:",
  "  - Keep one overlay per board under `boards/`.",
  "",
  "```sh",
  "# west build -b nrf52840dk",
  "- use this line as code, not a rule",
  "```",
  "",
  "## ISR safety",
  "",
  "Interrupt handlers must never block.",
  "",
  "- Prefer `k_msgq` over `k_fifo` in ISR paths.",
  "- Avoid `printk` inside an ISR;",
  "  defer logging to a work queue.",
  "- ISR stacks are 2 KiB on every board.",
  "",
  "### Checklist",
  "",
  "1. Check `k_is_in_isr()` before sleeping.",
  "",
].join("\n");

/**
 * A `.cursorrules` with no headings and twelve bullets: eight imperative rules (two repeating
 * `CLAUDE.md`'s in other words' case and punctuation), four that are not rules.
 */
export const CURSORRULES = [
  "You are an expert embedded C engineer working on Zephyr RTOS.",
  "",
  "- use CONFIG_HELIOS_ as the prefix for every new symbol",
  "- Never enable `CONFIG_ASSERT` in release builds!",
  "- Write unit tests with ztest for every driver change.",
  "- Keep functions under 60 lines.",
  "- Don't allocate from the heap in drivers.",
  "- Always run `twister -T tests/` before pushing.",
  "- Document every public API in its header.",
  "- Name threads after their subsystem.",
  "- The HAL lives in `drivers/hal/`.",
  "- Style:",
  "- Tests are in `tests/`.",
  "- " + "Use a very long sentence ".repeat(10).trim() + ".",
  "",
].join("\n");

/**
 * An empty workspace — nothing to dedupe against, no slug taken.
 *
 * @param overrides - Fields to replace.
 * @returns The baseline.
 */
export function emptyBaseline(overrides: Partial<ImportBaseline> = {}): ImportBaseline {
  return { slugs: new Set(), importedSkills: [], factTexts: new Set(), ...overrides };
}
