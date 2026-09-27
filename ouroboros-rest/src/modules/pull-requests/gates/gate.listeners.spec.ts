import { Logger } from "@nestjs/common";

import { GateListeners, type GateEvaluated } from "./gate.listeners";

/**
 * The registry the merge executor (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360))
 * hears evaluations on: every listener hears, one that throws is logged without silencing the
 * rest, and an unregistered one hears nothing more.
 */

/** One evaluation. */
const EVALUATED: GateEvaluated = {
  prId: "pr-514",
  organizationId: "org-360",
  revisionId: "rev-2",
  state: "armed",
  mergeReady: true,
  redCount: 0,
};

describe("GateListeners", () => {
  it("tells every listener, and a throwing one silences nobody", () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const listeners = new GateListeners();
    const heard: string[] = [];

    listeners.add({
      gateEvaluated: () => {
        throw new Error("boom");
      },
    });
    listeners.add({ gateEvaluated: (evaluated) => heard.push(evaluated.prId) });

    expect(() => {
      listeners.emit(EVALUATED);
    }).not.toThrow();
    expect(heard).toEqual(["pr-514"]);
    expect(error).toHaveBeenCalledWith("A gate listener failed for pr pr-514.", "boom");
    error.mockRestore();
  });

  it("stops telling a listener once it is removed", () => {
    const listeners = new GateListeners();
    const heard: GateEvaluated[] = [];
    const remove = listeners.add({ gateEvaluated: (evaluated) => heard.push(evaluated) });

    listeners.emit(EVALUATED);
    remove();
    listeners.emit(EVALUATED);

    expect(heard).toEqual([EVALUATED]);
  });
});
