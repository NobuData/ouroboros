import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { learnedSchema, type LearnRequest } from "../engine/engine.contract";
import { LLM_PROPOSER_VERSION, candidatesFromLearned } from "./proposers.learn";
import { ProposerContractViolation } from "./proposers.types";

/**
 * The `/v0/learn` contract's answer as registry candidates (#412 → #423): the engine's own
 * documented example, read from `ouroboros-engine/openapi.yaml`, becomes an `llm` candidate the
 * proposer service can write like any other — and invented provenance is refused on this side too.
 */

interface LearnExample {
  request: Record<string, unknown>;
  response: unknown;
}

/**
 * @returns The engine's documented request and 200 answer for `POST /v0/learn`.
 */
function documentedExample(): LearnExample {
  const path = join(__dirname, "..", "..", "..", "..", "ouroboros-engine", "openapi.yaml");
  const document = parse(readFileSync(path, "utf8")) as {
    paths: Record<string, { post: Record<string, unknown> }>;
  };
  const operation = document.paths["/v0/learn"].post as {
    requestBody: { content: { "application/json": { example: Record<string, unknown> } } };
    responses: { "200": { content: { "application/json": { example: unknown } } } };
  };

  return {
    request: operation.requestBody.content["application/json"].example,
    response: operation.responses["200"].content["application/json"].example,
  };
}

/**
 * @param body - The documented request, in the engine's names.
 * @returns It in this service's names.
 */
function requestOf(body: Record<string, unknown>): LearnRequest {
  const sources = body.sources as { kind: string; label: string; text: string; refs: [] }[];
  const context = body.context as { repo: string | null; existing_facts?: string[] };

  return {
    sources: sources as unknown as LearnRequest["sources"],
    context: { repo: context.repo, existingFacts: context.existing_facts ?? [] },
  };
}

describe("learned candidates into the registry", () => {
  it("turns the engine's documented answer into an llm candidate, landing proposed", () => {
    const example = documentedExample();
    const [candidate] = candidatesFromLearned(
      learnedSchema.parse(example.response),
      requestOf(example.request),
    );

    expect(candidate).toEqual({
      text: "Tests under `tests/hil/` require rig reservation via `rig claim`",
      repoRef: "acme-robotics/helios-firmware",
      proposer: "llm",
      proposerVersion: LLM_PROPOSER_VERSION,
      category: "environment",
      confidence: 0.82,
      provenance: {
        line: "from PR #498 review cycle",
        refs: [{ kind: "pull_request", id: "a7150000-0000-0000-0000-000000000498" }],
      },
      source: { kind: "pr_review_cycle", id: "a7150000-0000-0000-0000-000000000498" },
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(candidate).not.toHaveProperty("status");
  });

  it("refuses a candidate citing a ref its source did not carry", () => {
    const example = documentedExample();
    const learned = learnedSchema.parse(example.response);
    learned.candidates[0].provenance.refs = [
      { kind: "run", id: "a7120000-0000-0000-0000-000000001847" },
    ];

    expect(() => candidatesFromLearned(learned, requestOf(example.request))).toThrow(
      ProposerContractViolation,
    );
  });

  it("refuses a candidate naming a source the bundle did not carry", () => {
    const example = documentedExample();
    const learned = learnedSchema.parse(example.response);
    learned.candidates[0].sourceIndex = 5;

    expect(() => candidatesFromLearned(learned, requestOf(example.request))).toThrow(/source 5/);
  });

  it("maps the installed extractor's empty answer to no candidates", () => {
    const example = documentedExample();

    expect(
      candidatesFromLearned(
        learnedSchema.parse({ candidates: [], extractor: "unavailable-v0", notes: ["…"] }),
        requestOf(example.request),
      ),
    ).toEqual([]);
  });
});
