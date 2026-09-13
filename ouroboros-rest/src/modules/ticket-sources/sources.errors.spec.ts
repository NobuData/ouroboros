import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import { MINIMUM_SYNC_INTERVAL_SECONDS } from "../backlog/debounce";
import {
  TICKET_SOURCE_ERRORS,
  sourceConfigInvalid,
  sourceCredentialsUnsupported,
  sourceNameTaken,
  sourceNotFound,
  sourcePaused,
  sourceSyncRunning,
  sourceSyncTooSoon,
} from "./sources.errors";
import { TICKET_SOURCE_REGISTRY_ERRORS } from "./ticket-source.registry";

/**
 * The source-management refusals ([#141](https://github.com/NobuData/ouroboros/issues/141)):
 * every code is one a client can look up, every status is the one the envelope promises, and
 * no message names anything the service keeps to itself.
 */

const MODULE_ROOT = join(__dirname, "..", "..", "..");

const SPECIFICATION = readFileSync(join(MODULE_ROOT, "openapi.yaml"), "utf8");

const SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";

describe("the codes", () => {
  it.each(Object.values(TICKET_SOURCE_ERRORS))(
    "names %s as a stable, machine-readable code",
    (code) => {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/);
    },
  );

  it.each(Object.values(TICKET_SOURCE_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(code);
  });

  it("publishes the registry's 501 now that a route can answer it", () => {
    // `ticket-source.registry.ts` withheld the code while no operation could raise it. The
    // add, update, credentials, test and sync operations all resolve a provider, so it is
    // published against them.
    expect(SPECIFICATION).toContain(TICKET_SOURCE_REGISTRY_ERRORS.kindUnsupported);
  });

  it("keeps the three sync refusals apart, because the reader's next move differs", () => {
    expect(
      new Set([
        TICKET_SOURCE_ERRORS.paused,
        TICKET_SOURCE_ERRORS.syncRunning,
        TICKET_SOURCE_ERRORS.syncTooSoon,
      ]).size,
    ).toBe(3);
  });
});

describe("a source that is not there", () => {
  it("is a 404 naming what was asked for", () => {
    const error = sourceNotFound(SOURCE_ID);

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.notFound);
    expect(error.envelope().details).toEqual({ sourceId: SOURCE_ID });
  });
});

describe("a configuration the schema refused", () => {
  it("is a 422 carrying every field's sentences, in the validation envelope's own shape", () => {
    const error = sourceConfigInvalid({ repos: ["Repositories needs at least 1 entry"] });

    expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.configInvalid);
    expect(error.envelope().details).toEqual({
      fields: { repos: ["Repositories needs at least 1 entry"] },
    });
  });
});

describe("a name already in use", () => {
  it("is a 409 naming the name", () => {
    const error = sourceNameTaken("GitHub · acme-robotics");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.nameTaken);
    expect(error.envelope().details).toEqual({ displayName: "GitHub · acme-robotics" });
  });
});

describe("the three ways a manual sync is refused", () => {
  it("refuses a paused source with a 409 that says what to do first", () => {
    const error = sourcePaused(SOURCE_ID);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.paused);
    expect(error.envelope().message).toContain("Resume");
  });

  it("refuses a running sync with a 409 and no retry hint, because none is knowable", () => {
    const error = sourceSyncRunning(SOURCE_ID);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.syncRunning);
    expect(error.envelope().details).toEqual({ sourceId: SOURCE_ID });
    expect(error.envelope().details).not.toHaveProperty("retryAfterSeconds");
  });

  it("refuses a repeat inside the interval with a 409 carrying the wait", () => {
    const error = sourceSyncTooSoon(22);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.syncTooSoon);
    expect(error.envelope().details).toEqual({ retryAfterSeconds: 22 });
    expect(error.envelope().message).toContain(String(MINIMUM_SYNC_INTERVAL_SECONDS));
  });
});

describe("a provider with nowhere to put a credential", () => {
  it("is a 409 naming the kind", () => {
    const error = sourceCredentialsUnsupported("custom");

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.envelope().code).toBe(TICKET_SOURCE_ERRORS.credentialsUnsupported);
    expect(error.envelope().details).toEqual({ kind: "custom" });
  });
});

describe("every message", () => {
  it("names nothing about the service's internals", () => {
    for (const error of [
      sourceNotFound(SOURCE_ID),
      sourceConfigInvalid({ x: ["y"] }),
      sourceNameTaken("n"),
      sourcePaused(SOURCE_ID),
      sourceSyncRunning(SOURCE_ID),
      sourceSyncTooSoon(1),
      sourceCredentialsUnsupported("custom"),
    ]) {
      expect(error.envelope().message).not.toMatch(/ticket_sources|organization_id|vault|token/i);
    }
  });
});
