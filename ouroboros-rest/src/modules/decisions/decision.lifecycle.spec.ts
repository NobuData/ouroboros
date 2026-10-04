import { Logger } from "@nestjs/common";

import { DecisionLifecycle, type DecisionLifecycleEvent } from "./decision.lifecycle";

/** The lifecycle hook #536 asked for (#461): every listener hears, a throwing one costs nothing. */

const FILED: DecisionLifecycleEvent = {
  type: "filed",
  itemId: "item-1",
  organizationId: "acme",
  kindId: "merge_approval",
};

describe("DecisionLifecycle", () => {
  afterEach(() => jest.restoreAllMocks());

  it("tells every listener, and stops telling one that unregistered", () => {
    const lifecycle = new DecisionLifecycle();
    const heard: string[] = [];
    lifecycle.add({ decisionChanged: (event) => heard.push(`a:${event.type}`) });
    const stop = lifecycle.add({ decisionChanged: (event) => heard.push(`b:${event.type}`) });

    lifecycle.emit(FILED);
    stop();
    lifecycle.emit(FILED);

    expect(heard).toEqual(["a:filed", "b:filed", "a:filed"]);
  });

  it("logs a listener that throws, and the others still hear", () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const lifecycle = new DecisionLifecycle();
    const heard = jest.fn();
    lifecycle.add({
      decisionChanged: () => {
        throw new Error("chat is down");
      },
    });
    lifecycle.add({ decisionChanged: heard });

    lifecycle.emit(FILED);

    expect(heard).toHaveBeenCalledWith(FILED);
    expect(error).toHaveBeenCalledWith(
      "A decision lifecycle listener failed for item item-1.",
      "chat is down",
    );
  });
});
