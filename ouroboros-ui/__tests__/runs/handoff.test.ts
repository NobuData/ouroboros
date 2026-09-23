import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  HANDOFF_LIMITATION,
  checkoutCommands,
  shellQuote,
  transcriptUrl,
} from "@/app/runs/handoff";

import { SEEDED_RUN_ID } from "../helpers/runs";

/**
 * The take-over hand-off (#310, decision R7): commands that do what they say when pasted, the
 * transcript's address on this origin, and the limitation stated plainly.
 */

/**
 * What a POSIX shell makes of a quoted word.
 *
 * @param word The word, as the commands print it.
 * @returns What `printf %s` receives as its argument.
 */
function shellReads(word: string): string {
  return execFileSync("/bin/sh", ["-c", `printf %s ${word}`], { encoding: "utf8" });
}

describe("shellQuote", () => {
  it("leaves an ordinary branch name bare", () => {
    expect(shellQuote("loop/482-canbus-flake")).toBe("loop/482-canbus-flake");
    expect(shellQuote("feature/v1.2_rc+1")).toBe("feature/v1.2_rc+1");
  });

  it("quotes a name a shell would read as syntax, so it arrives as typed", () => {
    for (const name of ["loop/$(rm -rf ~)", "a;b", "it's", "x`id`", "a&b|c", "sp ace", "quote'd'twice"]) {
      const quoted = shellQuote(name);

      expect(quoted).not.toBe(name);
      expect(shellReads(quoted)).toBe(name);
    }
  });
});

describe("checkoutCommands", () => {
  it("fetches the branch from origin and switches to it", () => {
    expect(checkoutCommands("loop/482-canbus-flake")).toBe(
      "git fetch origin loop/482-canbus-flake\ngit switch loop/482-canbus-flake",
    );
  });

  it("quotes the branch in both commands", () => {
    expect(checkoutCommands("a;b")).toBe("git fetch origin 'a;b'\ngit switch 'a;b'");
  });
});

describe("transcriptUrl", () => {
  it("is this origin's proxy of the JSONL export, the id encoded", () => {
    expect(transcriptUrl(SEEDED_RUN_ID)).toBe(`/api/runs/${SEEDED_RUN_ID}/transcript.jsonl`);
    expect(transcriptUrl("a/b")).toBe("/api/runs/a%2Fb/transcript.jsonl");
  });
});

describe("the limitation", () => {
  it("says deep IDE integration is arriving, and what this does instead", () => {
    expect(HANDOFF_LIMITATION).toContain("Deep IDE integration is arriving (#316)");
    expect(HANDOFF_LIMITATION).toContain("pauses the loop");
  });
});
