import assert from "node:assert/strict";
import test from "node:test";

import { CisisProjectStore } from "./persistence.js";

test("reports unavailable IndexedDB outside a browser", () => {
  if (typeof indexedDB === "undefined") {
    assert.throws(() => new CisisProjectStore(), /IndexedDB is not available/);
  }
});
