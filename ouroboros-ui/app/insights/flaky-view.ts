/**
 * Every decision the flaky-tests card makes, and every sentence it says
 * (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)).
 *
 * Mockup 15's **FLAKY TESTS** card is AT.3's ([#331](https://github.com/NobuData/ouroboros/issues/331))
 * states as BJ.2 serves them (`InsightsFlaky`): one row per case — a mono path, a state pill, a
 * sparkline of the case's real daily flake rate, the rate itself, and a context line — and
 * under them the way out, *Open playbook: Flaky test hunt →*.
 *
 * **Framework-free and pure**, the way `app/insights/view.ts` is.
 *
 * ### The card's value is its links
 *
 * - *fixed by loop #1847* is the run whose tests first passed cleanly after the case's last flaky
 *   occurrence — `resolvedBy`, which the service sends only when an occurrence names a loop. It
 *   links to that run's console. Without it the line says the case is healthy again and links
 *   nothing: a loop number nobody measured would be a fabricated citation.
 * - *rising on hil-rig-02* names the rig only when **every** flaky occurrence ran on it — the
 *   service's `platform`, absent otherwise — so this never guesses a machine. A `rig:` platform
 *   links to the build farm's runner list; any other platform is drawn as words.
 * - *Open playbook →* links the workspace's real *Flaky test hunt* recipe (BF.6,
 *   [#415](https://github.com/NobuData/ouroboros/issues/415)) when there is one, and says plainly
 *   that there is none when there is not.
 */

import type { InsightsFlaky, InsightsFlakyCase, InsightsRange } from "@/app/api/insights";
import type { Playbook } from "@/app/api/playbooks";
import { percentOf } from "@/app/format";
import { PLAYBOOKS_REGION_ID } from "@/app/knowledge/view";
import { BUILD_FARM_PATH, FARM_RUNNERS_HASH, KNOWLEDGE_PATH, playbookPath, runPath } from "@/app/paths";
import { INSIGHTS_ORIGIN } from "@/app/runs/origin";
import type { ChipTone } from "@/app/ui";

import type { SeriesEmpty } from "./series-view";
import { NOT_MEASURED } from "./view";

/** The card's heading, from the mockup. */
export const FLAKY_TITLE = "Flaky tests";

/** The card's empty state — a range with nothing distrusted is good news, said so. */
export const NO_FLAKY: SeriesEmpty = {
  title: "No flaky tests in this range",
  note: "A test that passes and fails on the same code lands here, with its history and state.",
};

/**
 * How many rows the card draws. The payload lists every case still distrusted and every case
 * fixed in the window, highest flake score first; a third-width card shows the worst of them and
 * says how many more there are.
 */
export const FLAKY_ROWS = 5;

/** The prefix the flakes plane gives a platform that is a farm rig — `rig:hil-rig-02`. */
export const RIG_PREFIX = "rig:";

/** What each state's pill says and how it is toned — mockup 15's `ok`, `warn` and plain pills. */
export const FLAKY_STATES: Readonly<Record<InsightsFlakyCase["state"], { label: string; tone: ChipTone }>> = {
  fixed: { label: "fixed", tone: "ok" },
  quarantined: { label: "quarantined", tone: "warn" },
  watching: { label: "watching", tone: "neutral" },
};

/** The trend, as the context line says it. */
const TREND_WORDS: Readonly<Record<InsightsFlakyCase["trend"], string>> = {
  rising: "rising",
  falling: "falling",
  flat: "steady",
};

/** A `watching` case is below AT.3's quarantine threshold by definition — the mockup's words. */
export const UNDER_THRESHOLD = "under threshold";

/** A `fixed` case no occurrence attributes to a loop — healthy again, nothing cited. */
export const BACK_TO_HEALTHY = "healthy again";

/** One piece of a context line: words, or words that link somewhere. */
export interface ContextPart {
  /** What it says. */
  readonly text: string;
  /** Where it goes, or `undefined` for plain words. */
  readonly href?: string;
}

/** One drawn row. */
export interface FlakyRowView {
  /** The case's stable key — the React key. */
  readonly key: string;
  /** The mono path. */
  readonly name: string;
  /** Where the case lives — `telemetry integration · acme/helios-firmware` — the path's tooltip. */
  readonly where: string;
  /** The pill. */
  readonly state: { readonly label: string; readonly tone: ChipTone };
  /** The rate over the window — `4.1%` — or the em dash when the case did not run. */
  readonly rate: string;
  /** Whether the rate is drawn in the warning hue — a quarantined case. */
  readonly rateWarn: boolean;
  /** The sparkline's values, oldest first; a day the case did not run is a zero-height bar. */
  readonly history: readonly number[];
  /** Whether the sparkline recedes — a fixed case. */
  readonly dim: boolean;
  /** The context line, in parts. */
  readonly context: readonly ContextPart[];
  /** The row in one sentence, for a screen reader — the sparkline is decoration. */
  readonly summary: string;
}

/** The workspace's flaky-test recipe, as much of it as the link needs. */
export interface FlakyPlaybook {
  /** The playbook's id. */
  readonly id: string;
  /** Its name — `Flaky test hunt`. */
  readonly name: string;
}

/** What the playbook line draws. */
export type PlaybookLink =
  /** The recipe exists: a link to it. */
  | { readonly kind: "link"; readonly label: string; readonly href: string }
  /** It does not: a sentence saying so, and where recipes are made. */
  | { readonly kind: "absent"; readonly note: string; readonly label: string; readonly href: string };

/** What the card draws. */
export interface FlakyView {
  /** The tag — the window. */
  readonly tag: string;
  /** The rows, at most {@link FLAKY_ROWS}. */
  readonly rows: readonly FlakyRowView[];
  /** `Showing the worst 5 of 12.`, or `null` when every case is drawn. */
  readonly more: string | null;
  /** What to draw instead of rows, or `null` when there are some. */
  readonly empty: SeriesEmpty | null;
}

/**
 * The name mockup 14 seeds and mockup 15 links — matched case-blind and trimmed, since names are
 * unique per workspace (`playbooks_organization_name_key`) but typed by people.
 */
export const FLAKY_PLAYBOOK_NAME = "Flaky test hunt";

/**
 * Find the workspace's flaky-test recipe.
 *
 * @param items Every playbook of the workspace.
 * @returns The one named {@link FLAKY_PLAYBOOK_NAME}, or `null` when there is none.
 */
export function flakyPlaybookOf(items: readonly Playbook[]): FlakyPlaybook | null {
  const wanted = FLAKY_PLAYBOOK_NAME.toLowerCase();
  const found = items.find((playbook) => playbook.name.trim().toLowerCase() === wanted);

  return found === undefined ? null : { id: found.id, name: found.name };
}

/** Said when the workspace has no flaky-test recipe. */
export const NO_PLAYBOOK = `No “${FLAKY_PLAYBOOK_NAME}” playbook in this workspace yet.`;

/** The link beside {@link NO_PLAYBOOK} — where recipes are made. */
export const PLAYBOOKS_LINK = "Playbooks →";

/** The Knowledge page's playbooks card — the seat `app/knowledge/view.ts` names. */
export const PLAYBOOKS_HREF = `${KNOWLEDGE_PATH}#${PLAYBOOKS_REGION_ID}`;

/**
 * The playbook line.
 *
 * @param playbook The recipe, `null` when there is none, or `undefined` when the playbooks could
 *   not be read — then nothing is drawn, since neither *here it is* nor *there is none* is known.
 * @returns What to draw, or `null` for nothing.
 */
export function playbookLink(playbook: FlakyPlaybook | null | undefined): PlaybookLink | null {
  if (playbook === undefined) return null;
  if (playbook === null) return { kind: "absent", note: NO_PLAYBOOK, label: PLAYBOOKS_LINK, href: PLAYBOOKS_HREF };

  return { kind: "link", label: `Open playbook: ${playbook.name} →`, href: playbookPath(playbook.id) };
}

/**
 * Where a platform resolves to.
 *
 * @param platform The one platform every flaky occurrence ran on — `rig:hil-rig-02`.
 * @returns The rig's name linked to the farm's runner list, or the platform as plain words.
 */
export function platformPart(platform: string): ContextPart {
  if (!platform.startsWith(RIG_PREFIX)) return { text: platform };

  return { text: platform.slice(RIG_PREFIX.length), href: `${BUILD_FARM_PATH}#${FARM_RUNNERS_HASH}` };
}

/**
 * The context line under a row.
 *
 * @param flaky The case.
 * @returns `fixed by loop #1847` (linked), `rising on hil-rig-02` (rig linked), or
 *   `under threshold`.
 */
export function flakyContext(flaky: InsightsFlakyCase): ContextPart[] {
  if (flaky.state === "fixed") {
    return flaky.resolvedBy === undefined
      ? [{ text: BACK_TO_HEALTHY }]
      : [
          { text: "fixed by " },
          {
            text: `loop #${flaky.resolvedBy.issueNumber}`,
            href: runPath(flaky.resolvedBy.runId, INSIGHTS_ORIGIN.id),
          },
        ];
  }

  const lead = flaky.state === "watching" ? UNDER_THRESHOLD : TREND_WORDS[flaky.trend];

  return flaky.platform === undefined ? [{ text: lead }] : [{ text: `${lead} on ` }, platformPart(flaky.platform)];
}

/**
 * One row.
 *
 * @param flaky The case.
 * @returns What the row draws.
 */
export function flakyRow(flaky: InsightsFlakyCase): FlakyRowView {
  const state = FLAKY_STATES[flaky.state];
  const rate = flaky.ratePct === null ? NOT_MEASURED : percentOf(flaky.ratePct / 100);
  const context = flakyContext(flaky);
  const name = flaky.name ?? flaky.caseKey;

  return {
    key: `${flaky.repository}:${flaky.caseKey}`,
    name,
    where: [flaky.suite, flaky.repository].filter((part): part is string => part !== null).join(" · "),
    state,
    rate,
    rateWarn: flaky.state === "quarantined",
    history: flaky.history.map((day) => day.ratePct ?? 0),
    dim: flaky.state === "fixed",
    context,
    summary: `${name}, ${state.label}, ${rate === NOT_MEASURED ? "did not run" : `${rate} flaky`}, ${context.map((part) => part.text).join("")}`,
  };
}

/**
 * The card.
 *
 * @param flaky BJ.2's flaky card.
 * @param range The page's range — the tag.
 * @returns What the card draws.
 */
export function flakyView(flaky: InsightsFlaky, range: InsightsRange): FlakyView {
  const total = flaky.cases.length;

  return {
    tag: `${range} window`,
    rows: flaky.cases.slice(0, FLAKY_ROWS).map(flakyRow),
    more: total > FLAKY_ROWS ? `Showing the worst ${FLAKY_ROWS} of ${total}.` : null,
    empty: total === 0 ? NO_FLAKY : null,
  };
}
