import assert from "node:assert/strict";
import test from "node:test";

import { CisisRunner } from "./index.js";
import type { WorkerRunRequest, WorkerRunResponse } from "./protocol.js";
import type { CisisRunResult } from "./types.js";

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
    diagnostics: [],
    durationMs: 1,
  };
}

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
