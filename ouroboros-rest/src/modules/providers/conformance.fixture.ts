/**
 * The conformance kit — the suite every model provider adapter has to pass, and the reason
 * *"it works against my provider"* is a test result rather than a claim.
 *
 * AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)), mirroring WF-Q.5
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)) — the kit that gates the
 * ticket-source SPI. An adapter author writes one spec file:
 *
 * ```ts
 * describeAdapterConformance(() => ({ adapter: new OllamaAdapter(), … }));
 * ```
 *
 * …and gets roughly thirty assertions about things that are otherwise discovered by AE.2 in a
 * browser: that failures are values and not exceptions, that a detail never quotes the
 * credential, that a config schema is one AE.5 can actually render, that a param schema offers
 * only tunables `model_aliases.params` can store (CH.2,
 * [#585](https://github.com/NobuData/ouroboros/issues/585)), and that the `pull` flag and the
 * `pullModel` member agree.
 *
 * ---------------------------------------------------------------------------
 * **Why the checks are functions returning lists of sentences.**
 *
 * Every rule below is a `…Violations(…) => string[]` with an `it` wrapped round it, rather than
 * a body full of `expect`s. Two things fall out of that and both are worth the small
 * awkwardness:
 *
 *   * **The kit is testable.** `conformance.fixture.spec.ts` runs each check against an adapter
 *     that is wrong on purpose and asserts it is caught. A conformance kit nobody has watched
 *     fail is a conformance kit that passes everything.
 *   * **One run reports every problem.** A new adapter with six things wrong is six sentences,
 *     not six edit-and-rerun cycles.
 *
 * ---------------------------------------------------------------------------
 * **Why every adapter must record a fixture for all five error classes.**
 *
 * There is no *"this class cannot happen for my provider"* escape hatch, and that is
 * deliberate. Every one of the five is arrangeable for every adapter that talks HTTP — a `401`,
 * a refused socket, a `503`, a `429`, a `404` from a wrong address — and an author who cannot
 * produce one has not decided what their adapter does about it. The alternative shape, an
 * optional map with a reason string, produces a kit whose coverage silently shrinks one
 * adapter at a time.
 *
 * The fixtures themselves are **recorded**, not live: a harness arranges a stand-in `fetch`
 * over a captured response and calls the adapter. The kit never opens a socket, which is what
 * lets it run in the unit suite where `yarn test` will actually notice it.
 *
 * ---------------------------------------------------------------------------
 * **It is a `.fixture.ts`.** `tsconfig.build.json` leaves those out of the image alongside the
 * specs — see `docs/CONVENTIONS.md` and the README's layout table — so the kit is type-checked
 * with the code it gates and shipped with none of it.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import {
  supportsPull,
  validationPill,
  type ModelPullProgress,
  type ModelProviderAdapter,
  type NormalizedModel,
  type ProviderConnectionContext,
  type ProviderValidation,
} from "./provider.adapter";
import {
  configSchemaViolations,
  type ProviderConfigSchema,
  type ProviderConnectionConfig,
} from "./provider.config";
import { paramSchemaViolations, storageViolations, type ModelParamSchema } from "./provider.params";
import {
  CONNECTED_PILL,
  PROVIDER_ERROR_CLASSES,
  PROVIDER_ERROR_PILLS,
  type ProviderErrorClass,
} from "./provider.errors";
import { toParamFields } from "./param.forms";
import { secretFieldName, storedConfigSchema, toFormFields } from "./provider.forms";

/**
 * Everything the kit needs from an adapter author.
 *
 * The thunks are where the recording lives: each one installs the adapter's own captured
 * response and calls the member, so the kit stays transport-agnostic. An adapter over HTTP
 * stubs `fetch`; the in-memory fake scripts its next answer; a future adapter over a socket
 * does whatever it does. None of that is the kit's business — what the kit checks is the
 * contract on the way back out.
 */
export interface AdapterConformance {
  /** The adapter under test. */
  readonly adapter: ModelProviderAdapter;
  /**
   * The credential the arranged calls use, or null for an adapter that needs none.
   *
   * The kit searches every rendered `detail` for this string. It must therefore be a value
   * distinctive enough to find — a realistic-looking key, not `"x"` — and the harness must
   * really pass it to the adapter, or the check proves nothing.
   */
  readonly secret: string | null;
  /**
   * A **stored** configuration the adapter considers well-formed — the submission minus the
   * credential, which is what `provider_connections.config` holds and what
   * {@link ProviderConnectionContext.config} hands back.
   *
   * Empty is a legitimate value: an adapter whose only field is the key row has nothing else
   * to store. It is validated against `storedConfigSchema()`, and the submission the form
   * would have made — this plus {@link secret} — against the schema itself. See
   * {@link ajvViolations}.
   */
  readonly sampleConfig: ProviderConnectionConfig;
  /** A `validate` call arranged from a recorded success. */
  readonly validateSuccess: () => Promise<ProviderValidation>;
  /**
   * One arranged `validate` call per error class.
   *
   * A total `Record`, so an author cannot leave one out — see this file's header.
   */
  readonly validateFailures: Readonly<
    Record<ProviderErrorClass, () => Promise<ProviderValidation>>
  >;
  /** A `discoverModels` call arranged from a recorded listing. */
  readonly discover: () => Promise<NormalizedModel[]>;
  /**
   * What that recorded listing must normalize to, written out in full.
   *
   * The point of the kit's discovery leg: normalization is where two adapters most easily
   * disagree — one trims a vendor prefix, another does not — and the only way to check it is to
   * state the answer.
   */
  readonly expectedModels: readonly NormalizedModel[];
  /**
   * The models whose param schemas the kit checks, beyond the ones discovery reported.
   *
   * Empty is the ordinary answer: the kit already asks for a schema for every id in
   * {@link expectedModels}, which is what a real connection would be offering fields for. An
   * adapter whose schema *varies* by model names the ids that take the other branch here — the
   * Anthropic adapter lists a pre-thinking Claude — so that both branches are checked against
   * the dialect and against what the database will store, rather than only the one its
   * recording happened to contain.
   */
  readonly paramModels: readonly string[];
  /**
   * A `pullModel` call, arranged. Required exactly when `capabilities().pull` is true, and the
   * kit fails on either mismatch.
   */
  readonly pull: (() => AsyncIterable<ModelPullProgress>) | null;
}

/**
 * Everything wrong with an adapter's capability declaration.
 *
 * @param adapter - The adapter.
 * @returns The violations.
 */
export function capabilityViolations(adapter: ModelProviderAdapter): string[] {
  const violations: string[] = [];
  const capabilities = adapter.capabilities();

  for (const flag of ["discovery", "pull", "entitlements", "invocation"] as const) {
    if (typeof capabilities[flag] !== "boolean") {
      violations.push(`capabilities().${flag} must be a boolean`);
    }
  }

  // Stability, checked by value rather than by identity: an adapter is free to build a fresh
  // object each call, and several will, because returning a shared mutable one is the bug this
  // is guarding against from the other side.
  if (JSON.stringify(adapter.capabilities()) !== JSON.stringify(capabilities)) {
    violations.push("capabilities() must answer the same flags every call");
  }

  const declared = capabilities.pull;
  const present = typeof (adapter as { pullModel?: unknown }).pullModel === "function";

  if (declared !== present) {
    violations.push(
      `capabilities().pull is ${declared.toString()} but pullModel is ` +
        `${present ? "present" : "absent"} — the flag is what supportsPull narrows on`,
    );
  }

  if (supportsPull(adapter) !== declared) {
    violations.push("supportsPull disagrees with capabilities().pull");
  }

  // AF.2 (#235) is what implements invocation. An adapter claiming it today would be claiming a
  // member that does not exist on any interface yet, which is the reservation being spent
  // rather than kept.
  if (capabilities.invocation) {
    violations.push("capabilities().invocation is reserved for AF.2 (#235) and must be false");
  }

  return violations;
}

/**
 * Everything wrong with an adapter's config schema, beyond the dialect itself.
 *
 * The dialect is `configSchemaViolations`' job and this calls it first. What is added here is
 * the part that only makes sense with an *adapter* in hand: stability, isolation from the
 * caller, and agreement between the schema's secret field and the credential the harness says
 * the adapter needs.
 *
 * @param adapter - The adapter.
 * @param secret - The credential the harness uses, or null.
 * @param sampleConfig - A configuration the adapter considers well-formed, validated against
 *   the schema so an adapter cannot ship one its own add-form would reject.
 * @returns The violations.
 */
export function schemaViolations(
  adapter: ModelProviderAdapter,
  secret: string | null,
  sampleConfig: ProviderConnectionConfig,
): string[] {
  const schema = adapter.configSchema();
  const violations = configSchemaViolations(schema);

  if (violations.length > 0) {
    // Everything below reads the schema's own structure, and a schema that failed the dialect
    // has no structure worth reading. Reporting the dialect violations alone is the useful
    // answer; adding cascade failures to them is not.
    return violations;
  }

  if (JSON.stringify(adapter.configSchema()) !== JSON.stringify(schema)) {
    violations.push("configSchema() must answer the same schema every call");
  }

  // The caller is AE.5, which will hold this value while somebody fills in a form. An adapter
  // handing out its own internal object would have that form's edits land in the adapter.
  const tampered = adapter.configSchema() as { title: string };
  tampered.title = `${tampered.title} (tampered)`;

  if (adapter.configSchema().title === tampered.title) {
    violations.push("configSchema() must not hand out a value the caller can mutate back in");
  }

  const secretField = secretFieldName(schema);

  if (secret !== null && secretField === null) {
    violations.push(
      "the harness supplies a credential but the schema marks no x-ouroboros-secret field, " +
        "so AE.5 would render no way to enter one",
    );
  }

  if (secret === null && secretField !== null) {
    violations.push(
      `the schema marks "${secretField}" as the credential but the harness supplies none, ` +
        "so the recorded fixtures never exercise the field the form would collect",
    );
  }

  violations.push(...formViolations(schema));
  violations.push(...ajvViolations(schema, adapter.kind, sampleConfig, secret));

  return violations;
}

/**
 * Everything wrong with the form this schema renders as.
 *
 * AC.1's third acceptance criterion, checked per adapter rather than only against the recorded
 * card shapes: `toFormFields` is total, one field per property, in order, and every one of them
 * has something a `<label>` can say.
 *
 * @param schema - The adapter's schema, already known to be in the dialect.
 * @returns The violations.
 */
function formViolations(schema: ProviderConfigSchema): string[] {
  const violations: string[] = [];
  const fields = toFormFields(schema);
  const names = Object.keys(schema.properties);

  if (fields.map((field) => field.name).join() !== names.join()) {
    violations.push("toFormFields must answer one field per property, in properties order");
  }

  for (const field of fields) {
    if (field.label.length === 0) {
      violations.push(`field "${field.name}" renders with an empty label`);
    }
  }

  // The order is a contract — `provider.config.ts` says why — and the way it breaks is a schema
  // that has travelled through something which does not preserve key order. Round-tripping is
  // the cheapest way to notice, and the wire between here and AE.5 is JSON.
  const roundTripped = JSON.parse(JSON.stringify(schema)) as ProviderConfigSchema;

  if (Object.keys(roundTripped.properties).join() !== names.join()) {
    violations.push("field order must survive a JSON round trip");
  }

  return violations;
}

/**
 * Everything Ajv says about the schema, about the form it validates, and about the stored
 * configuration underneath it.
 *
 * The dialect check in `provider.config.ts` knows this codebase's extra rules; Ajv knows JSON
 * Schema. Both matter: AE.5 may hand the schema to a generic validator, and a schema that
 * rejected its own adapter's sample values would fail the add-form on values the adapter
 * considers correct.
 *
 * **Two schemas are checked, because there are two.** `configSchema()` describes the *form* —
 * every row including the key row — and what a submitted form validates against is that. What
 * reaches `provider_connections.config` is the same object with the credential removed, so it
 * validates against `storedConfigSchema()`. Checking a stored config against the form's schema
 * would fail every adapter whose credential is mandatory, which is most of them; checking a
 * submission against the stored projection would never exercise the key row's own `minLength`.
 * Each value is therefore checked against the schema it is actually governed by.
 *
 * @param schema - The adapter's schema.
 * @param kind - The adapter's kind, used only as each compiled schema's `$id` so two in one run
 *   cannot collide.
 * @param sampleConfig - The stored configuration to validate.
 * @param secret - The credential the harness uses, or null. Put back into the sample as the
 *   form would have submitted it, so the key row's own keywords are exercised.
 * @returns The violations.
 */
function ajvViolations(
  schema: ProviderConfigSchema,
  kind: string,
  sampleConfig: ProviderConnectionConfig,
  secret: string | null,
): string[] {
  // `strict: false` for the reason `openapi.spec.ts` sets it: the schema carries `x-ouroboros-…`
  // annotations, which are JSON Schema's own extension mechanism and which strict mode reports
  // as unknown keywords.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  const secretField = secretFieldName(schema);
  const submission =
    secretField === null || secret === null
      ? { ...sampleConfig }
      : { ...sampleConfig, [secretField]: secret };

  let validateSubmission;
  let validateStored;

  try {
    validateSubmission = ajv.compile({ ...schema, $id: `urn:ouroboros:provider-config:${kind}` });
    validateStored = ajv.compile({
      ...storedConfigSchema(schema),
      $id: `urn:ouroboros:provider-config:${kind}:stored`,
    });
  } catch (error) {
    return [`schema is not valid JSON Schema: ${describeThrown(error)}`];
  }

  const violations: string[] = [];

  if (!validateSubmission(submission)) {
    violations.push(
      `the adapter's own sample submission is rejected by its schema: ${ajv.errorsText(validateSubmission.errors)}`,
    );
  }

  if (!validateStored(sampleConfig)) {
    violations.push(
      `the adapter's own sample config is rejected by its stored-config schema: ${ajv.errorsText(validateStored.errors)}`,
    );
  }

  return violations;
}

/**
 * Everything wrong with an adapter's param schemas, across every model the harness names.
 *
 * CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)) added this leg, and it checks
 * four things per model. Three are {@link schemaViolations}' checks in the other dialect —
 * the dialect itself, stability, and that the value cannot be mutated back into the adapter —
 * and the fourth is the one this ticket exists for:
 *
 * **Every param offered must be one `model_aliases.params` can store.** A schema offering a
 * sixth key, or a temperature ceiling above V019's, renders a control somebody fills in
 * correctly and cannot save. `storageViolations` is that rule and this is where an adapter
 * author meets it — in their own test run, rather than at somebody's **Save alias**.
 *
 * Ajv compiles each schema too, for `ajvViolations`' reason: the same document is what CH.1's
 * writes are validated with, so a schema a generic validator will not compile is a schema that
 * would take the save path down rather than refuse a field.
 *
 * @param adapter - The adapter.
 * @param modelIds - The models to ask about. At least one; the suite passes the recorded
 *   listing's ids plus {@link AdapterConformance.paramModels}.
 * @returns The violations, each naming the model it is about.
 */
export function paramViolations(
  adapter: ModelProviderAdapter,
  modelIds: readonly string[],
): string[] {
  if (modelIds.length === 0) {
    // Not a pass. An adapter whose recorded listing is empty and which names no extra models
    // has had its param schema checked against nothing at all, and a leg of the kit that
    // silently covers zero cases is worse than one that fails.
    return ["no model to ask for a param schema — record a listing or name one in paramModels"];
  }

  const violations: string[] = [];

  for (const modelId of modelIds) {
    const at = `paramSchema("${modelId}")`;
    const schema = adapter.paramSchema(modelId);
    const dialect = paramSchemaViolations(schema);

    if (dialect.length > 0) {
      // Everything below reads the schema's own structure, and a schema that failed the
      // dialect has none worth reading — `schemaViolations` stops for the same reason.
      violations.push(...dialect.map((violation) => `${at}: ${violation}`));

      continue;
    }

    violations.push(...storageViolations(schema).map((violation) => `${at}: ${violation}`));

    if (JSON.stringify(adapter.paramSchema(modelId)) !== JSON.stringify(schema)) {
      violations.push(`${at} must answer the same schema every call`);
    }

    // The caller is the alias inspector, holding this while somebody fills in a form.
    const tampered = adapter.paramSchema(modelId) as { title: string };
    tampered.title = `${tampered.title} (tampered)`;

    if (adapter.paramSchema(modelId).title === tampered.title) {
      violations.push(`${at} must not hand out a value the caller can mutate back in`);
    }

    violations.push(...paramAjvViolations(at, adapter.kind, modelId, schema));

    // The renderer has to be total over it, which is the other half of "no UI special-casing":
    // one field per property, in order, each with something a `<label>` can say.
    const fields = toParamFields(schema);
    const names = Object.keys(schema.properties);

    if (fields.map((field) => field.name).join() !== names.join()) {
      violations.push(`${at}: toParamFields must answer one field per param, in schema order`);
    }

    for (const field of fields) {
      if (field.label.length === 0) {
        violations.push(`${at}: param "${field.name}" renders with an empty label`);
      }
    }

    // Field order is a contract for `provider.config.ts`'s reason, and the way it breaks is a
    // schema that has travelled through something which does not preserve key order.
    const roundTripped = JSON.parse(JSON.stringify(schema)) as ModelParamSchema;

    if (Object.keys(roundTripped.properties).join() !== names.join()) {
      violations.push(`${at}: param order must survive a JSON round trip`);
    }
  }

  return violations;
}

/**
 * What Ajv says about one param schema.
 *
 * Separate from `ajvViolations` because there is nothing to submit through it: a param document
 * is optional throughout, so the value worth checking is the empty object — the state seven of
 * mockup 21's eight rows are in, and the one a newly created alias starts in. A schema that
 * rejected `{}` would refuse every alias nobody has tuned.
 *
 * @param at - The sentence prefix naming the model.
 * @param kind - The adapter's kind, used only as the compiled schema's `$id` so two in one run
 *   cannot collide.
 * @param modelId - The model, likewise part of the `$id`.
 * @param schema - The schema.
 * @returns The violations.
 */
function paramAjvViolations(
  at: string,
  kind: string,
  modelId: string,
  schema: ModelParamSchema,
): string[] {
  // `strict: false` for `ajvViolations`' reason: the schema carries `x-ouroboros-…`
  // annotations, which strict mode reports as unknown keywords.
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  let validate;

  try {
    validate = ajv.compile({
      ...schema,
      $id: `urn:ouroboros:model-params:${kind}:${encodeURIComponent(modelId)}`,
    });
  } catch (error) {
    return [`${at} is not valid JSON Schema: ${describeThrown(error)}`];
  }

  return validate({})
    ? []
    : [`${at} rejects an empty params document: ${ajv.errorsText(validate.errors)}`];
}

/**
 * A thrown value, as a sentence.
 *
 * @param error - Whatever was caught.
 * @returns Its message, or the value rendered.
 */
function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Everything wrong with what a `validate` call answered.
 *
 * @param validation - What the adapter answered.
 * @param expected - The class the recorded fixture was arranged to produce, or `null` for the
 *   success fixture.
 * @param secret - The credential the call was made with, or null. Searched for in the detail.
 * @returns The violations.
 */
export function validationViolations(
  validation: ProviderValidation,
  expected: ProviderErrorClass | null,
  secret: string | null,
): string[] {
  const violations: string[] = [];

  if (validation.detail.length === 0) {
    violations.push("detail must say something — it is what the card foot prints");
  }

  // The shortest path to a leaked key is an adapter that echoes a provider's error body, and
  // provider error bodies quote request headers. Checked on success too: a chatty success note
  // is the same leak with a green glyph in front of it.
  if (secret !== null && secret.length > 0 && validation.detail.includes(secret)) {
    violations.push("detail contains the credential");
  }

  if (expected === null) {
    if (validation.status !== "ok") {
      violations.push(`the success fixture answered ${validation.status}: ${validation.detail}`);

      return violations;
    }

    if (!Number.isInteger(validation.latencyMs) || validation.latencyMs < 0) {
      violations.push("latencyMs must be a non-negative whole number of milliseconds");
    }

    if (validationPill(validation) !== CONNECTED_PILL) {
      violations.push("a successful validation must render the connected pill");
    }

    return violations;
  }

  if (validation.status !== "failed") {
    violations.push(`the ${expected} fixture answered ok`);

    return violations;
  }

  if (validation.errorClass !== expected) {
    violations.push(`the ${expected} fixture was classified ${validation.errorClass}`);

    return violations;
  }

  if (validationPill(validation) !== PROVIDER_ERROR_PILLS[expected]) {
    violations.push(`a ${expected} failure must render the ${expected} pill`);
  }

  return violations;
}

/**
 * Everything wrong with a discovered model list.
 *
 * @param models - What `discoverModels` answered.
 * @returns The violations.
 */
export function normalizedModelViolations(models: readonly NormalizedModel[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const [index, model] of models.entries()) {
    const at = `model ${index.toString()}`;

    if (typeof model.id !== "string" || model.id.length === 0) {
      violations.push(`${at}: id must be a non-empty string`);
    } else if (seen.has(model.id)) {
      // Two rows with the same id become two chips a person cannot tell apart, and an alias
      // resolving against the catalog then has two candidates and no rule for choosing.
      violations.push(`${at}: id "${model.id}" is a duplicate`);
    } else {
      seen.add(model.id);
    }

    if (typeof model.display !== "string" || model.display.length === 0) {
      violations.push(`${at}: display must be a non-empty string — a chip needs text`);
    }

    violations.push(...measureViolations(at, "contextLength", model.contextLength, 1));
    violations.push(...measureViolations(at, "sizeBytes", model.sizeBytes, 0));
    violations.push(...tierViolations(at, model.tier));
  }

  return violations;
}

/**
 * Whether a reported service tier is absent or a word worth rendering.
 *
 * The shape half of decision **P8**. A kit cannot see whether an adapter *read* its tier from
 * a response or made it up — that is what each adapter's own recorded fixtures are for, and
 * why the Anthropic suite records a listing with the signal and one without. What a kit can
 * refuse is the shape that turns *nothing was said* into a pill: an empty string, which is
 * falsy in the adapter and truthy nowhere useful, and reaches `provider_models.meta.tier` as
 * a value that a `tier is not null` read then treats as an entitlement.
 *
 * @param at - Which model, for the message.
 * @param tier - What the adapter answered.
 * @returns The violations.
 */
function tierViolations(at: string, tier: string | null): string[] {
  if (tier === null) {
    return [];
  }

  return typeof tier === "string" && tier.length > 0
    ? []
    : [`${at}: tier must be null or a non-empty string — an absent signal is null (P8)`];
}

/**
 * Whether one optional numeric measure is absent or a sane number.
 *
 * `null` means *the provider did not say*, and that is always acceptable. What is not is a
 * fabricated zero, a fraction of a byte, or a `NaN` from a parse nobody checked — each of which
 * reaches a card as a confident-looking number.
 *
 * @param at - Which model, for the message.
 * @param field - The field's name.
 * @param value - What the adapter answered.
 * @param floor - The smallest meaningful value: `1` for a context length, `0` for a size.
 * @returns The violations.
 */
function measureViolations(
  at: string,
  field: string,
  value: number | null,
  floor: number,
): string[] {
  if (value === null) {
    return [];
  }

  if (!Number.isInteger(value) || value < floor) {
    return [`${at}: ${field} must be null or a whole number of at least ${floor.toString()}`];
  }

  return [];
}

/**
 * Everything wrong with a pull stream.
 *
 * @param events - Every event the stream produced, in order.
 * @returns The violations.
 */
export function pullStreamViolations(events: readonly ModelPullProgress[]): string[] {
  const violations: string[] = [];

  if (events.length === 0) {
    return ["a pull must report at least one event"];
  }

  const terminal = events.filter((event) => event.done);

  if (terminal.length !== 1 || !events[events.length - 1].done) {
    // Completion is a statement the stream makes, not something inferred from an iterator
    // finishing — see `ModelPullProgress.done`. A stream that just stops is what a pull looks
    // like when the daemon dies half way through.
    violations.push("exactly one event must carry done: true, and it must be the last");
  }

  for (const [index, event] of events.entries()) {
    const at = `event ${index.toString()}`;

    if (event.status.length === 0) {
      violations.push(`${at}: status must say what is happening`);
    }

    violations.push(...measureViolations(at, "completedBytes", event.completedBytes, 0));
    violations.push(...measureViolations(at, "totalBytes", event.totalBytes, 0));

    if (
      event.completedBytes !== null &&
      event.totalBytes !== null &&
      event.completedBytes > event.totalBytes
    ) {
      violations.push(`${at}: completedBytes exceeds totalBytes`);
    }
  }

  return violations;
}

/**
 * A connection context built from a harness, for the members that take one.
 *
 * @param harness - The harness.
 * @returns The context. The connection id is a fixed, obviously-synthetic uuid: an adapter that
 *   sent it to a provider would be sending a workspace's internal identifier, and a recorded
 *   fixture is where that shows up.
 */
export function conformanceContext(harness: AdapterConformance): ProviderConnectionContext {
  return {
    connectionId: "00000000-0000-4000-8000-000000000216",
    config: harness.sampleConfig,
    secret: harness.secret,
  };
}

/**
 * The suite.
 *
 * @param name - What the adapter is called, for the `describe` block.
 * @param build - Builds the harness. A function rather than a value so each `it` gets a fresh
 *   adapter and a fresh recording — a kit whose cases shared one stubbed `fetch` would pass or
 *   fail depending on the order Jest ran them in.
 */
export function describeAdapterConformance(name: string, build: () => AdapterConformance): void {
  describe(`${name} — ModelProviderAdapter conformance`, () => {
    it("keys on one of V015's provider kinds", () => {
      expect(PROVIDER_CONNECTION_KINDS).toContain(build().adapter.kind);
    });

    it("declares four stable capability flags that agree with its members", () => {
      expect(capabilityViolations(build().adapter)).toEqual([]);
    });

    it("answers a config schema AE.5 can render", () => {
      const harness = build();

      expect(schemaViolations(harness.adapter, harness.secret, harness.sampleConfig)).toEqual([]);
    });

    it("validates a recorded success into a connected pill with a measured latency", async () => {
      const harness = build();

      expect(validationViolations(await harness.validateSuccess(), null, harness.secret)).toEqual(
        [],
      );
    });

    for (const errorClass of PROVIDER_ERROR_CLASSES) {
      it(`classifies its recorded ${errorClass} failure as ${errorClass}, without throwing`, async () => {
        const harness = build();

        // Awaited inside the assertion's argument rather than round a `rejects` matcher on
        // purpose: `validate` returning its failure is the contract, so a rejection here should
        // fail this test as an unhandled error rather than be quietly accepted by a matcher.
        const validation = await harness.validateFailures[errorClass]();

        expect(validationViolations(validation, errorClass, harness.secret)).toEqual([]);
      });
    }

    it("normalizes its recorded listing exactly as recorded", async () => {
      const harness = build();
      const models = await harness.discover();

      expect(normalizedModelViolations(models)).toEqual([]);
      expect(models).toEqual(harness.expectedModels);
    });

    it("answers a param schema the inspector can render and the database can store", async () => {
      const harness = build();
      const discovered = harness.expectedModels.map((model) => model.id);

      expect(paramViolations(harness.adapter, [...discovered, ...harness.paramModels])).toEqual([]);

      // Awaited so the discovery recording is really consumed by this case rather than left
      // pending: the ids above come from `expectedModels`, and a harness whose recording and
      // whose expectation had diverged would otherwise be checked here against the wrong list.
      await expect(harness.discover()).resolves.toEqual(harness.expectedModels);
    });

    it("supplies a pull fixture exactly when it declares the capability", () => {
      const harness = build();

      expect(harness.pull !== null).toBe(harness.adapter.capabilities().pull);
    });

    it("streams a pull that ends with a terminal event", async () => {
      const harness = build();
      const pull = harness.pull;

      if (pull === null) {
        // Not a skip: an adapter that does not pull has a contract here too, and it is that
        // the member is unreachable rather than that the case does not apply. `supportsPull` is
        // the only door to it, and this is the assertion that it stays shut.
        expect(supportsPull(harness.adapter)).toBe(false);

        return;
      }

      const events: ModelPullProgress[] = [];

      for await (const event of pull()) {
        events.push(event);
      }

      expect(pullStreamViolations(events)).toEqual([]);
    });
  });
}
