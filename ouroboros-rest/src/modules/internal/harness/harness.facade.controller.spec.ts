import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../../auth/anonymous";
import { INTERNAL_ONLY } from "../internal.decorators";
import { HARNESS_ANTHROPIC_PATH, HARNESS_MESSAGES_ROUTE } from "../internal.paths";
import type { HarnessCredentialsService } from "./harness.credentials.service";
import { facadeRefusal } from "./harness.errors";
import { HarnessFacadeController, sinkOf, type FacadeResponse } from "./harness.facade.controller";
import type { HarnessFacadeService } from "./harness.facade.service";
import type { CredentialBinding } from "./harness.repository";

/** A response that records what was written. */
function response(): FacadeResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer[];
  ended: boolean;
  close(): void;
} {
  const listeners: (() => void)[] = [];
  const recorded = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: [] as Buffer[],
    ended: false,
    status(code: number) {
      recorded.statusCode = code;
    },
    setHeader(name: string, value: string) {
      recorded.headers[name] = value;
    },
    write(chunk: Uint8Array) {
      recorded.body.push(Buffer.from(chunk));
    },
    end() {
      recorded.ended = true;
    },
    on(_event: "close", listener: () => void) {
      listeners.push(listener);
    },
    close() {
      listeners.forEach((listener) => {
        listener();
      });
    },
  };

  return recorded;
}

const BINDING = { id: "c1", alias: "coder-max" } as CredentialBinding;

describe("the harness facade route", () => {
  it("is authenticated by its credential, not by the internal key", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, HarnessFacadeController)).toBeUndefined();
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, HarnessFacadeController)).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, HarnessFacadeController)).toBe(
      HARNESS_ANTHROPIC_PATH,
    );
    expect(Reflect.getMetadata(PATH_METADATA, HarnessFacadeController.prototype.messages)).toBe(
      HARNESS_MESSAGES_ROUTE,
    );
    expect(Reflect.getMetadata(METHOD_METADATA, HarnessFacadeController.prototype.messages)).toBe(
      1,
    );
  });

  it("writes a credential refusal in the Messages API's error shape, and relays nothing", async () => {
    const credentials = {
      authenticate: jest.fn().mockResolvedValue(facadeRefusal("credential_expired", "Expired.")),
    } as unknown as HarnessCredentialsService;
    const facade = { relay: jest.fn() } as unknown as HarnessFacadeService;
    const res = response();

    await new HarnessFacadeController(credentials, facade).messages(
      { model: "coder-max" },
      { headers: {} },
      res,
    );

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(Buffer.concat(res.body).toString("utf8"))).toMatchObject({
      type: "error",
      error: { type: "authentication_error" },
      ouroboros: { code: "credential_expired" },
    });
    expect(facade.relay).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an object", async () => {
    const credentials = {
      authenticate: jest.fn().mockResolvedValue(BINDING),
    } as unknown as HarnessCredentialsService;
    const res = response();

    await new HarnessFacadeController(credentials, {
      relay: jest.fn(),
    } as unknown as HarnessFacadeService).messages([], { headers: {} }, res);

    expect(res.statusCode).toBe(400);
  });

  it("relays with the right path, and aborts when the harness leaves", async () => {
    let seen: AbortSignal | undefined;
    const res = response();
    const facade = {
      relay: jest.fn((call: { signal: AbortSignal; path: string }) => {
        seen = call.signal;
        res.close();

        return Promise.resolve();
      }),
    } as unknown as HarnessFacadeService;
    const credentials = {
      authenticate: jest.fn().mockResolvedValue(BINDING),
    } as unknown as HarnessCredentialsService;

    await new HarnessFacadeController(credentials, facade).countTokens(
      { model: "coder-max" },
      { headers: {} },
      res,
    );

    expect(facade.relay).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v1/messages/count_tokens", binding: BINDING }),
      expect.anything(),
    );
    expect(seen?.aborted).toBe(true);
  });
});

describe("sinkOf", () => {
  it("sends status and headers once, flushed, then the bytes as given", () => {
    const res = response();
    const sink = sinkOf(res);

    sink.head(200, { "content-type": "text/event-stream" });
    sink.write(new Uint8Array([1, 2]));
    sink.end();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(Buffer.concat(res.body)).toEqual(Buffer.from([1, 2]));
    expect(res.ended).toBe(true);
  });
});
