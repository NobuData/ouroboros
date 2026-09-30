/**
 * The `/v0/learn` contract's answer, as registry candidates — where BH.1's LLM extractor
 * ([#423](https://github.com/NobuData/ouroboros/issues/423)) plugs into BF.3's proposer registry
 * ([#412](https://github.com/NobuData/ouroboros/issues/412)) as the `llm` proposer.
 *
 * Nothing calls the engine's `/v0/learn` yet — the MVP's proposers are deterministic. This is the
 * committed half of the seam: an answer the contract accepts becomes {@link FactCandidate}s the
 * service's generic path (`FactProposersService.propose`) writes exactly as it writes a
 * correction note's — sealed (no status), deduped in any status, `proposed`, never confirmed.
 *
 * **Provenance is checked on this side too.** The engine refuses a candidate citing a ref its
 * source did not carry; this adapter refuses it again, so an older or misbehaving engine cannot
 * put invented provenance on the card.
 */

import type { LearnRequest, Learned } from "../engine/engine.contract";
import { ProposerContractViolation, sealCandidate, type FactCandidate } from "./proposers.types";

/** The version of the contract-to-candidate mapping — bumped when this adapter's answer changes. */
export const LLM_PROPOSER_VERSION = 1;

/**
 * Turn an extractor's answer into registry candidates.
 *
 * @param learned - The engine's answer, parsed by `learnedSchema`.
 * @param request - The bundle it answered.
 * @returns One sealed `llm` candidate per answered candidate, in order.
 * @throws {ProposerContractViolation} When a candidate names a source that was not sent or
 *   cites a ref its source did not carry.
 */
export function candidatesFromLearned(learned: Learned, request: LearnRequest): FactCandidate[] {
  return learned.candidates.map((candidate, index) => {
    const source = request.sources[candidate.sourceIndex];

    if (source === undefined) {
      throw new ProposerContractViolation(
        `learned candidate ${String(index)} names source ${String(candidate.sourceIndex)}, ` +
          `which the bundle did not carry`,
      );
    }

    const offered = new Set(source.refs.map((ref) => `${ref.kind}:${ref.id}`));
    const invented = candidate.provenance.refs.filter(
      (ref) => !offered.has(`${ref.kind}:${ref.id}`),
    );

    if (invented.length > 0) {
      throw new ProposerContractViolation(
        `learned candidate ${String(index)} cites ` +
          `${invented.map((ref) => `${ref.kind} ${ref.id}`).join(", ")}, which its source did not carry`,
      );
    }

    return sealCandidate({
      text: candidate.text,
      repoRef: request.context.repo,
      proposer: "llm",
      proposerVersion: LLM_PROPOSER_VERSION,
      category: candidate.category,
      confidence: candidate.confidence,
      provenance: { line: candidate.provenance.line, refs: candidate.provenance.refs },
      source: { kind: source.kind, id: source.refs[0]?.id ?? String(candidate.sourceIndex) },
    });
  });
}
