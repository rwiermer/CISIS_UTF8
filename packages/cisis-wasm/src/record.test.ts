import assert from "node:assert/strict";
import test from "node:test";

import { decodeIso2709Records, encodeIso2709Record } from "./record.js";

const exportedIso = new TextEncoder().encode(
  "00135nz   2200085n  4500" +
  "024000600000070000400006070000600010999000900016999002400025\x1e" +
  "Title\x1eAda\x1eGrace\x1eoriginal\x1e^m000005^cCISISWASMREAD\x1e\x1d",
);

test("encodes ordered and repeated CISIS fields as ISO2709", () => {
  const encoded = encodeIso2709Record({
    fields: [
      { tag: 24, value: "A title" },
      { tag: 70, value: "First" },
      { tag: 70, value: "Second" },
      { tag: 26, value: "^aParis^bPress" },
    ],
  });
  const text = new TextDecoder().decode(encoded);

  assert.equal(Number(text.slice(0, 5)), encoded.byteLength);
  assert.equal(Number(text.slice(12, 17)), 73);
  assert.equal(text.slice(24, 36), "024000800000");
  assert.equal(text.slice(36, 48), "070000600008");
  assert.equal(text.slice(48, 60), "070000700014");
  assert.equal(text.slice(60, 72), "026001500021");
  assert.equal(text.slice(72), "#A title#First#Second#^aParis^bPress##");
});

test("rejects records that ISO2709 cannot represent safely", () => {
  assert.throws(
    () => encodeIso2709Record({ fields: [{ tag: 0, value: "invalid" }] }),
    /between 1 and 999/,
  );
  assert.throws(
    () => encodeIso2709Record({ fields: [{ tag: 1, value: "reserved#value" }] }),
    /reserved byte/,
  );
});

test("decodes ordered repeated and binary ISO2709 fields", () => {
  const decoded = decodeIso2709Records(exportedIso);
  assert.equal(decoded.length, 1);
  assert.deepEqual(
    decoded[0]!.fields.map((field) => [field.tag, new TextDecoder().decode(field.value as Uint8Array)]),
    [
      [24, "Title"],
      [70, "Ada"],
      [70, "Grace"],
      [999, "original"],
      [999, "^m000005^cCISISWASMREAD"],
    ],
  );
});

test("rejects corrupt ISO2709 exports", () => {
  const corrupt = exportedIso.slice();
  corrupt[corrupt.length - 1] = 0;
  assert.throws(() => decodeIso2709Records(corrupt), /record terminator/);
  assert.throws(() => decodeIso2709Records(exportedIso.slice(0, 20)), /Truncated/);
});
