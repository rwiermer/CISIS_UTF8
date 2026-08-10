import type { CisisDiagnostic, CisisDiagnosticCategory } from "./types.js";

function categoryFor(line: string): CisisDiagnosticCategory {
  const lower = line.toLowerCase();
  if (lower.includes("unsupported")) return "unsupported";
  if (lower.includes("format") || lower.includes("pft")) return "format";
  if (lower.includes("file") || lower.includes("open") || lower.includes("path")) {
    return "filesystem";
  }
  if (lower.includes("argument") || lower.includes("parameter")) return "argument";
  return "runtime";
}

export function collectDiagnostics(stdout: string, stderr: string): CisisDiagnostic[] {
  const diagnostics: CisisDiagnostic[] = [];
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/);

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    const isError =
      /^fatal:/i.test(raw) ||
      /^WXIS\|/i.test(raw) ||
      /\b(error|invalid|missing|unsupported)\b/i.test(raw);
    const isWarning = /\bwarning\b/i.test(raw);
    if (!isError && !isWarning) continue;

    diagnostics.push({
      category: categoryFor(raw),
      message: raw.replace(/^fatal:\s*/i, ""),
      raw,
      severity: isError ? "error" : "warning",
    });
  }
  return diagnostics;
}
