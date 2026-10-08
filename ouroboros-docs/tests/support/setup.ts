// Testing Library's DOM matchers (toBeInTheDocument, toHaveAttribute, …) for every test,
// and a clean DOM after each component test.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
