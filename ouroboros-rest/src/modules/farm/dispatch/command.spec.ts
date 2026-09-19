import { parseCommand, renderCommand } from "./command";

/**
 * argv ⇄ the stored command text (#252). The one property that matters is that the two are exact
 * inverses — and that the reader refuses, rather than interprets, anything the writer could not
 * have produced.
 */
describe("a build's command", () => {
  describe("rendering argv", () => {
    it("writes plain words bare, joined by single spaces", () => {
      expect(renderCommand(["west", "build", "-b", "helios_mainboard", "app"])).toBe(
        "west build -b helios_mainboard app",
      );
      expect(renderCommand(["make", "hil-sweep", "RIG=rig-02"])).toBe("make hil-sweep RIG=rig-02");
    });

    it("single-quotes a word with anything a shell would treat specially", () => {
      expect(renderCommand(["sh", "-c", "make all"])).toBe("sh -c 'make all'");
      expect(renderCommand(["echo", "$HOME", "*", "a;b", 'say "hi"'])).toBe(
        `echo '$HOME' '*' 'a;b' 'say "hi"'`,
      );
    });

    it("writes an embedded quote as '\\'' and an empty word as ''", () => {
      expect(renderCommand(["echo", "it's"])).toBe(`echo 'it'\\''s'`);
      expect(renderCommand(["printf", ""])).toBe("printf ''");
    });

    it("has no rendering for a command with no program", () => {
      expect(() => renderCommand([])).toThrow(TypeError);
    });
  });

  describe("reading it back", () => {
    const argvs: string[][] = [
      ["west", "build", "-b", "helios_mainboard", "app", "--", "-DCONFIG_OTA_ROLLBACK=y"],
      ["xcodebuild", "-scheme", "HeliosConsole", "-destination", "platform=macOS", "test"],
      ["sh", "-c", "make all && make test"],
      ["echo", "it's", "'", "''", "a'b'c"],
      ["printf", "", " ", "\t", "line\nbreak"],
      ["./scripts/notarize.sh", "dist/ouroboros.pkg"],
      ["python3", "-c", "print('héllo — ünïcode')"],
      ["weird\\path", "back\\\\slash"],
    ];

    it.each(argvs.map((argv) => [renderCommand(argv), argv]))(
      "reads %s back as exactly the argv it was rendered from",
      (text, argv) => {
        expect(parseCommand(text)).toEqual(argv);
      },
    );

    it("reads the seed's plain-word commands, which are their own rendering", () => {
      expect(parseCommand("west build -b helios_mainboard app")).toEqual([
        "west",
        "build",
        "-b",
        "helios_mainboard",
        "app",
      ]);
      expect(parseCommand("make hil-sweep RIG=rig-02")).toEqual([
        "make",
        "hil-sweep",
        "RIG=rig-02",
      ]);
    });

    it.each([
      ["an empty text", ""],
      ["two spaces between words", "make  all"],
      ["a leading space", " make"],
      ["a trailing space", "make "],
      ["double quotes", 'sh -c "make all"'],
      ["an unquoted metacharacter", "echo $HOME"],
      ["an unterminated quote", "echo 'oops"],
      ["a backslash escape a shell would read", "echo a\\ b"],
      ["a needlessly quoted plain word", "'make' all"],
      ["a tab separator", "make\tall"],
    ])("refuses %s rather than guessing at it", (_, text) => {
      expect(parseCommand(text)).toBeUndefined();
    });
  });
});
