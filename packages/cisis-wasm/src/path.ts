export function normalizeVirtualPath(path: string): string {
  if (!path || path.includes("\0")) {
    throw new Error("CISIS file paths must be non-empty and contain no NUL bytes");
  }
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`CISIS file paths must be relative: ${path}`);
  }
  if (path.includes("\\")) {
    throw new Error(`CISIS file paths must use forward slashes: ${path}`);
  }

  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error(`CISIS file path escapes its request root: ${path}`);
  }
  return parts.join("/");
}

export function parentDirectories(path: string): string[] {
  const parts = normalizeVirtualPath(path).split("/");
  const parents: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"));
  }
  return parents;
}
