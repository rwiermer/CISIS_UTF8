import assert from "node:assert/strict";
import test from "node:test";

import { CisisRunner } from "./index.js";
import type { WorkerRunRequest, WorkerRunResponse } from "./protocol.js";
import type { CisisRunRequest, CisisRunResult } from "./types.js";

class MockWorker {
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessage: ((event: MessageEvent<WorkerRunResponse>) => unknown) | null = null;
  readonly messages: WorkerRunRequest[] = [];
  terminated = false;

  postMessage(message: WorkerRunRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: WorkerRunResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerRunResponse>);
  }
}

function success(stdout: string): CisisRunResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    files: {},
    fileStates: {},
    diagnostics: [],
    durationMs: 1,
  };
}

function recordExportFixture(): Uint8Array {
  const output: number[] = [0x43, 0x57, 0x52, 0x31];
  const u16 = (value: number): void => { output.push(value & 0xff, (value >>> 8) & 0xff); };
  const u32 = (value: number): void => {
    output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
  };
  const field = (tag: number, value: string): void => {
    const data = new TextEncoder().encode(value);
    u16(tag);
    u32(data.byteLength);
    output.push(...data);
  };
  u32(1);
  u32(5);
  output.push(0);
  u32(4);
  field(24, "Title");
  field(70, "Ada");
  field(70, "Grace");
  field(999, "original");
  return Uint8Array.from(output);
}

const exportedRecord = recordExportFixture();

test("serializes requests through one worker", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({
    moduleUrls: { mx: "mx.mjs", wxis: "wxis.mjs" },
    workerFactory: () => worker as unknown as Worker,
  });

  const first = runner.run({ program: "mx", args: ["first"] });
  const second = runner.run({ program: "wxis", args: ["second"] });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0]?.moduleUrl, "mx.mjs");

  worker.respond({ type: "result", id: worker.messages[0]!.id, result: success("first") });
  assert.equal((await first).stdout, "first");
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[1]?.moduleUrl, "wxis.mjs");

  worker.respond({ type: "result", id: worker.messages[1]!.id, result: success("second") });
  assert.equal((await second).stdout, "second");
  runner.dispose();
});

test("terminates the worker when execution times out", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({
    defaultTimeoutMs: 5,
    workerFactory: () => worker as unknown as Worker,
  });

  await assert.rejects(
    runner.run({ program: "mx", args: [] }),
    /timed out after 5ms/,
  );
  assert.equal(worker.terminated, true);
  runner.dispose();
});

test("rejects non-allowlisted environment keys before starting a worker", async () => {
  let workerCreated = false;
  const runner = new CisisRunner({
    workerFactory: () => {
      workerCreated = true;
      return new MockWorker() as unknown as Worker;
    },
  });

  await assert.rejects(
    runner.run({ program: "mx", args: [], env: { PATH: "/host/bin" } }),
    /not allowlisted: PATH/,
  );
  assert.equal(workerCreated, false);
  runner.dispose();
});

test("rejects cleanly when a worker cannot be constructed", async () => {
  const runner = new CisisRunner({
    workerFactory: () => {
      throw new Error("worker construction failed");
    },
  });

  await assert.rejects(
    runner.run({ program: "mx", args: [] }),
    /worker construction failed/,
  );
  runner.dispose();
});

test("rejects input files above the configured limit", async () => {
  const runner = new CisisRunner({ maxInputBytes: 4 });
  await assert.rejects(
    runner.run({ program: "mx", args: [], files: { "input.txt": "12345" } }),
    /input files exceed 4 bytes/,
  );
  runner.dispose();
});

test("builds IDE-oriented format, index, and search requests", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({
    moduleUrls: { mx: "mx.mjs", wxis: "wxis.mjs" },
    workerFactory: () => worker as unknown as Worker,
  });

  const format = runner.format({ database: "cds", pft: "v24/", from: 2, count: 3 });
  assert.deepEqual(worker.messages[0]?.request.args, [
    "cds",
    "pft=v24/",
    "from=2",
    "count=3",
    "lw=0",
    "now",
  ]);
  worker.respond({ type: "result", id: worker.messages[0]!.id, result: success("format") });
  await format;

  const index = runner.index({ database: "cds", fst: "24 4 MHU,V24" });
  assert.deepEqual(worker.messages[1]?.request.returnFiles, [
    "cds.cnt",
    "cds.ifp",
    "cds.l01",
    "cds.l02",
    "cds.n01",
    "cds.n02",
  ]);
  assert.equal(worker.messages[1]?.request.files?.["__cisis/index.fst"], "24 4 MHU,V24");
  worker.respond({ type: "result", id: worker.messages[1]!.id, result: success("index") });
  await index;

  const search = runner.search({ database: "cds", expression: "plants", count: 5 });
  assert.deepEqual(worker.messages[2]?.request.args, [
    "cds",
    "bool=plants",
    "pft=mfn/",
    "count=5",
    "lw=0",
    "now",
  ]);
  worker.respond({ type: "result", id: worker.messages[2]!.id, result: success("search") });
  await search;
  runner.dispose();
});

test("formats an ordered structured record through ISO import", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({
    moduleUrls: { mx: "mx.mjs", wxis: "wxis.mjs" },
    workerFactory: () => worker as unknown as Worker,
  });

  const pending = runner.formatRecord({
    record: {
      fields: [
        { tag: 24, value: "A title" },
        { tag: 70, value: "First" },
        { tag: 70, value: "Second" },
      ],
    },
    pft: "v24/",
  });
  assert.deepEqual(worker.messages[0]?.request.args, [
    "iso=marc=__cisis/record.iso",
    "create=__cisis/record",
    "now",
  ]);
  assert.ok(worker.messages[0]?.request.files?.["__cisis/record.iso"] instanceof Uint8Array);

  worker.respond({
    type: "result",
    id: worker.messages[0]!.id,
    result: {
      ...success("imported"),
      files: {
        "__cisis/record.mst": new Uint8Array([1]),
        "__cisis/record.xrf": new Uint8Array([2]),
      },
      durationMs: 2,
    },
  });
  await Promise.resolve();
  assert.deepEqual(worker.messages[1]?.request.args, [
    "__cisis/record",
    "pft=v24/",
    "lw=0",
    "now",
  ]);

  worker.respond({ type: "result", id: worker.messages[1]!.id, result: success("A title") });
  const formatted = await pending;
  assert.equal(formatted.stdout, "A title");
  assert.equal(formatted.durationMs, 3);
  runner.dispose();
});

test("writes structured records with explicit MFNs and invalidates indexes", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({
    moduleUrls: { mx: "mx.mjs", wxis: "wxis.mjs" },
    workerFactory: () => worker as unknown as Worker,
  });
  const pending = runner.writeRecords({
    database: "catalog",
    replace: true,
    records: [
      { mfn: 5, status: "active", fields: [{ tag: 24, value: "Five" }] },
      { mfn: 9, status: "deleted", fields: [{ tag: 24, value: "Nine" }] },
    ],
    files: { "catalog.ifp": new Uint8Array([9]) },
  });

  assert.deepEqual(worker.messages[0]?.request.args, [
    "iso=marc=__cisis/records.iso",
    "proc='='v999^m",
    "create=catalog",
    "pft=if 1=0 then mfn fi",
    "now",
  ]);
  assert.equal(worker.messages[0]?.request.files?.["catalog.ifp"], undefined);
  worker.respond({
    type: "result",
    id: worker.messages[0]!.id,
    result: {
      ...success(""),
      files: {
        "catalog.mst": new Uint8Array([1]),
        "catalog.xrf": new Uint8Array([2]),
      },
      durationMs: 2,
    },
  });
  await Promise.resolve();

  assert.equal(worker.messages[1]?.request.args[0], "__cisis/write-source");
  assert.match(worker.messages[1]?.request.args[1] ?? "", /mfn=5 or mfn=9/);
  assert.equal(worker.messages[1]?.request.args[2], "copy=catalog");
  worker.respond({
    type: "result",
    id: worker.messages[1]!.id,
    result: {
      ...success(""),
      files: {
        "catalog.mst": new Uint8Array([3]),
        "catalog.xrf": new Uint8Array([4]),
      },
      durationMs: 3,
    },
  });

  const written = await pending;
  assert.equal(written.durationMs, 5);
  assert.equal(written.fileStates["catalog.ifp"], false);
  assert.equal(written.fileStates["catalog.n02"], false);
  runner.dispose();
});

test("rejects invalid structured database records", async () => {
  const runner = new CisisRunner();
  await assert.rejects(
    runner.writeRecords({
      database: "catalog",
      records: [
        { mfn: 2, status: "active", fields: [] },
        { mfn: 2, status: "deleted", fields: [] },
      ],
    }),
    /Duplicate CISIS record MFN: 2/,
  );
  runner.dispose();
});

test("does not expose a partially finalized structured write", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({ workerFactory: () => worker as unknown as Worker });
  const pending = runner.writeRecords({
    database: "catalog",
    replace: true,
    records: [{ mfn: 1, status: "active", fields: [] }],
  });
  const databaseFiles = {
    "catalog.mst": new Uint8Array([1]),
    "catalog.xrf": new Uint8Array([2]),
  };
  worker.respond({
    type: "result",
    id: worker.messages[0]!.id,
    result: { ...success(""), files: databaseFiles },
  });
  await Promise.resolve();
  worker.respond({
    type: "result",
    id: worker.messages[1]!.id,
    result: {
      ...success(""),
      exitCode: 1,
      stderr: "finalization failed",
      files: databaseFiles,
    },
  });

  const failed = await pending;
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(failed.files, {});
  assert.deepEqual(failed.fileStates, {});
  runner.dispose();
});

test("reads structured records through the direct MX record API", async () => {
  const worker = new MockWorker();
  const runner = new CisisRunner({ workerFactory: () => worker as unknown as Worker });
  const pending = runner.readRecords({ database: "catalog", from: 5, count: 2 });

  assert.deepEqual(worker.messages[0]?.request.args, []);
  assert.deepEqual(
    (worker.messages[0]?.request as CisisRunRequest & {
      directRecordRead: unknown;
    }).directRecordRead,
    {
      database: "catalog",
      from: 5,
      count: 2,
      outputPath: "__cisis-records.bin",
    },
  );
  worker.respond({
    type: "result",
    id: worker.messages[0]!.id,
    result: {
      ...success(""),
      files: { "__cisis-records.bin": exportedRecord },
    },
  });

  const result = await pending;
  assert.equal(result.records[0]?.mfn, 5);
  assert.equal(result.records[0]?.status, "active");
  assert.deepEqual(result.records[0]?.fields.map((field) => field.tag), [24, 70, 70, 999]);
  assert.equal(
    new TextDecoder().decode(result.records[0]?.fields[3]?.value as Uint8Array),
    "original",
  );
  runner.dispose();
});

test("rejects unsafe database names in IDE helpers", () => {
  const runner = new CisisRunner();
  assert.throws(() => runner.format({ database: "../outside", pft: "v1" }), /escapes/);
  assert.throws(() => runner.search({ database: "-all", expression: "x" }), /database name/);
  assert.throws(
    () => runner.index({ database: "cds", index: "out=side", fst: "1 0 v1" }),
    /database name/,
  );
  runner.dispose();
});

test("rejects inspected files outside the request root", async () => {
  let workerCreated = false;
  const runner = new CisisRunner({
    workerFactory: () => {
      workerCreated = true;
      return new MockWorker() as unknown as Worker;
    },
  });

  await assert.rejects(
    runner.run({ program: "wxis", args: [], inspectFiles: ["../outside"] }),
    /escapes/,
  );
  assert.equal(workerCreated, false);
  runner.dispose();
});
