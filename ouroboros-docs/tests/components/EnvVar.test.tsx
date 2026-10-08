// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EnvVar, { CONFIG_REFERENCE_ROUTE, envVarHref } from "../../src/components/EnvVar";

describe("envVarHref", () => {
  it("points at the variable's heading on the configuration reference", () => {
    expect(CONFIG_REFERENCE_ROUTE).toBe("/administration/configuration");
    expect(envVarHref("OURO_SMTP_URL")).toBe("/administration/configuration#ouro_smtp_url");
  });

  it.each(["ouro_smtp_url", "OURO-SMTP-URL", "1OURO", "", "OURO SMTP"])(
    "refuses %j, which is not a variable name",
    (name) => {
      expect(() => envVarHref(name)).toThrow(/variable name/);
    },
  );
});

describe("<EnvVar>", () => {
  it("renders the name in the code face, linked to the reference", () => {
    render(<EnvVar name="OURO_MAIL_FROM" />);
    const code = screen.getByText("OURO_MAIL_FROM");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("a")).toHaveAttribute(
      "href",
      "/administration/configuration#ouro_mail_from",
    );
  });

  it("fails loudly on a malformed name", () => {
    expect(() => render(<EnvVar name="smtp url" />)).toThrow(/variable name/);
  });
});
