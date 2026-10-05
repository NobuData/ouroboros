import { describe, expect, it } from "vitest";

import {
  AUDIT_FAMILY,
  EMPTY_DRAFT,
  FAMILIES_REQUIRED,
  NAME_REQUIRED,
  NONE,
  READ_FAILED,
  SIEM_NEEDS_AUDIT,
  SIEM_OPENS_ENDPOINTS,
  SIEM_OPENS_LOG,
  URL_INVALID,
  URL_NOT_HTTPS,
  URL_REQUIRED,
  WRITE_FAILED,
  type WebhookDraft,
  actionLabel,
  activeCountLabel,
  attemptStamp,
  codeOf,
  createBody,
  deadLetteredPhrase,
  deleteWarning,
  deliveryLogTitle,
  detailOf,
  draftFieldErrors,
  draftOf,
  familyChoices,
  healthLine,
  healthWarns,
  latencyOf,
  pingSentence,
  rangeLabel,
  redeliverLabel,
  redeliveredSentence,
  refusalSentence,
  rotateWarning,
  secretLead,
  siemHint,
  siemStatus,
  switchLabel,
  toggleFamily,
  updateBody,
  validateDraft,
  withEndpoint,
  withoutEndpoint,
} from "@/app/webhooks/view";

import {
  DEPLOY_ID,
  SIEM_ID,
  deadLetter,
  deployEndpoint,
  webhookDelivery,
  webhookEndpoint,
  webhookHealth,
  webhookList,
  webhookListWithSiem,
} from "../helpers/webhooks";

/**
 * The webhook surfaces' rules (BS.5, #495): the SIEM row's status claim, the form's checks and
 * bodies, and the sentences the sheets say.
 */

describe("the SIEM row", () => {
  it("is the ✓ only when the service says streaming", () => {
    const status = siemStatus(webhookList());

    expect(status).toMatchObject({ state: "streaming", mark: "✓", detail: "(webhook)", endpointId: SIEM_ID });
  });

  it("is a warning with the dead-lettered count when events are dead-lettered — even if streaming were claimed", () => {
    const status = siemStatus(
      webhookListWithSiem({
        streaming: true,
        warning: true,
        health: webhookHealth({ state: "dead_lettered", deadLettered: 3 }),
      }),
    );

    expect(status.state).toBe("warning");
    expect(status.mark).toBe("⚠");
    expect(status.detail).toBe("— deliveries failing (3 events dead-lettered)");
    expect(status.summary).toContain("hole");
  });

  it.each([
    [{ streaming: false, active: false }, "paused", "— paused"],
    [{ streaming: false, health: webhookHealth({ state: "retrying", retrying: 1 }) }, "retrying", "— retrying"],
    [{ streaming: false, health: webhookHealth({ state: "idle", lastAttemptAt: null }) }, "idle", "— no deliveries yet"],
    [{ streaming: false }, "stalled", "— not delivering"],
  ] as const)("says what is true without a ✓: %#", (siem, state, detail) => {
    const status = siemStatus(webhookListWithSiem(siem));

    expect(status.state).toBe(state);
    expect(status.detail).toBe(detail);
    expect(status.mark).toBeNull();
    expect(status.endpointId).toBe(SIEM_ID);
  });

  it("says not set up with no SIEM endpoint, and unavailable when the endpoints were not read", () => {
    expect(siemStatus(webhookList({ siem: null }))).toMatchObject({ state: "unset", detail: "— not set up", endpointId: null, mark: null });
    expect(siemStatus(null)).toMatchObject({ state: "unknown", detail: "— status unavailable", endpointId: null, mark: null });
  });

  it("names what a press does: the log when there is an endpoint, the endpoints when not", () => {
    expect(siemHint(siemStatus(webhookList()))).toContain(SIEM_OPENS_LOG);
    expect(siemHint(siemStatus(webhookList({ siem: null })))).toContain(SIEM_OPENS_ENDPOINTS);
  });
});

describe("words and figures", () => {
  it("phrases health with the count when events wait", () => {
    expect(healthLine(webhookHealth())).toBe("healthy");
    expect(healthLine(webhookHealth({ state: "dead_lettered", deadLettered: 1 }))).toBe(
      "dead-lettering · 1 event dead-lettered",
    );
    expect(healthWarns(webhookHealth())).toBe(false);
    expect(healthWarns(webhookHealth({ state: "dead_lettered", deadLettered: 2 }))).toBe(true);
    expect(deadLetteredPhrase(2)).toBe("2 events dead-lettered");
  });

  it("stamps in UTC to the second, and passes through what is not a date", () => {
    expect(attemptStamp("2026-10-05T14:31:07.000Z")).toBe("2026-10-05 14:31:07");
    expect(attemptStamp("2026-10-05T16:31:07+02:00")).toBe("2026-10-05 14:31:07");
    expect(attemptStamp("soon")).toBe("soon");
  });

  it("draws an absent code, latency and detail as a dash", () => {
    expect(codeOf(null)).toBe(NONE);
    expect(codeOf(503)).toBe("503");
    expect(latencyOf(null)).toBe(NONE);
    expect(latencyOf(182)).toBe("182 ms");
    expect(detailOf(deadLetter())).toBe("receiver answered 503");
    expect(detailOf(webhookDelivery())).toBe("ok");
    expect(detailOf(webhookDelivery({ responseExcerpt: null }))).toBe(NONE);
  });

  it("says which rows of how many", () => {
    expect(rangeLabel(0, 25, 132)).toBe("1–25 of 132");
    expect(rangeLabel(125, 7, 132)).toBe("126–132 of 132");
    expect(rangeLabel(0, 0, 0)).toBe("0 of 0");
  });

  it("says a ping's row, success or failure", () => {
    expect(pingSentence(webhookDelivery({ eventType: "ping" }))).toBe("Ping succeeded · HTTP 200 · 182 ms");
    expect(
      pingSentence(webhookDelivery({ status: "failed", responseCode: null, latencyMs: null, error: "connection refused" })),
    ).toBe("Ping failed · connection refused");
    expect(pingSentence(webhookDelivery({ status: "failed", responseCode: 500, error: null }))).toBe(
      "Ping failed · HTTP 500 · 182 ms",
    );
  });

  it("labels and sentences name what they are about", () => {
    expect(redeliverLabel(deadLetter())).toBe("Redeliver audit.policy.published, attempt 6");
    expect(redeliveredSentence(webhookDelivery({ attempt: 7 }))).toContain("attempt 7");
    expect(actionLabel("Edit", "deploy-bot")).toBe("Edit deploy-bot");
    expect(switchLabel({ name: "deploy-bot", active: true })).toBe("Pause deploy-bot");
    expect(switchLabel({ name: "deploy-bot", active: false })).toBe("Enable deploy-bot");
    expect(activeCountLabel(2)).toBe("2 active");
    expect(deliveryLogTitle("siem-forwarder")).toBe("Deliveries · siem-forwarder");
    expect(rotateWarning("deploy-bot")).toContain("shown once");
    expect(deleteWarning(deployEndpoint())).not.toContain("SIEM");
    expect(deleteWarning(webhookEndpoint())).toContain("SIEM stream");
    expect(secretLead("x", false)).not.toBe(secretLead("x", true));
  });

  it("falls back when the service gave no sentence", () => {
    expect(refusalSentence("  ")).toBe(WRITE_FAILED);
    expect(refusalSentence("", READ_FAILED)).toBe(READ_FAILED);
    expect(refusalSentence("No.")).toBe("No.");
  });
});

describe("the form's rules", () => {
  const draft: WebhookDraft = {
    name: " siem-forwarder ",
    url: " https://siem.acme.dev/hooks/ouroboros ",
    description: "  ",
    families: [AUDIT_FAMILY],
    siem: true,
  };

  it("passes a complete draft", () => {
    expect(validateDraft(draft)).toEqual({});
  });

  it("names each thing a browser can see is wrong", () => {
    expect(validateDraft(EMPTY_DRAFT)).toEqual({
      name: NAME_REQUIRED,
      url: URL_REQUIRED,
      families: FAMILIES_REQUIRED,
    });
    expect(validateDraft({ ...draft, url: "not a url" }).url).toBe(URL_INVALID);
    expect(validateDraft({ ...draft, url: "http://siem.acme.dev" }).url).toBe(URL_NOT_HTTPS);
  });

  it("refuses a SIEM stream that does not subscribe to audit.*", () => {
    expect(validateDraft({ ...draft, families: ["pr.*"] })).toEqual({ siem: SIEM_NEEDS_AUDIT });
    expect(validateDraft({ ...draft, families: ["pr.*"], siem: false })).toEqual({});
  });

  it("builds the create body trimmed, with no empty description and no secret", () => {
    expect(createBody(draft)).toEqual({
      name: "siem-forwarder",
      url: "https://siem.acme.dev/hooks/ouroboros",
      eventFamilies: ["audit.*"],
      siem: true,
    });
    expect(createBody({ ...draft, description: " Splunk " }).description).toBe("Splunk");
  });

  it("round-trips an endpoint through the form with nothing to send", () => {
    const endpoint = webhookEndpoint();

    expect(updateBody(draftOf(endpoint), endpoint)).toEqual({});
    expect(updateBody({ ...draftOf(deployEndpoint()), families: ["run.merged", "pr.*"] }, deployEndpoint())).toEqual({});
  });

  it("sends only what changed, clearing a description with null", () => {
    const endpoint = webhookEndpoint();

    expect(
      updateBody({ ...draftOf(endpoint), description: "", families: ["audit.*", "pr.*"] }, endpoint),
    ).toEqual({ description: null, eventFamilies: ["audit.*", "pr.*"] });
    expect(updateBody({ ...draftOf(endpoint), name: "siem", siem: false }, endpoint)).toEqual({
      name: "siem",
      siem: false,
    });
    expect(updateBody({ ...draftOf(endpoint), url: "https://other.dev/h" }, endpoint)).toEqual({
      url: "https://other.dev/h",
    });
  });

  it("offers the registry's families and keeps an exact type the endpoint already has", () => {
    expect(familyChoices(["audit.*", "pr.*"], ["pr.*", "run.merged"])).toEqual(["audit.*", "pr.*", "run.merged"]);
    expect(toggleFamily(["audit.*"], "pr.*")).toEqual(["audit.*", "pr.*"]);
    expect(toggleFamily(["audit.*", "pr.*"], "audit.*")).toEqual(["pr.*"]);
  });

  it("routes a refusal's fields to the form's, first message each", () => {
    expect(
      draftFieldErrors({
        fields: {
          url: ["url resolves to an internal address", "second"],
          "eventFamilies.0": ["unknown family"],
          siem: "another endpoint is the SIEM route",
          registryVersion: ["not a form field"],
          name: [""],
        },
      }),
    ).toEqual({
      url: "url resolves to an internal address",
      families: "unknown family",
      siem: "another endpoint is the SIEM route",
    });
    expect(draftFieldErrors({})).toEqual({});
    expect(draftFieldErrors(null)).toEqual({});
    expect(draftFieldErrors({ fields: "no" })).toEqual({});
  });
});

describe("the list, kept in step", () => {
  it("replaces an endpoint and recounts the active ones", () => {
    const next = withEndpoint(webhookList(), deployEndpoint({ active: false }));

    expect(next.items).toHaveLength(2);
    expect(next.activeCount).toBe(1);
  });

  it("puts a new endpoint first", () => {
    const next = withEndpoint(webhookList(), webhookEndpoint({ id: "new", name: "new", siem: false }));

    expect(next.items.map((item) => item.id)).toEqual(["new", SIEM_ID, DEPLOY_ID]);
    expect(next.activeCount).toBe(3);
  });

  it("drops an endpoint, and the SIEM row with its endpoint", () => {
    expect(withoutEndpoint(webhookList(), DEPLOY_ID)).toMatchObject({ activeCount: 1, siem: { endpointId: SIEM_ID } });
    expect(withoutEndpoint(webhookList(), SIEM_ID)).toMatchObject({ activeCount: 1, siem: null });
  });
});
