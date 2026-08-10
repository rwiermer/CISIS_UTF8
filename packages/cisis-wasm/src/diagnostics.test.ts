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

test("classifies numeric PFT parser failures", () => {
  const diagnostics = collectDiagnostics("", "*** fmt_error=15\n\nfatal: /");
  assert.deepEqual(diagnostics[0], {
    category: "format",
    message: "PFT format error 15",
    raw: "*** fmt_error=15",
    severity: "error",
  });
});
