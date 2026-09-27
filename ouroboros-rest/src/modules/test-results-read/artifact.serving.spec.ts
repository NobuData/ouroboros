import {
  ARTIFACT_SAFETY_HEADERS,
  baseName,
  contentDisposition,
  contentTypeOf,
  isPreviewable,
  OCTET_STREAM,
  presentationOf,
} from "./artifact.serving";

describe("artifact serving (#333)", () => {
  describe("the mockup's four artifacts", () => {
    it.each([
      ["junit-build3.xml", "junit", "application/xml", "inline"],
      ["serial-console.log", "log", "text/plain; charset=utf-8", "inline"],
      ["coverage.info", "coverage", "text/plain; charset=utf-8", "inline"],
      ["rig-capture-estop.csv", "capture", "text/csv; charset=utf-8", "attachment"],
    ] as const)("serves %s (%s) as %s, %s", (name, kind, type, disposition) => {
      const presentation = presentationOf(kind, name);

      expect(presentation.contentType).toBe(type);
      expect(presentation.disposition).toBe(disposition);
      expect(presentation.contentDisposition.startsWith(`${disposition}; `)).toBe(true);
    });
  });

  it("previews a HIL results file inline as JSON", () => {
    expect(presentationOf("hil", "ouro-hil-results.json")).toMatchObject({
      contentType: "application/json",
      disposition: "inline",
    });
  });

  it("downloads anything collected as `other`, whatever its type", () => {
    expect(presentationOf("other", "notes.txt").disposition).toBe("attachment");
  });

  it("never previews a text kind whose name is not a safe text type", () => {
    expect(isPreviewable("log", "report.html")).toBe(false);
    expect(isPreviewable("log", "firmware.elf")).toBe(false);
    expect(presentationOf("log", "report.html")).toMatchObject({
      contentType: OCTET_STREAM,
      disposition: "attachment",
    });
  });

  it.each([
    ["firmware.bin", OCTET_STREAM],
    ["noextension", OCTET_STREAM],
    [".hidden", OCTET_STREAM],
    ["page.html", OCTET_STREAM],
    ["image.svg", OCTET_STREAM],
    ["REPORT.XML", "application/xml"],
    ["build/zephyr/junit.xml", "application/xml"],
  ])("types %s as %s", (name, type) => {
    expect(contentTypeOf(name)).toBe(type);
  });

  it("names the file by its last path segment", () => {
    expect(baseName("build/zephyr/junit-build3.xml")).toBe("junit-build3.xml");
    expect(contentDisposition("inline", "build/zephyr/junit-build3.xml")).toBe(
      "inline; filename=\"junit-build3.xml\"; filename*=UTF-8''junit-build3.xml",
    );
  });

  it("keeps a non-ASCII name exactly in filename* and safely in filename", () => {
    expect(contentDisposition("attachment", "serial console · ü.log")).toBe(
      'attachment; filename="serial console _ _.log"; ' +
        "filename*=UTF-8''serial%20console%20%C2%B7%20%C3%BC.log",
    );
  });

  it("lets nothing in a name end the header or start another", () => {
    const header = contentDisposition("attachment", 'a"; x=y\r\nSet-Cookie: s=1\\(1)*.log');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header).toContain("%28");
    expect(header).toContain("%2A");
  });

  it("carries nosniff, a sandbox and a private cache policy on every answer", () => {
    expect(ARTIFACT_SAFETY_HEADERS).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-cache",
    });
  });
});
