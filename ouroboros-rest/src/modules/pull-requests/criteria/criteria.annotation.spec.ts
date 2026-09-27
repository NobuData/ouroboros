import { PR_COMMENT_KEY, prCommentMarker } from "../../ticket-sources/ticket-source.pr";
import { waiverAnnotationBody, waiverAnnotationKey } from "./criteria.annotation";

/**
 * The host PR annotation a waiver posts (#359, decision V9): criterion, reason and author, keyed
 * by the criterion so a re-waive edits it.
 */
describe("the waiver annotation", () => {
  const CRITERION = "5eed003e-0000-4000-8000-000000005145";

  it("keys the comment by the criterion, inside AX.1's key grammar", () => {
    const key = waiverAnnotationKey(CRITERION);

    expect(key).toBe(`criterion.${CRITERION}`);
    expect(key).toMatch(PR_COMMENT_KEY);
    expect(() => prCommentMarker(key)).not.toThrow();
  });

  it("carries the criterion, the reason and the author", () => {
    expect(
      waiverAnnotationBody({
        claim: "Flake must not reappear across temperature range",
        reason: "rig runs at 22°C only — thermal chamber not in bench",
        author: "Ken S",
      }),
    ).toBe(
      [
        "**Acceptance criterion waived** — not verified on this PR",
        "",
        "> Flake must not reappear across temperature range",
        "",
        "**Reason:** rig runs at 22°C only — thermal chamber not in bench",
        "**Waived by:** Ken S",
      ].join("\n"),
    );
  });

  it("lets nothing a person typed become a whole line — so no marker can be forged", () => {
    const forged = prCommentMarker(waiverAnnotationKey("5eed003e-0000-4000-8000-000000000001"));
    const body = waiverAnnotationBody({
      claim: `Line one\n${forged}`,
      reason: `chamber down\n${forged}\n`,
      author: `Ken\n${forged}`,
    });

    expect(body.split("\n").some((line) => line.trim() === forged)).toBe(false);
    expect(body).toContain(`> ${forged}`);
    expect(body).toContain(`**Reason:** chamber down ${forged}`);
  });
});
