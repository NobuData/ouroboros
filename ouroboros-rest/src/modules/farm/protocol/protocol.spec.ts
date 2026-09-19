import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ENVELOPE_MAX_BYTES,
  LOG_CHUNK_MAX_BASE64_CHARS,
  LOG_CHUNK_MAX_BYTES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  SENT_BY,
  decode,
  encode,
  frame,
  isMessageType,
  sortDiagnostics,
  type Diagnostic,
  type MessageType,
  type Sender,
} from "./protocol";
import { SPECS, decodedLength } from "./protocol.schema";

/**
 * The parity suite — this codec against `schemas/runner-protocol/fixtures/expected.json`
 * ([#251](https://github.com/NobuData/ouroboros/issues/251)).
 *
 * It is the reason the fixtures exist. The agent is Go and this gateway is TypeScript; neither
 * imports the other, and neither is the specification. What makes them agree is that
 * `ouroboros-runner/internal/conn/protocol_test.go` and this file assert against the **same
 * bytes** — so a rule added to one codec and forgotten in the other fails in the half that
 * forgot it, on the pull request that forgot it. That is the issue's *golden fixtures are
 * shared with the Go tests; drift fails CI*, and `ci/rest` watches `schemas/runner-protocol/**`
 * so that a fixture change alone runs this suite.
 *
 * The fixtures are read out of the repository rather than copied: a copy is a second copy, and a
 * second copy is the drift this arrangement exists to prevent. A contract that cannot be found
 * fails the suite rather than skipping it — a parity suite that passes when it cannot read the
 * contract reports green about nothing.
 */

/** `schemas/runner-protocol/`, from this file. */
const PROTOCOL_ROOT = join(__dirname, "..", "..", "..", "..", "..", "schemas", "runner-protocol");

/** Its `fixtures/`. */
const FIXTURES = join(PROTOCOL_ROOT, "fixtures");

/** One case of the parity contract. */
interface Case {
  readonly name: string;
  readonly about: string;
  readonly document: string;
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** One recorded session, and what replaying it must produce. */
interface Transcript {
  readonly name: string;
  readonly document: string;
  readonly duplicate_terminals: number;
}

/** `expected.json`. */
interface Contract {
  readonly cases: readonly Case[];
  readonly transcripts: readonly Transcript[];
}

/** One `sessions/*.json` entry: a frame from one end, or the socket dying. */
interface SessionEntry {
  readonly from?: Sender;
  readonly message?: string;
  readonly event?: "disconnect";
}

/**
 * Read a file under `fixtures/`.
 *
 * @param name - Its path relative to `fixtures/`.
 * @returns Its bytes.
 */
function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

/** The contract, read once. */
const CONTRACT = JSON.parse(fixture("expected.json").toString("utf8")) as Contract;

/** `v1.json`, read once. */
const SCHEMA = JSON.parse(readFileSync(join(PROTOCOL_ROOT, "v1.json"), "utf8")) as {
  readonly properties: { readonly type: { readonly enum: readonly string[] } };
  readonly $defs: {
    readonly limits: { readonly const: Readonly<Record<string, number>> };
    readonly diagnostic_codes: { readonly enum: readonly string[] };
  };
};

/**
 * A transcript's frames.
 *
 * @param document - Its path relative to `fixtures/`.
 * @returns The entries, in order.
 */
function session(document: string): readonly SessionEntry[] {
  return (JSON.parse(fixture(document).toString("utf8")) as { frames: SessionEntry[] }).frames;
}

/**
 * A heartbeat frame padded to a given total size in bytes, with a fifth envelope key.
 *
 * The padding is an illegal key on purpose: a frame at the ceiling is *parsed* and then refused
 * for what is in it, while a frame one byte over is refused as `envelope.malformed` before any
 * parsing — and the two diagnostics are how the test tells those apart.
 *
 * @param bytes - The frame's size.
 * @returns The frame's text, exactly that many bytes long.
 */
function frameOfSize(bytes: number): string {
  const base = fixture("valid/heartbeat.json").toString("utf8").trim();
  const shell = base.replace(/\}\s*$/, ', "pad": ""}');
  const padding = bytes - Buffer.byteLength(shell);

  return shell.replace('"pad": ""', `"pad": "${"x".repeat(padding)}"`);
}

/**
 * A `log.chunk` frame carrying a given number of decoded bytes.
 *
 * @param bytes - How many bytes of log.
 * @returns The frame's text.
 */
function chunkOf(bytes: number): string {
  const chunk = JSON.parse(fixture("valid/log-chunk.json").toString("utf8")) as {
    payload: { data: string };
  };
  chunk.payload.data = Buffer.alloc(bytes, 0x61).toString("base64");

  return JSON.stringify(chunk);
}

describe("the runner protocol codec", () => {
  describe("against expected.json — the parity contract", () => {
    it("reads a contract that has cases in it", () => {
      expect(CONTRACT.cases.length).toBeGreaterThan(40);
    });

    it.each(CONTRACT.cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
      const result = decode(fixture(testCase.document));

      expect(result.diagnostics).toEqual(testCase.diagnostics);
      expect(result.envelope !== undefined).toBe(testCase.valid);
    });

    it("names every fixture in valid/ and invalid/ in a case, so none can accumulate unasserted", () => {
      const named = new Set(CONTRACT.cases.map((c) => c.document));
      const files = ["valid", "invalid"].flatMap((directory) =>
        readdirSync(join(FIXTURES, directory)).map((file) => `${directory}/${file}`),
      );

      expect(files.filter((file) => !named.has(file))).toEqual([]);
    });

    it("has a valid example of every message type", () => {
      const types = new Set(
        CONTRACT.cases
          .filter((c) => c.valid)
          .map((c) => (JSON.parse(fixture(c.document).toString("utf8")) as { type: string }).type),
      );

      expect([...types].sort()).toEqual([...MESSAGE_TYPES].sort());
    });
  });

  describe("against the session transcripts", () => {
    it.each(CONTRACT.transcripts.map((t) => [t.name, t] as const))(
      "%s: every frame decodes, travels in its type's direction, and the duplicates add up",
      (_name, transcript) => {
        const seen = new Set<string>();
        let duplicates = 0;

        for (const entry of session(transcript.document)) {
          if (entry.event === "disconnect") continue;

          const result = decode(fixture(entry.message as string));
          expect(result.diagnostics).toEqual([]);

          const envelope = result.envelope;
          if (!envelope) throw new Error(`${String(entry.message)} did not decode`);

          expect(SENT_BY[envelope.type]).toContain(entry.from);

          if (envelope.type === "job.finish") {
            if (seen.has(envelope.id)) duplicates += 1;
            seen.add(envelope.id);
          }
        }

        expect(duplicates).toBe(transcript.duplicate_terminals);
      },
    );
  });

  describe("against v1.json", () => {
    it("speaks the line the schema is written for", () => {
      expect(SCHEMA.$defs.limits.const.protocol).toBe(PROTOCOL_VERSION);
    });

    it("holds the ceilings the schema publishes as numbers", () => {
      expect(SCHEMA.$defs.limits.const).toEqual({
        protocol: PROTOCOL_VERSION,
        envelope_max_bytes: ENVELOPE_MAX_BYTES,
        log_chunk_max_bytes: LOG_CHUNK_MAX_BYTES,
        log_chunk_max_base64_chars: LOG_CHUNK_MAX_BASE64_CHARS,
      });
    });

    it("knows exactly the schema's message types, and has a contract and a direction for each", () => {
      expect([...MESSAGE_TYPES]).toEqual(SCHEMA.properties.type.enum);
      expect(Object.keys(SPECS)).toEqual(SCHEMA.properties.type.enum);
      expect(Object.keys(SENT_BY)).toEqual(SCHEMA.properties.type.enum);
    });

    it("can produce only the diagnostic codes the schema names", () => {
      const produced = new Set(CONTRACT.cases.flatMap((c) => c.diagnostics.map((d) => d.code)));

      for (const code of produced) expect(SCHEMA.$defs.diagnostic_codes.enum).toContain(code);
    });
  });

  // The two limits the contract deliberately does not ship as fixtures (§ 7): each
  // implementation builds the boundary from the published numbers instead.
  describe("the boundaries built from the published limits", () => {
    it("accepts a frame of exactly the ceiling and refuses one byte more, without parsing it", () => {
      expect(Buffer.byteLength(frameOfSize(ENVELOPE_MAX_BYTES))).toBe(ENVELOPE_MAX_BYTES);
      expect(decode(frameOfSize(ENVELOPE_MAX_BYTES)).diagnostics).toEqual([
        { code: "envelope.field.unknown", path: "/pad" },
      ]);
      expect(decode(frameOfSize(ENVELOPE_MAX_BYTES + 1)).diagnostics).toEqual([
        { code: "envelope.malformed", path: "" },
      ]);
    });

    it("accepts a chunk of exactly the decoded cap and refuses one byte more", () => {
      expect(decode(chunkOf(LOG_CHUNK_MAX_BYTES)).diagnostics).toEqual([]);
      expect(decode(chunkOf(LOG_CHUNK_MAX_BYTES + 1)).diagnostics).toEqual([
        { code: "payload.field.range", path: "/payload/data" },
      ]);
    });

    it("measures a chunk's decoded length strictly, as Go's standard encoding does", () => {
      expect(decodedLength("YWJj")).toBe(3);
      expect(decodedLength("YWI=")).toBe(2);
      expect(decodedLength("YQ==")).toBe(1);
      expect(decodedLength("YW\nJj")).toBe(3);
      expect(decodedLength("not base64!!")).toBeUndefined();
      expect(decodedLength("YWJ")).toBeUndefined();
    });
  });

  describe("what the fixtures do not pin", () => {
    it("refuses an integer written as a fraction, as the Go decoder does", () => {
      const text = fixture("valid/heartbeat.json").toString("utf8").replace('"v": 1', '"v": 1.0');

      expect(decode(text).diagnostics).toEqual([{ code: "envelope.field.type", path: "/v" }]);
    });

    it("refuses a counter written with an exponent, and accepts a fraction where a number is legal", () => {
      const text = fixture("valid/heartbeat.json")
        .toString("utf8")
        .replace('"uptime_s": 86400', '"uptime_s": 8.64e4');

      expect(decode(text).diagnostics).toEqual([
        { code: "payload.field.type", path: "/payload/uptime_s" },
      ]);
      expect(decode(fixture("valid/heartbeat.json")).envelope?.payload).toMatchObject({
        cpu_pct: 4.5,
      });
    });

    it("refuses what is not JSON, and JSON that is not an object", () => {
      for (const text of ["", "{", "null", "1", '"hello"', "[]"]) {
        expect(decode(text).diagnostics).toEqual([{ code: "envelope.malformed", path: "" }]);
      }
    });

    it("hands back plain numbers, not the wire's representation of them", () => {
      const envelope = decode(fixture("valid/hello.json")).envelope;

      expect(envelope?.payload).toMatchObject({ capabilities: { cpus: 8, memory_mb: 16384 } });
      expect(
        typeof (envelope?.payload as { capabilities: { cpus: unknown } }).capabilities.cpus,
      ).toBe("number");
    });

    it("anchors an unknown key inside an open map's value at its escaped path", () => {
      const offer = JSON.parse(fixture("valid/job-offer.json").toString("utf8")) as {
        payload: { env: Record<string, unknown> };
      };
      offer.payload.env["A/B~C"] = 7;

      expect(decode(JSON.stringify(offer)).diagnostics).toEqual([
        { code: "payload.field.type", path: "/payload/env/A~1B~0C" },
      ]);
    });

    it("anchors array elements at numeric paths, sorted as numbers", () => {
      const offer = JSON.parse(fixture("valid/job-offer.json").toString("utf8")) as {
        payload: { command: unknown[] };
      };
      offer.payload.command = Array.from({ length: 12 }, (_, i) => (i === 2 || i === 10 ? i : "x"));

      expect(decode(JSON.stringify(offer)).diagnostics).toEqual([
        { code: "payload.field.type", path: "/payload/command/2" },
        { code: "payload.field.type", path: "/payload/command/10" },
      ]);
    });
  });

  describe("writing", () => {
    it.each(MESSAGE_TYPES.map((t) => [t] as const))(
      "writes a %s that its own decoder accepts, byte-compatible with the fixture",
      (type: MessageType) => {
        const valid = CONTRACT.cases.find(
          (c) =>
            c.valid &&
            (JSON.parse(fixture(c.document).toString("utf8")) as { type: string }).type === type,
        );
        const decoded = decode(fixture(valid?.document as string)).envelope;
        if (!decoded) throw new Error(`no valid ${type} fixture`);

        const text = encode(frame(decoded.type, decoded.payload, decoded.id));

        expect(decode(text).envelope).toEqual(decoded);
        expect(JSON.parse(text)).toEqual(
          JSON.parse(fixture(valid?.document as string).toString("utf8")),
        );
      },
    );

    it("mints a fresh ULID per frame unless it is given one", () => {
      const first = frame("undrain", {});
      const second = frame("undrain", {});

      expect(first.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(second.id > first.id).toBe(true);
      expect(frame("undrain", {}, first.id).id).toBe(first.id);
    });

    it("refuses to write a frame over the ceiling", () => {
      const huge = frame("bye", {
        reason: "error",
        detail: "x".repeat(ENVELOPE_MAX_BYTES),
        reconnect_after_ms: null,
      });

      expect(() => encode(huge)).toThrow(RangeError);
    });
  });

  describe("helpers", () => {
    it("recognises exactly the fifteen types", () => {
      expect(MESSAGE_TYPES).toHaveLength(15);
      expect(isMessageType("job.finish")).toBe(true);
      expect(isMessageType("job.finished")).toBe(false);
    });

    it("sorts by path, numerically where segments are numbers, then by code", () => {
      expect(
        sortDiagnostics([
          { code: "payload.field.type", path: "/payload/b" },
          { code: "payload.field.range", path: "/payload/a/10" },
          { code: "payload.field.enum", path: "/payload/a/2" },
          { code: "payload.field.type", path: "/payload/a/2" },
          { code: "payload.field.missing", path: "/payload" },
        ]),
      ).toEqual([
        { code: "payload.field.missing", path: "/payload" },
        { code: "payload.field.enum", path: "/payload/a/2" },
        { code: "payload.field.type", path: "/payload/a/2" },
        { code: "payload.field.range", path: "/payload/a/10" },
        { code: "payload.field.type", path: "/payload/b" },
      ]);
    });
  });
});
