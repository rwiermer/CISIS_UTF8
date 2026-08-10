import assert from "node:assert/strict";
import test from "node:test";

import type { CisisRunner } from "./index.js";
import { CisisProject, CisisProjectConflictError } from "./project.js";
import type { CisisRunRequest, CisisRunResult, WriteRecordsRequest } from "./types.js";

function result(files: Record<string, Uint8Array> = {}): CisisRunResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    files,
    fileStates: {},
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
  assert.equal(project.revision, 0);
  project.writeFile("data/input.bin", new Uint8Array([1, 2, 3]));
  assert.equal(project.revision, 0);
  project.writeFile("data/input.bin", new Uint8Array([4]));
  assert.equal(project.revision, 1);
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

test("project removes files reported missing after a run", async () => {
  const runner = {
    run: async () => ({
      ...result(),
      fileStates: { "temporary.txt": false },
    }),
  } as unknown as CisisRunner;
  const project = new CisisProject(runner, { "temporary.txt": "delete me" });

  await project.run({
    program: "wxis",
    args: ["IsisScript=delete.xis"],
    inspectFiles: ["temporary.txt"],
  });

  assert.equal(project.hasFile("temporary.txt"), false);
});

test("project absorbs structured record writes and drops stale indexes", async () => {
  const runner = {
    writeRecords: async () => ({
      ...result({
        "catalog.mst": new Uint8Array([4]),
        "catalog.xrf": new Uint8Array([5]),
      }),
      fileStates: {
        "catalog.ifp": false,
        "catalog.l01": false,
      },
    }),
  } as unknown as CisisRunner;
  const project = new CisisProject(runner, {
    "catalog.mst": new Uint8Array([1]),
    "catalog.xrf": new Uint8Array([2]),
    "catalog.ifp": new Uint8Array([3]),
    "catalog.l01": new Uint8Array([3]),
  });

  await project.writeRecords({
    database: "catalog",
    records: [{ mfn: 7, status: "active", fields: [{ tag: 24, value: "Updated" }] }],
  });

  assert.deepEqual(project.listFiles(), ["catalog.mst", "catalog.xrf"]);
  assert.deepEqual(project.readFile("catalog.mst"), new Uint8Array([4]));
});

test("project serializes mutations against the latest committed files", async () => {
  const requests: WriteRecordsRequest[] = [];
  const completions: Array<(value: CisisRunResult) => void> = [];
  const runner = {
    writeRecords: (request: WriteRecordsRequest) => {
      requests.push(request);
      return new Promise<CisisRunResult>((resolve) => completions.push(resolve));
    },
  } as unknown as CisisRunner;
  const project = new CisisProject(runner, {
    "catalog.mst": new Uint8Array([1]),
    "catalog.xrf": new Uint8Array([2]),
  });
  const record = { mfn: 1, status: "active" as const, fields: [] };

  const first = project.writeRecords({ database: "catalog", records: [record] });
  const second = project.writeRecords({ database: "catalog", records: [record] });
  await Promise.resolve();
  assert.equal(requests.length, 1);
  completions[0]!(result({
    "catalog.mst": new Uint8Array([3]),
    "catalog.xrf": new Uint8Array([4]),
  }));
  await first;
  await Promise.resolve();

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]!.files?.["catalog.mst"], new Uint8Array([3]));
  completions[1]!(result({
    "catalog.mst": new Uint8Array([5]),
    "catalog.xrf": new Uint8Array([6]),
  }));
  await second;
  assert.equal(project.revision, 2);
  assert.deepEqual(project.readFile("catalog.mst"), new Uint8Array([5]));
});

test("project rejects stale optimistic record writes before execution", async () => {
  let calls = 0;
  const runner = {
    writeRecords: async () => {
      calls += 1;
      return result();
    },
  } as unknown as CisisRunner;
  const project = new CisisProject(runner);
  project.writeFile("local.txt", "changed");

  await assert.rejects(
    project.writeRecords({
      database: "catalog",
      records: [],
      expectedRevision: 0,
    }),
    (error) =>
      error instanceof CisisProjectConflictError &&
      error.expectedRevision === 0 &&
      error.actualRevision === 1,
  );
  assert.equal(calls, 0);
});

test("project discards mutation output after an overlapping host edit", async () => {
  let complete!: (value: CisisRunResult) => void;
  const runner = {
    writeRecords: () => new Promise<CisisRunResult>((resolve) => { complete = resolve; }),
  } as unknown as CisisRunner;
  const project = new CisisProject(runner);
  const pending = project.writeRecords({ database: "catalog", records: [] });
  await Promise.resolve();
  project.writeFile("local.txt", "changed during execution");
  complete(result({
    "catalog.mst": new Uint8Array([1]),
    "catalog.xrf": new Uint8Array([2]),
  }));

  await assert.rejects(
    pending,
    (error) => error instanceof CisisProjectConflictError && error.actualRevision === 1,
  );
  assert.equal(project.hasFile("catalog.mst"), false);
  assert.equal(project.hasFile("local.txt"), true);
});
