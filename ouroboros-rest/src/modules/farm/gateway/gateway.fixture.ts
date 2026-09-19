/**
 * Test doubles for the gateway's unit suites — a socket that records what is written to it, and
 * the fixture frames an agent sends, read from the protocol's own golden files.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). Every frame a suite here feeds
 * the gateway is a file under `schemas/runner-protocol/fixtures/` or a copy of one with a field
 * changed, never a hand-typed object: a suite whose inputs were written from memory tests what
 * its author remembered the protocol to be.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decode, type Envelope, type MessageType } from "../protocol/protocol";
import type { AgentSocket } from "./agent.socket";

/** `schemas/runner-protocol/fixtures/`, from this file. */
export const FIXTURES = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "schemas",
  "runner-protocol",
  "fixtures",
);

/**
 * A fixture's bytes.
 *
 * @param name - Its path under `fixtures/`, e.g. `valid/hello.json`.
 * @returns The bytes.
 */
export function fixtureBytes(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

/**
 * A fixture as an object, to change a field of before sending.
 *
 * @param name - Its path under `fixtures/`.
 * @returns A fresh, mutable copy.
 */
export function fixtureFrame(name: string): {
  v: number;
  type: string;
  id: string;
  payload: Record<string, unknown>;
} {
  return JSON.parse(fixtureBytes(name).toString("utf8")) as {
    v: number;
    type: string;
    id: string;
    payload: Record<string, unknown>;
  };
}

/**
 * Encode an object as a frame's bytes.
 *
 * @param value - The frame.
 * @returns The bytes.
 */
export function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

/** A socket that keeps everything written to it. */
export class FakeSocket implements AgentSocket {
  /** Every frame written, decoded — `decode` refusing one fails the suite, as the agent would. */
  readonly sent: Envelope[] = [];
  /** The close, once there has been one. */
  closedWith: { code: number; reason: string } | undefined;
  /** Whether `terminate` was called. */
  terminated = false;
  /** Set to make every later write fail, as a socket that died does. */
  failWrites = false;

  /** Whether a write could still land. */
  get isOpen(): boolean {
    return this.closedWith === undefined && !this.terminated;
  }

  /**
   * Record a frame.
   *
   * @param text - The frame.
   * @returns Resolves, or rejects when writes are failing or the socket is closed.
   */
  send(text: string): Promise<void> {
    if (this.failWrites || !this.isOpen) return Promise.reject(new Error("socket closed"));

    const decoded = decode(text);
    if (!decoded.envelope) {
      return Promise.reject(
        new Error(`the gateway wrote an illegal frame: ${JSON.stringify(decoded.diagnostics)}`),
      );
    }

    this.sent.push(decoded.envelope);
    return Promise.resolve();
  }

  /**
   * Record a close.
   *
   * @param code - The close code.
   * @param reason - The reason.
   */
  close(code: number, reason: string): void {
    this.closedWith ??= { code, reason };
  }

  /** Record a termination. */
  terminate(): void {
    this.terminated = true;
  }

  /**
   * The types written, in order.
   *
   * @returns The types.
   */
  types(): MessageType[] {
    return this.sent.map((envelope) => envelope.type);
  }

  /**
   * The last frame of a type.
   *
   * @param type - Which.
   * @returns It, typed.
   * @throws {Error} If none was written — a suite asserting on a frame that never came.
   */
  last<T extends MessageType>(type: T): Envelope<T> {
    const found = [...this.sent].reverse().find((envelope) => envelope.type === type);
    if (!found) throw new Error(`no ${type} was written; wrote ${this.types().join(", ")}`);

    return found as Envelope<T>;
  }
}

/**
 * Let every pending promise callback run.
 *
 * @returns After a macrotask, by which time a chain of resolved promises has settled.
 */
export function drain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
