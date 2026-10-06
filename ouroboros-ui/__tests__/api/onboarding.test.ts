import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_ONBOARDING } from "@/app/get-started/view";

import { STUB_BASE_URL, stubClient } from "../helpers/api";
import {
  REPO,
  dryRunOn,
  launchReceipt,
  seededAlternatives,
  seededFirstIssue,
  seededTiles,
  selfHostedDefaults,
  templateSelection,
  wizard,
} from "../helpers/onboarding";

/** The wizard's service calls (#385, #388), the `/get-started` poll's hop (#390) and the cards' reads (#392–#394). */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ALTERNATIVES_LIMIT, onboarding, readFirstIssueCard } = await import("@/app/api/onboarding");
const { ONBOARDING_REPO_MISSING, ONBOARDING_UNAVAILABLE_CODE, readOnboardingPoll } = await import(
  "@/app/api/onboarding-poll"
);

/** A client answering one body, recording what it was asked. */
function answering(body: unknown) {
  return stubClient(() => ({ body }));
}

/** Each request as `METHOD path?query`, and its body. */
async function asked(requests: Request[]) {
  return Promise.all(
    requests.map(async (request) => ({
      call: `${request.method} ${request.url.replace(STUB_BASE_URL, "")}`,
      body: request.method === "GET" ? null : await request.text(),
    })),
  );
}

describe("the wizard's service calls", () => {
  it("reads one repository's wizard, naming it in the query", async () => {
    const { client, requests } = answering(wizard());

    expect(await onboarding.read(REPO, client)).toEqual(wizard());
    expect(await asked(requests)).toEqual([
      { call: "GET /api/v1/onboarding?repo=acme-robotics%2Fhelios-firmware", body: null },
    ]);
  });

  it("reads the fresh-org rule with no repository", async () => {
    const { client, requests } = answering({ offer: true, reason: "fresh_organization" });

    expect(await onboarding.surfacing(client)).toEqual({ offer: true, reason: "fresh_organization" });
    expect((await asked(requests))[0]!.call).toBe("GET /api/v1/onboarding/surfacing");
  });

  it("dismisses, completes a step, skips and launches — each scoped to the repository", async () => {
    const { client, requests } = stubClient((request) => ({
      body: request.url.includes("skip")
        ? { onboarding: wizard(), settingsPath: "/settings", configurationImported: false }
        : request.url.includes("launch")
          ? launchReceipt()
          : wizard(),
    }));

    await onboarding.update(REPO, { dismissed: true }, client);
    await onboarding.completeStep(REPO, 3, client);
    expect((await onboarding.skip(REPO, client)).configurationImported).toBe(false);
    expect((await onboarding.launch(REPO, client)).outcome).toBe("queued");

    expect(await asked(requests)).toEqual([
      { call: "PATCH /api/v1/onboarding?repo=acme-robotics%2Fhelios-firmware", body: '{"dismissed":true}' },
      { call: "POST /api/v1/onboarding/complete-step?repo=acme-robotics%2Fhelios-firmware", body: '{"step":3}' },
      { call: "POST /api/v1/onboarding/skip?repo=acme-robotics%2Fhelios-firmware", body: "" },
      { call: "POST /api/v1/onboarding/launch?repo=acme-robotics%2Fhelios-firmware", body: "" },
    ]);
  });

  it("throws the service's refusal", async () => {
    const { client } = stubClient(() => ({
      status: 409,
      body: { code: "onboarding_step_incomplete", message: "No workflow has been created yet.", details: {} },
    }));

    await expect(onboarding.completeStep(REPO, 3, client)).rejects.toMatchObject({
      status: 409,
      message: "No workflow has been created yet.",
    });
  });
});

describe("readOnboardingPoll", () => {
  it("reads the repository with a deadline, and answers the wizard", async () => {
    const read = vi.fn().mockResolvedValue(wizard());

    expect(await readOnboardingPoll(REPO, read)).toEqual({
      state: "fresh",
      payload: wizard(),
      etag: null,
      pollAfterSeconds: null,
    });
    expect(read.mock.calls[0]![0]).toBe(REPO);
    expect(read.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });

  it.each([null, undefined, "", "helios-firmware", "a/b/c"])(
    "never forwards %j — it is not a repository",
    async (repo) => {
      const read = vi.fn();

      expect(await readOnboardingPoll(repo, read)).toEqual({
        state: "failed",
        reason: ONBOARDING_REPO_MISSING,
        pollAfterSeconds: null,
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("reads a 401 as gone and a dropped read as unreachable, under this hop's code", async () => {
    expect(await readOnboardingPoll(REPO, vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readOnboardingPoll(REPO, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({
      state: "failed",
      reason: UNREACHABLE_ONBOARDING,
    });
    expect(ONBOARDING_UNAVAILABLE_CODE).toBe("onboarding_unavailable");
  });
});

describe("the template tiles' service calls (#392)", () => {
  it("reads one repository's tiles, naming it in the query, with the poll's deadline", async () => {
    const { client, requests } = answering(seededTiles());
    const controller = new AbortController();

    expect(await onboarding.templates(REPO, client, controller.signal)).toEqual(seededTiles());
    expect(await asked(requests)).toEqual([
      { call: "GET /api/v1/onboarding/templates?repo=acme-robotics%2Fhelios-firmware", body: null },
    ]);
  });

  it("selects a template by slug, scoped to the repository, and answers the selection", async () => {
    const { client, requests } = answering(templateSelection());

    expect(await onboarding.selectTemplate(REPO, "quick-fixes", client)).toEqual(templateSelection());
    expect(await asked(requests)).toEqual([
      {
        call: "POST /api/v1/onboarding/select-template?repo=acme-robotics%2Fhelios-firmware",
        body: JSON.stringify({ slug: "quick-fixes" }),
      },
    ]);
  });

  it("throws the gate's refusal with its findings, for the tile to draw", async () => {
    const { client } = stubClient(() => ({
      status: 422,
      body: {
        code: "onboarding_template_invalid",
        message: "The quick-fixes template could not be turned into a workflow: its definition did not pass validation.",
        details: { slug: "quick-fixes", version: 1, findings: [{ source: "dsl", code: "unreachable_node", message: "Stage review is unreachable.", path: "/nodes/3" }] },
      },
    }));

    await expect(onboarding.selectTemplate(REPO, "quick-fixes", client)).rejects.toMatchObject({
      status: 422,
      code: "onboarding_template_invalid",
      details: { findings: [{ code: "unreachable_node" }] },
    });
  });
});


describe("the first-issue card's service calls (#393)", () => {
  /** A client answering each of the card's three reads by its path. */
  function cardClient(dryRunStatus = 200) {
    return stubClient((request) => {
      if (request.url.includes("/policies/dry-run")) {
        return dryRunStatus === 200
          ? { body: dryRunOn() }
          : { status: dryRunStatus, body: { code: "unavailable", message: "The policy is busy.", details: {} } };
      }

      return { body: request.url.includes("alternatives") ? seededAlternatives() : seededFirstIssue() };
    });
  }

  it("reads the pick and the alternatives, naming the repository and the limit, with the poll's deadline", async () => {
    const { client, requests } = cardClient();
    const controller = new AbortController();

    expect(await onboarding.firstIssue(REPO, client, controller.signal)).toEqual(seededFirstIssue());
    expect(await onboarding.firstIssueAlternatives(REPO, 5, client, controller.signal)).toEqual(seededAlternatives());
    expect(await asked(requests)).toEqual([
      { call: "GET /api/v1/onboarding/first-issue?repo=acme-robotics%2Fhelios-firmware", body: null },
      { call: "GET /api/v1/onboarding/first-issue/alternatives?repo=acme-robotics%2Fhelios-firmware&limit=5", body: null },
    ]);
  });

  it("reads the card in one go — the pick, the whole ranking, and the policy as a reading", async () => {
    const { client, requests } = cardClient();

    expect(await readFirstIssueCard(REPO, client)).toEqual({
      firstIssue: seededFirstIssue(),
      alternatives: seededAlternatives(),
      dryRun: { ok: true, value: dryRunOn() },
    });
    expect((await asked(requests)).map((one) => one.call)).toEqual([
      "GET /api/v1/onboarding/first-issue?repo=acme-robotics%2Fhelios-firmware",
      `GET /api/v1/onboarding/first-issue/alternatives?repo=acme-robotics%2Fhelios-firmware&limit=${String(ALTERNATIVES_LIMIT)}`,
      "GET /api/v1/policies/dry-run",
    ]);
    expect(ALTERNATIVES_LIMIT).toBe(50);
  });

  it("keeps a policy that could not be read as a reason, beside a pick that could", async () => {
    const { client } = cardClient(503);

    expect((await readFirstIssueCard(REPO, client)).dryRun).toEqual({ ok: false, reason: "The policy is busy." });
  });

  it("throws the picker's refusal — the card is nothing without its pick", async () => {
    const { client } = stubClient(() => ({
      status: 422,
      body: { code: "validation_failed", message: "repo must be owner/name.", details: {} },
    }));

    await expect(readFirstIssueCard("nope", client)).rejects.toMatchObject({ status: 422 });
  });
});

describe("the right column's service call (#394)", () => {
  it("reads one repository's defaults, claims and projection, naming it in the query, with the poll's deadline", async () => {
    const { client, requests } = answering(selfHostedDefaults());
    const controller = new AbortController();

    expect(await onboarding.defaults(REPO, client, controller.signal)).toEqual(selfHostedDefaults());
    expect(await asked(requests)).toEqual([
      { call: "GET /api/v1/onboarding/defaults?repo=acme-robotics%2Fhelios-firmware", body: null },
    ]);
  });
});
