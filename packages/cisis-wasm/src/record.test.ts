import assert from "node:assert/strict";
import test from "node:test";

import { encodeIso2709Record } from "./record.js";

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
