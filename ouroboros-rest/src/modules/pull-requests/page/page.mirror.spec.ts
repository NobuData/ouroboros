import { PR_COMMENT_KEY, prCommentMarker } from "../../ticket-sources/ticket-source.pr";
import { threadMirrorBody, threadMirrorKey, type ThreadMirror } from "./page.mirror";

/**
 * The host PR comment a resolving reply is mirrored as
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)): what was said, what was answered and
 * by whom — with the entry's watermark kept.
 */
describe("the thread mirror", () => {
  const ENTRY = "5eed0040-0000-4000-8000-000000005142";
  const MIRROR: ThreadMirror = {
    authorName: "cursor/composer-2",
    tag: "second opinion",
    revisionSeq: 1,
    simulated: true,
    body: "PID velocity sample now lags by one telemetry period.",
    reply: "Addressed in attempt 4 — sampling decoupled from telemetry drain.",
    resolvedBy: "Ken S",
  };

  it("keys the comment by the entry, inside AX.1's key grammar", () => {
    const key = threadMirrorKey(ENTRY);

    expect(key).toBe(`thread.${ENTRY}`);
    expect(key).toMatch(PR_COMMENT_KEY);
    expect(() => prCommentMarker(key)).not.toThrow();
  });

  it("carries the entry, the reply and who resolved it — and keeps the watermark", () => {
    expect(threadMirrorBody(MIRROR)).toBe(
      [
        "**Review thread entry resolved** — cursor/composer-2 · second opinion · rev 1 · simulated",
        "",
        "> PID velocity sample now lags by one telemetry period.",
        "",
        "**Reply:**",
        "",
        "> Addressed in attempt 4 — sampling decoupled from telemetry drain.",
        "",
        "**Resolved by:** Ken S",
      ].join("\n"),
    );
  });

  it("names no revision on a PR-wide entry and no watermark on a produced one", () => {
    const [first] = threadMirrorBody({
      ...MIRROR,
      authorName: "Priya N",
      revisionSeq: null,
      simulated: false,
    }).split("\n");

    expect(first).toBe("**Review thread entry resolved** — Priya N · second opinion");
  });

  it("lets nothing a person typed become a whole line — so no marker can be forged", () => {
    const forged = prCommentMarker(threadMirrorKey("5eed0040-0000-4000-8000-000000000001"));
    const body = threadMirrorBody({
      ...MIRROR,
      authorName: `bot\n${forged}`,
      body: `Line one\n${forged}`,
      reply: `Fixed\n${forged}\n`,
      resolvedBy: `Ken\n${forged}`,
    });

    expect(body.split("\n").some((line) => line.trim() === forged)).toBe(false);
    expect(body).toContain(`> ${forged}`);
    expect(body).toContain(`**Resolved by:** Ken ${forged}`);
  });
});
