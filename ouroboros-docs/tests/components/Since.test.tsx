// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Since, { sinceLabel } from "../../src/components/Since";

describe("sinceLabel", () => {
  it("names the module and version", () => {
    expect(sinceLabel("0.7.16", "ouroboros-rest")).toBe("Since ouroboros-rest 0.7.16");
  });

  it("leaves the module out when none is given", () => {
    expect(sinceLabel("1.0.0")).toBe("Since 1.0.0");
    expect(sinceLabel("1.0.0", "  ")).toBe("Since 1.0.0");
  });

  it.each(["0.7", "v0.7.16", "0.7.16-beta", "latest", ""])("refuses version %j", (version) => {
    expect(() => sinceLabel(version)).toThrow(/version like/);
  });
});

describe("<Since>", () => {
  it("renders a small badge", () => {
    render(<Since version="0.7.16" module="ouroboros-rest" />);
    expect(screen.getByText("Since ouroboros-rest 0.7.16")).toHaveClass("since");
  });

  it("fails loudly on a malformed version", () => {
    expect(() => render(<Since version="soon" />)).toThrow(/version like/);
  });
});
