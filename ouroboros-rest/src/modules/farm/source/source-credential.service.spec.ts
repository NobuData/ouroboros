import { DomainError } from "../../errors/error.envelope";
import { buildJob, JOB, ORG } from "../dispatch/dispatch.fixture";
import { SOURCE_CREDENTIAL_ERRORS } from "./source-credential.errors";
import type { SourceCredentialRepository, SourceLedger } from "./source-credential.repository";
import {
  SOURCE_CREDENTIAL_USERNAME,
  SOURCE_TICKET_GRACE_MS,
  SourceCredentialService,
  sourceCredentialPath,
} from "./source-credential.service";
import { hashSourceTicket, mintSourceTicket } from "./source-credential.token";

/**
 * The source credential (#991, decision L9): a ticket minted with the offer when the workspace
 * has a GitHub token, redeemed once for that token, every failure one opaque 401, the trail
 * naming the repository and nothing of the credential.
 */

const NOW = new Date("2026-10-16T12:00:00.000Z");
const TOKEN = "ghp_workspaceTokenNeverLogged0123456789";

let ticket: string;
let ledgerRow: SourceLedger | undefined;
let redeemed: boolean;
let configured: boolean;
let repository: jest.Mocked<Pick<SourceCredentialRepository, "mint" | "ledger" | "redeem">>;
let audit: { record: jest.Mock };
let github: { isConfigured: jest.Mock; tokenFor: jest.Mock };
let service: SourceCredentialService;

/** The ledger as the mint left it, for a ticket the case knows. */
function ledgerFor(token: string, over: Partial<SourceLedger> = {}): SourceLedger {
  return {
    jobId: JOB,
    organizationId: ORG,
    tokenHash: hashSourceTicket(token),
    expiresAt: new Date(NOW.getTime() + 60_000),
    redeemedAt: null,
    status: "offered",
    repository: "acme-robotics/helios-firmware",
    ...over,
  };
}

beforeEach(() => {
  ticket = mintSourceTicket().token;
  ledgerRow = ledgerFor(ticket);
  redeemed = true;
  configured = true;
  repository = {
    mint: jest.fn().mockResolvedValue(true),
    ledger: jest.fn().mockImplementation(() => Promise.resolve(ledgerRow)),
    redeem: jest.fn().mockImplementation(() => Promise.resolve(redeemed)),
  };
  audit = { record: jest.fn().mockResolvedValue("event-id") };
  github = {
    isConfigured: jest.fn().mockImplementation(() => Promise.resolve(configured)),
    tokenFor: jest.fn().mockResolvedValue(TOKEN),
  };
  service = new SourceCredentialService(
    repository as unknown as SourceCredentialRepository,
    github as never,
    audit as never,
    () => NOW,
  );
});

/** The code a refused promise carries. */
async function refusal(promise: Promise<unknown>): Promise<[number, string]> {
  const error: unknown = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );

  expect(error).toBeInstanceOf(DomainError);

  return [(error as DomainError).getStatus(), (error as DomainError).code];
}

describe("minting with the offer", () => {
  it("mints a ticket on the job's path, valid for the answer window plus a grace", async () => {
    const credential = await service.forOffer(buildJob(), NOW, 10_000);

    expect(credential).toEqual({
      path: sourceCredentialPath(JOB),
      token: expect.stringMatching(/^ouro_src_[A-Za-z0-9._~-]+$/) as string,
      expires_at: new Date(NOW.getTime() + 10_000 + SOURCE_TICKET_GRACE_MS).toISOString(),
    });
    expect(repository.mint).toHaveBeenCalledWith(
      ORG,
      JOB,
      hashSourceTicket(credential?.token ?? ""),
      NOW,
      new Date(NOW.getTime() + 10_000 + SOURCE_TICKET_GRACE_MS),
    );
    expect(sourceCredentialPath(JOB)).toBe(`/api/v1/farm/jobs/${JOB}/source-credential`);
  });

  it("mints nothing for a workspace with no GitHub token — that clone is anonymous", async () => {
    configured = false;

    await expect(service.forOffer(buildJob(), NOW, 10_000)).resolves.toBeUndefined();
    expect(repository.mint).not.toHaveBeenCalled();
  });

  it("mints nothing once the job's ticket was redeemed — the row is frozen", async () => {
    repository.mint.mockResolvedValue(false);

    await expect(service.forOffer(buildJob(), NOW, 10_000)).resolves.toBeUndefined();
  });
});

describe("redeeming", () => {
  it("answers the workspace's token as a git credential, once, and audits the repository", async () => {
    const answer = await service.redeem(JOB, `Bearer ${ticket}`);

    expect(answer).toEqual({
      username: SOURCE_CREDENTIAL_USERNAME,
      password: TOKEN,
      expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    expect(repository.redeem).toHaveBeenCalledWith(JOB, hashSourceTicket(ticket), NOW);
    expect(github.tokenFor).toHaveBeenCalledWith(ORG);
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: null,
      action: "runner.source_credential_redeemed",
      subjectType: "build_job",
      subjectId: JOB,
      at: NOW,
      detail: { repository: "acme-robotics/helios-firmware" },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(ticket);
  });

  it.each([
    ["no bearer", () => undefined],
    ["a basic credential", () => "Basic abc"],
    ["another ticket", () => `Bearer ${mintSourceTicket().token}`],
    [
      "a job with no ledger",
      () => {
        ledgerRow = undefined;
        return `Bearer ${ticket}`;
      },
    ],
    [
      "an expired ticket",
      () => {
        ledgerRow = ledgerFor(ticket, { expiresAt: NOW });
        return `Bearer ${ticket}`;
      },
    ],
    [
      "a ticket already redeemed",
      () => {
        ledgerRow = ledgerFor(ticket, { redeemedAt: new Date(NOW.getTime() - 1000) });
        return `Bearer ${ticket}`;
      },
    ],
    [
      "a job that is not being run",
      () => {
        ledgerRow = ledgerFor(ticket, { status: "succeeded" });
        return `Bearer ${ticket}`;
      },
    ],
    [
      "a redemption another presentation won",
      () => {
        redeemed = false;
        return `Bearer ${ticket}`;
      },
    ],
  ])(
    "refuses %s with one opaque 401, opening no token and auditing nothing",
    async (_label, header) => {
      const authorization = header();

      expect(await refusal(service.redeem(JOB, authorization))).toEqual([
        401,
        SOURCE_CREDENTIAL_ERRORS.refused,
      ]);
      expect(github.tokenFor).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it("reads no ledger at all for a request carrying no bearer", async () => {
    await refusal(service.redeem(JOB, undefined));

    expect(repository.ledger).not.toHaveBeenCalled();
  });
});
