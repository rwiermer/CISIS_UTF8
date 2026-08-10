import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { executeRequest } from "../../packages/cisis-wasm/dist/worker-runtime.js";

const [mxPath, wxisPath, root] = process.argv.slice(2);
if (!mxPath || !wxisPath || !root) {
  throw new Error("usage: node package-smoke.mjs <mx.mjs> <wxis.mjs> <source-root>");
}

const mx = await executeRequest(1, pathToFileURL(mxPath).href, {
  program: "mx",
  args: ["seq=utf8.txt", "pft=v1/", "now"],
  files: { "utf8.txt": "This is a test in UTF8\n" },
});
if (mx.exitCode !== 0 || mx.stdout.trim() !== "This is a test in UTF8") {
  throw new Error(`Packaged MX runtime failed:\n${mx.stdout}\n${mx.stderr}`);
}

const hello = await readFile(`${root}/wxis_src/examples/hello.xis`, "utf8");
const wxis = await executeRequest(2, pathToFileURL(wxisPath).href, {
  program: "wxis",
  args: ["IsisScript=hello.xis"],
  files: { "hello.xis": hello },
});
if (
  wxis.exitCode !== 0 ||
  !wxis.stdout.includes("Content-type: text/html") ||
  !wxis.stdout.includes("Hello world!")
) {
  throw new Error(`Packaged WXIS runtime failed:\n${wxis.stdout}\n${wxis.stderr}`);
}

console.log("Packaged MX/PFT and WXIS runtimes passed.");
