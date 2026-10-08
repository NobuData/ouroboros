import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { request } from "@playwright/test";

import { AUTH_STATE_PATH, BASE_URL, CAPTURE_USER } from "./settings.ts";

/**
 * Signs in once before any capture and saves the session for every one of them (CZ.1, #1170).
 *
 * It calls the route the UI's own sign-in form calls — BetterAuth's email/password sign-in,
 * on the UI's origin, which forwards `/api/auth/*` to `ouroboros-rest` — so the session is a
 * real one and its cookie belongs to the UI's host.
 *
 * @throws {Error} when the stack is unreachable or refuses the credential, with the reason:
 *   `EMAIL_PASSWORD_DISABLED` means `ouroboros-rest` runs in production, and
 *   `INVALID_EMAIL_OR_PASSWORD` means the database was not seeded.
 */
export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ baseURL: BASE_URL });
  try {
    let response;
    try {
      response = await context.post("/api/auth/sign-in/email", { data: CAPTURE_USER });
    } catch (error) {
      throw new Error(
        `cannot reach the app at ${BASE_URL} — start the seeded stack (yarn dev) or set ` +
          `OURO_DOCS_CAPTURE_BASE_URL. ${(error as Error).message}`,
      );
    }
    if (!response.ok()) {
      throw new Error(
        `sign-in as ${CAPTURE_USER.email} at ${BASE_URL} answered ${response.status()}: ` +
          `${await response.text()}`,
      );
    }
    mkdirSync(dirname(AUTH_STATE_PATH), { recursive: true });
    await context.storageState({ path: AUTH_STATE_PATH });
  } finally {
    await context.dispose();
  }
}
