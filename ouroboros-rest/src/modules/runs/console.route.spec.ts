import { readFixture } from "../workflows/dsl.golden.fixture";
import { inheritedTaskOf } from "./console.route";

/**
 * Which task kind a stage's spend is capped under, read from the pinned document.
 *
 * Against `standard-fix.json` — the document mockup 10's run is pinned to and the one the ingest
 * bench publishes — so the answers are the product's own: `implement` inherits the `implement`
 * route (whose cap is the mockup's `$2.50`), and `plan` pins `coder-max`, which has no route and
 * therefore no cap.
 */

const STANDARD_FIX = readFixture("valid/standard-fix.json");

describe("inheritedTaskOf", () => {
  it("reads the task a stage inherits its route from", () => {
    expect(inheritedTaskOf(STANDARD_FIX, "implement")).toBe("implement");
    expect(inheritedTaskOf(STANDARD_FIX, "split")).toBe("split");
  });

  it("answers nothing for a stage that pins a model — a pinned stage has no route", () => {
    expect(inheritedTaskOf(STANDARD_FIX, "plan")).toBeUndefined();
    expect(inheritedTaskOf(STANDARD_FIX, "analyze")).toBeUndefined();
  });

  it("answers nothing for a stage with no routing at all, or a node the document lacks", () => {
    expect(inheritedTaskOf(STANDARD_FIX, "build")).toBeUndefined();
    expect(inheritedTaskOf(STANDARD_FIX, "no-such-stage")).toBeUndefined();
  });

  it("answers nothing for a document it cannot read, rather than failing the page", () => {
    expect(inheritedTaskOf(null, "implement")).toBeUndefined();
    expect(inheritedTaskOf({ nodes: "not a list" }, "implement")).toBeUndefined();
  });

  it("answers nothing for a routing object whose task is not a name", () => {
    const document = structuredClone(STANDARD_FIX) as {
      nodes: { id: string; config: Record<string, unknown> }[];
    };
    const implement = document.nodes.find((node) => node.id === "implement")!;

    implement.config.routing = { inherit_task: "" };
    expect(inheritedTaskOf(document, "implement")).toBeUndefined();

    implement.config.routing = { inherit_task: 7 };
    expect(inheritedTaskOf(document, "implement")).toBeUndefined();

    implement.config.routing = "implement";
    expect(inheritedTaskOf(document, "implement")).toBeUndefined();
  });
});
