import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryState } from "@/app/login/sso";

/**
 * Step 1's SSO half, now that it can act
 * ([#718](https://github.com/NobuData/ouroboros/issues/718)).
 *
 * **This suite used to assert the opposite of almost every case in it.** The form shipped
 * inert in [#44](https://github.com/NobuData/ouroboros/issues/44) — the field carried
 * `disabled`, the button carried `aria-disabled` and a reason, and the reason was one
 * `SSO_UNAVAILABLE` constant. That was the right rendering while there was no endpoint behind
 * it (design system § 3.5). [#712](https://github.com/NobuData/ouroboros/issues/712) is the
 * endpoint, so *asserts disabled* becomes *asserts submits*, and the paragraph under the
 * button is asserted to be the service's sentence rather than this application's.
 *
 * The action itself is `__tests__/login/actions.test.ts`. What is mocked here is not a
 * shortcut but the boundary: this component's whole job is to submit a field and render what
 * came back, and a suite that also ran the action would be testing the action twice and this
 * component's markup once.
 */

/** What the mocked action answers, for this case. */
let answer: DiscoveryState;

/** Every domain the action was submitted with, in order. */
let submitted: string[];

vi.mock("@/app/login/actions", () => ({
  discoverDomain: (_previous: DiscoveryState, formData: FormData) => {
    submitted.push(String(formData.get("domain") ?? ""));
    return Promise.resolve(answer);
  },
}));

const { SsoForm } = await import("@/app/login/sso-form");

/** The mockup's own explainer id, which the card owns and hands down. */
const EXPLAINER = "login-sso-why";

beforeEach(() => {
  submitted = [];
  answer = {
    status: "answered",
    ssoAvailable: false,
    message: "Enterprise SSO is not configured yet — sign in with GitHub for now.",
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Render the form as the card does, with the explainer it points at beside it.
 *
 * @returns Testing Library's result.
 */
function ssoForm() {
  return render(
    <>
      <SsoForm describedBy={EXPLAINER} />
      <p id={EXPLAINER}>
        SAML 2.0 and OIDC via your identity provider — Okta, Entra ID, Google Workspace.
      </p>
    </>,
  );
}

/**
 * Type a domain and press the button.
 *
 * @param domain What to put in the field.
 */
function submit(domain: string) {
  fireEvent.change(screen.getByLabelText("Company domain"), { target: { value: domain } });
  fireEvent.click(screen.getByRole("button", { name: /continue with sso/i }));
}

describe("the field and its button", () => {
  it("carries the mockup's enterprise-domain field, with its example domain", () => {
    ssoForm();

    expect(screen.getByLabelText("Company domain")).toHaveAttribute(
      "placeholder",
      "acme.ouroboros.dev",
    );
  });

  it("accepts typing, because what is typed now goes somewhere", () => {
    // It carried the real `disabled` while there was nothing to submit to — "a text box that
    // accepts typing and then discards it is worse than one that does not".
    ssoForm();

    expect(screen.getByLabelText("Company domain")).not.toBeDisabled();
  });

  it("offers a button that can be pressed, and submits the form around it", () => {
    // It carried `aria-disabled` and a `reason`, which also made it `type="button"` — the
    // primitive refuses to let an inert control submit anything.
    ssoForm();

    const button = screen.getByRole("button", { name: /continue with sso/i });

    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveAttribute("type", "submit");
  });

  it("describes both controls with the mockup's SAML/OIDC explainer", () => {
    ssoForm();

    expect(screen.getByLabelText("Company domain")).toHaveAccessibleDescription(
      /SAML 2\.0 and OIDC/,
    );
    expect(screen.getByRole("button", { name: /continue with sso/i })).toHaveAccessibleDescription(
      /SAML 2\.0 and OIDC/,
    );
  });

  it("says nothing about SSO until something has been asked", () => {
    // The state the constant could not express: *nothing has been asked* is not *the answer
    // was no*, and a card that said "not configured" before a domain was typed was answering
    // a question nobody put.
    ssoForm();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("what a submission renders", () => {
  it("submits the domain that was typed", async () => {
    ssoForm();

    submit("acme-robotics.dev");

    await waitFor(() => expect(submitted).toEqual(["acme-robotics.dev"]));
  });

  it("renders the endpoint's own sentence, rather than a constant of its own", async () => {
    // The acceptance criterion, as a case: the designed state is driven by the response.
    ssoForm();

    submit("acme-robotics.dev");

    expect(await screen.findByRole("status")).toHaveTextContent(/not configured yet/i);
  });

  it("renders whatever the endpoint says instead, which is how #722 lands unchanged", async () => {
    answer = {
      status: "answered",
      ssoAvailable: true,
      message: "Taking you to your identity provider…",
    };
    ssoForm();

    submit("acme-robotics.dev");

    expect(await screen.findByRole("status")).toHaveTextContent(/identity provider/i);
  });

  it("announces a refusal as an alert, since it is this client's failure and not an answer", async () => {
    answer = {
      status: "refused",
      message: "domain must be a company domain, such as acme.ouroboros.dev",
    };
    ssoForm();

    submit("not a domain");

    expect(await screen.findByRole("alert")).toHaveTextContent(/must be a company domain/i);
  });

  it("replaces the last answer rather than stacking answers up", async () => {
    ssoForm();

    submit("acme-robotics.dev");
    await screen.findByRole("status");

    answer = { status: "refused", message: "The service failed." };
    submit("second.example");

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("The service failed.");
  });

  it("keeps the field usable after an answer, so a second domain can be tried", async () => {
    ssoForm();

    submit("acme-robotics.dev");
    await screen.findByRole("status");

    expect(screen.getByLabelText("Company domain")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /continue with sso/i })).not.toBeDisabled();
  });
});

/**
 * The a11y pass over the controls #718 made live.
 *
 * The shipped suite covered the inert state only, which is a different set of properties
 * entirely: an `aria-disabled` control's whole job is to be reachable and explain itself,
 * and none of what is below applies to one.
 */
describe("what a screen reader is told", () => {
  it("does not mark the field invalid before anything has been typed", () => {
    ssoForm();

    expect(screen.getByLabelText("Company domain")).not.toHaveAttribute("aria-invalid");
  });

  it("marks the field invalid when the value is what was refused", async () => {
    answer = {
      status: "refused",
      message: "domain must be a company domain, such as acme.ouroboros.dev",
    };
    ssoForm();

    submit("not a domain");

    await waitFor(() =>
      expect(screen.getByLabelText("Company domain")).toHaveAttribute("aria-invalid", "true"),
    );
  });

  it("leaves the field valid for an answer, which is about the domain and not the typing", async () => {
    // Marking the input invalid here would tell somebody they had mistyped a domain the
    // service understood perfectly.
    ssoForm();

    submit("acme-robotics.dev");

    await screen.findByRole("status");
    expect(screen.getByLabelText("Company domain")).not.toHaveAttribute("aria-invalid");
  });

  it("describes the field with the answer as well as the explainer", async () => {
    // The live region announces it once; this is what makes it findable *again* by somebody
    // who has tabbed back to correct the domain, which is the likelier order after a refusal.
    answer = { status: "refused", message: "The service failed." };
    ssoForm();

    submit("acme-robotics.dev");

    await waitFor(() =>
      expect(screen.getByLabelText("Company domain")).toHaveAccessibleDescription(
        /SAML 2\.0 and OIDC[\s\S]*The service failed\./,
      ),
    );
  });

  it("keeps the explainer as the only description while nothing has been asked", () => {
    ssoForm();

    expect(screen.getByLabelText("Company domain")).toHaveAccessibleDescription(
      "SAML 2.0 and OIDC via your identity provider — Okta, Entra ID, Google Workspace.",
    );
  });
});
