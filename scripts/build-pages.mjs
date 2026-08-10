import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, process.argv[2] ?? "build/pages");
const packageDist = resolve(root, "packages/cisis-wasm/dist");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(root, "demo"), destination, { recursive: true });
await cp(packageDist, resolve(destination, "runtime"), { recursive: true });
console.log(`Staged CISIS playground at ${destination}`);
