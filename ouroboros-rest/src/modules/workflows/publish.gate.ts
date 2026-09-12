/**
 * The publish gate — *both green, or nothing at all* (P.3,
 * [#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * ```
 * definition ─▶ [1] zod   (P.2, in this process)   ─┬─ any error ─▶ findings, and no engine call
 *                                                   └─ green ────▶ [2] engine (R.2, over the wire)
 *                                                                   ─┬─ any finding ─▶ findings
 *                                                                    └─ green ──────▶ publish
 * ```
 *
 * ---------------------------------------------------------------------------
 * ## Why two validators, and why in this order
 *
 * The ticket's own argument: *"REST-side validation alone is one implementation's reading of
 * the DSL. The component that will eventually execute a definition should be able to read it
 * before it is published — otherwise the first time the engine disagrees is at runtime, months
 * later."* So publishing asks both.
 *
 * The order is not arbitrary. The zod stage runs in this process against a document already in
 * memory; the engine stage is a network round trip with a five-second deadline. Running the
 * cheap one first means the overwhelmingly common failure — a canvas somebody is still
 * building — costs no hop at all, and it means a document the engine is asked about is one
 * that at least parses. **A document that fails stage 1 never reaches stage 2**, which is also
 * what keeps the findings readable: a document with no `trigger` would otherwise collect one
 * complaint per validator saying the same thing twice.
 *
 * ## Nothing here writes, and that is the atomicity criterion
 *
 * *"Any finding → 422 with node-anchored errors and nothing written."* This service produces
 * findings and no side effects; `workflows.service.ts` calls it **before** it opens the
 * transaction that inserts a version. There is therefore no ordering a reader has to check and
 * no failure path that could leave a numbered row behind, because the gate runs before the
 * only statement that could write one.
 *
 * ## What the gate does *not* consider
 *
 * **Warnings.** `dsl.references.ts` reports decision **P7**'s unknown-name warnings when it is
 * given a catalogue, and they are advisory by construction — a model alias that does not exist
 * *yet* is a workflow somebody is about to finish wiring, not a document that must be refused.
 * `DslVerdict.valid` is `errors` being empty, and this gate is that predicate and no stricter.
 * The catalogue is deliberately not assembled here for the same reason: it would make publish
 * depend on the model registry in order to produce diagnostics that could not change the
 * answer.
 *
 * **An engine that does not publish the route.** R.2
 * ([#144](https://github.com/NobuData/ouroboros/issues/144)) is the engine half and has not
 * landed; until it does, `EngineClient.validateWorkflow` answers `undefined` and this gate
 * records the second opinion as *unavailable* rather than refusing every publish in the
 * product. That tolerance is exactly one status wide — an engine that is down, refusing or
 * answering off-contract still fails the publish with `engine_unavailable` — and it costs a
 * redundant check rather than the only one, because `dsl.parity.spec.ts` holds the two
 * validators to the same verdict over every committed fixture.
 */

import { Injectable, Logger } from "@nestjs/common";

import { EngineClient } from "../engine/engine.client";
import type { DslDiagnostic } from "./dsl.errors";
import { validateWorkflowDocument } from "./dsl.validator";

/** Which validator produced a finding. */
export type PublishFindingSource = "dsl" | "engine";

/** The endpoints of the edge a finding anchors to. */
export interface PublishFindingEdge {
  /** The edge's `from`, verbatim — including when it names no node. */
  readonly from: string;
  /** The edge's `to`, verbatim. */
  readonly to: string;
}

/**
 * One reason a definition may not be published, in the shape the studio anchors from.
 *
 * The two validators speak different vocabularies and this is deliberately *not* an attempt to
 * reconcile them: `code` is whichever validator's own string, and `source` says which, so a
 * client can render `dsl` findings against P.2's documented codes without having to guess
 * whether a code it does not recognise is a new rule or another service's.
 */
export interface PublishFinding {
  /** Which validator said so. */
  readonly source: PublishFindingSource;
  /** Which rule broke, in that validator's vocabulary. */
  readonly code: string;
  /** What a person should read. */
  readonly message: string;
  /** An RFC 6901 JSON Pointer to the offending value, when there is one. */
  readonly path?: string;
  /** The node this anchors to — what the canvas selects when the finding is clicked. */
  readonly node?: string;
  /** The edge this anchors to, when it is about one. */
  readonly edge?: PublishFindingEdge;
}

/** What the gate decided, and what the answer has to say about it. */
export interface PublishVerdict {
  /** Everything both stages found, zod's first. Empty is the only state that may publish. */
  readonly findings: readonly PublishFinding[];
  /**
   * Whether the engine's opinion is part of the verdict.
   *
   * `false` when the zod stage refused before the engine was asked, and `false` when the
   * engine build does not publish the route. It is reported rather than inferred so that
   * `workflows.service.ts` can log *which* gate let a version through, and so a suite can
   * assert the second stage really ran.
   */
  readonly engineConsulted: boolean;
}

@Injectable()
export class WorkflowPublishGate {
  /**
   * Where the *mechanism* of an un-seconded publish is recorded.
   *
   * `debug`, deliberately — see {@link check}. The line an operator reads at the default level
   * is the caller's, because it names the workflow.
   */
  private readonly logger = new Logger(WorkflowPublishGate.name);

  /**
   * @param engine - The typed engine client, from the non-global `EngineModule`.
   */
  constructor(private readonly engine: EngineClient) {}

  /**
   * Run both validators over one definition.
   *
   * @param definition - The draft's document, exactly as it is stored. Not reshaped on the
   *   way: the thing being judged has to be the thing that becomes immutable.
   * @returns The verdict. `findings` empty means the caller may write a version; anything else
   *   means it must write nothing.
   * @throws {UpstreamError} `engine_unavailable` when the engine publishes the route and could
   *   not answer — a publish is refused rather than waved through by an outage.
   */
  async check(definition: unknown): Promise<PublishVerdict> {
    const verdict = validateWorkflowDocument(definition);

    if (!verdict.valid) {
      // Stage 2 is not reached, per this file's header: the engine cannot say anything useful
      // about a document that does not parse, and a second copy of every complaint would make
      // the list harder to act on rather than more complete.
      return { findings: verdict.errors.map(fromDiagnostic), engineConsulted: false };
    }

    const second = await this.engine.validateWorkflow(definition);

    if (second === undefined) {
      // `debug` rather than `warn`, and the level is the division of labour: **the caller is
      // what must not be silent**, because it is what knows which workflow was published, and
      // `workflows.service.ts` warns on `engineConsulted: false` for exactly that reason. One
      // line per publish at `warn` is right; two is a line an operator learns to skip. This
      // one carries the mechanism, for whoever turns the level up after reading the other.
      this.logger.debug(
        "ouroboros-engine does not publish POST /v0/workflows/validate, so the engine half of " +
          "the gate was skipped (#144). The two validators are held to one verdict by " +
          "dsl.parity.spec.ts; the engine's reading is a second opinion this build cannot ask " +
          "for.",
      );

      return { findings: [], engineConsulted: false };
    }

    return {
      findings: second.findings.map((finding) => ({
        source: "engine" as const,
        code: finding.code,
        message: finding.message,
        ...(finding.path === undefined ? {} : { path: finding.path }),
        ...(finding.node === undefined ? {} : { node: finding.node }),
        ...(finding.edge === undefined ? {} : { edge: finding.edge }),
      })),
      engineConsulted: true,
    };
  }
}

/**
 * One DSL diagnostic, as a finding.
 *
 * @param diagnostic - What `validateWorkflowDocument` reported.
 * @returns The same fact in the gate's shape. `path` is always present on this side —
 *   `dsl.errors.ts` gives every diagnostic a pointer, `""` being the document itself — and the
 *   anchors are copied only when the diagnostic carries them, so a finding never claims to be
 *   about a node it is not about.
 */
function fromDiagnostic(diagnostic: DslDiagnostic): PublishFinding {
  return {
    source: "dsl",
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path,
    ...(diagnostic.node === undefined ? {} : { node: diagnostic.node }),
    ...(diagnostic.edge === undefined ? {} : { edge: { ...diagnostic.edge } }),
  };
}
