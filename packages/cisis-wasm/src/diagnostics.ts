import type { CisisDiagnostic, CisisDiagnosticCategory } from "./types.js";

function categoryFor(line: string): CisisDiagnosticCategory {
  const lower = line.toLowerCase();
  if (lower.includes("unsupported")) return "unsupported";
  if (lower.includes("format") || lower.includes("pft") || lower.includes("fmt_error")) {
    return "format";
  }
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
      /^\*{3}\s*fmt_error=\d+/i.test(raw) ||
      /^WXIS\|/i.test(raw) ||
      /\b(error|invalid|missing|unsupported)\b/i.test(raw);
    const isWarning = /\bwarning\b/i.test(raw);
    if (!isError && !isWarning) continue;

    const formatError = /^\*{3}\s*fmt_error=(\d+)/i.exec(raw);
    diagnostics.push({
      category: categoryFor(raw),
      message: formatError ? `PFT format error ${formatError[1]}` : raw.replace(/^fatal:\s*/i, ""),
      raw,
      severity: isError ? "error" : "warning",
    });
  }
  return diagnostics;
}
