import type { MatrixCellStatus, MatrixGapSeverity } from "../../db/schema";
import { MAX_DERIVATION_LENGTH, deriveSeverity } from "./matrix.severity";
import { matrix, matrixInput } from "./rs127.fixture";

/** The gap severity rule (#621, decision V7). */

function derive(
  ours: MatrixCellStatus,
  rivals: readonly MatrixCellStatus[],
  proposed: MatrixGapSeverity | null = null,
) {
  return deriveSeverity({
    usLabel: "Helios",
    ours,
    rivals: rivals.map((status, index) => ({
      name: ["Skylink", "AeroMesh", "Novum"][index],
      status,
    })),
    proposed,
  });
}

describe("the severity rule", () => {
  it("reproduces RS-127's seeded chips from its seeded cells and proposed gaps", () => {
    const stored = matrix();
    const proposed = (matrixInput()["rows"] as { gap: MatrixGapSeverity }[]).map((row) => row.gap);

    const derived = stored.rows.map((row, index) => {
      const [ours, ...theirs] = row.cells;
      return deriveSeverity({
        usLabel: stored.usLabel,
        ours: ours.status,
        rivals: theirs.map((cell, column) => ({
          name: stored.rivals[column].name,
          status: cell.status,
        })),
        proposed: proposed[index],
      });
    });

    expect(derived.map((each) => each.severity)).toEqual(["high", "high", "med", "wip", "lead"]);
    expect(derived.map((each) => each.severity)).toEqual(stored.rows.map((row) => row.severity));
    expect(derived.every((each) => !each.clamped)).toBe(true);
  });

  it("is wip whenever ours is in flight, whatever the rivals or the proposal", () => {
    expect(derive("wip", ["shipping", "none", "none"], "high").severity).toBe("wip");
    expect(derive("wip", ["unknown", "unknown", "unknown"]).severity).toBe("wip");
  });

  it("is lead when we are ahead of every known rival", () => {
    const lead = derive("shipping", ["none", "unknown", "none"]);

    expect(lead).toMatchObject({ severity: "lead", bestRival: "none", distance: -2 });
    expect(derive("partial", ["none", "none", "none"]).severity).toBe("lead");
  });

  it("is low when level with the best rival", () => {
    expect(derive("shipping", ["shipping", "none", "none"])).toMatchObject({
      severity: "low",
      distance: 0,
    });
    expect(derive("none", ["none", "none", "none"]).severity).toBe("low");
  });

  it("is med one step behind — and high only when that is what was proposed", () => {
    expect(derive("partial", ["shipping", "partial", "none"])).toMatchObject({
      severity: "med",
      distance: 1,
    });
    expect(derive("partial", ["shipping", "partial", "none"], "med").severity).toBe("med");
    expect(derive("partial", ["shipping", "partial", "none"], "high").severity).toBe("high");
    expect(derive("none", ["partial", "none", "none"], "high").severity).toBe("high");
    expect(derive("none", ["wip", "none", "none"]).severity).toBe("med");
  });

  it("is high two steps behind, whatever was proposed", () => {
    expect(derive("none", ["shipping", "shipping", "partial"])).toMatchObject({
      severity: "high",
      distance: 2,
    });
    expect(derive("none", ["shipping", "none", "none"], "low").severity).toBe("high");
  });

  it("measures nothing — low — when our status or every rival's is unknown", () => {
    expect(derive("unknown", ["shipping", "none", "none"], "high")).toMatchObject({
      severity: "low",
      distance: null,
    });
    expect(derive("shipping", ["unknown", "unknown", "unknown"], "lead")).toMatchObject({
      severity: "low",
      bestRival: null,
      distance: null,
    });
  });

  it("leaves an unknown rival out instead of counting it as none", () => {
    // With AeroMesh as `none` we would still lead; the point is it is not what decides.
    expect(derive("partial", ["unknown", "shipping", "none"]).bestRival).toBe("shipping");
    expect(derive("none", ["unknown", "none", "none"]).severity).toBe("low");
  });

  it("clamps a proposal the cells do not support, and says so", () => {
    const clamped = derive("shipping", ["none", "none", "none"], "high");

    expect(clamped.severity).toBe("lead");
    expect(clamped.clamped).toBe(true);
    expect(clamped.derivation).toContain("proposed: high (clamped — the cells do not support it)");
    expect(derive("partial", ["shipping", "none", "none"], "low")).toMatchObject({
      severity: "med",
      clamped: true,
    });
    expect(derive("partial", ["shipping", "none", "none"], "high").clamped).toBe(false);
    expect(derive("partial", ["shipping", "none", "none"]).clamped).toBe(false);
  });

  it("stores every input in the derivation", () => {
    expect(derive("partial", ["shipping", "partial", "none"], "high").derivation).toBe(
      "Helios: partial · best rival: shipping (Skylink) · rivals: 1 shipping, 1 partial, 1 none · " +
        "proposed: high · one step behind the best rival, proposed high → high",
    );
    expect(derive("shipping", ["unknown", "unknown", "unknown"]).derivation).toBe(
      "Helios: shipping · best rival: unknown · rivals: 3 unknown · proposed: none · " +
        "no rival's status is known, so no gap is measured → low",
    );
    expect(
      deriveSeverity({ usLabel: "Helios", ours: "none", rivals: [], proposed: null }).derivation,
    ).toContain("rivals: none");
  });

  it("keeps a derivation within what the column stores, however long the names", () => {
    const long = deriveSeverity({
      usLabel: "U".repeat(120),
      ours: "none",
      rivals: Array.from({ length: 12 }, (_, index) => ({
        name: `${index.toString()}${"R".repeat(119)}`,
        status: "shipping" as const,
      })),
      proposed: "high",
    });

    expect(long.derivation.length).toBeLessThanOrEqual(MAX_DERIVATION_LENGTH);
    expect(long.derivation).toContain("…");
    expect(long.derivation).toMatch(/→ high$/);
  });
});
