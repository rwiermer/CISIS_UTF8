import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

const [mxPath, wxisPath, root] = process.argv.slice(2);

if (!mxPath || !wxisPath || !root) {
  throw new Error("usage: node smoke.mjs <mx.mjs> <wxis.mjs> <source-root>");
}

async function instantiate(modulePath) {
  const stdout = [];
  const stderr = [];
  const imported = await import(pathToFileURL(modulePath).href);
  const module = await imported.default({
    noInitialRun: true,
    print: (line) => stdout.push(line),
    printErr: (line) => stderr.push(line),
  });

  return { module, stdout, stderr };
}

const mx = await instantiate(mxPath);
mx.module.FS.writeFile("/utf8.txt", "This is a test in UTF8\n");
const mxExit = mx.module.callMain([
  "seq=/utf8.txt",
  "pft=v1/",
  "now",
]);

if (mxExit !== 0 || mx.stdout.join("\n").trim() !== "This is a test in UTF8") {
  throw new Error(
    `MX Wasm smoke failed (${mxExit}):\n${mx.stdout.join("\n")}\n${mx.stderr.join("\n")}`,
  );
}

const wxis = await instantiate(wxisPath);
const hello = await readFile(`${root}/wxis_src/examples/hello.xis`, "utf8");
wxis.module.FS.writeFile("/hello.xis", hello);
const wxisExit = wxis.module.callMain(["IsisScript=/hello.xis"]);
const wxisOutput = wxis.stdout.join("\n");

if (
  wxisExit !== 0 ||
  !wxisOutput.includes("Content-type: text/html") ||
  !wxisOutput.includes("Hello world!")
) {
  throw new Error(
    `WXIS Wasm smoke failed (${wxisExit}):\n${wxisOutput}\n${wxis.stderr.join("\n")}`,
  );
}

console.log("MX/PFT and WXIS WebAssembly smoke tests passed.");
