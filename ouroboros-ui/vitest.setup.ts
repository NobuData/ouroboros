import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Test setup shared by every suite.
 *
 * Two things only:
 *
 * 1. `@testing-library/jest-dom/vitest` registers the DOM matchers
 *    (`toBeInTheDocument`, `toHaveAttribute`, …) on Vitest's `expect`.
 * 2. `cleanup()` unmounts anything a test rendered. Vitest runs a file's tests in one
 *    jsdom document, so without this the second test in a file queries a page that
 *    still holds the first test's markup.
 */
afterEach(() => {
  cleanup();
});
