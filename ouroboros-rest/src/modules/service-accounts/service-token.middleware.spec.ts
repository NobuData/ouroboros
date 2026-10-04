import {
  SERVICE_PRINCIPAL_PROPERTY,
  SERVICE_TOKEN_REJECTED_PROPERTY,
  type ServiceRequest,
} from "../auth/service.principal";
import { FIXTURE_ORGANIZATION } from "../tenancy/organization.fixture";
import type { ServiceAccountsRepository } from "./service-accounts.repository";
import { ServiceTokenMiddleware } from "./service-token.middleware";
import { hashServiceToken } from "./service.tokens";

/**
 * Authentication before the guards (#485): a live token becomes a principal, anything else with
 * the prefix becomes a rejection, and a request without one is untouched.
 */

const TOKEN = `orb_svc_${"A".repeat(43)}`;

/** A repository that knows one token. */
function repository(known: boolean): jest.Mocked<ServiceAccountsRepository> {
  return {
    authenticate: jest.fn().mockResolvedValue(
      known
        ? {
            tokenId: "token-1",
            accountId: "account-1",
            name: "devops-bot",
            scopes: ["api.read"],
            organization: FIXTURE_ORGANIZATION,
          }
        : undefined,
    ),
    touch: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ServiceAccountsRepository>;
}

/** A request with an Authorization header. */
function bearing(value?: string): ServiceRequest {
  return { headers: value === undefined ? {} : { authorization: value } };
}

describe("authenticating a service token", () => {
  it("attaches the principal and stamps last use for a live token", async () => {
    const accounts = repository(true);
    const request = bearing(`Bearer ${TOKEN}`);

    await new ServiceTokenMiddleware(accounts).authenticate(request);

    expect(accounts.authenticate).toHaveBeenCalledWith(hashServiceToken(TOKEN));
    expect(accounts.touch).toHaveBeenCalledWith("token-1", expect.any(Date));
    expect(request[SERVICE_PRINCIPAL_PROPERTY]).toMatchObject({
      name: "devops-bot",
      scopes: ["api.read"],
      organization: FIXTURE_ORGANIZATION,
    });
    expect(request[SERVICE_TOKEN_REJECTED_PROPERTY]).toBeUndefined();
  });

  it("flags an unknown, rotated or revoked token as rejected", async () => {
    const request = bearing(`Bearer ${TOKEN}`);

    await new ServiceTokenMiddleware(repository(false)).authenticate(request);

    expect(request[SERVICE_TOKEN_REJECTED_PROPERTY]).toBe(true);
    expect(request[SERVICE_PRINCIPAL_PROPERTY]).toBeUndefined();
  });

  it("rejects a malformed token without a query", async () => {
    const accounts = repository(true);
    const request = bearing("Bearer orb_svc_short");

    await new ServiceTokenMiddleware(accounts).authenticate(request);

    expect(accounts.authenticate).not.toHaveBeenCalled();
    expect(request[SERVICE_TOKEN_REJECTED_PROPERTY]).toBe(true);
  });

  it("leaves a request with no service token alone", async () => {
    const accounts = repository(true);

    for (const request of [bearing(), bearing("Bearer something-else")]) {
      await new ServiceTokenMiddleware(accounts).authenticate(request);
      expect(request[SERVICE_PRINCIPAL_PROPERTY]).toBeUndefined();
      expect(request[SERVICE_TOKEN_REJECTED_PROPERTY]).toBeUndefined();
    }
    expect(accounts.authenticate).not.toHaveBeenCalled();
  });

  it("continues the request, or hands a failed lookup to next", async () => {
    const accounts = repository(true);
    const next = jest.fn();

    new ServiceTokenMiddleware(accounts).use(bearing(`Bearer ${TOKEN}`), {}, next);
    await new Promise(process.nextTick);
    expect(next).toHaveBeenCalledWith();

    const failure = new Error("database down");
    accounts.authenticate.mockRejectedValue(failure);
    const failed = jest.fn();

    new ServiceTokenMiddleware(accounts).use(bearing(`Bearer ${TOKEN}`), {}, failed);
    await new Promise(process.nextTick);
    expect(failed).toHaveBeenCalledWith(failure);
  });
});
