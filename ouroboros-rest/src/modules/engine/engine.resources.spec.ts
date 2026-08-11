import { engineStatusResource } from "./engine.resources";

/**
 * What the engine said, and what this API says about it.
 *
 * A short file for a short function, and the assertions are all about the *difference*
 * between the two shapes: the version crosses the boundary, and nothing else does.
 */

/** A parsed `GET /v0/status`, as the client hands one over. */
const status = { service: "ouroboros-engine", version: "0.3.0", uptimeSeconds: 1234.567 };

describe("the engine status resource", () => {
  it("reports the engine as up", () => {
    // There is no other value: every way the engine can fail to answer is a `502`, so a
    // body that exists at all came from a reachable engine.
    expect(engineStatusResource(status).engine).toBe("up");
  });

  it("reports the build that answered", () => {
    expect(engineStatusResource(status).version).toBe("0.3.0");
  });

  it("carries exactly the two documented fields", () => {
    expect(Object.keys(engineStatusResource(status)).sort()).toEqual(["engine", "version"]);
  });

  it("does not publish the engine's uptime", () => {
    // Deliberate, and the reason is who reads it: uptime answers an operator's question,
    // and an operator has the engine's own logs and the readiness probe. Adding a field
    // later is compatible; removing one a screen has started rendering is not.
    expect(JSON.stringify(engineStatusResource(status))).not.toContain("1234.567");
  });

  it("does not publish the engine's distribution name", () => {
    expect(JSON.stringify(engineStatusResource(status))).not.toContain("ouroboros-engine");
  });
});
