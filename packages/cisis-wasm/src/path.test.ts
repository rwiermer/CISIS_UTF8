import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVirtualPath, parentDirectories } from "./path.js";

test("normalizes request-relative paths", () => {
  assert.equal(normalizeVirtualPath("fixtures/./cds.iso"), "fixtures/cds.iso");
  assert.deepEqual(parentDirectories("a/b/c.mst"), ["a", "a/b"]);
});

test("rejects absolute and escaping paths", () => {
  for (const path of ["", "/etc/passwd", "../outside", "a/../../outside", "C:/temp/file"] ) {
    assert.throws(() => normalizeVirtualPath(path));
  }
});
