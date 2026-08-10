import assert from "node:assert/strict";
import test from "node:test";

import type { CisisRunner } from "./index.js";
import { CisisProject } from "./project.js";
import type { CisisRunRequest, CisisRunResult } from "./types.js";

function result(files: Record<string, Uint8Array> = {}): CisisRunResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    files,
    diagnostics: [],
    durationMs: 1,
  };
}

test("project owns file bytes and snapshots defensively", () => {
  const source = new Uint8Array([1, 2, 3]);
  const project = new CisisProject({} as CisisRunner, { "data/input.bin": source });
  source[0] = 9;

  const read = project.readFile("data/input.bin")!;
  assert.deepEqual(read, new Uint8Array([1, 2, 3]));
  read[1] = 9;
  assert.deepEqual(project.readFile("data/input.bin"), new Uint8Array([1, 2, 3]));

  const snapshot = project.snapshot();
  snapshot.files["data/input.bin"]![2] = 9;
  assert.deepEqual(project.readFile("data/input.bin"), new Uint8Array([1, 2, 3]));
  assert.deepEqual(project.listFiles(), ["data/input.bin"]);
});

test("project supplies files to runs and retains requested outputs", async () => {
  const requests: CisisRunRequest[] = [];
  const runner = {
    run: async (request: CisisRunRequest) => {
      requests.push(request);
      return result({ "cds.mst": new Uint8Array([4]), "cds.xrf": new Uint8Array([5]) });
    },
  } as unknown as CisisRunner;
  const project = new CisisProject(runner, { "cds.iso": new Uint8Array([1, 2]) });

  await project.run({
    program: "mx",
    args: ["iso=cds.iso", "create=cds", "now"],
    returnFiles: ["cds.mst", "cds.xrf"],
  });

  assert.deepEqual(Object.keys(requests[0]!.files!).sort(), ["cds.iso"]);
  assert.deepEqual(project.listFiles(), ["cds.iso", "cds.mst", "cds.xrf"]);
});

test("project rejects paths outside its virtual root", () => {
  const project = new CisisProject({} as CisisRunner);
  assert.throws(() => project.writeFile("../outside", "bad"), /escapes/);
});
