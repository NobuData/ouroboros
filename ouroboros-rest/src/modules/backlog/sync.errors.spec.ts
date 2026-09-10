import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { BACKLOG_SYNC_ERRORS, syncAlreadyRunning, syncTooSoon } from "./sync.errors";
import { MINIMUM_SYNC_INTERVAL_SECONDS } from "./debounce";

/**
 * The codes, and the promise that the document is the registry — `tenancy.errors.spec.ts`'s
 * shape, for the same reason: a code is only useful if it is stable and if a client can
 * discover what it means, and `openapi.yaml` is where the second half lives.
 */

/** The module root, where the authoritative specification is committed. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** The authoritative specification, read once. */
const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

describe("the codes", () => {
  it.each(Object.values(BACKLOG_SYNC_ERRORS))(
    "names %s as a stable, machine-readable code",
    (code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(BACKLOG_SYNC_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("keeps the two apart, because the reader's next move differs", () => {
    // *Watch it* and *wait this long* are different instructions, and one `sync_refused`
    // would leave a client unable to tell them apart.
    expect(BACKLOG_SYNC_ERRORS.running).not.toBe(BACKLOG_SYNC_ERRORS.tooSoon);
  });
});

describe("a cycle that is already running", () => {
  it("is a 409 rather than a 429 — the caller did not cause it", () => {
    // `429` means *you* have done this too often, and would invite a client to back its own
    // requests off, which changes nothing about a loop it does not own.
    const error = syncAlreadyRunning();

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(BACKLOG_SYNC_ERRORS.running);
  });

  it("carries no retry hint, because none is knowable", () => {
    expect(syncAlreadyRunning().envelope().details).toEqual({});
  });

  it("says what will happen next, rather than what went wrong", () => {
    expect(syncAlreadyRunning().envelope().message).toContain("already running");
  });
});

describe("a repeat inside the minimum interval", () => {
  it("is a 409 carrying the wait", () => {
    const error = syncTooSoon(22);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(BACKLOG_SYNC_ERRORS.tooSoon);
    expect(error.envelope().details).toEqual({ retryAfterSeconds: 22 });
  });

  it("names the interval it is measured against, so the refusal explains itself", () => {
    expect(syncTooSoon(22).envelope().message).toContain(String(MINIMUM_SYNC_INTERVAL_SECONDS));
  });

  it("names nothing about the service's internals", () => {
    // The message is read by whoever clicked. No workspace id, no repository, no table.
    const message = syncTooSoon(22).envelope().message;

    expect(message).not.toMatch(/github_|organization|token/i);
  });
});
