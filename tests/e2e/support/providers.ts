/**
 * Mockup 07's providers screen, as this suite asserts against it
 * ([#233](https://github.com/NobuData/ouroboros/issues/233)).
 *
 * Two halves, and they are two different kinds of thing.
 *
 * **What the seed makes of `/models/providers`** — the five cards, their pills, their
 * addresses, their models and their meters — is written down here rather than read back, the
 * rule `support/seed.ts` states at length. Every value comes from
 * `R__dev_seed_providers.sql` ([#221](https://github.com/NobuData/ouroboros/issues/221)) and
 * from the arithmetic the product does over it, so a seed that changes breaks this file and
 * somebody has to look at both.
 *
 * **What the leg brings into existence** — a connection at the stub provider, its keys, and
 * the two spellings a rotation moves between — is the other half. It is not a fixture; it is
 * a row this leg creates through the API and deletes again, and the constants below are the
 * ones the *stub* enforces (`fixtures/provider-stub/server.mjs`) rather than ones anything
 * agreed to pretend.
 *
 * ## Why the leg connects its own cards at all
 *
 * Because the seeded five cannot answer the questions the ticket asks. Their addresses exist
 * only in the fixture and their `credentials_encrypted` values are the words
 * *dev-seed-value-not-a-real-credential* under a nonce no vault sealed — deliberately, so
 * that a reveal against demo data fails in the designed way instead of showing a key. That
 * makes them perfect for parity and useless for the credential lifecycle: a rotation is a
 * *verify*-then-retire and has nothing to verify against, a reveal has nothing to decrypt, and
 * a pull has no daemon. So the leg connects a vLLM card and an Ollama card of its own to
 * `provider-stub`, exercises the lifecycle on those, and removes them — and the seeded five
 * are read on every test and written by none.
 *
 * ## Three figures here are computed by the product
 *
 * `$412.80`, `$76.00` and `$64.10` are calendar-month sums over `token_usage` — decision
 * **M7** — assembled from three seeds that each own part of the total, and the meter's
 * fraction is that sum against a cap in another column. So a card's meter is the whole chain
 * from a ledger row to a bar's tone, and none of it is a value the seed could have been made
 * to say by writing it into a column.
 *
 * ## What is deliberately not written down
 *
 * **Anything measured from the stack's own clock.** `last_used_at` is `now() - interval`, so
 * every card's meta row ends in a relative time that differs between two runs a minute apart.
 * The stable half — *Added by Ken Suenobu · 2026-06-12* — is a literal in the seed and is
 * asserted; the trailing *last used 3m ago* is not, and the screenshots do not mask it because
 * the parity pair is photographed with the seed's own dates in place and the relative half is
 * the one thing on the page a diff tolerance is not asked to cover. See {@link SEEDED_CARDS}.
 */

import type { BrowserContext } from "@playwright/test";

import { quietly, requestAs, writeAs } from "./rest";

/* ------------------------------------------------------------------ where the page lives */

/** The providers screen's route — mockup 07, `app/(app)/models/providers/page.tsx`. */
export const PROVIDERS_PATH = "/models/providers";

/** The routing screen, for the leg that navigates away and requires a revealed key to mask. */
export const ROUTING_PATH = "/models";

/** The page's `<h1>`, from `app/providers/view.ts`. */
export const PROVIDERS_TITLE = "Providers & keys";

/** The grid's landmark name — `GRID_LABEL`. */
export const GRID_LABEL = "Provider connections";

/* ------------------------------------------------------------------ the seeded five */

/** One card's models region, as the card draws it. */
export interface SeededModels {
  /** The region's label — `Models available` for chips, `Detected models` for a pull-list. */
  readonly label: string;
  /** What each chip or row prints, in the order discovery reported them. */
  readonly entries: readonly string[];
}

/** One of the five seeded cards. */
export interface SeededCard {
  /** The card's heading, and what the grid orders by. */
  readonly name: string;
  /** The status pill — `cards.ts`'s `PILLS`, from the row's stored `status`. */
  readonly pill: string;
  /** The line under the heading — `capability_note`, stored verbatim. */
  readonly note: string;
  /**
   * What the key row's `<label>` says, or `null` for a card with no key row.
   *
   * The adapter's own field title, never a word this file chose: `cards.ts` takes the label
   * from the catalog entry's secret field, so Copilot's row says **GitHub token** where the
   * other three say **API key**. A suite that assumed one label for all of them would be
   * asserting a page in which every provider is configured the same way, which is the one
   * thing mockup 07's five cards exist to disprove.
   */
  readonly keyLabel: string | null;
  /** The address row's value, or `null` for a connection with no address of its own. */
  readonly address: string | null;
  /**
   * What the card's key row holds, of the three states a row can be in.
   *
   * **Every seeded card is `empty`, and that is a property of the seed rather than of the
   * page.** `R__dev_seed_providers.sql` writes the three cloud connections a `credentials_
   * encrypted` value that is well-formed by V015's CHECK and was **never sealed by
   * anything** — its own header says so at length, because no SQL file can produce an
   * AES-256-GCM envelope under a workspace DEK. So the vault cannot open them, the listing
   * has no suffix to publish, and the row draws its placeholder and a **Save**: the honest
   * rendering of *there is something sealed here that this deployment cannot open*.
   *
   * Mockup 07 draws `sk-ant-api03-••••••••••••Xq4A`, and that is the one element of the
   * artwork this seed cannot reach. A `masked` row is what the leg's **own** connections
   * draw, because those hold a credential this deployment really sealed — which is why the
   * whole credential lifecycle is exercised there and none of it here.
   *
   * `absent` is the Ollama card: its adapter declares no credential at all, so there is no
   * row rather than an empty one — which is why {@link SeededCard.keyLabel} is null there and
   * a label everywhere else.
   */
  readonly key: "masked" | "empty" | "absent";
  /** The stable half of the meta row: `Added by … · YYYY-MM-DD`. */
  readonly meta: string;
  /** The **Monthly cap** field's value — `capValue`, which draws an em-dash for no cap. */
  readonly cap: string;
  /** The meter's figure, and its note, as `meterFor` composes them. */
  readonly meter: { readonly figure: string; readonly note: string | null };
  /** The models region. */
  readonly models: SeededModels;
}

/** The chips region's label. */
export const MODELS_LABEL = "Models available";

/** The pull-list region's label — the Ollama card's. */
export const DETECTED_LABEL = "Detected models";

/**
 * What an **editable** cap field holds when there is no cap: nothing.
 *
 * `caps.ts` draws the em-dash as the field's *placeholder* and `capText(null)` as its value,
 * and those are two different things — a placeholder is a prompt and a value is a figure. A
 * reader who may not edit is shown `capValue(null)`, which **is** the em-dash, because a
 * read-only field with no value in it would look like a field that failed to load. Both
 * spellings are asserted, on the two roles that meet them.
 */
export const UNCAPPED = "";

/** What a *read-only* cap field draws for no cap — `cards.ts`'s `NEVER_USED`. */
export const UNCAPPED_READ_ONLY = "—";

/**
 * The five cards, in `display_name` order — which is the order the repository lists in and
 * therefore the order the grid draws.
 *
 * The **GitHub Copilot** card is the one that is not simply healthy, and it is the combination
 * a grid has to draw carefully: *enabled and unhealthy*. Its row's `status` is `error` and its
 * health snapshot carries no error class, so the pill is the coarse `error` rather than one of
 * the taxonomy's five finer words — a class is written by a probe, and no probe has run.
 *
 * Its meter is the other reason it is worth naming: `$76.00` against a `$95` cap is exactly
 * **80%**, which is `WARN_AT`, so the seed already draws one warn meter and the cap-edit leg
 * has a second one to make and unmake.
 */
export const SEEDED_CARDS: readonly SeededCard[] = [
  {
    name: "Anthropic Claude",
    pill: "connected",
    note: "api.anthropic.com · primary coding lane",
    keyLabel: "API key",
    address: null,
    key: "empty",
    meta: "Added by Ken Suenobu · 2026-06-12",
    cap: "$600",
    meter: { figure: "$412.80", note: "of $600 cap" },
    models: {
      label: MODELS_LABEL,
      entries: ["claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"],
    },
  },
  {
    name: "Cursor",
    pill: "connected",
    note: "api.cursor.com · used for second-opinion reviews",
    keyLabel: "API key",
    address: null,
    key: "empty",
    meta: "Added by Ken Suenobu · 2026-07-02",
    cap: "$120",
    meter: { figure: "$64.10", note: "of $120 cap" },
    models: { label: MODELS_LABEL, entries: ["cursor/composer-2"] },
  },
  {
    name: "GitHub Copilot",
    pill: "error",
    note: "billed through GitHub org acme-robotics",
    keyLabel: "GitHub token",
    address: null,
    key: "empty",
    meta: "Added by Ken Suenobu · 2026-06-18",
    cap: "$95",
    meter: { figure: "$76.00", note: "of $95 cap" },
    models: { label: MODELS_LABEL, entries: ["copilot/gpt-5-codex"] },
  },
  {
    name: "Ollama · workstation",
    pill: "connected",
    note: "zero-cost lane — used for docs & commit messages",
    keyLabel: null,
    address: "http://ken-station.local:11434",
    key: "absent",
    meta: "Added by Ken Suenobu · 2026-05-14",
    cap: UNCAPPED,
    meter: { figure: "no metered spend", note: "2.1M tokens on-box" },
    models: {
      label: DETECTED_LABEL,
      entries: ["llama4:scout", "phi4:14b", "qwen3-coder:32b"],
    },
  },
  {
    name: "OpenAI-compatible · local vLLM",
    pill: "connected",
    note: "self-hosted · A100 ×2",
    keyLabel: "API key",
    address: "http://10.0.4.20:8000/v1",
    key: "empty",
    meta: "Added by Ken Suenobu · 2026-05-30",
    cap: UNCAPPED,
    // **Not the `$0.00` `R__dev_seed_providers.sql`'s header predicts.** `meterFor` calls a
    // local row priced only when it spent something, so a local provider whose calls were
    // metered at zero draws the words rather than the figure. The distinction the seed cares
    // about — priced-at-nothing against nobody-priced-this — is alive and is drawn one level
    // up, on mockup 06's spend card, where the same rows produce `$0.00` beside
    // *5 unpriced calls*. The card meter is the one surface that says it in words.
    meter: { figure: "no metered spend", note: "19.6M tokens on-box" },
    models: {
      label: MODELS_LABEL,
      entries: ["local/deepseek-v3.2", "local/llama-4-maverick"],
    },
  },
];

/**
 * One seeded card by its heading.
 *
 * @param name - The card's heading.
 * @returns The card.
 * @throws {Error} When nothing here is called that — a typo in a spec, caught where it was
 *   made rather than as an assertion against `undefined` three lines later.
 */
export function seededCard(name: string): SeededCard {
  const card = SEEDED_CARDS.find((one) => one.name === name);

  if (card === undefined) {
    throw new Error(`no seeded provider card is called "${name}"`);
  }

  return card;
}

/* ------------------------------------------------------------------ the security strip */

/** The strip's landmark name — `view.ts`'s `SECURITY_STRIP_LABEL`. */
export const SECURITY_STRIP_LABEL = "Security model";

/**
 * The phrase the strip emphasises, and the one word of its copy this file writes down.
 *
 * The whole sentence is `docs/SECURITY_MODEL.md` § 7.1 and `ouroboros-ui`'s own
 * `security-strip.test.tsx` reads the document and compares it word for word — which is a
 * better assertion than a copy here could be, and copying it would produce a second place to
 * update when the document moves. What a browser adds is that the strip *shipped*, in both
 * palettes, under the grid, with the badge slot holding what § 7.3 permits and nothing else.
 */
export const SECURITY_STRIP_EMPHASIS = "envelope encryption";

/** The one tag § 7.3 permits — a claim about the deployment rather than a certification. */
export const SECURITY_STRIP_TAG = "self-hosted";

/** The strip's link out. */
export const SECURITY_MODEL_LINK = "Read the security model ↗";

/**
 * The two certifications mockup 07 drew and § 7.3 withdrew.
 *
 * Asserted **absent**, which is the only way a truth correction stays corrected: a badge
 * nobody is looking for is a badge somebody pastes back in from the artwork.
 */
export const WITHDRAWN_BADGES: readonly string[] = ["SOC 2 Type II", "ISO 27001"];

/* ------------------------------------------------------------------ the stub provider */

/**
 * Where `provider-stub` answers, from inside the compose network.
 *
 * A container's view, not a browser's: this address is typed into a form the **service**
 * then fetches, so it has to resolve where `ouroboros-rest` runs. The stub publishes no host
 * port precisely because nothing outside the network has any business reaching it.
 */
const STUB_ORIGIN = "http://provider-stub:8080";

/** The stub's OpenAI-compatible root — already ending `/v1`, as mockup 07's placeholder does. */
export const STUB_OPENAI_BASE_URL = `${STUB_ORIGIN}/v1`;

/** The stub's Ollama host — no `/api`, which the adapter appends. */
export const STUB_OLLAMA_HOST = STUB_ORIGIN;

/**
 * A key the stub accepts, and the one a connection is created with.
 *
 * Its last four characters are what the masked row shows, so it and {@link ROTATED_KEY} are
 * deliberately spelled to differ there: `••••lpha` becoming `••••ravo` is the whole of *the
 * masked suffix updates*, and two keys differing only in the middle would make that assertion
 * pass against a card that had not changed at all.
 */
export const ACCEPTED_KEY = "ouro-e2e-key-alpha";

/** The key a successful rotation moves to. */
export const ROTATED_KEY = "ouro-e2e-key-bravo";

/** The masked row a connection holding {@link ACCEPTED_KEY} draws — `••••` and four characters. */
export const ACCEPTED_KEY_MASK = "••••lpha";

/** …and after a successful rotation to {@link ROTATED_KEY}. */
export const ROTATED_KEY_MASK = "••••ravo";

/**
 * A key the stub refuses.
 *
 * It carries no `ouro-e2e-` prefix, which is the stub's entire authorisation rule — so the
 * `401` it earns is a provider refusing a credential, classified by the adapter's own
 * taxonomy, and not a fixture that was told to fail.
 */
export const REJECTED_KEY = "definitely-not-an-accepted-key";

/**
 * The models the stub serves under both wire formats, in the order a **card** draws them.
 *
 * `provider_models` is read `order by model_id`, so what the stub happens to list first is not
 * what the chips show first — the same reason the seeded cards' models are written down
 * alphabetically rather than in the seed's insert order.
 */
export const STUB_MODELS = ["e2e-large", "e2e-small"] as const;

/** What the vLLM card's chips print for them — `LOCAL_DISPLAY_PREFIX` plus the id. */
export const STUB_CHIPS = STUB_MODELS.map((id) => `local/${id}`);

/** The model the pull leg pulls — the row it presses. */
export const STUB_PULL_MODEL = "e2e-small";

/** What the models region says on a connection nothing has discovered against yet. */
export const NO_MODELS = "No models discovered yet.";

/** The models region's refresh, which is what discovers them. */
export const REFRESH_MODELS = "Refresh models";

/* ------------------------------------------------------------------ connections of our own */

/** What `POST /api/v1/providers` answers — the fields this leg reads of it. */
interface CreatedConnection {
  /** The row's id, which is how everything afterwards addresses it. */
  readonly id: string;
  /** The card's heading, echoed back. */
  readonly displayName: string;
}

/** The names the leg's own cards are connected under. */
export const STUB_CARDS = {
  /**
   * The OpenAI-compatible card — the reveal, rotate and test-truth subject.
   *
   * Lower-case on purpose: the grid orders by `display_name`, so a name after
   * `OpenAI-compatible · local vLLM` puts this card last under either collation and leaves the
   * seeded five drawn where the parity baselines photographed them.
   */
  vllm: "vLLM · e2e stub",
  /** The Ollama card — the pull subject, and the only kind whose adapter declares `pull`. */
  ollama: "workstation · e2e stub",
} as const;

/**
 * Connect a provider at the stub, through the API, and answer its id.
 *
 * Through `POST /api/v1/providers` rather than through the add dialog, because only *one*
 * test in this leg is about the dialog. The other four need a connection to exist and are
 * about what happens next, and driving a three-step dialog to arrange each of them would spend
 * the budget re-asserting the add flow four more times.
 *
 * **It is not a shortcut past a check.** The route validates against the live provider exactly
 * as the dialog's action does — same service, same adapter, same vault — so a connection this
 * returns an id for is one the stub really accepted.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @param kind - `openai_compatible` or `ollama`.
 * @param config - The adapter's own settings, keyed as its `configSchema()` declares them.
 * @returns The new connection's id.
 * @throws {Error} If the context carries no session, or if the service refused — including
 *   when the provider refused, which is a `422` carrying the adapter's sentence.
 */
export async function connectStub(
  context: BrowserContext,
  kind: "openai_compatible" | "ollama",
  config: Readonly<Record<string, string>>,
): Promise<string> {
  const displayName = kind === "ollama" ? STUB_CARDS.ollama : STUB_CARDS.vllm;

  const created = await requestAs<CreatedConnection>(
    context,
    "POST",
    "/api/v1/providers",
    { kind, displayName, config },
    `connecting the ${kind} stub as "${displayName}"`,
  );

  if (created === null) {
    throw new Error(`connecting the ${kind} stub answered no body; there is no id to act on.`);
  }

  // A connection is created **without** models: `add` validates, seals and inserts, and
  // discovery is a live call of its own (AE.4). Every leg but the add flow's needs a card that
  // already has its models, so the arrangement is made here — through the same route the
  // page's **Refresh models** calls, so nothing is written that the product would not write.
  // The add leg presses the button instead, because there the sequence *is* the subject.
  await requestAs(
    context,
    "POST",
    `/api/v1/providers/${created.id}/discover`,
    {},
    `discovering models on the ${kind} stub`,
  );

  return created.id;
}

/**
 * Connect the vLLM card the credential legs act on — the stub's OpenAI-compatible face, with
 * {@link ACCEPTED_KEY} stored.
 *
 * @param context - The context to act for.
 * @returns The new connection's id.
 * @throws {Error} As {@link connectStub} does.
 */
export function connectStubVllm(context: BrowserContext): Promise<string> {
  return connectStub(context, "openai_compatible", {
    baseUrl: STUB_OPENAI_BASE_URL,
    apiKey: ACCEPTED_KEY,
    capabilityNote: "e2e stub · connected by the providers leg",
  });
}

/**
 * Connect the Ollama card the pull leg acts on.
 *
 * No credential: the adapter's schema declares a host and nothing else, because a daemon on
 * your own machine authenticates nobody.
 *
 * @param context - The context to act for.
 * @returns The new connection's id.
 * @throws {Error} As {@link connectStub} does.
 */
export function connectStubOllama(context: BrowserContext): Promise<string> {
  return connectStub(context, "ollama", {
    baseUrl: STUB_OLLAMA_HOST,
    capabilityNote: "e2e stub · connected by the providers leg",
  });
}

/**
 * Remove every connection this leg connects, whatever state a test left them in.
 *
 * By **name** rather than by an id the caller wrote down, and that is the whole point: the
 * teardown that matters most is the one after a test that failed *between* creating a
 * connection and remembering it, which is exactly when an id-based teardown has nothing to
 * work with. It also collects leftovers from a run that was interrupted, so a stack somebody
 * is debugging against with `--keep` does not accumulate cards.
 *
 * The names are {@link STUB_CARDS}'s, which nothing else in the workspace uses — the seed's
 * five are named for mockup 07 — so this can never remove a seeded connection.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @returns When the removals have been attempted. It never throws — see `support/rest.ts`.
 */
export function disconnectStubCards(context: BrowserContext): Promise<void> {
  const names = new Set<string>(Object.values(STUB_CARDS));

  return quietly(
    async () => {
      const listing = await requestAs<{ readonly items: readonly CreatedConnection[] }>(
        context,
        "GET",
        "/api/v1/providers",
        null,
        "listing the connections this leg created",
      );

      for (const connection of listing?.items ?? []) {
        if (!names.has(connection.displayName)) continue;

        await requestAs(
          context,
          "DELETE",
          `/api/v1/providers/${connection.id}`,
          null,
          `removing connection ${connection.id}`,
        );
      }
    },
    "a provider connection this leg created was not removed — it is a sixth card in a grid " +
      "the parity screenshots photograph as five, so the next run fails on an image rather " +
      "than here.",
  );
}

/* ------------------------------------------------------------------ putting a cap back */

/**
 * Set a seeded connection's monthly cap, in whole cents.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @param id - The connection.
 * @param cents - The cap, or `null` for no cap.
 * @returns When the service has stored it.
 * @throws {Error} As `support/rest.ts`'s write does.
 */
export function setCap(context: BrowserContext, id: string, cents: number | null): Promise<void> {
  return writeAs(
    context,
    "PATCH",
    `/api/v1/providers/${id}`,
    { monthlyCapCents: cents },
    `setting connection ${id}'s monthly cap`,
  );
}

/**
 * The one seeded connection this leg edits, and the cap the seed left on it.
 *
 * The id is literal in `R__dev_seed_providers.sql`, as every seeded id in this suite is.
 * **Anthropic** rather than one of the other four because it is the card whose meter the edit
 * has somewhere to move: `$412.80` against the seed's `$600` is 69% and draws no warning, and
 * against {@link WARN_CAP_CENTS} it is 92% and draws one. Copilot is already at exactly 80%,
 * so an edit there could only assert a warn meter that was warning before it.
 */
export const CAPPED_CONNECTION = {
  /** `provider_connections.id` — literal in the migration. */
  id: "5eed000c-0000-4000-8000-000000000001",
  /** The card it draws. */
  name: "Anthropic Claude",
  /** The cap the seed wrote, in whole cents — mockup 07's `$600`. */
  seededCapCents: 60_000,
} as const;

/** The cap the leg types, in whole cents — `$450`, which puts the meter over `WARN_AT`. */
export const WARN_CAP_CENTS = 45_000;

/** …as the field draws it, and as it is typed. */
export const WARN_CAP_TEXT = "$450";

/** …and the meter's note at that cap. */
export const WARN_CAP_METER_NOTE = "of $450 cap";

/**
 * Put {@link CAPPED_CONNECTION}'s cap back exactly as the seed wrote it.
 *
 * The value is written down rather than read back before the test, for the reason the rest of
 * this module is written down: a restore that re-sent whatever it found would put back a cap
 * this run had already broken just as faithfully as the seed's.
 *
 * @param context - The context to act for.
 * @returns When the restore has been attempted. It never throws — see `support/rest.ts`.
 */
export function restoreCap(context: BrowserContext): Promise<void> {
  return quietly(
    () => setCap(context, CAPPED_CONNECTION.id, CAPPED_CONNECTION.seededCapCents),
    `${CAPPED_CONNECTION.name}'s monthly cap was not restored — the next run's card, its ` +
      "meter and both parity screenshots start from a cap nobody wrote.",
  );
}

/* ------------------------------------------------------------------ the page's own words */

/** The **Monthly cap** field's label, and decision P7's sentence attached to it. */
export const CAP_LABEL = "Monthly cap";

/** Decision P7, said where the cap is set — `caps.ts`'s `CAP_WARNING_ONLY`. */
export const CAP_WARNING_ONLY = "Warning only — enforcement arrives with invocation.";

/** The class the meter wears at or above `WARN_AT` — `app/ui/meter.tsx`'s own modifier. */
export const METER_WARN_CLASS = "ou-meter--warn";

/** The card foot's probe. */
export const TEST_CONNECTION = "Test connection";

/** The key row's three actions. */
export const REVEAL = "Reveal";
export const ROTATE = "Rotate";
export const MASK_NOW = "Mask";

/** What a revealed row says about itself — `keys.ts`'s `REVEAL_RECORDED`. */
export const REVEAL_RECORDED = "This reveal was recorded in the audit log.";

/** The line a failed rotation stands beside — `keys.ts`'s `OLD_KEY_ACTIVE`, and the point. */
export const OLD_KEY_ACTIVE = "Your existing key is still active — nothing was changed.";

/**
 * The instant, as the audit sheet's **When (UTC)** column prints it — `YYYY-MM-DD HH:MM`.
 *
 * Restated here rather than imported, as everything in this directory is. It is written out
 * for one purpose: a stamp in this format sorts **lexicographically in chronological order**,
 * which is what lets a leg say *this row happened after I started* with a string comparison
 * and no date arithmetic.
 *
 * That comparison is the whole of what makes the trail leg an assertion. The workspace's
 * `audit_events` are not cleared between runs and are not this leg's to clear — a trail that
 * could be emptied by a test is not a trail — so *the sheet contains the word `rotated`* is
 * satisfied by any previous run's rotation, and would go on being satisfied with the audit
 * interceptor removed from the service entirely. That was observed: stubbing the interceptor
 * to write nothing left all twenty-one tests green. Anchoring on **now** is what fixed it.
 *
 * @param at - The instant to render.
 * @returns The stamp, in UTC.
 */
export function auditStamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`
  );
}

/** The audit sheet's ghost action, its heading, and the sentences the leg looks for. */
export const AUDIT_LOG_LABEL = "Audit log";
export const AUDIT_SHEET_TITLE = "Credential audit log";

/** `view.ts`'s `SENTENCES`, for the four operations this leg performs. */
export const AUDIT_SENTENCES = {
  added: "connected the provider",
  revealed: "revealed the credential",
  rotated: "rotated the credential",
  capChanged: "changed the monthly cap",
} as const;

/** The add flow's controls and steps — `catalog.ts`. */
export const ADD_PROVIDER_LABEL = "+ Add provider";
export const CATALOG_LIST_LABEL = "Provider kinds";
export const CONNECT = "Connect";
export const ADDED_TITLE = "Connected";
export const DONE = "Done";
export const NAME_LABEL = "Name";
export const BASE_URL_LABEL = "Base URL";
export const API_KEY_LABEL = "API key";
export const OPENAI_TILE_LABEL = "OpenAI-compatible";

/** `NOTHING_STORED` — what every add refusal ends with, and the half the negative leg is about. */
export const NOTHING_STORED = "Nothing was stored.";

/** The pull-list's action, and the state a finished row draws. */
export const PULL_LATEST = "Pull latest";
export const PULLED = "pulled";
