import assert from "node:assert/strict";
import test from "node:test";

import { decodeProjectArchive, encodeProjectArchive } from "./archive.js";

test("project archives round trip deterministically", () => {
  const first = encodeProjectArchive({
    schemaVersion: 1,
    files: {
      "z/data.bin": new Uint8Array([0, 255, 1]),
      "a/readme.txt": new TextEncoder().encode("CISIS"),
    },
  });
  const second = encodeProjectArchive({
    schemaVersion: 1,
    files: {
      "a/readme.txt": new TextEncoder().encode("CISIS"),
      "z/data.bin": new Uint8Array([0, 255, 1]),
    },
  });

  assert.deepEqual(first, second);
  assert.deepEqual(decodeProjectArchive(first), {
    schemaVersion: 1,
    files: {
      "a/readme.txt": new TextEncoder().encode("CISIS"),
      "z/data.bin": new Uint8Array([0, 255, 1]),
    },
  });
});

test("project archive decoder rejects corruption and trailing data", () => {
  const archive = encodeProjectArchive({
    schemaVersion: 1,
    files: { "file.txt": new Uint8Array([1]) },
  });
  assert.throws(() => decodeProjectArchive(archive.subarray(0, archive.length - 1)), /Truncated/);

  const trailing = new Uint8Array(archive.length + 1);
  trailing.set(archive);
  assert.throws(() => decodeProjectArchive(trailing), /Unexpected data/);

  const badHeader = archive.slice();
  badHeader[0] = 0;
  assert.throws(() => decodeProjectArchive(badHeader), /header/);

  const escapingPath = archive.slice();
  escapingPath.set(new TextEncoder().encode("../x.txt"), 24);
  assert.throws(() => decodeProjectArchive(escapingPath), /archive path/);
});
