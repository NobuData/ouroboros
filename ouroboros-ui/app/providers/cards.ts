/**
 * Every decision the provider card makes, as functions with inputs and outputs
 * ([#228](https://github.com/NobuData/ouroboros/issues/228)).
 *
 * The card (`app/providers/provider-card.tsx`) draws; this module decides. Framework-free
 * and pure, the way `app/providers/catalog.ts` and `app/models/spend.ts` are, so every
 * acceptance criterion that is a *judgement* — which row a key takes, what a meter reads, when
 * a pill is allowed to exist — is a unit test on a small value rather than an assertion about
 * rendered text.
 *
 * ---------------------------------------------------------------------------
 * ### The rule this module exists to keep: nothing branches on `kind`
 *
 * Five cards look like five components, and written that way they drift apart by the second
 * sprint. So the card is **composed from the adapter's own answers**, which cross the wire on
 * the catalog entry: the entry's `fields` decide the key row — a `url` field is an address row
 * under the label the adapter gave it (*Base URL*, *Host*), a `secret` field is the masked key
 * row — and `capabilities.pull` decides whether the models region is chips or Ollama's
 * pull-list. Whether a cap exists decides between a meter and an em-dash. {@link cardModel} is
 * total over any connection and any entry, and `__tests__/providers/provider-card.test.tsx`
 * proves it with a sixth kind no file here names: the conformance kit's fake adapter, which
 * must render a correct card with zero changes to card code.
 *
 * {@link MONOGRAMS} is the one place a kind is written down, and it is *copy*: two letters
 * and a tint per kind the mockup draws, with a fallback for any other. It decides nothing
 * about the card's anatomy, the same way `catalog.ts`'s `KIND_LABELS` decides nothing.
 *
 * ---------------------------------------------------------------------------
 * ### The honesty rules, per region (roadmap decision **P8**)
 *
 * - **The meter prints priced spend only.** A cloud kind whose calls nobody priced reads
 *   *unpriced*, never `$0.00`. A local kind reads *no metered spend* beside its on-box
 *   tokens, because `$0.00` and *we do not meter this* are different facts and only the
 *   second is true of a machine the workspace already owns. A null cap is an em-dash, not `$0`.
 * - **The `priority tier` pill exists only on a real signal** — a `tier` discovery actually
 *   reported on a model — and the `· 4 seats` suffix only on a count a check actually
 *   returned. Both are read, never assumed; {@link seatsIn} is the reader half of the
 *   service's `provider.entitlements.ts`, spelled identically so a count written there is the
 *   count read here.
 * - **A connection never used shows an em-dash for last-used**, not a stamp borrowed from
 *   somewhere else.
 *
 * ### The meter is decided twice, from one function
 *
 * Since AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232)) the cap is editable,
 * and the meter has to move the moment it is — before the route has re-read. So the model
 * carries the meter's **inputs** ({@link SpendInputs}) rather than a decided line, and
 * {@link meterFor} is called wherever the line is drawn: on the server for the first paint,
 * and again in `app/providers/cap-field.tsx` with the cap the reader just typed. One pure
 * function, so the two cannot disagree.
 */

import type {
  ModelAlias,
  ModelPull,
  ProviderErrorClass,
  ProviderModel,
  ProviderModels,
  UnlistedModel,
  ProviderCatalogEntry,
  ProviderConnection,
  ProviderMonthlySpendRow,
} from "@/app/api/providers";
import type { Reading } from "@/app/api/reading";
import type { ProviderHealth } from "@/app/api/routing";
import { compactNumber, durationOfMinutes, moneyOfCents } from "@/app/format";
import type { ChipDot, ChipTone, MeterTone } from "@/app/ui";

import { BASE_URL_FIELD, monogramOf } from "./catalog";
import { NOBODY } from "./view";

/* ------------------------------------------------------------------------- the monogram */

/** Which of the token sheet's hues a monogram is tinted in. */
export type MonogramTint =
  /** The model-routing purple — the mockup's `AN`. */
  | "model"
  /** The brand accent — the mockup's `CU`. */
  | "accent"
  /** The warn hue — the mockup's `GH`. */
  | "warn"
  /** The ok hue — the mockup's `VL`. */
  | "ok"
  /** Muted ink on the raised plane — the mockup's `OL`, and every kind the mockup does not draw. */
  | "neutral";

/** The square at the head of a card: two letters, and a tint. */
export interface Monogram {
  readonly letters: string;
  readonly tint: MonogramTint;
}

/**
 * The five treatments mockup 07 draws, by kind.
 *
 * Copy, not behaviour — see this file's header. The letters are the mockup's own (`VL` for
 * the vLLM card, which is the OpenAI-compatible kind), and a kind not here is drawn from its
 * own name in the neutral tint by {@link monogramFor}, which is how the sixth adapter gets a
 * monogram nobody wrote for it.
 */
export const MONOGRAMS: Readonly<Partial<Record<string, Monogram>>> = {
  anthropic: { letters: "AN", tint: "model" },
  cursor: { letters: "CU", tint: "accent" },
  copilot: { letters: "GH", tint: "warn" },
  openai_compatible: { letters: "VL", tint: "ok" },
  ollama: { letters: "OL", tint: "neutral" },
};

/**
 * The monogram for a connection.
 *
 * @param kind The connection's kind.
 * @param displayName Its heading — what the letters are derived from for a kind the mockup
 *   does not draw, so two unknown kinds are tellable apart by their names rather than both
 *   reading `CU`.
 * @returns The letters and the tint.
 */
export function monogramFor(kind: string, displayName: string): Monogram {
  return MONOGRAMS[kind] ?? { letters: monogramOf(displayName), tint: "neutral" };
}

/* ---------------------------------------------------------------------- the status pill */

/** The pill beside the name: a word, a hue, and a shape. */
export interface StatusPill {
  /** What the pill says — always present, so hue is never the only signal. */
  readonly label: string;
  readonly tone: ChipTone;
  /** Filled for a state something reported; a ring for one nobody has. */
  readonly dot: ChipDot;
}

/**
 * The pill each stored status earns.
 *
 * `connected` is the taxonomy's own word for a check that passed (`provider.errors.ts`'s
 * `CONNECTED_PILL`), verbatim. The other three are the health strip's words for the same
 * statuses (`app/models/view.ts`), so a person looking at mockups 06 and 07 does not have to
 * learn that two words mean one thing. `unknown` is a ring in the warn hue and never drawn
 * as healthy.
 */
const PILLS: Readonly<Record<ProviderConnection["status"], StatusPill>> = {
  active: { label: "connected", tone: "ok", dot: "filled" },
  paused: { label: "paused", tone: "neutral", dot: "filled" },
  error: { label: "error", tone: "err", dot: "filled" },
  unknown: { label: "unknown", tone: "warn", dot: "ring" },
};

/**
 * The taxonomy's finer pills — `provider.errors.ts`'s `PROVIDER_ERROR_PILLS`, verbatim.
 *
 * Five classes, five distinct pills, the mapping 1:1 in both directions as the service
 * asserts of its own table. They are drawn from the error class the health snapshot carries
 * since AE.4's ([#230](https://github.com/NobuData/ouroboros/issues/230)) live test wrote
 * one, and only beside an `error` status: a class the sweep has since cleared draws the
 * coarse pill again, which is the honest reading of a measurement nobody has repeated.
 */
const ERROR_PILLS: Readonly<Record<ProviderErrorClass, StatusPill>> = {
  auth: { label: "key rejected", tone: "err", dot: "filled" },
  network: { label: "unreachable", tone: "err", dot: "filled" },
  upstream: { label: "degraded upstream", tone: "warn", dot: "filled" },
  rate_limit: { label: "rate limited", tone: "warn", dot: "filled" },
  config: { label: "needs configuration", tone: "err", dot: "filled" },
};

/**
 * The pill for a connection.
 *
 * @param status The stored status.
 * @param errorClass The class behind an `error`, from the health snapshot, or null.
 * @returns The pill — the taxonomy's finer word where a class is known, the status's own
 *   otherwise.
 */
export function statusPill(
  status: ProviderConnection["status"],
  errorClass: ProviderErrorClass | null = null,
): StatusPill {
  if (status === "error" && errorClass !== null) return ERROR_PILLS[errorClass];

  return PILLS[status];
}

/**
 * What the pill says on hover — the last check's own phrase, when the strip has one.
 *
 * @param health The connection's row on the health strip, or null when the strip did not
 *   list it or could not be read.
 * @returns The detail, or null when there is nothing measured worth printing.
 */
export function pillDetail(health: ProviderHealth | null): string | null {
  return health?.detail ?? null;
}

/* -------------------------------------------------------------------------- the key row */

/** The address row — the mockup's **Base URL** and **Host** fields, under the adapter's label. */
export interface AddressRow {
  /** The field's label, as the adapter titled it. */
  readonly label: string;
  /** The stored address. */
  readonly value: string;
}

/** The masked key row. */
export interface SecretRow {
  /** The field's label, as the adapter titled it — the row's accessible name. */
  readonly label: string;
  /** `••••Xq4A`, or null when no credential is stored — the optional key left empty. */
  readonly mask: string | null;
  /** What an empty row says — the adapter's own prose, *API key — optional, no auth configured*. */
  readonly placeholder: string | null;
}

/** What the two rows say when the entry that would title them could not be read. */
export const ADDRESS_LABEL = "Address";

/** …and the key row's fallback label. */
export const CREDENTIAL_LABEL = "Credential";

/**
 * The address row, from the entry's fields and the connection.
 *
 * The field is found by the one name the contract reserves across every adapter,
 * `baseUrl`, and its label is whatever the adapter titled it — which is the whole of how
 * *Base URL* and *Host* come to be two rows drawn by one component.
 *
 * @param entry The connection's catalog entry, or null when the catalog could not be read or
 *   does not list this kind any more.
 * @param connection The connection.
 * @returns The row, or null for a connection with no address. Without an entry the row is
 *   still drawn under {@link ADDRESS_LABEL}: the address is a fact about the connection, and
 *   a card that hid it because a second read failed would be a card that lost data.
 */
export function addressRow(
  entry: ProviderCatalogEntry | null,
  connection: ProviderConnection,
): AddressRow | null {
  if (connection.baseUrl === null) return null;

  const field = entry?.fields.find((one) => one.name === BASE_URL_FIELD);

  return { label: field?.label ?? ADDRESS_LABEL, value: connection.baseUrl };
}

/**
 * The masked key row, from the entry's fields and the connection.
 *
 * The field is the one whose `widget` is `secret` — the service's own pointer at the
 * credential, derived once from the adapter's `x-ouroboros-secret` — so this function knows
 * nothing about which provider it is drawing.
 *
 * @param entry The connection's catalog entry, or null.
 * @param connection The connection.
 * @returns The row when the adapter declares a credential, whether or not one is stored; the
 *   row under {@link CREDENTIAL_LABEL} when there is no entry but a mask; and null for a
 *   provider that takes no credential at all — Ollama's card has no key row anywhere on it.
 */
export function secretRow(
  entry: ProviderCatalogEntry | null,
  connection: ProviderConnection,
): SecretRow | null {
  const field = entry?.fields.find((one) => one.widget === "secret");

  if (field !== undefined) {
    return { label: field.label, mask: connection.mask, placeholder: field.placeholder };
  }

  return connection.mask === null
    ? null
    : { label: CREDENTIAL_LABEL, mask: connection.mask, placeholder: null };
}

/**
 * The key row's two actions — live since AE.3
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)); what each does, and every
 * sentence it says, is `app/providers/keys.ts`'s.
 */
export const REVEAL = "Reveal";

/** The second. */
export const ROTATE = "Rotate";

/** The empty optional key row's one action — the mockup's **Save**. */
export const SAVE_KEY = "Save";

/* ---------------------------------------------------------------------- the dependents */

/**
 * The aliases that resolve through one connection — the routes a delete would break and a
 * switch-off would take down.
 *
 * Read off the registry's own listing rather than kept on the connection, because the
 * alias is what points at the connection and not the other way round (Y.1,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)); the service's delete guard
 * names the same aliases, from the same rows, so the two cannot disagree. Every alias
 * counts, switched-off ones included: the foreign key does not read `enabled`, and neither
 * does a loop that resolves the alias tomorrow.
 *
 * @param aliases The registry's aliases, as read — or why they could not be.
 * @param connectionId The connection.
 * @returns The dependent aliases' names, sorted the way the service sorts them; or the
 *   reading's own refusal, so the switch can say the routes could not be checked rather
 *   than pretend there are none.
 */
export function dependentsOf(
  aliases: Reading<readonly ModelAlias[]>,
  connectionId: string,
): Reading<readonly string[]> {
  if (!aliases.ok) return aliases;

  return {
    ok: true,
    value: aliases.value
      .filter((alias) => alias.connection?.id === connectionId)
      .map((alias) => alias.alias)
      .sort((left, right) => left.localeCompare(right)),
  };
}

/* ------------------------------------------------------------------------- the meta row */

/** The line under the key row, decided. */
export interface MetaRow {
  /** Who connected it — a name, or {@link NOBODY}. Never an id. */
  readonly addedBy: string;
  /** When, as `YYYY-MM-DD` in UTC. */
  readonly addedOn: string;
  /** *3m ago*, or {@link NEVER_USED} before first use. */
  readonly lastUsed: string;
}

/** What the meta row prints for a connection nothing has invoked through — an em-dash. */
export const NEVER_USED = "—";

/** Seconds in a minute, minutes in an hour, hours in a day. */
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago an instant was, in the mockup's own spellings — `41s ago`, `3m ago`,
 * `1h 12m ago`, `3d ago`.
 *
 * Measured from the instant the page was read, which the reader passes down rather than
 * each card reading a clock: a server render and its hydration then agree about every
 * figure, and a suite can hold the arithmetic still.
 *
 * @param iso The instant, ISO 8601.
 * @param now The instant the page was read.
 * @returns The phrase. An instant in the future — a clock skew — is drawn as `0s ago`
 *   rather than as a negative, and an unparseable one as the value itself.
 */
export function relativeAgo(iso: string, now: Date): string {
  const then = new Date(iso);

  if (Number.isNaN(then.getTime())) return iso;

  const elapsed = Math.max(0, now.getTime() - then.getTime());

  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)}s ago`;
  if (elapsed < DAY_MS) return `${durationOfMinutes(Math.floor(elapsed / MINUTE_MS))} ago`;

  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

/**
 * The calendar day an instant falls on, in UTC — the mockup's `2026-06-12`.
 *
 * UTC for the reason the audit sheet's stamp is: a date that moved with the reader's zone
 * would be a different card for two people looking at one connection.
 *
 * @param iso The instant, ISO 8601.
 * @returns `YYYY-MM-DD`, or the value itself when it cannot be parsed.
 */
export function utcDate(iso: string): string {
  const at = new Date(iso);

  return Number.isNaN(at.getTime()) ? iso : at.toISOString().slice(0, 10);
}

/**
 * The meta row for a connection.
 *
 * @param connection The connection.
 * @param now The instant the page was read.
 * @returns The three facts, each already a string.
 */
export function metaRow(connection: ProviderConnection, now: Date): MetaRow {
  return {
    addedBy: connection.addedByName ?? NOBODY,
    addedOn: utcDate(connection.createdAt),
    lastUsed: connection.lastUsedAt === null ? NEVER_USED : relativeAgo(connection.lastUsedAt, now),
  };
}

/* --------------------------------------------------------------------- the models region */

/** The region's label over the chips. */
export const MODELS_LABEL = "Models available";

/** …and over the pull-list. */
export const DETECTED_LABEL = "Detected models";

/** What the region says when discovery has reported nothing yet. */
export const NO_MODELS = "No models discovered yet.";

/** What the region says when the models could not be read. */
export const MODELS_UNAVAILABLE = "The models could not be read just now.";

/** The models region, decided. */
export type ModelsRegion =
  /** Chips, the tier pills discovery earned, and the flags on aliases the catalog stranded. */
  | {
      readonly kind: "chips";
      readonly models: readonly ProviderModel[];
      readonly tiers: readonly string[];
      readonly unlisted: readonly UnlistedModel[];
      /** Whether a refresh means anything — the adapter's own `discovery` flag. */
      readonly refreshable: boolean;
    }
  /** The pull-list — one row per detected model, the pulls in flight, and the same flags. */
  | {
      readonly kind: "pull-list";
      readonly models: readonly ProviderModel[];
      readonly unlisted: readonly UnlistedModel[];
      readonly refreshable: boolean;
      /** The service's records for this connection, as read with the page. */
      readonly pulls: readonly ModelPull[];
    }
  /** The read failed; the region says so rather than drawing no chips as if there were none. */
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The service tiers discovery reported, each once, in the order first seen.
 *
 * A tier is `meta.tier` on a model, and only a non-empty string counts — decision **P8**: the
 * pill exists for a word the provider said, and for nothing inferred from anything else.
 *
 * @param models The connection's models.
 * @returns The distinct tiers. Empty for a provider that publishes no such signal, which is
 *   every seeded card but Anthropic's.
 */
export function tiersOf(models: readonly ProviderModel[]): readonly string[] {
  const tiers: string[] = [];

  for (const model of models) {
    const tier = model.meta.tier;

    if (typeof tier === "string" && tier.length > 0 && !tiers.includes(tier)) tiers.push(tier);
  }

  return tiers;
}

/**
 * What a tier pill says — the mockup's `priority tier`.
 *
 * @param tier The provider's own word.
 * @returns The label.
 */
export function tierLabel(tier: string): string {
  return `${tier} tier`;
}

/**
 * The models region for a connection.
 *
 * @param entry The connection's catalog entry, or null. Without one — the catalog unread, or
 *   a kind the build no longer registers — the region is chips: the shape every kind but a
 *   pulling one takes, and the one that claims nothing about what the provider can do.
 * @param models What the models read produced, or null when it was never attempted because
 *   the listing itself could not be read.
 * @param pulls The service's pull records for the connection, or none. Read only for a
 *   pulling kind; a failed read is an empty list, because the rows are the catalog's and the
 *   list's own poll re-reads progress the moment a pull is started.
 * @returns The region.
 */
export function modelsRegion(
  entry: ProviderCatalogEntry | null,
  models: Reading<ProviderModels> | null,
  pulls: readonly ModelPull[] = [],
): ModelsRegion {
  if (models === null || !models.ok) {
    return { kind: "unavailable", reason: models?.reason ?? MODELS_UNAVAILABLE };
  }

  const refreshable = entry?.capabilities.discovery === true;

  if (entry?.capabilities.pull === true) {
    return {
      kind: "pull-list",
      models: models.value.models,
      unlisted: models.value.unlisted,
      refreshable,
      pulls,
    };
  }

  return {
    kind: "chips",
    models: models.value.models,
    tiers: tiersOf(models.value.models),
    unlisted: models.value.unlisted,
    refreshable,
  };
}

/* ---------------------------------------------------------------------------- the meter */

/** The meter's line and bar, decided. */
export interface MeterLine {
  /** The figure — `$412.80`, or the word that stands where a figure would lie. */
  readonly figure: string;
  /** What follows it in faint ink — `of $600 cap`, `2.1M tokens on-box` — or null. */
  readonly note: string | null;
  /** How full the bar is, `0`–`1`, or null for no bar at all. */
  readonly fraction: number | null;
  readonly tone: MeterTone;
}

/** The line's label — the mockup's *This month*. */
export const THIS_MONTH = "This month";

/** What a local kind prints where a cloud kind prints money. */
export const NO_METERED_SPEND = "no metered spend";

/** What a cloud kind prints when nobody priced its calls — the spend card's word. */
export const UNPRICED = "unpriced";

/** What every kind prints before anything has been recorded this month. */
export const NO_SPEND = "no spend recorded";

/** The fraction at which a meter turns to the warn hue — the mockup's Copilot card, at 80%. */
export const WARN_AT = 0.8;

/**
 * The narrowest a local kind's meter is drawn — mockup 07's 3% ok sliver, so the treatment
 * is visible on a lane that has no cap to fill against.
 */
export const LOCAL_METER = 0.03;

/**
 * A cap as the card prints it — `$600`, `$95`, `$1,250.50`.
 *
 * Whole dollars are drawn without cents, because that is how mockup 07 writes every cap and
 * how a person thinks of one; a cap that really carries cents keeps them.
 *
 * @param cents The cap in cents.
 * @returns The figure.
 */
export function capFigure(cents: number): string {
  const money = moneyOfCents(cents);

  return money.endsWith(".00") ? money.slice(0, -3) : money;
}

/**
 * What the foot's **Monthly cap** field reads.
 *
 * @param cents The cap, or null for no cap.
 * @returns The figure, or an em-dash — never `$0`, which is a real cap meaning *spend nothing*.
 */
export function capValue(cents: number | null): string {
  return cents === null ? NEVER_USED : capFigure(cents);
}

/**
 * The tone a fraction of a cap earns.
 *
 * @param fraction Spend over cap.
 * @returns `err` at or over the cap, `warn` from {@link WARN_AT}, the accent below.
 */
export function meterTone(fraction: number): MeterTone {
  if (fraction >= 1) return "err";
  if (fraction >= WARN_AT) return "warn";

  return "accent";
}

/**
 * The meter for a connection.
 *
 * @param connection The connection — its cap.
 * @param row The month's row for the connection's kind, or null when the kind has no usage
 *   this month or the spend could not be read.
 * @param seats A seat count a check reported, or null — {@link seatsIn}.
 * @returns {@link meterFor}'s line, at the connection's stored cap.
 */
export function meterLine(
  connection: ProviderConnection,
  row: ProviderMonthlySpendRow | null,
  seats: number | null,
): MeterLine {
  return meterFor(connection.monthlyCapCents, row, seats);
}

/**
 * The meter for a cap.
 *
 * The rules, per this file's header: money for priced spend, *unpriced* for a cloud kind
 * nobody priced, *no metered spend* for a local kind that cost nothing or was never priced,
 * and on-box tokens beside a local figure; a bar only against a cap, save the local sliver.
 *
 * @param cap The cap in cents, or null for none — the stored one, or the one just typed.
 * @param row The month's row for the connection's kind, or null.
 * @param seats A seat count a check reported, or null.
 * @returns The line.
 */
export function meterFor(
  cap: number | null,
  row: ProviderMonthlySpendRow | null,
  seats: number | null,
): MeterLine {
  const capNote =
    cap === null ? null : `of ${capFigure(cap)} cap${seats === null ? "" : ` · ${seats} seat${seats === 1 ? "" : "s"}`}`;

  if (row === null) {
    return { figure: NO_SPEND, note: capNote, fraction: cap === null ? null : 0, tone: "accent" };
  }

  const priced = row.spendCents !== null && (row.spendCents > 0 || !row.local);
  const figure = priced
    ? moneyOfCents(row.spendCents ?? 0)
    : row.local
      ? NO_METERED_SPEND
      : UNPRICED;
  const tokens =
    row.local && row.tokens > 0 ? `${compactNumber(row.tokens)} tokens on-box` : null;
  const note = [capNote, tokens].filter((part): part is string => part !== null).join(" · ");

  if (cap !== null && row.spendCents !== null) {
    // A cap of zero is a real instruction — *spend nothing* — and any priced spend against
    // it is over it; a division would answer `Infinity` or `NaN` for the two cases instead.
    const fraction = cap === 0 ? (row.spendCents > 0 ? 1 : 0) : Math.min(1, row.spendCents / cap);

    return { figure, note: note || null, fraction, tone: meterTone(fraction) };
  }

  return {
    figure,
    note: note || null,
    fraction: row.local ? LOCAL_METER : null,
    tone: row.local ? "ok" : "accent",
  };
}

/**
 * The seat count inside a check's detail, if it carries one — the mockup's `· 4 seats`.
 *
 * The reader half of the service's `provider.entitlements.ts`, spelled identically: a count
 * is written there as `200 · 4 seats` and read here off the end of the same string. Anything
 * else — a detail with no count, a detail that says nothing — is null, which appends nothing;
 * *seats unknown* would be a suffix a reader has to learn to distrust (decision **P8**).
 *
 * @param detail A check's detail, or null.
 * @returns The count, or null.
 */
export function seatsIn(detail: string | null): number | null {
  const match = /(?:^| · )(\d{1,9}) seats?$/.exec(detail ?? "");

  return match === null ? null : Number.parseInt(match[1], 10);
}

/* ----------------------------------------------------------------------------- the foot */

/** The foot's first action. */
export const TEST_CONNECTION = "Test connection";

/** The cap field's label. */
export const CAP_LABEL = "Monthly cap";

/* --------------------------------------------------------------------------- the switch */

/**
 * The switch's accessible name: what it controls, rather than the card's name again.
 *
 * Never changes with the position — `aria-checked` carries that.
 *
 * @param displayName The card's heading.
 * @returns The name.
 */
export function switchLabel(displayName: string): string {
  return `Route through ${displayName}`;
}

/** What a switched-off card says under its switch. */
export const SWITCHED_OFF = "Switched off — routing skips this provider until it is switched on.";

/** What every switch says to a role that may not press it. */
export const SWITCH_READ_ONLY = "Switching a provider on or off is for workspace owners and admins.";

/** What a switch says when its press did not persist, for any reason but the two named. */
export const SWITCH_FAILED = "The switch could not be saved. Nothing was changed — try again in a moment.";

/** What a switch says when the connection it belongs to has been removed underneath it. */
export const SWITCH_GONE = "This provider has been removed. Reload the page.";

/* ------------------------------------------------------------------------------ the card */

/** Everything the card draws, decided. */
export interface CardModel {
  readonly id: string;
  readonly name: string;
  /** The second line, or null — the card then draws one line instead of two. */
  readonly capabilityNote: string | null;
  readonly monogram: Monogram;
  readonly pill: StatusPill;
  readonly pillDetail: string | null;
  readonly enabled: boolean;
  readonly address: AddressRow | null;
  readonly secret: SecretRow | null;
  readonly meta: MetaRow;
  readonly models: ModelsRegion;
  /** What the meter and the cap field are drawn from — see {@link SpendInputs}. */
  readonly spend: SpendInputs;
  /**
   * The aliases that resolve through this connection, or why they could not be read — what
   * the switch asks about before it goes off, and what a refused delete names.
   */
  readonly dependents: Reading<readonly string[]>;
}

/**
 * The meter's three inputs, carried rather than decided so the cap field can redraw the
 * meter with a cap the reader has typed and the route has not yet re-read.
 */
export interface SpendInputs {
  /** The stored cap in cents, or null for none. */
  readonly capCents: number | null;
  /** The month's row for the connection's kind, or null. */
  readonly row: ProviderMonthlySpendRow | null;
  /** A seat count a check reported, or null. */
  readonly seats: number | null;
}

/** What one card is composed from. */
export interface CardInputs {
  readonly connection: ProviderConnection;
  /** The catalog entry for the connection's kind, or null. */
  readonly entry: ProviderCatalogEntry | null;
  /** The connection's row on the health strip, or null. */
  readonly health: ProviderHealth | null;
  /** The month's row for the connection's kind, or null. */
  readonly spend: ProviderMonthlySpendRow | null;
  /** What the models read produced, or null when it was not attempted. */
  readonly models: Reading<ProviderModels> | null;
  /**
   * The service's pull records for the connection — a pulling kind's, read with the page.
   * Optional because only a pulling kind has any; the screen passes what it read, and none
   * is what every other card has.
   */
  readonly pulls?: readonly ModelPull[];
  /** What the registry's aliases read produced — one read for the whole grid. */
  readonly aliases: Reading<readonly ModelAlias[]>;
  /** The instant the page was read. */
  readonly now: Date;
}

/**
 * The card for one connection.
 *
 * Total over its inputs: every null is a state the card draws rather than a reason it
 * cannot. That is what makes a kind nobody wrote a card for render — see this file's header.
 *
 * @param inputs See {@link CardInputs}.
 * @returns The model.
 */
export function cardModel({
  connection,
  entry,
  health,
  spend,
  models,
  pulls = [],
  aliases,
  now,
}: CardInputs): CardModel {
  return {
    id: connection.id,
    name: connection.displayName,
    capabilityNote: connection.capabilityNote,
    monogram: monogramFor(connection.kind, connection.displayName),
    pill: statusPill(connection.status, health?.errorClass ?? null),
    pillDetail: pillDetail(health),
    enabled: connection.enabled,
    address: addressRow(entry, connection),
    secret: secretRow(entry, connection),
    meta: metaRow(connection, now),
    models: modelsRegion(entry, models, pulls),
    spend: { capCents: connection.monthlyCapCents, row: spend, seats: seatsIn(pillDetail(health)) },
    dependents: dependentsOf(aliases, connection.id),
  };
}

/* ------------------------------------------------------------------------------ the grid */

/**
 * The grid's accessible name.
 *
 * What the grid draws when it has no cards — the guidance for an empty workspace, the seat
 * under the failed-read banner — is `app/providers/states.ts`'s, beside the page's other
 * states, since AE.6 ([#232](https://github.com/NobuData/ouroboros/issues/232)).
 */
export const GRID_LABEL = "Provider connections";
