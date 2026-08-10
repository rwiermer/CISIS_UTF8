/// <reference lib="webworker" />

import type { WorkerRunRequest, WorkerRunResponse } from "./protocol.js";
import { executeRequest } from "./worker-runtime.js";

const worker = self as DedicatedWorkerGlobalScope;
let queue = Promise.resolve();

worker.onmessage = (event: MessageEvent<WorkerRunRequest>) => {
  const message = event.data;
  if (message.type !== "run") return;

  queue = queue.then(async () => {
    let response: WorkerRunResponse;
    try {
      const result = await executeRequest(message.id, message.moduleUrl, message.request);
      response = { type: "result", id: message.id, result };
    } catch (error) {
      response = {
        type: "error",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    worker.postMessage(response);
  });
};
