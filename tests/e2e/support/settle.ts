/**
 * Waiting for a page to stop changing before measuring it
 * ([#650](https://github.com/NobuData/ouroboros/issues/650)).
 *
 * A screenshot assertion is robust to a page still settling: Playwright re-shoots until two
 * frames agree, and the baseline is compared against a page that has stopped moving.
 * `page.evaluate` has no such protection — it reads whichever frame it lands on, once — and
 * the readability audit is built almost entirely on `evaluate`.
 *
 * That cost this leg an afternoon, so the finding is written down. Immediately after the
 * palette is pinned, `getComputedStyle` on the sidebar's labels reports colours a few
 * points short of the token sheet's — `rgb(115, 133, 143)` where `--ink-faint` is
 * `#7e9099` — and the shortfall drifts from run to run. Read again a frame later and it is
 * the token, exactly. Every ratio computed from the first read was a *fraction of a
 * palette change*, which is why the numbers looked plausible (4.35:1 against a required
 * 4.5:1) rather than absurd, and that is the dangerous kind of wrong: a plausible number
 * is one somebody argues with instead of investigating.
 *
 * The same is true of layout on arrival. A dashboard measured before its cards have settled
 * briefly overflows its pane by twenty-odd pixels, which the containment probe reports as
 * the § 1.3 violation it would be if it lasted.
 *
 * So: **read it twice and require the two to agree.** Mechanism-independent — it does not
 * care whether the cause is a transition, a re-render, a font swap or the next one — and it
 * is the same rule the screenshot assertion applies, written out for the measurements that
 * do not get it for free.
 */

import { expect } from "@playwright/test";

/** How many readings a value may take to stop changing before that is itself the finding. */
const ATTEMPTS = 10;

/** How long to wait between readings — a few frames, not a guess at a transition. */
const INTERVAL_MS = 100;

/**
 * Read a value until two consecutive readings are identical, and return it.
 *
 * @param read - How to take one reading. Must return something JSON-serialisable, since
 *   that is how two readings are compared.
 * @param what - What is being read, for the failure message.
 * @returns The settled reading.
 * @throws {Error} Through its assertion, if the value never stopped changing. That is a
 *   real finding rather than a timeout to raise: a page whose measurements are still moving
 *   a second after it claimed to be ready is a page nothing can be asserted about, and
 *   saying so beats asserting against an arbitrary frame of it.
 * @typeParam Reading The shape of one reading.
 */
export async function settle<Reading>(
  read: () => Promise<Reading>,
  what: string,
): Promise<Reading> {
  let previous = await read();
  let previousKey = JSON.stringify(previous);

  for (let attempt = 1; attempt < ATTEMPTS; attempt += 1) {
    // Serial on purpose: the whole question is what changed between one reading and the
    // next, so there is nothing here to parallelise.
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));

    const current = await read();
    const currentKey = JSON.stringify(current);

    if (currentKey === previousKey) return current;

    previous = current;
    previousKey = currentKey;
  }

  expect(
    null,
    `${what} was still changing after ${ATTEMPTS} readings ${INTERVAL_MS}ms apart, so ` +
      "nothing measured on this page would mean anything. Last reading: " +
      `${previousKey.slice(0, 400)}`,
  ).toBe("settled");

  return previous;
}
