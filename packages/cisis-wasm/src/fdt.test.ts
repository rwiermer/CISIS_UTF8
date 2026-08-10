import assert from "node:assert/strict";
import test from "node:test";

import {
  CisisFdtParseError,
  parseCisisFdt,
  validateCisisRecordsAgainstFdt,
} from "./fdt.js";

const source = `W:DEMO
F:DEMO  F     DEMO1
S:DEMO
***
Title                         ab                  24 20 0 0
Subjects                                          69 40 0 1
Authors                                           70 12 0 1
`;

test("parses a legacy fixed-column CISIS FDT", () => {
  assert.deepEqual(parseCisisFdt(source), {
    headers: ["W:DEMO", "F:DEMO  F     DEMO1", "S:DEMO"],
    fields: [
      { name: "Title", subfields: ["a", "b"], tag: 24, maxBytes: 20, type: 0, repeatable: false },
      { name: "Subjects", subfields: [], tag: 69, maxBytes: 40, type: 0, repeatable: true },
      { name: "Authors", subfields: [], tag: 70, maxBytes: 12, type: 0, repeatable: true },
    ],
  });
});

test("rejects malformed and duplicate FDT rows with line information", () => {
  assert.throws(() => parseCisisFdt("Title 24 20 0 0"), (error) => {
    assert.ok(error instanceof CisisFdtParseError);
    assert.equal(error.line, 1);
    return true;
  });
  assert.throws(
    () => parseCisisFdt(`${source}Another                       24 20 0 0\n`),
    /duplicate field tag: 24/,
  );
});

test("validates present, repeated, missing, long, and subfielded record data", () => {
  const definition = parseCisisFdt(source);
  const issues = validateCisisRecordsAgainstFdt([
    {
      mfn: 1,
      status: "active",
      fields: [
        { tag: 24, value: "^aShort^bSubtitle" },
        { tag: 69, value: "One" },
        { tag: 69, value: "Two" },
      ],
    },
    {
      mfn: 2,
      status: "active",
      fields: [
        { tag: 24, value: "^zUnknown subfield and too long" },
        { tag: 24, value: "Repeated" },
        { tag: 70, value: "日本語日本語日本語" },
        { tag: 99, value: "Unknown tag" },
      ],
    },
    { mfn: 3, status: "deleted", fields: [] },
  ], definition);

  assert.deepEqual(issues.map((issue) => issue.code), [
    "field-too-long",
    "invalid-subfield",
    "non-repeatable-field",
    "field-too-long",
    "unknown-field",
  ]);
  assert.equal(issues[0]?.mfn, 2);
  assert.equal(issues[2]?.occurrence, 2);
});
