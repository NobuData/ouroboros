import { PROTOCOL_VERSION, decode } from "../protocol/protocol";
import { bytes, fixtureBytes, fixtureFrame } from "./gateway.fixture";
import {
  DEFAULT_VERSION_POLICY,
  describe as describeDiagnostics,
  negotiate,
  readHello,
  securityModeRefusal,
  type VersionPolicy,
} from "./hello";

/** An agent that speaks exactly line 1 — the Go agent today. */
const V1 = { version: "0.1.0", protocol_min: 1, protocol_max: 1 };

describe("reading a hello", () => {
  describe("negotiate — the two floors", () => {
    it("accepts an agent inside the range, at the highest line both speak", () => {
      expect(negotiate(V1, DEFAULT_VERSION_POLICY)).toEqual({ accepted: true, protocol: 1 });
      expect(negotiate({ ...V1, protocol_max: 3 }, { protocolMin: 1, protocolMax: 2 })).toEqual({
        accepted: true,
        protocol: 2,
      });
    });

    it("refuses an agent below the protocol floor, naming the minimum", () => {
      const verdict = negotiate(V1, { protocolMin: 2, protocolMax: 2 });

      expect(verdict).toEqual({
        accepted: false,
        refusal: {
          code: "version.below_minimum",
          minimum: 2,
          detail: "this gateway speaks protocol 2 and this agent only 1; upgrade the agent",
          retry_after_ms: null,
        },
      });
    });

    it("refuses an agent newer than anything this gateway speaks as unsupported", () => {
      const verdict = negotiate(
        { ...V1, protocol_min: 3, protocol_max: 4 },
        DEFAULT_VERSION_POLICY,
      );

      expect(verdict).toMatchObject({
        accepted: false,
        refusal: { code: "version.unsupported", minimum: 1, retry_after_ms: null },
      });
      expect(!verdict.accepted && verdict.refusal.detail).toContain("3–4");
    });

    it("refuses an agent build below the configured agent-version floor, naming both", () => {
      const policy: VersionPolicy = { ...DEFAULT_VERSION_POLICY, minimumAgentVersion: "0.2.0" };
      const verdict = negotiate(V1, policy);

      expect(verdict).toEqual({
        accepted: false,
        refusal: {
          code: "version.below_minimum",
          minimum: 1,
          detail: "agent 0.1.0 is below this farm's minimum agent version 0.2.0; upgrade the agent",
          retry_after_ms: null,
        },
      });
    });

    it("compares agent versions by precedence, not as strings", () => {
      const policy: VersionPolicy = { ...DEFAULT_VERSION_POLICY, minimumAgentVersion: "0.9.0" };

      expect(negotiate({ ...V1, version: "0.10.0" }, policy).accepted).toBe(true);
      expect(negotiate({ ...V1, version: "0.9.0" }, policy).accepted).toBe(true);
      expect(negotiate({ ...V1, version: "0.9.0-rc.1" }, policy).accepted).toBe(false);
    });

    it("refuses a build that does not report a semantic version when a floor is set", () => {
      const policy: VersionPolicy = { ...DEFAULT_VERSION_POLICY, minimumAgentVersion: "0.1.0" };

      expect(negotiate({ ...V1, version: "dev" }, policy).accepted).toBe(false);
      expect(negotiate({ ...V1, version: "dev" }, DEFAULT_VERSION_POLICY).accepted).toBe(true);
    });
  });

  describe("readHello", () => {
    it("acknowledges the golden hello at line 1", () => {
      const reading = readHello(fixtureBytes("valid/hello.json"), DEFAULT_VERSION_POLICY);

      expect(reading.kind).toBe("hello");
      expect(reading.kind === "hello" && reading.protocol).toBe(PROTOCOL_VERSION);
      expect(reading.kind === "hello" && reading.envelope.payload.hostname).toBe("shed-pi-01");
    });

    it("refuses the refuse transcript's hello with the transcript's refusal shape", () => {
      // sessions/refuse.json: valid/hello.json, answered by a refusal shaped like valid/refuse.json.
      const reading = readHello(fixtureBytes("valid/hello.json"), {
        ...DEFAULT_VERSION_POLICY,
        minimumAgentVersion: "0.2.0",
      });
      const golden = decode(fixtureBytes("valid/refuse.json")).envelope;

      expect(reading.kind).toBe("refuse");
      expect(reading.kind === "refuse" && reading.refusal.code).toBe(
        (golden?.payload as { code: string }).code,
      );
      expect(reading.kind === "refuse" && reading.refusal.minimum).toBe(1);
    });

    it("closes on a first frame that is not a hello", () => {
      expect(readHello(fixtureBytes("valid/heartbeat.json"), DEFAULT_VERSION_POLICY)).toEqual({
        kind: "violation",
        reason: "the first frame was heartbeat, not hello",
      });
    });

    it("closes on an illegal hello, naming codes and paths only", () => {
      const reading = readHello(
        fixtureBytes("invalid/hello-field-unknown.json"),
        DEFAULT_VERSION_POLICY,
      );

      expect(reading).toEqual({
        kind: "violation",
        reason: "an illegal first frame: payload.field.unknown at /payload/token",
      });
    });

    it("reads a hello written in a newer line whose range reaches this gateway's", () => {
      const hello = fixtureFrame("valid/hello.json");
      hello.v = 2;
      (hello.payload.agent as { protocol_max: number }).protocol_max = 2;

      const reading = readHello(bytes(hello), DEFAULT_VERSION_POLICY);

      expect(reading.kind).toBe("hello");
      expect(reading.kind === "hello" && reading.protocol).toBe(1);
    });

    it("refuses a hello written in a line this gateway cannot reach, as unsupported", () => {
      const hello = fixtureFrame("valid/hello.json");
      hello.v = 2;
      hello.payload.agent = { version: "2.0.0", protocol_min: 2, protocol_max: 2 };

      const reading = readHello(bytes(hello), DEFAULT_VERSION_POLICY);

      expect(reading).toMatchObject({
        kind: "refuse",
        refusal: { code: "version.unsupported", minimum: 1 },
      });
    });

    it("refuses a newer-line hello that is not a legal line-1 hello rather than guessing at it", () => {
      const hello = fixtureFrame("valid/hello.json");
      hello.v = 2;
      (hello.payload.agent as { protocol_max: number }).protocol_max = 2;
      hello.payload.labels = ["gpu"];

      expect(readHello(bytes(hello), DEFAULT_VERSION_POLICY)).toMatchObject({
        kind: "refuse",
        refusal: { code: "version.unsupported" },
      });
    });

    it("closes on a newer-line frame that is not a hello at all", () => {
      const beat = fixtureFrame("valid/heartbeat.json");
      beat.v = 2;

      expect(readHello(bytes(beat), DEFAULT_VERSION_POLICY).kind).toBe("violation");
    });

    it("closes on a newer-line hello with no readable range", () => {
      const hello = fixtureFrame("valid/hello.json");
      hello.v = 2;
      hello.payload.agent = { version: "2.0.0" };

      expect(readHello(bytes(hello), DEFAULT_VERSION_POLICY).kind).toBe("violation");
    });
  });

  describe("securityModeRefusal — the claim against the transport", () => {
    it("accepts a claim that matches, and a hello that makes none", () => {
      expect(securityModeRefusal("mtls", "mtls")).toBeUndefined();
      expect(securityModeRefusal("bearer_fallback", "bearer_fallback")).toBeUndefined();
      expect(securityModeRefusal(undefined, "bearer_fallback")).toBeUndefined();
    });

    it("refuses mtls claimed on a connection that presented no certificate — a stripping proxy", () => {
      expect(securityModeRefusal("mtls", "bearer_fallback")).toMatchObject({
        code: "identity.unknown",
        minimum: null,
        retry_after_ms: null,
      });
      expect(securityModeRefusal("mtls", "bearer_fallback")?.detail).toContain("stripping");
    });

    it("refuses bearer_fallback claimed on a certificate connection", () => {
      expect(securityModeRefusal("bearer_fallback", "mtls")?.code).toBe("identity.unknown");
    });
  });

  it("describes diagnostics by code and path, with the root as /", () => {
    expect(
      describeDiagnostics([
        { code: "envelope.malformed", path: "" },
        { code: "payload.field.range", path: "/payload/cpu_pct" },
      ]),
    ).toBe("envelope.malformed at /, payload.field.range at /payload/cpu_pct");
  });
});
