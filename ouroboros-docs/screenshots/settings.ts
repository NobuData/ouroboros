import { join } from "node:path";

import { SCREENSHOTS_DIR } from "./lib/manifest.ts";

/**
 * The capture harness's settings (CZ.1, #1170) — where the app is, who signs in, and the
 * files a run shares between its steps.
 */

/** The seeded `ouroboros-ui` the captures are taken from. */
export const BASE_URL = process.env.OURO_DOCS_CAPTURE_BASE_URL || "http://localhost:3000";

/**
 * The seeded owner the harness signs in as, with the development seed's password
 * (`ouroboros-db/migrations/R__dev_seed.sql`). Email/password sign-in answers only where
 * `ouroboros-rest` is not running in production, which is the point: this is demo data on
 * a development stack, and these values are already public in the seed and the e2e suite.
 */
export const CAPTURE_USER = {
  email: "ken@acme-robotics.dev",
  password: "ouroboros-dev-password",
} as const;

/** The signed-in session, saved once per run and reused by every capture. */
export const AUTH_STATE_PATH = join(SCREENSHOTS_DIR, ".auth", "state.json");

/** How long an entry's `ready` selector may take to appear. */
export const READY_TIMEOUT_MS = 20_000;

/** The entries to capture (`--only`), passed from `yarn screenshots` to the spec. */
export const ONLY_ENV = "SCREENSHOTS_ONLY";

/** The results log the spec appends to as each file lands, read back by `yarn screenshots`. */
export const RESULTS_ENV = "SCREENSHOTS_RESULTS";
