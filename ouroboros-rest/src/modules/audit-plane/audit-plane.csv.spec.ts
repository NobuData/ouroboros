import { AUDIT_CSV_COLUMNS, csvCell, csvHeader, csvLine } from "./audit-plane.csv";
import { MOCKUP_ROWS } from "./audit-plane.fixture";
import { auditPlaneEventResource } from "./audit-plane.resources";

/** The export's CSV (#486): a stable column contract, RFC 4180, safe to open. */
describe("the audit CSV", () => {
  it("keeps its column contract — append only", () => {
    expect(AUDIT_CSV_COLUMNS).toEqual([
      "occurred_at",
      "actor_kind",
      "actor",
      "actor_id",
      "actor_service",
      "event",
      "action",
      "plane",
      "subject_type",
      "subject_id",
      "ip",
      "detail",
      "id",
    ]);
    expect(csvHeader()).toBe(`${AUDIT_CSV_COLUMNS.join(",")}\r\n`);
  });

  it("writes one line per event, from the same resource the list answers with", () => {
    const event = auditPlaneEventResource(MOCKUP_ROWS[1]);

    expect(csvLine(event)).toBe(
      [
        "2026-10-05T14:12:00.000Z",
        "human",
        "Ken",
        "user-ken",
        "",
        "rotated Anthropic API key",
        "provider.rotated",
        "provider",
        "provider_connection",
        "",
        "198.51.100.24",
        '"{""kind"":""anthropic"",""outcome"":""success""}"',
        "5eed0074-0000-4000-8000-000000000002",
      ].join(",") + "\r\n",
    );
  });

  it("quotes commas, quotes and line breaks, doubling quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
  });

  it.each(['=HYPERLINK("x")', "+1", "-1+1", "@SUM(A1)", "\tcmd"])(
    "neutralises %p, which a spreadsheet would run as a formula",
    (value) => {
      expect(csvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );
});
