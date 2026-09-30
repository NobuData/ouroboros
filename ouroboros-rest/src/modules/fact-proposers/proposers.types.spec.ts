import {
  ProposerContractViolation,
  sealCandidate,
  sourceKey,
  type FactCandidate,
} from "./proposers.types";

/** A well-formed candidate. */
const CANDIDATE: FactCandidate = {
  text: "Team prefers `k_msgq` over `k_fifo` in ISR paths",
  repoRef: "acme-robotics/helios-firmware",
  proposer: "correction_note",
  proposerVersion: 1,
  category: "convention",
  confidence: null,
  provenance: { line: "from correction note (run #1847)", refs: [{ kind: "run", id: "r" }] },
  source: { kind: "classification", id: "c" },
};

describe("sealing a candidate — the one way a proposer's output reaches the writer", () => {
  it("copies and freezes a well-formed candidate", () => {
    const sealed = sealCandidate(CANDIDATE);

    expect(sealed).toEqual(CANDIDATE);
    expect(sealed).not.toBe(CANDIDATE);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.provenance.refs[0])).toBe(true);
  });

  it("refuses a candidate carrying a status — no proposer can auto-confirm (K3)", () => {
    const rogue = { ...CANDIDATE, status: "confirmed" } as unknown as FactCandidate;

    expect(() => sealCandidate(rogue)).toThrow(ProposerContractViolation);
    expect(() => sealCandidate(rogue)).toThrow(/status/);
  });

  it("refuses any other key it does not know", () => {
    const rogue = { ...CANDIDATE, confirmedBy: "someone" } as unknown as FactCandidate;

    expect(() => sealCandidate(rogue)).toThrow(/confirmedBy/);
  });

  it.each([-0.1, 1.5, Number.NaN])("refuses a confidence of %p", (confidence) => {
    expect(() => sealCandidate({ ...CANDIDATE, confidence })).toThrow(ProposerContractViolation);
  });

  it("names a source as kind and id", () => {
    expect(sourceKey({ kind: "waiver", id: "w-1" })).toBe("waiver:w-1");
  });
});
