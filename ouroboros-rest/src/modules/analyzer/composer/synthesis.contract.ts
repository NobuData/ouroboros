/**
 * The `/v0/synthesize-findings` contract — the v2 LLM synthesis pass, committed now (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)); implemented by BX.1,
 * [#522](https://github.com/NobuData/ouroboros/issues/522).
 *
 * The published document is `schemas/synthesize-findings/v0.json`; `synthesis.contract.spec.ts`
 * is its drift check — {@link SYNTHESIZE_FINDINGS_V0_FIELDS} pins every field with its type, the
 * fixtures are classified as `expected.json` records, and the request this service would send and
 * the stub's answer both validate.
 *
 *   * **In** — the run, its window, its findings and the suggestions the deterministic composer
 *     made from them ({@link synthesisRequest}).
 *   * **Out** — additional suggestion *candidates* (each held to the impact-claim discipline: a
 *     computable basis, or `unquantified` and a spike) and *enrichments* (prose for an existing
 *     suggestion; never a changed number), with provenance.
 *
 * Until BX.1 lands, {@link UnavailableSynthesizer} is installed: it answers the contract's empty
 * shape (`actor: none`), by design. The deterministic composition never waits on it and never
 * depends on what it says.
 */

import { Injectable } from "@nestjs/common";

import type {
  ActionBinding,
  ComposeWindow,
  ComposedSuggestion,
  ComposerFinding,
  Impact,
  SuggestionKind,
} from "./composer.types";

/** The contract's `$id`. */
export const SYNTHESIS_CONTRACT = "https://ouroboros.build/schemas/synthesize-findings/v0.json";

/** The engine route BX.1 will serve it on. */
export const SYNTHESIZE_FINDINGS_ROUTE = "/v0/synthesize-findings";

/** Every field of `v0.json` with its type — the drift check compares this with the document. */
export const SYNTHESIZE_FINDINGS_V0_FIELDS: readonly string[] = [
  "response.candidates:array",
  "response.candidates[].kind:enum(build_process,workflow,ticket_draft)",
  "response.candidates[].finding_ids:array",
  "response.candidates[].finding_ids[]:string",
  "response.candidates[].title:string",
  "response.candidates[].evidence_line:string",
  "response.candidates[].impact:oneOf(3)",
  "response.candidates[].needs_spike:boolean",
  "response.candidates[].action_binding:object",
  "response.candidates[].action_binding.plane:enum(farm_config,job_hook,workflow,test_gate,planning)",
  "response.candidates[].action_binding.change:object",
  "response.enrichments:array",
  "response.enrichments[].identity_key:string",
  "response.enrichments[].narrative:string",
  "response.provenance:object",
  "response.provenance.actor:enum(model,none)",
  "response.provenance.model:string|null",
  "response.provenance.cost_cents:number|null",
  "request.run_id:string",
  "request.repo_ref:string",
  "request.window:object",
  "request.window.from:string",
  "request.window.to:string",
  "request.window.days:integer",
  "request.findings:array",
  "request.findings[].id:string",
  "request.findings[].analyzer:string",
  "request.findings[].analyzer_version:integer",
  "request.findings[].finding_type:string",
  "request.findings[].subject_key:string",
  "request.findings[].identity_key:string",
  "request.findings[].data:object",
  "request.findings[].confidence:integer",
  "request.findings[].confidence_basis:object",
  "request.suggestions:array",
  "request.suggestions[].identity_key:string",
  "request.suggestions[].kind:enum(build_process,workflow,ticket_draft)",
  "request.suggestions[].title:string",
  "request.suggestions[].evidence_line:string",
  "request.suggestions[].confidence:integer",
  "request.suggestions[].impact:object|null",
  "request.suggestions[].needs_spike:boolean",
  "request.suggestions[].action_binding:object",
  "request.suggestions[].action_binding.plane:enum(farm_config,job_hook,workflow,test_gate,planning)",
  "request.suggestions[].action_binding.change:object",
];

/** One finding, as the request carries it. */
export interface SynthesisFinding {
  id: string;
  analyzer: string;
  analyzer_version: number;
  finding_type: string;
  subject_key: string;
  identity_key: string;
  data: Record<string, unknown>;
  confidence: number;
  confidence_basis: Record<string, unknown>;
}

/** One composed suggestion, as the request carries it. */
export interface SynthesisComposed {
  identity_key: string;
  kind: SuggestionKind;
  title: string;
  evidence_line: string;
  confidence: number;
  impact: Impact | null;
  needs_spike: boolean;
  action_binding: ActionBinding;
}

/** The request — `$defs/synthesis_request`. */
export interface SynthesisRequest {
  run_id: string;
  repo_ref: string;
  window: ComposeWindow;
  findings: SynthesisFinding[];
  suggestions: SynthesisComposed[];
}

/** Who answered. */
export interface SynthesisProvenance {
  actor: "model" | "none";
  model: string | null;
  cost_cents: number | null;
}

/** The response — the document's root. */
export interface SynthesisResponse {
  candidates: {
    kind: SuggestionKind;
    finding_ids: string[];
    title: string;
    evidence_line: string;
    impact: Record<string, unknown> | null;
    needs_spike: boolean;
    action_binding: ActionBinding;
  }[];
  enrichments: { identity_key: string; narrative: string }[];
  provenance: SynthesisProvenance;
}

/**
 * Build the request for one run.
 *
 * @param run - The run.
 * @param window - Its corpus window.
 * @param findings - Its findings.
 * @param suggestions - What the composer made, each with the identity it was recorded under.
 * @returns The request body.
 */
export function synthesisRequest(
  run: { id: string; repo_ref: string },
  window: ComposeWindow,
  findings: readonly ComposerFinding[],
  suggestions: readonly (ComposedSuggestion & { identityKey: string })[],
): SynthesisRequest {
  return {
    run_id: run.id,
    repo_ref: run.repo_ref,
    window,
    findings: findings.map((finding) => ({
      id: finding.id,
      analyzer: finding.analyzer,
      analyzer_version: finding.analyzerVersion,
      finding_type: finding.findingType,
      subject_key: finding.subjectKey,
      identity_key: finding.identityKey,
      data: { ...finding.data },
      confidence: finding.confidence,
      confidence_basis: { ...finding.confidenceBasis },
    })),
    suggestions: suggestions.map((suggestion) => ({
      identity_key: suggestion.identityKey,
      kind: suggestion.kind,
      title: suggestion.title,
      evidence_line: suggestion.evidenceLine,
      confidence: suggestion.confidence,
      impact: suggestion.impact,
      needs_spike: suggestion.needsSpike,
      action_binding: suggestion.actionBinding,
    })),
  };
}

/** The synthesis port — BX.1 installs a model behind it. */
export interface Synthesizer {
  /**
   * Propose candidates and enrichments for one run.
   *
   * @param request - The run, its findings and its composed suggestions.
   * @returns The contract's response.
   */
  synthesize(request: SynthesisRequest): Promise<SynthesisResponse>;
}

/** The injection token the synthesizer is bound to. */
export const SYNTHESIZER = Symbol("SYNTHESIZER");

/** The stub's answer: nothing proposed, nobody asked, nothing spent. */
export const UNAVAILABLE_SYNTHESIS: SynthesisResponse = Object.freeze({
  candidates: [],
  enrichments: [],
  provenance: { actor: "none", model: null, cost_cents: null },
}) as SynthesisResponse;

/** Unimplemented by design until BX.1: answers the contract's empty shape. */
@Injectable()
export class UnavailableSynthesizer implements Synthesizer {
  /**
   * Answer with no candidates and no enrichments.
   *
   * @returns {@link UNAVAILABLE_SYNTHESIS}.
   */
  synthesize(): Promise<SynthesisResponse> {
    return Promise.resolve({
      candidates: [],
      enrichments: [],
      provenance: { ...UNAVAILABLE_SYNTHESIS.provenance },
    });
  }
}
