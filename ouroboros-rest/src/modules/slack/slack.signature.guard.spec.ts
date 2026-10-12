import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";

import type { AppConfigService } from "../config/config.service";
import { UnauthenticatedError } from "../errors/error.envelope";
import { SlackInboundController } from "./slack.controller";
import { SLACK_ERRORS } from "./slack.errors";
import { slackConfig } from "./slack.fixture";
import { slackSignature } from "./slack.signature";
import { SlackSignatureGuard } from "./slack.signature.guard";

/**
 * The guard on everything Slack calls (#535). The matrix itself is `slack.signature.spec.ts`;
 * this is that the guard applies it to the raw body and the configured secret, refuses with one
 * uninformative answer, and is actually on the three routes — **remove the verification and
 * this file goes red**.
 */

const BODY = Buffer.from('{"type":"event_callback","event_id":"Ev1"}');

/** A request context carrying what a case sends. */
function context(request: {
  headers?: Record<string, string>;
  rawBody?: Buffer;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {},
        originalUrl: "/api/v1/slack/events",
        ip: "203.0.113.9",
        ...request,
      }),
    }),
  } as unknown as ExecutionContext;
}

/** Headers for a body signed just now with a secret. */
function headers(secret: string, body: Buffer, at: Date = new Date()): Record<string, string> {
  const timestamp = String(Math.floor(at.getTime() / 1000));

  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": slackSignature(secret, timestamp, body),
  };
}

/** A guard over a configuration. */
function guard(overrides: Record<string, unknown> = {}): SlackSignatureGuard {
  return new SlackSignatureGuard(slackConfig(overrides) as unknown as AppConfigService);
}

/** What a refused call threw. */
function refusal(run: () => unknown): UnauthenticatedError {
  try {
    run();
  } catch (error) {
    return error as UnauthenticatedError;
  }
  throw new Error("the guard admitted the request");
}

describe("SlackSignatureGuard", () => {
  const secret = slackConfig().slackSigningSecret ?? "";

  it("admits a request signed with the deployment's signing secret", () => {
    expect(guard().canActivate(context({ headers: headers(secret, BODY), rawBody: BODY }))).toBe(
      true,
    );
  });

  it.each([
    ["a tampered body", { headers: headers(secret, BODY), rawBody: Buffer.from('{"type":"x"}') }],
    [
      "a signature made with another secret",
      { headers: headers("another-signing-secret-000000", BODY), rawBody: BODY },
    ],
    [
      "a stale timestamp",
      { headers: headers(secret, BODY, new Date(Date.now() - 10 * 60 * 1000)), rawBody: BODY },
    ],
    [
      "a future timestamp",
      { headers: headers(secret, BODY, new Date(Date.now() + 10 * 60 * 1000)), rawBody: BODY },
    ],
    ["no headers at all", { rawBody: BODY }],
    ["no raw body kept", { headers: headers(secret, BODY) }],
  ])("refuses %s with 401 slack_signature_invalid", (_label, request) => {
    const error = refusal(() => guard().canActivate(context(request)));

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe(SLACK_ERRORS.signatureInvalid);
  });

  it("says the same sentence whatever was wrong — a forger learns nothing from the answer", () => {
    const tampered = refusal(() =>
      guard().canActivate(context({ headers: headers(secret, BODY), rawBody: Buffer.from("x") })),
    );
    const missing = refusal(() => guard().canActivate(context({})));

    expect(tampered.getResponse()).toEqual(missing.getResponse());
  });

  it("refuses everything on a deployment with no signing secret — nothing can be Slack", () => {
    const unconfigured = guard({ slackSigningSecret: undefined });

    expect(
      refusal(() =>
        unconfigured.canActivate(context({ headers: headers(secret, BODY), rawBody: BODY })),
      ).code,
    ).toBe(SLACK_ERRORS.signatureInvalid);
  });

  it("is on the controller Slack calls, so no inbound route is reachable without it", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SlackInboundController)).toEqual([
      SlackSignatureGuard,
    ]);
  });
});
