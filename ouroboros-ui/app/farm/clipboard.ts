/**
 * Writing a value that is still being fetched to the clipboard
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * The enroll card mints its token *in* the press of **Copy command**, so the text does not exist
 * yet when the press happens — and a clipboard write is only allowed while the press is still
 * the browser's idea of a user gesture. Two shapes cover the engines:
 *
 * - **A `ClipboardItem` over a promise**, started inside the press. The write is *asked for*
 *   during the gesture and *fulfilled* when the text arrives, which is the only form Safari
 *   accepts, and Chromium and Firefox take it too.
 * - **`writeText` after the wait**, for an engine with no `ClipboardItem`. Those engines keep a
 *   gesture alive for a few seconds after the press, which a mint fits inside.
 *
 * **The text is a secret and this module treats it as one**: it is handed to the clipboard and
 * to nothing else — not returned, not logged, not put in an error.
 */

/** The clipboard's MIME type for a command. */
const PLAIN = "text/plain";

/**
 * Write a text to the clipboard as soon as it exists.
 *
 * @param text The text, still arriving. **If it rejects, so does this** — nothing is written.
 * @param clipboard The clipboard to write to. Defaults to the browser's, which is `undefined`
 *   on an insecure origin; a suite passes a stub.
 * @returns When the write has taken.
 * @throws When there is no clipboard, when the text never arrived, or when the browser refused.
 */
export async function copyWhenReady(
  text: Promise<string>,
  clipboard: Clipboard | undefined = globalThis.navigator?.clipboard,
): Promise<void> {
  if (clipboard === undefined) {
    // The text's rejection is still somebody's to observe; this path never reads it.
    text.catch(() => {});

    throw new Error("This page has no clipboard to write to.");
  }

  if (typeof ClipboardItem === "function" && typeof clipboard.write === "function") {
    const blob = text.then((value) => new Blob([value], { type: PLAIN }));

    await clipboard.write([new ClipboardItem({ [PLAIN]: blob })]);

    return;
  }

  await clipboard.writeText(await text);
}
