/**
 * The publish gate — *both green, or nothing at all* (P.3,
 * [#134](https://github.com/NobuData/ouroboros/issues/134)).
 *
 * ```
 * definition ─▶ [1] zod      (P.2, in this process)    ─┬─ any error ─▶ findings, and no engine call
 *                                                       └─ green ────▶ [2] registry (CH.6, one read)
 *               ─┬─ an unknown alias ─▶ findings, and no engine call
 *                └─ every pin resolves ─▶ [3] engine (R.2, over the wire)
 *                                          ─┬─ any finding ─▶ findings
 *                                           └─ green ──────▶ publish
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
 * ## Governance: a pin must name an alias the registry holds (CH.6)
 *
 * Mockup 21's why-card promises that *routes and workflows may only reference registry aliases —
 * raw model strings are rejected at publish time*, and
 * [#589](https://github.com/NobuData/ouroboros/issues/589) makes that a property of this gate
 * rather than a sentence on a page. Two ways a stage can break it, one refusal shape for both:
 *
 *   * **a raw model id** — `pinned_model: "claude-fable-5"` — is a zod error already
 *     (`config.routing_raw_model`), because the DSL's pin is an object. This gate rewrites its
 *     message into the designed one and attaches the suggestion; and
 *   * **an alias the workspace does not have** — `{alias: "coder-maxx"}` — is decision **P7**'s
 *     `reference.unknown_alias` warning on a draft, and *this* gate promotes it to a finding.
 *
 * Both findings name the node, carry `suggestion` — the alias the author most plausibly meant,
 * `alias.suggestion.ts`'s rules — and refuse with the same `422 workflow_definition_invalid`. The
 * registry is read once, before zod, because the raw-id refusal needs it too.
 *
 * **Everything else P7 warns about stays advisory.** An unknown skill or task route is still a
 * workflow somebody is about to finish wiring; the governance rule is about aliases and about
 * nothing else, so no other warning is read here.
 *
 * ## What refuses a publish without being a finding
 *
 * **An engine that cannot answer.** The engine leg is not optional. An engine that is down,
 * refusing, answering off-contract — or not publishing `POST /v0/workflows/validate` at all — is
 * `engine_unavailable`, and the publish is refused rather than waved through. Until R.2
 * ([#144](https://github.com/NobuData/ouroboros/issues/144)) landed, that last case was tolerated
 * and the gate published on the zod verdict alone; the engine serves the route now and the two
 * services deploy together, so the tolerance was retired alongside the tripwire in
 * `engine.contract.spec.ts` that asked for exactly that.
 */

import { Injectable } from "@nestjs/common";

import { EngineClient } from "../engine/engine.client";
import type { RegistryAlias } from "./alias.suggestion";
import { rawModelMessage, suggestAlias, unknownAliasMessage } from "./alias.suggestion";
import { WorkflowCatalogRepository } from "./catalog.repository";
import type { DslDiagnostic } from "./dsl.errors";
import { DslErrorCode, DslWarningCode } from "./dsl.errors";
import { valueAtPath } from "./dsl.issues";
import { validateWorkflowDocument } from "./dsl.validator";

/**
 * Which validator produced a finding — the DSL's zod stage, the registry's governance stage
 * (CH.6, #589), or the engine.
 */
export type PublishFindingSource = "dsl" | "registry" | "engine";

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
  /**
   * The registry alias the author most plausibly meant — present only on a governance finding
   * that has one to offer (CH.6, #589). The message already says it; this is the value a client
   * puts in the field when somebody accepts it.
   */
  readonly suggestion?: string;
}

/** What the gate decided, and what the answer has to say about it. */
export interface PublishVerdict {
  /** Everything both stages found, zod's first. Empty is the only state that may publish. */
  readonly findings: readonly PublishFinding[];
  /**
   * Whether the engine's opinion is part of the verdict.
   *
   * `false` exactly when the zod stage refused before the engine was asked, so a verdict with
   * no findings always carries `true` — reported rather than inferred, so a suite can assert
   * the second stage really ran.
   */
  readonly engineConsulted: boolean;
}

@Injectable()
export class WorkflowPublishGate {
  /**
   * @param engine - The typed engine client, from the non-global `EngineModule`.
   * @param catalog - The workspace reads — here, the model registry's aliases.
   */
  constructor(
    private readonly engine: EngineClient,
    private readonly catalog: WorkflowCatalogRepository,
  ) {}

  /**
   * Run every stage over one definition.
   *
   * @param organizationId - The workspace publishing, whose registry a pin must resolve in.
   * @param definition - The draft's document, exactly as it is stored. Not reshaped on the
   *   way: the thing being judged has to be the thing that becomes immutable.
   * @returns The verdict. `findings` empty means the caller may write a version; anything else
   *   means it must write nothing.
   * @throws {UpstreamError} `engine_unavailable` when the engine could not answer, whatever the
   *   reason — a publish is refused rather than waved through by an outage.
   */
  async check(organizationId: string, definition: unknown): Promise<PublishVerdict> {
    const aliases = await this.catalog.registryAliases(organizationId);
    const verdict = validateWorkflowDocument(definition, {
      catalogue: { aliases: aliases.map((row) => row.alias) },
    });

    if (!verdict.valid) {
      // The engine is not reached, per this file's header: it cannot say anything useful about
      // a document that does not parse, and a second copy of every complaint would make the
      // list harder to act on rather than more complete.
      return {
        findings: verdict.errors.map((diagnostic) => governed(diagnostic, definition, aliases)),
        engineConsulted: false,
      };
    }

    const unresolved = verdict.warnings
      .filter((warning) => warning.code === DslWarningCode.REFERENCE_UNKNOWN_ALIAS)
      .map((warning) => governed(warning, definition, aliases));

    if (unresolved.length > 0) {
      return { findings: unresolved, engineConsulted: false };
    }

    const second = await this.engine.validateWorkflow(definition);

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

/**
 * One diagnostic as a finding, with the governance rule's designed refusal where it applies.
 *
 * A raw model id and an unknown alias get the message `alias.suggestion.ts` composes — naming the
 * node and what it pinned — and the suggestion beside it; an unknown alias is attributed to the
 * `registry` stage, because the DSL stage only warned about it. Every other diagnostic passes
 * through {@link fromDiagnostic} untouched.
 *
 * @param diagnostic - What the DSL validator reported.
 * @param definition - The document, to read back what the pin actually holds.
 * @param aliases - The workspace's registry.
 * @returns The finding.
 */
function governed(
  diagnostic: DslDiagnostic,
  definition: unknown,
  aliases: readonly RegistryAlias[],
): PublishFinding {
  const finding = fromDiagnostic(diagnostic);
  const node = diagnostic.node ?? "";
  const written = valueAtPath(definition, pointerSegments(diagnostic.path));

  if (typeof written !== "string") {
    return finding;
  }

  if (diagnostic.code === DslErrorCode.CONFIG_ROUTING_RAW_MODEL) {
    return withSuggestion(finding, suggestAlias(written, aliases), (suggestion) =>
      rawModelMessage(node, written, suggestion),
    );
  }

  if (diagnostic.code === DslWarningCode.REFERENCE_UNKNOWN_ALIAS) {
    return withSuggestion(
      { ...finding, source: "registry" },
      suggestAlias(written, aliases),
      (suggestion) => unknownAliasMessage(node, written, suggestion),
    );
  }

  return finding;
}

/**
 * A finding with the designed message, and the suggestion when there is one.
 *
 * @param finding - The finding so far.
 * @param suggestion - The alias to offer, or null.
 * @param message - Composes the sentence for that suggestion.
 * @returns The finding, never claiming a suggestion it does not have.
 */
function withSuggestion(
  finding: PublishFinding,
  suggestion: string | null,
  message: (suggestion: string | null) => string,
): PublishFinding {
  return {
    ...finding,
    message: message(suggestion),
    ...(suggestion === null ? {} : { suggestion }),
  };
}

/**
 * An RFC 6901 pointer as the segments `valueAtPath` walks.
 *
 * @param pointer - `/nodes/1/config/routing/pinned_model`, or `""` for the document itself.
 * @returns `["nodes", "1", "config", "routing", "pinned_model"]` — string indexes reach array
 *   elements just as numbers do.
 */
function pointerSegments(pointer: string): string[] {
  return pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}
