#!/usr/bin/env node
// price-catalog.mjs — the bundled model price catalog: vendored from upstream, and
// rendered into the repeatable migration that applies it.
//
// Decision **R4** makes pricing *data in the repository* rather than an API call on the
// render path (see the header of migrations/V012__model_prices.sql for why the three
// alternatives were rejected). That decision needs two things this verb provides, and one
// property it must never lose: **no network access at runtime**. Nothing here runs during
// a migration. `--vendor` is a developer refreshing the pin, everything else reads files.
//
//   --vendor   Refresh the vendored extract from upstream, at a pinned commit.
//              Downloads LiteLLM's model_prices_and_context_window.json and its licence,
//              prunes the entries to the providers this product can reach and the fields
//              it keeps, and writes catalog/litellm-model-prices.json with a provenance
//              block naming the commit, its date and the licence. The only mode that
//              touches the network, and the only one a release ever runs by hand.
//
//   --write    Render migrations/R__model_price_catalog.sql from that extract: one call
//              to ouroboros.import_model_price_catalog() carrying the rows as jsonb.
//              Deterministic — same extract, byte-identical output.
//
//   --check    Render and compare against the committed migration, without writing.
//              Fails when the two disagree, which is the case where somebody edited a
//              generated file or bumped the extract and forgot to re-render.
//              This is what ci/db runs; it needs neither a database nor a network.
//
// **The transform, in one place, because it is a claim about money.** Upstream publishes
// a cost per token as a floating-point number; this schema stores cents per one million
// tokens (`cost_per_token × 10^8`), rounded to the column's four decimal places. Two
// entries are refused rather than converted:
//
//   * one whose input or output cost is missing or zero — "unknown" and "free" are
//     different claims, and a hosted model that costs nothing is not something this
//     catalog will assert on a vendor's behalf. Locally served models are free by their
//     *kind*, which is what the house rows below are for.
//   * one whose non-zero cost rounds to zero cents per 1M — that would render `$0` for a
//     model somebody is being invoiced for, which is the exact lie the whole ticket
//     exists to prevent. It raises here rather than shipping.
//
// Usage:
//   ouroboros-db/scripts/price-catalog.mjs --check
//   ouroboros-db/scripts/price-catalog.mjs --write
//   ouroboros-db/scripts/price-catalog.mjs --vendor [--commit <sha>]
//   ouroboros-db/scripts/price-catalog.mjs --help
//
// Exit status: 0 the check passed / 1 it failed, naming the fix / 2 it could not run.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The module root, resolved from this file so the verb works from any directory. */
const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The vendored extract, and the licence it ships under. */
const EXTRACT_NAME = "catalog/litellm-model-prices.json";
const EXTRACT_PATH = join(MODULE_ROOT, EXTRACT_NAME);
const LICENCE_NAME = "catalog/LICENSE.litellm";
const LICENCE_PATH = join(MODULE_ROOT, LICENCE_NAME);

/** The generated migration, beside the versioned one that defines what it calls. */
const MIGRATION_NAME = "migrations/R__model_price_catalog.sql";
const MIGRATION_PATH = join(MODULE_ROOT, MIGRATION_NAME);

/** Where the extract comes from. Public, MIT, and read only by `--vendor`. */
const UPSTREAM = {
  repository: "BerriAI/litellm",
  path: "model_prices_and_context_window.json",
  licencePath: "LICENSE",
  licence: "MIT",
};

/**
 * Which upstream providers become which AC.1 (#216) provider kind.
 *
 * Deliberately short. An entry here is a claim that this product can *reach* those models
 * through that adapter, and a wrong one prices a model the user is not buying: upstream
 * carries a hundred and twenty-five providers, most of them gateways and resellers whose
 * rates are their own rather than the vendor's. `openai` maps to `openai_compatible`
 * because OpenAI's own API is the endpoint that adapter is named after.
 *
 * Adding a provider is a one-line change here plus a re-vendor, and the extract's
 * provenance block records what the mapping was when it was taken.
 */
const PROVIDER_KINDS = {
  anthropic: "anthropic",
  openai: "openai_compatible",
};

/** The upstream `mode` values that are a model this product would route work to. */
const KEPT_MODES = ["chat", "responses"];

/**
 * The capability flags carried into `meta`, as `{ourName: upstreamField}`.
 *
 * CH.2 (#585) reads these when a provider's own model list is unavailable, so the set is
 * "what a registry row shows", not "everything upstream publishes" — the rest stays
 * upstream, one `--vendor` away.
 */
const CAPABILITY_FLAGS = {
  reasoning: "supports_reasoning",
  function_calling: "supports_function_calling",
  vision: "supports_vision",
  prompt_caching: "supports_prompt_caching",
  response_schema: "supports_response_schema",
  web_search: "supports_web_search",
  pdf_input: "supports_pdf_input",
  computer_use: "supports_computer_use",
};

/**
 * The house rows: the three provider kinds whose billing is not per-token at all.
 *
 * Not from upstream — upstream has no rate for them *because there is no rate* — so they
 * are stated here, stamped `catalog_source: "ouroboros"` in `meta`, and shipped in the
 * same snapshot so one `catalog_version` covers the whole bundled catalog.
 *
 * `openai_compatible` is deliberately absent, and V012's header argues it at length: that
 * adapter fronts a local vLLM *and* `api.openai.com`, so a bundled `free` row for the kind
 * would price every uncovered OpenAI model at `$0`. A workspace running a local endpoint
 * says so in an override of its own.
 */
const HOUSE_ROWS = [
  {
    match_provider_kind: "copilot",
    match_model: "*",
    billing_mode: "seat",
    meta: {
      catalog_source: "ouroboros",
      note: "GitHub Copilot is billed per seat and per premium request, not per token — upstream publishes no rate for it, because there is none to publish.",
    },
  },
  {
    match_provider_kind: "cursor",
    match_model: "*",
    billing_mode: "usage",
    meta: {
      catalog_source: "ouroboros",
      note: "Cursor meters usage on terms this catalog cannot express as an input and an output rate.",
    },
  },
  {
    match_provider_kind: "ollama",
    match_model: "*",
    billing_mode: "free",
    meta: {
      catalog_source: "ouroboros",
      note: "The Ollama adapter talks to a local daemon, so every model reached through it runs on hardware the workspace already pays for. Free by kind, not by model.",
    },
  },
];

/** Cents per one million tokens, from a cost per token, at the column's own scale. */
const CENTS_PER_1M = 1e8;
const AMOUNT_SCALE = 4;

/**
 * Convert an upstream per-token cost into cents per one million tokens.
 *
 * @param {unknown} costPerToken - The upstream figure, in whole currency units per token.
 * @param {string} what - Model and field, for the message when it cannot be converted.
 * @returns {number} Cents per 1M tokens, rounded to the column's four decimal places.
 * @throws {Error} When the figure is not a positive number, or rounds away to nothing.
 */
function centsPer1M(costPerToken, what) {
  if (typeof costPerToken !== "number" || !Number.isFinite(costPerToken) || costPerToken <= 0) {
    throw new Error(`${what}: expected a positive cost per token, got ${costPerToken}`);
  }
  const cents = Number((costPerToken * CENTS_PER_1M).toFixed(AMOUNT_SCALE));
  if (cents <= 0) {
    throw new Error(
      `${what}: ${costPerToken} per token rounds to ${cents} cents per 1M, which would render as free`,
    );
  }
  return cents;
}

/**
 * Whether an upstream entry is one this catalog carries.
 *
 * @param {string} key - The upstream key, which is the model identifier.
 * @param {Record<string, unknown>} entry - The upstream entry.
 * @returns {boolean} True when it is kept.
 */
function isKept(key, entry) {
  // `sample_spec` is upstream's own documentation of the format, not a model.
  if (key === "sample_spec") return false;
  // A qualified key — `openai/container`, `ft:gpt-4o-2024-08-06` — is upstream's name for
  // a route or a fine-tune family, not an identifier a provider connection reports. The
  // lookup is by the model id the engine actually calls, so a key that is not one would
  // be a row nothing could ever match.
  if (/[:/]/.test(key)) return false;
  if (!Object.hasOwn(PROVIDER_KINDS, entry.litellm_provider)) return false;
  if (!KEPT_MODES.includes(entry.mode)) return false;
  // Unknown means absent — see the header.
  return typeof entry.input_cost_per_token === "number" && entry.input_cost_per_token > 0
    && typeof entry.output_cost_per_token === "number" && entry.output_cost_per_token > 0;
}

/** The upstream fields the extract keeps, beyond the two costs and the two identifiers. */
const KEPT_FIELDS = [
  "litellm_provider",
  "mode",
  "max_input_tokens",
  "max_output_tokens",
  "deprecation_date",
  ...Object.values(CAPABILITY_FLAGS),
];

/**
 * Prune an upstream catalog to the entries and fields this product keeps.
 *
 * Keys are emitted in sorted order so two vendors of the same commit produce the same
 * file, and a diff between two commits shows what upstream changed rather than how it
 * happened to be serialised.
 *
 * @param {Record<string, Record<string, unknown>>} upstream - The whole upstream document.
 * @returns {Record<string, Record<string, unknown>>} The extract's `models` block.
 */
export function prune(upstream) {
  const models = {};
  for (const key of Object.keys(upstream).sort()) {
    const entry = upstream[key];
    if (!entry || typeof entry !== "object" || !isKept(key, entry)) continue;
    const kept = { input_cost_per_token: entry.input_cost_per_token, output_cost_per_token: entry.output_cost_per_token };
    for (const field of KEPT_FIELDS) {
      if (entry[field] !== undefined && entry[field] !== null) kept[field] = entry[field];
    }
    models[key] = kept;
  }
  return models;
}

/**
 * Turn the extract into the rows the import function is given.
 *
 * @param {{provenance: Record<string, unknown>, models: Record<string, Record<string, unknown>>}} extract
 *   - The vendored extract.
 * @returns {Array<Record<string, unknown>>} The catalog rows, house rows first, then the
 *   vendored ones ordered by kind and model.
 */
export function rows(extract) {
  const vendored = Object.entries(extract.models).map(([model, entry]) => {
    const capabilities = {};
    for (const [name, field] of Object.entries(CAPABILITY_FLAGS)) {
      if (typeof entry[field] === "boolean") capabilities[name] = entry[field];
    }
    const meta = {
      catalog_source: "litellm",
      upstream_key: model,
      upstream_provider: entry.litellm_provider,
      mode: entry.mode,
    };
    if (typeof entry.max_input_tokens === "number") meta.context_tokens = entry.max_input_tokens;
    if (typeof entry.max_output_tokens === "number") meta.max_output_tokens = entry.max_output_tokens;
    if (entry.deprecation_date) meta.deprecation_date = entry.deprecation_date;
    if (Object.keys(capabilities).length > 0) meta.capabilities = capabilities;

    return {
      match_provider_kind: PROVIDER_KINDS[entry.litellm_provider],
      match_model: model,
      billing_mode: "token",
      input_cents_per_1m: centsPer1M(entry.input_cost_per_token, `${model}.input_cost_per_token`),
      output_cents_per_1m: centsPer1M(entry.output_cost_per_token, `${model}.output_cost_per_token`),
      meta,
    };
  });

  // Sorted by the lookup key, and by code points rather than by locale, so the ordering is
  // a property of the data rather than of the machine that rendered it.
  vendored.sort((a, b) =>
    a.match_provider_kind < b.match_provider_kind ? -1
    : a.match_provider_kind > b.match_provider_kind ? 1
    : a.match_model < b.match_model ? -1
    : a.match_model > b.match_model ? 1
    : 0);

  return [...HOUSE_ROWS, ...vendored];
}

/** The dollar-quote tag the rows are carried in. */
const QUOTE = "$catalog$";

/**
 * Render the repeatable migration.
 *
 * @param {{provenance: Record<string, unknown>, models: Record<string, Record<string, unknown>>}} extract
 *   - The vendored extract.
 * @returns {string} The file text, ending in a newline.
 * @throws {Error} When a row would break out of the dollar quote or collide with a Flyway
 *   placeholder — neither can happen with the fields kept above, and both would be a
 *   silent corruption of a migration if they ever did.
 */
export function render(extract) {
  const catalog = rows(extract);
  const { provenance } = extract;
  const body = catalog.map((row) => `    ${JSON.stringify(row)}`).join(",\n");

  if (body.includes(QUOTE)) {
    throw new Error("a catalog row contains the dollar-quote tag the rows are carried in");
  }
  if (body.includes("${")) {
    throw new Error("a catalog row contains ${, which Flyway would substitute as a placeholder");
  }

  return `-- R__model_price_catalog.sql — the bundled model price catalog, as rows.
--
-- **Generated. Do not edit.** Re-render it from the vendored extract with
--
--   ouroboros-db/scripts/price-catalog.mjs --write
--
-- and refresh that extract from upstream — the only step that touches a network, and one
-- nothing at migration time performs — with
--
--   ouroboros-db/scripts/price-catalog.mjs --vendor --commit <sha>
--
-- ci/db runs \`--check\`, so an edit here fails the pull request that made it.
--
-- ---------------------------------------------------------------------------
-- **Provenance.** Every row below is stamped \`catalog_version = '${provenance.catalog_version}'\`
-- and traces to one of two places:
--
--   * ${provenance.entries_kept} of them to **${UPSTREAM.repository}/${UPSTREAM.path}**, pinned at commit
--     ${provenance.commit}
--     (committed ${provenance.commit_date}), licensed ${UPSTREAM.licence} — see ${LICENCE_NAME} for the
--     copy that came with it. The vendored extract is ${EXTRACT_NAME};
--     it is a pruned subset of that file and nothing else, so it can be diffed against
--     upstream directly. ${provenance.entries_upstream} upstream entries were pruned to those ${provenance.entries_kept}: the
--     providers this product can reach (${Object.entries(PROVIDER_KINDS).map(([from, to]) => `${from} → ${to}`).join(", ")}), the
--     modes it routes work to (${KEPT_MODES.join(", ")}), and only entries carrying a
--     positive cost in both directions.
--
--   * ${HOUSE_ROWS.length} of them — ${HOUSE_ROWS.map((row) => `${row.match_provider_kind} (${row.billing_mode})`).join(", ")} — to this
--     repository, stamped \`meta.catalog_source = 'ouroboros'\`. They are the kinds whose
--     billing is not per-token at all, for which upstream publishes no rate because there
--     is none to publish.
--
-- **The transform**, which is scripts/price-catalog.mjs and is documented in its header:
-- upstream's cost per token becomes cents per one million tokens (× 10^8) at the column's
-- four decimal places; \`max_input_tokens\`, \`max_output_tokens\` and the capability flags
-- are carried into \`meta\` for CH.2 (#585); an entry whose cost is missing, zero, or
-- rounds to zero is refused rather than imported as free.
--
-- **Repeatable**, so Flyway re-applies it whenever this file changes — which is whenever
-- a new snapshot is rendered — and skips it otherwise. What it calls is idempotent either
-- way: see ouroboros.import_model_price_catalog() in V012__model_prices.sql for what it
-- guarantees, including that no organization's override is reachable from here.
--
-- Filed as issue #580 (CG.2).

select ouroboros.import_model_price_catalog(
  '${provenance.catalog_version}',
  '${provenance.commit_date}'::timestamptz,
  ${QUOTE}[
${body}
  ]${QUOTE}::jsonb
);
`;
}

/**
 * Fetch a file from the pinned upstream commit.
 *
 * @param {string} commit - The commit sha.
 * @param {string} path - The path within the upstream repository.
 * @returns {Promise<string>} The file's text.
 */
async function fetchUpstream(commit, path) {
  const url = `https://raw.githubusercontent.com/${UPSTREAM.repository}/${commit}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

/**
 * Refresh the vendored extract from upstream.
 *
 * @param {string|null} commit - The commit to pin to, or null to keep the extract's own.
 * @returns {Promise<number>} The exit code.
 */
async function vendor(commit) {
  let pinned = commit;
  if (!pinned) {
    try {
      pinned = JSON.parse(readFileSync(EXTRACT_PATH, "utf8")).provenance.commit;
    } catch {
      console.error(`price-catalog: no extract to take a commit from — pass --commit <sha>.`);
      return 2;
    }
    console.log(`price-catalog: re-vendoring the pin the extract already carries, ${pinned}`);
  }
  if (!/^[0-9a-f]{40}$/.test(pinned)) {
    console.error(`price-catalog: --commit needs a full 40-character sha, not ${pinned}`);
    return 2;
  }

  // The commit's own date, which becomes both half of the catalog version and the
  // `effective_at` every bundled row carries. Taken from the API rather than from this
  // machine's clock: the snapshot's prices took effect when upstream published them, and
  // re-vendoring the same commit must produce the same file.
  const api = await fetch(`https://api.github.com/repos/${UPSTREAM.repository}/commits/${pinned}`);
  if (!api.ok) throw new Error(`asking GitHub about commit ${pinned} answered ${api.status}`);
  const commitDate = (await api.json()).commit.committer.date;

  const upstream = JSON.parse(await fetchUpstream(pinned, UPSTREAM.path));
  const models = prune(upstream);
  const extract = {
    provenance: {
      upstream: `https://github.com/${UPSTREAM.repository}/blob/${pinned}/${UPSTREAM.path}`,
      repository: UPSTREAM.repository,
      path: UPSTREAM.path,
      commit: pinned,
      commit_date: commitDate,
      licence: `${UPSTREAM.licence} — the copy that came with it is ${LICENCE_NAME}`,
      catalog_version: `${commitDate.slice(0, 10)}+litellm.${pinned.slice(0, 7)}`,
      provider_kinds: PROVIDER_KINDS,
      modes: KEPT_MODES,
      entries_upstream: Object.keys(upstream).length,
      entries_kept: Object.keys(models).length,
      transform: "ouroboros-db/scripts/price-catalog.mjs",
      note: "Generated by --vendor. A pruned subset of the upstream file at the pinned commit, and nothing else — every value here is upstream's, so this file can be diffed against it directly.",
    },
    models,
  };

  writeFileSync(EXTRACT_PATH, `${JSON.stringify(extract, null, 2)}\n`);
  writeFileSync(LICENCE_PATH, await fetchUpstream(pinned, UPSTREAM.licencePath));
  console.log(
    `price-catalog: ${EXTRACT_NAME} written — ${extract.provenance.entries_kept} of ${extract.provenance.entries_upstream} entries, at ${extract.provenance.catalog_version}`,
  );
  return renderMigration(false);
}

/**
 * Render the migration, or compare the committed one against a fresh rendering.
 *
 * @param {boolean} check - Whether to compare rather than write.
 * @returns {number} The exit code.
 */
function renderMigration(check) {
  let extract;
  try {
    extract = JSON.parse(readFileSync(EXTRACT_PATH, "utf8"));
  } catch (error) {
    console.error(`price-catalog: could not read ${EXTRACT_NAME}: ${error.message}`);
    return 2;
  }

  const fresh = render(extract);
  if (!check) {
    writeFileSync(MIGRATION_PATH, fresh);
    console.log(`price-catalog: ${MIGRATION_NAME} written — ${rows(extract).length} rows`);
    return 0;
  }

  let committed;
  try {
    committed = readFileSync(MIGRATION_PATH, "utf8");
  } catch {
    console.error(`price-catalog: ${MIGRATION_NAME} is missing — run this with --write.`);
    return 1;
  }

  if (committed === fresh) {
    console.log(`price-catalog: ${MIGRATION_NAME} is what ${EXTRACT_NAME} renders`);
    return 0;
  }

  console.error(`price-catalog: ${MIGRATION_NAME} is not what ${EXTRACT_NAME} renders.

Either the migration was edited by hand — it is generated, and the extract is where a
price is corrected — or the extract moved and the migration was not re-rendered:

  ouroboros-db/scripts/price-catalog.mjs --write

A workspace correcting a price for itself does not touch either file: that is an override
row in ouroboros.model_prices, which no re-import can overwrite.`);
  return 1;
}

/**
 * Run the verb.
 *
 * @param {string[]} argv - Command-line arguments.
 * @returns {Promise<number>} The exit code: `0` the check passed, `1` it failed naming
 *   the fix, `2` it could not run.
 */
export async function main(argv) {
  const mode = argv[0];
  if (!mode || mode === "--help" || mode === "-h") {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("//"))
      .map((line) => line.slice(3))
      .join("\n"));
    return mode ? 0 : 2;
  }
  if (!["--check", "--write", "--vendor"].includes(mode)) {
    console.error(`price-catalog: unknown argument: ${mode}`);
    return 2;
  }

  let commit = null;
  const rest = argv.slice(1);
  while (rest.length > 0) {
    const argument = rest.shift();
    if (argument === "--commit" && rest.length > 0) {
      commit = rest.shift();
    } else if (argument.startsWith("--commit=")) {
      commit = argument.slice("--commit=".length);
    } else {
      console.error(`price-catalog: unknown argument: ${argument}`);
      return 2;
    }
    if (mode !== "--vendor") {
      console.error(`price-catalog: --commit only means something with --vendor`);
      return 2;
    }
  }

  try {
    return mode === "--vendor" ? await vendor(commit) : renderMigration(mode === "--check");
  } catch (error) {
    console.error(`price-catalog: ${error.message}`);
    return 2;
  }
}

process.exit(await main(process.argv.slice(2)));
