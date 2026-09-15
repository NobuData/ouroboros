/**
 * Mockup 21's model registry, as this suite asserts against it
 * ([#597](https://github.com/NobuData/ouroboros/issues/597)).
 *
 * Two halves, and they are two different kinds of thing — the arrangement
 * `support/providers.ts` makes, for the same reason.
 *
 * **What the seed makes of `/models/registry`** — eight aliases, their bindings, their chips,
 * their health, their prices and what references them — is written down here rather than read
 * back, the rule `support/seed.ts` states at length. Every value comes from
 * `R__dev_seed_routing.sql` ([#582](https://github.com/NobuData/ouroboros/issues/582)) and
 * `R__dev_seed_providers.sql`, and from the derivations the product makes over them, so a seed
 * that changes breaks this file and somebody has to look at both.
 *
 * **What the leg brings into existence** — aliases of its own, a route pointed at one of them,
 * a switch moved and a draft pinned to a raw model — is the other half. None of it is a fixture;
 * each is a write the leg makes and takes back, and the helpers at the foot of this file are how.
 *
 * ## Four of the figures here are computed by the product
 *
 * The seed stores structure and no sentence this page prints. `max thinking` and `400k budget`
 * are CH.2's chips derived from `{"thinking": "max", "token_budget": 400000}`; `4 routes` is a
 * count over the reference index (V023); `degraded` beside `elevated latency` is CH.5's health
 * derivation over a provider's last check; and a price is CH.3's resolution over the bundled
 * catalog and one org override. So a parity assertion on a row is an assertion on the whole
 * chain from a column to the cell, and none of it is a value the seed could have been made to
 * say by writing it into a column.
 *
 * ## What is deliberately not written down
 *
 * **Anything the stack's own clock produces.** A dropped hop's sentence ends in the day the
 * alias was last written — the day the leg switched it off — so that sentence is asserted by its
 * shape. Nothing on the seeded page itself is clock-derived: every health reading is the seed's,
 * which is only true because `docker-compose.e2e.yml` holds the provider health sweep still.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BrowserContext } from "@playwright/test";

import { quietly, requestAs, writeAs } from "./rest";
import { type RouteBody, SEEDED_ROUTES } from "./routing";
import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";

/* ------------------------------------------------------------------ where the page lives */

/** The registry's route — mockup 21, `app/(app)/models/registry/page.tsx`. */
export const REGISTRY_PATH = "/models/registry";

/**
 * The registry with one alias already selected.
 *
 * The parameter is read on the **server** (`?alias=`), so the page arrives with the row selected
 * and the inspector's seat open on it in the first paint — which is what lets the parity pair
 * photograph the inspector and the chain card without driving the table first.
 *
 * @param alias - The alias to select.
 * @returns The path.
 */
export function registryPathFor(alias: string): string {
  return `${REGISTRY_PATH}?alias=${encodeURIComponent(alias)}`;
}

/** The page's `<h1>` — mockup 21's argument, verbatim (`app/registry/view.ts`). */
export const REGISTRY_TITLE = "Every model gets a name. Every route points at the name.";

/** The table's accessible name — its visually hidden `<caption>` (`TABLE_CAPTION`). */
export const TABLE_CAPTION = "Aliases, where each resolves, and whether it is on";

/** The table card's title — mockup 21's `ALLOWED MODELS`. */
export const TABLE_TITLE = "Allowed models";

/** The caption line under the table — mockup 21's, verbatim, and the rule the guard leg tests. */
export const TABLE_NOTE =
  "Aliases are unique per workspace. Deleting one is blocked while any route or workflow " +
  "references it.";

/** The why-card's title. */
export const WHY_TITLE = "Why aliases — the BYOK point";

/** The why-card's three claims, in order — the third is the one the governance test holds. */
export const WHY_ROWS = [
  "Swap providers, keep everything",
  "Same model, different keys",
  "Governance",
];

/** The chain card's title. */
export const CHAIN_TITLE = "Resolution chain";

/**
 * The inspector card's accessible name for a selected alias — mockup 21's `EDIT — CODER-MAX`.
 *
 * @param alias - The selected alias.
 * @returns The name.
 */
export function inspectorName(alias: string): string {
  return `Edit — ${alias}`;
}

/**
 * A table switch's accessible name. The column is **On** in a card called **Allowed models**,
 * and this is the verb the column is short for.
 *
 * @param alias - The row's alias.
 * @returns The name.
 */
export function switchName(alias: string): string {
  return `Allow ${alias}`;
}

/* ------------------------------------------------------------------ the seeded eight */

/** One row of the allowed-models table, as the seed makes it draw. */
export interface SeededRegistryRow {
  /** The alias — the row's identity, and what `?alias=` names. */
  readonly alias: string;
  /** The provider cell's name, or `null` for the unbound row, which draws *no provider*. */
  readonly provider: string | null;
  /** The raw model id — the only place in the product one renders (decision M1). */
  readonly model: string;
  /** CH.2's chips, in order; empty draws the em-dash. */
  readonly chips: readonly string[];
  /** The health cell's words — the state's word, or the note where the note is the word. */
  readonly health: string;
  /** The note beside the word, where the server has one the word does not already say. */
  readonly healthDetail: string | null;
  /** The `$ per 1M in·out` cell, as CH.3 resolved it. */
  readonly price: string;
  /** The `Used by` cell. */
  readonly usedBy: string;
  /** The **On** switch's position. */
  readonly enabled: boolean;
}

/** What a cell prints when there is nothing to print. */
export const EM_DASH = "—";

/** The unbound row's health cell, which is its note: mockup 21's `✗ no key — connect a provider`. */
export const NO_KEY = "no key — connect a provider";

/** The unbound row's way out, drawn inside its health cell. */
export const FIX_IN_PROVIDERS = "Fix in Providers →";

/**
 * The eight aliases, in the order the registry read serves them — **by name**, which is CH.5's
 * order and not mockup 21's (the drawing leads with `coder-max`). The order is asserted position
 * by position, so a service that started sorting some other way turns this leg red.
 *
 * **Three columns disagree with mockup 21, and the disagreement is settled in the data's
 * favour.** The drawing prices `claude-fable-5` at `$15 · $75` and `claude-sonnet-5` at
 * `$3 · $15`; the vendored catalog says otherwise, and `R__dev_seed_routing.sql`'s header records
 * CG.2's decision that the catalog wins. The drawing's `Used by` counts are its own too: the
 * seeded routes point at `coder-std`, `sizer` and `local-docs` more often than the artwork shows,
 * and the column is a count over the references that exist. Asserting the artwork would make
 * this leg red for discrepancies the roadmap has already resolved.
 */
export const SEEDED_REGISTRY: readonly SeededRegistryRow[] = [
  {
    alias: "coder-fallback",
    provider: "GitHub Copilot",
    model: "gpt-5-codex",
    chips: [],
    health: "degraded",
    healthDetail: "elevated latency",
    price: "seat-based",
    usedBy: "2 routes",
    enabled: true,
  },
  {
    alias: "coder-max",
    provider: "Anthropic Claude",
    model: "claude-fable-5",
    chips: ["max thinking", "400k budget"],
    health: "ok",
    healthDetail: null,
    price: "$10 · $50",
    usedBy: "4 routes",
    enabled: true,
  },
  {
    alias: "coder-std",
    provider: "Anthropic Claude",
    model: "claude-sonnet-5",
    chips: ["std thinking"],
    health: "ok",
    healthDetail: null,
    price: "$2 · $10",
    usedBy: "4 routes",
    enabled: true,
  },
  {
    alias: "gpt5-experiments",
    provider: null,
    model: "gpt-5.2-preview",
    chips: [],
    health: NO_KEY,
    healthDetail: null,
    price: EM_DASH,
    usedBy: "0 routes",
    enabled: false,
  },
  {
    alias: "local-docs",
    provider: "Ollama · workstation",
    model: "qwen3-coder:32b",
    chips: ["ctx 32k"],
    health: "ok",
    healthDetail: null,
    price: "$0",
    usedBy: "3 routes",
    enabled: true,
  },
  {
    alias: "local-free",
    provider: "OpenAI-compatible · local vLLM",
    model: "llama-4-maverick",
    chips: ["batch ok"],
    health: "ok",
    healthDetail: null,
    price: "$0",
    usedBy: "2 routes",
    enabled: true,
  },
  {
    alias: "second-opinion",
    provider: "Cursor",
    model: "composer-2",
    chips: ["review vote only"],
    health: "ok",
    healthDetail: null,
    price: "usage-based",
    usedBy: "1 route",
    enabled: true,
  },
  {
    alias: "sizer",
    provider: "Anthropic Claude",
    model: "claude-haiku-4-5",
    chips: ["temp 0", "8k out"],
    health: "ok",
    healthDetail: null,
    price: "$1 · $5",
    usedBy: "3 routes",
    enabled: true,
  },
];

/**
 * One seeded row, by its alias.
 *
 * @param alias - The alias.
 * @returns The row.
 * @throws {Error} If the seed has no such alias, naming the ones it has.
 */
export function seededAlias(alias: string): SeededRegistryRow {
  const found = SEEDED_REGISTRY.find((row) => row.alias === alias);

  if (found === undefined) {
    throw new Error(
      `the seeded registry has no ${alias} alias — it has ` +
        SEEDED_REGISTRY.map((row) => row.alias).join(", "),
    );
  }

  return found;
}

/**
 * What references `coder-max` — the inspector's **Used by** chips for the row mockup 21 opens
 * on, as V023's `ref_label` spells them: a route's tag, and an escalation's prefixed predicate.
 */
export const CODER_MAX_REFERRERS = [
  "plan-primary",
  "implement-primary",
  "review-primary",
  "escalation:effort≥L",
];

/**
 * Mockup 21's resolution chain for `coder-max`, from run #482's stored snapshot — the rail's
 * hops in order, and the tag that says it is a stored run rather than a simulation.
 */
export const CODER_MAX_CHAIN = {
  tag: "run #482",
  hops: [
    'route.task("implement")',
    "route implement-primary",
    "alias coder-max",
    "provider Anthropic",
    "model claude-fable-5",
  ],
  status: "resolved · 42ms",
  caption: "Every hop is inspectable in the run console transcript.",
} as const;

/* ------------------------------------------------------------------ what the leg writes */

/** The prefix every alias this leg creates carries — and what a teardown finds them by. */
export const RUN_ALIAS_PREFIX = "e2e-";

/**
 * A name for an alias this run creates, unique to the run.
 *
 * Aliases are unique per workspace and this suite runs against stacks that are not always torn
 * down, so a fixed name would pass once and answer `409 model_alias_name_taken` for ever after.
 * The prefix is what {@link removeRunAliases} finds them by if a test fails before its own
 * teardown could name them; lower-case base-36 keeps it inside the registry's kebab pattern.
 *
 * @param label - What the alias is for, in kebab case.
 * @returns The name.
 */
export function runAliasName(label: string): string {
  return `${RUN_ALIAS_PREFIX}${label}-${Date.now().toString(36)}`;
}

/**
 * The copy **Duplicate** makes, as CH.1 names it.
 *
 * @param alias - The alias duplicated.
 * @returns `<alias>-copy`.
 */
export function copyName(alias: string): string {
  return `${alias}-copy`;
}

/**
 * The binding the lifecycle test creates its alias on, and the one it rebinds it to.
 *
 * **Two connections of different kinds, on purpose.** The claim under test is *swap the provider
 * behind it and nothing else changes*, and a swap between two Anthropic keys would leave the
 * routing matrix's resolution line reading the same connection name before and after — a matrix
 * that never re-read the binding would pass. So the alias starts on the Anthropic connection and
 * moves to the local vLLM one, whose discovered catalog (`R__dev_seed_providers.sql`) lists a
 * model the first does not.
 */
export const LIFECYCLE_BINDING = {
  from: { connection: "Anthropic Claude", model: "claude-sonnet-5" },
  to: { connection: "OpenAI-compatible · local vLLM", model: "deepseek-v3.2" },
} as const;

/** The route the lifecycle test points at its alias, so the matrix has a line to redraw. */
export const LIFECYCLE_ROUTE = { kind: "docs", tag: "docs-primary" } as const;

/**
 * The route body that puts an alias at the head of {@link LIFECYCLE_ROUTE}'s chain.
 *
 * The seed's own chain with hop 1 replaced, so the only difference the matrix can draw is the
 * alias under test — and `sizer` stays behind it, so the route still has somewhere to degrade.
 *
 * @param alias - The alias to make the primary.
 * @returns The body `PUT /api/v1/routing/routes/docs` takes — a `RouteBody`, typed as a plain
 *   record too so `writeAs` accepts it without a cast.
 */
export function routeThrough(alias: string): RouteBody & Readonly<Record<string, unknown>> {
  const [, fallback] = SEEDED_ROUTES.docs.hops;

  return { ...SEEDED_ROUTES.docs, hops: [{ alias, note: null }, fallback] };
}

/**
 * The seeded alias the disable guard switches off: referenced, bound, and on a route whose
 * fallback is still usable when it is gone — so the simulation after it resolves rather than
 * fails, and the dropped hop is a reason under a result rather than the result.
 */
export const DISABLE_TARGET = {
  alias: "local-free",
  referrers: ["estimate-primary", "commitmsg-primary"],
  kind: "commit-msg",
  tag: "commitmsg-primary",
  fallback: "sizer",
} as const;

/** The connection the import test imports from, and the one model on it nothing names yet. */
export const IMPORT_SOURCE = { connection: "Anthropic Claude", model: "claude-opus-5" } as const;

/* ------------------------------------------------------------------ the registry, over the API */

/** The alias lifecycle's collection — CH.1 (#584). */
const ALIASES_API = "/api/v1/registry/aliases";

/** One alias as `GET /api/v1/registry/aliases` lists it — the two fields a teardown reads. */
interface ListedAlias {
  readonly id: string;
  readonly alias: string;
}

/**
 * Every alias in the context's workspace.
 *
 * Read for a **teardown** and nothing else, as `support/rest.ts` allows: a failed test may not
 * have written an id down, and that is the test that most needs cleaning up after.
 *
 * @param context - The context to act for.
 * @returns The aliases.
 */
async function listAliases(context: BrowserContext): Promise<readonly ListedAlias[]> {
  const answer = await requestAs<{ aliases: readonly ListedAlias[] }>(
    context,
    "GET",
    ALIASES_API,
    null,
    "listing the registry's aliases",
  );

  return answer?.aliases ?? [];
}

/**
 * Delete every alias this suite created, in any run.
 *
 * Found by {@link RUN_ALIAS_PREFIX} rather than by the names one test remembers, so an alias a
 * failed run left behind is taken too — a ninth row in a table whose parity is eight is a failure
 * the *next* run reports, against the wrong leg. Copies first, so an original is never still
 * being duplicated from when it goes. A route still pointing at one refuses its delete with a
 * `409`; the caller restores routes before calling this.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @returns When every delete has been attempted. It never throws — see `support/rest.ts`.
 */
export async function removeRunAliases(context: BrowserContext): Promise<void> {
  let aliases: readonly ListedAlias[] = [];

  await quietly(async () => {
    aliases = await listAliases(context);
  }, "the registry could not be listed, so this run's aliases were not removed —");

  const created = aliases
    .filter((row) => row.alias.startsWith(RUN_ALIAS_PREFIX))
    .sort((left, right) => right.alias.length - left.alias.length);

  for (const row of created) {
    await quietly(
      async () => {
        await requestAs(
          context,
          "DELETE",
          `${ALIASES_API}/${row.id}`,
          null,
          `removing ${row.alias}`,
        );
      },
      `${row.alias} was not removed — the next run's registry table, its count and its ` +
        "screenshots all see an alias nobody seeded.",
    );
  }
}

/**
 * Switch a seeded alias back on — the only position the seed leaves a bound alias in.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @param alias - The alias, as {@link SEEDED_REGISTRY} names it.
 * @returns When the restore has been attempted. It never throws.
 */
export async function restoreAliasEnabled(context: BrowserContext, alias: string): Promise<void> {
  await quietly(
    async () => {
      const row = (await listAliases(context)).find((candidate) => candidate.alias === alias);

      if (row === undefined) throw new Error(`the registry has no ${alias}`);

      await writeAs(
        context,
        "PATCH",
        `${ALIASES_API}/${row.id}`,
        { enabled: true },
        `switching ${alias} back on`,
      );
    },
    `${alias} was not switched back on — the next run's registry, its routing matrix and every ` +
      "simulation through it see a hop the seed never dropped.",
  );
}

/* ------------------------------------------------------------------ the governance draft */

/**
 * `standard-fix` — `workflows.id`, literal in `R__dev_seed_workflows.sql` (the rail's first).
 */
export const STANDARD_FIX_ID = "5eed001b-0000-4000-8000-000000000001";

/** The studio's route for it, and its `<h1>`. */
export const STANDARD_FIX = { path: "/workflows/standard-fix", title: "standard-fix" } as const;

/**
 * The stage the governance test pins to a raw model, the model, and what the gate answers.
 *
 * `plan` pins `coder-max` in the seeded document, and `coder-max` is bound to `claude-fable-5` —
 * so writing the raw id where the alias was is the exact mistake the why-card's third row
 * promises is refused, and the suggestion the gate offers back is the alias that was there.
 */
export const RAW_PIN = {
  stage: "plan",
  stageTitle: "Write attack plan",
  model: "claude-fable-5",
  message:
    "Stage `plan` pins the raw model id `claude-fable-5` — raw model ids are not allowed; " +
    "reference a registry alias (did you mean coder-max?).",
} as const;

/** The studio's refusal headline over a list of findings (`app/workflows/publish.ts`). */
export const FINDINGS_MESSAGE =
  "This definition cannot be published yet. Select a finding to go to the stage it is about — " +
  "nothing was published.";

/**
 * The seeded `standard-fix` document — the committed DSL fixture the seed copies byte for byte.
 *
 * **Read from the fixture rather than written out**, and that is not the rule `support/seed.ts`
 * argues against: this is the seed's own *input*, which `tests/seed.test.sh` in `ouroboros-db`
 * holds identical to the seeded draft, not a payload the product under test produced. Copying
 * three hundred lines of it into this file would be a second copy for that test to miss. It is
 * the value a restore puts back, never one read off the stack.
 *
 * @returns A fresh copy of the document.
 */
function seededDefinition(): Record<string, unknown> {
  const fixture = resolve(
    __dirname,
    "../../../schemas/workflow-dsl/fixtures/valid/standard-fix.json",
  );

  return JSON.parse(readFileSync(fixture, "utf8")) as Record<string, unknown>;
}

/**
 * Write `standard-fix`'s draft, guarded by the etag the service currently holds.
 *
 * `PUT …/draft` requires `If-Match` (P.4), which `support/rest.ts`'s helpers do not send: the
 * etag is read immediately before the write, so this is *the latest draft, replaced*, which is
 * what an arrangement and a restore both mean.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @param definition - The whole document.
 * @param what - What the write is for, for the failure message.
 * @returns When the service has stored it.
 * @throws {Error} If either request was refused, with the status and the body.
 */
async function writeDraft(
  context: BrowserContext,
  definition: Record<string, unknown>,
  what: string,
): Promise<void> {
  const path = `/api/v1/workflows/${STANDARD_FIX_ID}`;
  const detail = await requestAs<{ draft: { etag: string } }>(context, "GET", path, null, what);
  const token = await sessionTokenOf(context, what);

  const response = await fetch(`${REST_URL}${path}/draft`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${token}`,
      "if-match": detail?.draft.etag ?? "",
    },
    body: JSON.stringify({ definition }),
  });

  if (!response.ok) {
    throw new Error(`${what} answered ${response.status}: ${await response.text()}`);
  }
}

/**
 * Put a raw model id where {@link RAW_PIN}'s stage pins an alias, in `standard-fix`'s draft.
 *
 * A draft accepts it — drafts are works in progress, and V029 asks only that one be an object —
 * which is exactly why the refusal has to live at publish, and why this leg presses **Publish**
 * rather than asserting on a save.
 *
 * @param context - The context to act for.
 * @returns When the draft holds the raw pin.
 * @throws {Error} If the seeded document has no such stage, or the write was refused.
 */
export async function pinRawModel(context: BrowserContext): Promise<void> {
  const definition = seededDefinition();
  const nodes = definition.nodes as { id: string; config: Record<string, unknown> }[];
  const node = nodes.find((candidate) => candidate.id === RAW_PIN.stage);

  if (node === undefined) throw new Error(`standard-fix has no ${RAW_PIN.stage} stage`);

  node.config = { ...node.config, routing: { pinned_model: RAW_PIN.model } };

  await writeDraft(context, definition, `pinning ${RAW_PIN.stage} to ${RAW_PIN.model}`);
}

/**
 * Put `standard-fix`'s draft back exactly as the seed wrote it.
 *
 * @param context - The context to act for.
 * @returns When the restore has been attempted. It never throws.
 */
export function restoreStandardFixDraft(context: BrowserContext): Promise<void> {
  return quietly(
    () => writeDraft(context, seededDefinition(), "restoring standard-fix's draft"),
    "standard-fix's draft was not restored — the studio's canvas, the code view's file and " +
      "both their screenshot pairs start from a document that pins a raw model id.",
  );
}
