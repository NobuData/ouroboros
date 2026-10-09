/**
 * The conformance kit — the suite every research tool adapter must pass.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)), mirroring the ticket-source
 * (#142) and model-provider (#216) kits. An adapter author writes one spec file:
 *
 * ```ts
 * describeToolConformance("web", () => ({ adapter: new WebTool(…), … }));
 * ```
 *
 * …against **recorded** fixtures — a harness standing a captured response in for the network —
 * and gets the assertions that would otherwise be found in a running investigation: that every
 * operation answers sources in the ledger's shape (and that **data with no sources fails**), that
 * failures are classified, that no detail or source quotes the credential, that the config schema
 * renders as an enable form, that health maps onto the card's dots, and that capability flags and
 * members agree.
 *
 * Every rule is a `…Violations(…) => string[]` with an `it` around it, the convention both earlier
 * kits use: one run reports every problem, and `conformance.fixture.spec.ts` proves each rule
 * refuses an adapter that is wrong on purpose — a kit nobody has watched fail passes everything.
 *
 * A `.fixture.ts`: type-checked with the code it gates, shipped with none of it.
 */

import { isDeepStrictEqual } from "node:util";

import {
  TOOL_OPERATIONS,
  declaredOperations,
  type ResearchToolAdapter,
  type SubLineValue,
  type ToolCallContext,
  type ToolOperation,
} from "./research-tool.adapter";
import { resultViolations } from "./research-tool.citations";
import {
  toToolFormFields,
  toolSchemaViolations,
  type ResearchToolConfig,
} from "./research-tool.config";
import {
  TOOL_ERROR_CLASSES,
  isResearchToolError,
  type ToolErrorClass,
} from "./research-tool.errors";
import {
  TOOL_HEALTH_DOTS,
  TOOL_HEALTH_STATES,
  healthDot,
  subLineSlots,
  type ToolHealth,
  type ToolHealthState,
} from "./research-tool.health";
import { registrationViolations } from "./research-tool.registry";

/** What an adapter author supplies. */
export interface ToolConformance {
  /** The adapter, freshly built. */
  readonly adapter: ResearchToolAdapter;
  /** A configuration its schema accepts. */
  readonly config: ResearchToolConfig;
  /** The credential its fixtures were recorded with, or null for a tool that needs none. */
  readonly secret: string | null;
  /**
   * One recorded success per **declared** operation — and none for an undeclared one. Each
   * resolves to what the operation answered.
   */
  readonly operations: Partial<Record<ToolOperation, () => Promise<unknown>>>;
  /**
   * Recorded failures, by class. Each must reject with a {@link ResearchToolError} of that class.
   * Every HTTP-backed adapter can arrange `auth`, `network`, `rate_limited` and `upstream`; the
   * kit requires `network` and `upstream` of every adapter, and checks whatever else is given.
   */
  readonly failures: Partial<Record<ToolErrorClass, () => Promise<unknown>>>;
  /** Recorded health checks for the configured states the adapter can produce. */
  readonly health: Partial<
    Record<Exclude<ToolHealthState, "not_configured">, () => Promise<ToolHealth>>
  >;
}

/** The failure classes every adapter must record a fixture for. */
export const REQUIRED_FAILURES: readonly ToolErrorClass[] = ["network", "upstream"];

/**
 * A call context for the kit's fixtures.
 *
 * @param harness - The harness.
 * @param tokenCeiling - The ceiling to hand the adapter.
 * @returns The context.
 */
export function conformanceContext(
  harness: Pick<ToolConformance, "config" | "secret">,
  tokenCeiling: number | null = null,
): ToolCallContext {
  return {
    organizationId: "org-conformance",
    investigationId: "00000000-0000-4000-8000-000000000614",
    config: harness.config,
    secret: harness.secret,
    tokenCeiling,
  };
}

/**
 * The card row: a name, one glyph, a sub-line — stable, and fresh on every call.
 *
 * @param adapter - The adapter.
 * @returns The violations.
 */
export function displayViolations(adapter: ResearchToolAdapter): string[] {
  const violations: string[] = [];
  const meta = adapter.displayMeta();

  if (typeof meta.name !== "string" || meta.name.trim() === "") {
    violations.push("displayMeta().name must be non-blank");
  }
  if (typeof meta.glyph !== "string" || [...meta.glyph].length !== 1) {
    violations.push("displayMeta().glyph must be exactly one character");
  }
  if (typeof meta.subLine !== "string" || meta.subLine.trim() === "") {
    violations.push("displayMeta().subLine must be non-blank");
  }
  if (!isDeepStrictEqual(adapter.displayMeta(), meta)) {
    violations.push("displayMeta() must be stable — two calls answered different values");
  }

  (meta as { name: string }).name = "mutated";
  if (adapter.displayMeta().name === "mutated") {
    violations.push(
      "displayMeta() must answer a fresh value — a caller's edit reached the adapter",
    );
  }

  return violations;
}

/**
 * The live counts fill the sub-line's slots exactly — no slot unanswered, no stray key.
 *
 * @param adapter - The adapter.
 * @param counts - What `counts()` answered.
 * @returns The violations.
 */
export function countsViolations(
  adapter: ResearchToolAdapter,
  counts: Readonly<Record<string, SubLineValue>>,
): string[] {
  const violations: string[] = [];
  const slots = subLineSlots(adapter.displayMeta().subLine);

  for (const slot of slots) {
    if (!(slot in counts)) {
      violations.push(`counts() does not answer the sub-line's {${slot}}`);
    }
  }
  for (const [key, value] of Object.entries(counts)) {
    if (!slots.includes(key)) {
      violations.push(`counts() answers ${key}, which the sub-line does not name`);
    }
    if (typeof value === "string") {
      if (value.trim() === "" || value.length > 200) {
        violations.push(`counts().${key} must be a non-blank phrase of at most 200 characters`);
      }
    } else if (value !== null && (!Number.isInteger(value) || value < 0)) {
      violations.push(`counts().${key} must be a non-negative integer, a phrase or null`);
    }
  }

  return violations;
}

/**
 * The config schema renders as an enable form — the dialect's gate, stability, freshness, and
 * the form derivation succeeding with no tool-specific code.
 *
 * @param adapter - The adapter.
 * @returns The violations.
 */
export function schemaViolations(adapter: ResearchToolAdapter): string[] {
  const schema = adapter.configSchema();
  const violations = toolSchemaViolations(schema).map(
    (violation) => `configSchema(): ${violation}`,
  );

  if (violations.length > 0) {
    return violations;
  }
  if (!isDeepStrictEqual(adapter.configSchema(), schema)) {
    violations.push("configSchema() must be stable — two calls answered different values");
  }

  (schema as { title: string }).title = "mutated";
  if (adapter.configSchema().title === "mutated") {
    violations.push(
      "configSchema() must answer a fresh value — a caller's edit reached the adapter",
    );
  }

  const fields = toToolFormFields(adapter.configSchema());

  if (fields.length !== Object.keys(adapter.configSchema().properties).length) {
    violations.push("configSchema() does not render one enable-form field per property");
  }

  return violations;
}

/**
 * A health answer: a known state, a non-blank detail, never the credential.
 *
 * @param health - What `healthCheck()` answered.
 * @param secret - The credential to look for.
 * @param label - How to name it.
 * @returns The violations.
 */
export function healthViolations(
  health: ToolHealth,
  secret: string | null,
  label: string,
): string[] {
  const violations: string[] = [];

  if (!(TOOL_HEALTH_STATES as readonly string[]).includes(health.state)) {
    violations.push(
      `${label}: state "${String(health.state)}" is not one of ${TOOL_HEALTH_STATES.join(", ")}`,
    );
  } else if (healthDot(health) !== TOOL_HEALTH_DOTS[health.state]) {
    violations.push(`${label}: does not map onto its dot`);
  }
  if (typeof health.detail !== "string" || health.detail.trim() === "") {
    violations.push(`${label}: detail must be non-blank`);
  }
  if (secret !== null && JSON.stringify(health).includes(secret)) {
    violations.push(`${label}: quotes the credential`);
  }

  return violations;
}

/**
 * One operation's recorded answer: the citation contract, and no credential anywhere in it.
 *
 * @param operation - Which operation.
 * @param result - What it resolved to.
 * @param secret - The credential to look for.
 * @param tokenCeiling - The ceiling the call was given.
 * @returns The violations.
 */
export function operationViolations(
  operation: ToolOperation,
  result: unknown,
  secret: string | null,
  tokenCeiling: number | null = null,
): string[] {
  const violations = resultViolations(result, tokenCeiling).map(
    (violation) => `${operation}: ${violation}`,
  );

  if (secret !== null && JSON.stringify(result ?? null).includes(secret)) {
    violations.push(`${operation}: the answer quotes the credential`);
  }

  return violations;
}

/**
 * A recorded failure: rejected, classified as expected, and silent about the credential.
 *
 * @param expected - The class the fixture records.
 * @param outcome - How the call settled.
 * @param secret - The credential to look for.
 * @returns The violations.
 */
export function failureViolations(
  expected: ToolErrorClass,
  outcome: { readonly rejected: boolean; readonly value: unknown },
  secret: string | null,
): string[] {
  if (!outcome.rejected) {
    return [`${expected}: the operation resolved — a failure must reject with ResearchToolError`];
  }
  if (!isResearchToolError(outcome.value)) {
    return [`${expected}: rejected with something other than a classified ResearchToolError`];
  }

  const violations: string[] = [];

  if (outcome.value.errorClass !== expected) {
    violations.push(`${expected}: classified as ${outcome.value.errorClass}`);
  }
  if (outcome.value.detail.trim() === "") {
    violations.push(`${expected}: detail must be non-blank`);
  }
  if (secret !== null && `${outcome.value.detail} ${outcome.value.message}`.includes(secret)) {
    violations.push(`${expected}: the detail quotes the credential`);
  }

  return violations;
}

/**
 * The harness supplies a success fixture exactly for the declared operations, and the required
 * failure classes.
 *
 * @param harness - The harness.
 * @returns The violations.
 */
export function fixtureCoverageViolations(harness: ToolConformance): string[] {
  const violations: string[] = [];
  const declared = declaredOperations(harness.adapter);

  for (const operation of TOOL_OPERATIONS) {
    const recorded = harness.operations[operation] !== undefined;

    if (declared.includes(operation) && !recorded) {
      violations.push(`declares ${operation} but records no fixture for it`);
    }
    if (!declared.includes(operation) && recorded) {
      violations.push(`records a ${operation} fixture but does not declare ${operation}`);
    }
  }
  for (const errorClass of REQUIRED_FAILURES) {
    if (harness.failures[errorClass] === undefined) {
      violations.push(`records no ${errorClass} failure — every adapter must`);
    }
  }

  return violations;
}

/**
 * How a promise settled, without throwing.
 *
 * @param work - The call.
 * @returns Whether it rejected, and with what (or what it resolved to).
 */
export async function settle(
  work: () => Promise<unknown>,
): Promise<{ rejected: boolean; value: unknown }> {
  try {
    return { rejected: false, value: await work() };
  } catch (error) {
    return { rejected: true, value: error };
  }
}

/**
 * The kit, as a `describe` block.
 *
 * @param name - The adapter's name in the report.
 * @param build - A fresh harness per case.
 */
export function describeToolConformance(name: string, build: () => ToolConformance): void {
  describe(`${name} — ResearchToolAdapter conformance`, () => {
    it("registers: a slug, and capability flags that agree with its members", () => {
      expect(registrationViolations(build().adapter)).toEqual([]);
    });

    it("records a fixture for every declared operation and the required failures", () => {
      expect(fixtureCoverageViolations(build())).toEqual([]);
    });

    it("draws its tools-card row, stably", () => {
      expect(displayViolations(build().adapter)).toEqual([]);
    });

    it("fills its sub-line's slots from live counts", async () => {
      const harness = build();
      const counts = await harness.adapter.counts("org-conformance", harness.config);

      expect(countsViolations(harness.adapter, counts)).toEqual([]);
    });

    it("answers a config schema the enable form renders with no tool-specific code", () => {
      expect(schemaViolations(build().adapter)).toEqual([]);
    });

    it("reports not_configured — the idle dot — when the workspace has not configured it", async () => {
      const harness = build();
      const health = await harness.adapter.healthCheck(null, null, "org-conformance");

      expect(health.state).toBe("not_configured");
      expect(healthDot(health)).toBe("idle");
      expect(healthViolations(health, harness.secret, "unconfigured")).toEqual([]);
    });

    it("maps every recorded health state onto its dot, never quoting the credential", async () => {
      const harness = build();

      for (const [state, check] of Object.entries(harness.health)) {
        const health = await check();

        expect(health.state).toBe(state);
        expect(healthViolations(health, harness.secret, state)).toEqual([]);
      }
    });

    it("answers every declared operation inside the citation contract", async () => {
      const harness = build();

      for (const operation of declaredOperations(harness.adapter)) {
        const record = harness.operations[operation];

        if (record === undefined) continue;

        expect(operationViolations(operation, await record(), harness.secret)).toEqual([]);
      }
    });

    it("classifies every recorded failure, never quoting the credential", async () => {
      const harness = build();

      for (const errorClass of TOOL_ERROR_CLASSES) {
        const record = harness.failures[errorClass];

        if (record === undefined) continue;

        expect(failureViolations(errorClass, await settle(record), harness.secret)).toEqual([]);
      }
    });
  });
}
