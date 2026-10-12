/**
 * The guard on everything Slack calls (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * It runs before the handler and before anything reads the parsed body: the signature is
 * checked against the **raw bytes** `slack.raw-body.ts` kept, the app's signing secret and the
 * clock (`slack.signature.ts`). A request that fails is answered `401 slack_signature_invalid`
 * — one sentence, the same for every reason — and the reason is written to the security log
 * with where the request came from. A deployment with no signing secret refuses everything:
 * with nothing to verify against, nothing is Slack.
 */

import { type CanActivate, type ExecutionContext, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { slackSignatureInvalid } from "./slack.errors";
import {
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER,
  verifySlackSignature,
} from "./slack.signature";

/** The part of a request this guard reads. */
interface SignedRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody?: Buffer;
  readonly originalUrl?: string;
  readonly ip?: string;
}

/**
 * One header's value.
 *
 * @param request - The request.
 * @param name - The header, lower-case.
 * @returns Its value — the first when it was sent more than once.
 */
function header(request: SignedRequest, name: string): string | undefined {
  const value = request.headers[name];

  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class SlackSignatureGuard implements CanActivate {
  private readonly logger = new Logger("SlackSecurity");

  /** @param config - The app's signing secret. */
  constructor(private readonly config: AppConfigService) {}

  /**
   * Admit a request Slack signed, recently.
   *
   * @param context - The request about to reach a Slack handler.
   * @returns `true` for a verified request.
   * @throws {UnauthenticatedError} `401 slack_signature_invalid` for anything else.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SignedRequest>();
    const signingSecret = this.config.slackSigningSecret;

    const verdict =
      signingSecret === undefined
        ? ({ valid: false, problem: "signing_secret_not_configured" } as const)
        : verifySlackSignature(
            {
              signature: header(request, SLACK_SIGNATURE_HEADER),
              timestamp: header(request, SLACK_TIMESTAMP_HEADER),
              rawBody: request.rawBody,
            },
            signingSecret,
            new Date(),
          );

    if (verdict.valid) {
      return true;
    }

    // The security log: why, where and from whom — and nothing a request carried.
    this.logger.warn(
      `Refused a request to ${request.originalUrl ?? "a Slack endpoint"} from ${request.ip ?? "an unknown address"}: ${verdict.problem}`,
    );

    throw slackSignatureInvalid();
  }
}
