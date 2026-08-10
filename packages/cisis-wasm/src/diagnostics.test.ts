import assert from "node:assert/strict";
import test from "node:test";

import { collectDiagnostics } from "./diagnostics.js";

test("classifies native and WXIS errors without changing raw output", () => {
  const diagnostics = collectDiagnostics(
    "WXIS|execution error|format syntax|program.pft|",
    "fatal: dbxopen/open",
  );
  assert.deepEqual(
    diagnostics.map(({ category, message, severity }) => ({ category, message, severity })),
    [
      { category: "filesystem", message: "dbxopen/open", severity: "error" },
      {
        category: "format",
        message: "WXIS|execution error|format syntax|program.pft|",
        severity: "error",
      },
    ],
  );
});
