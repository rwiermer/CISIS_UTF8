import type { CisisRunRequest, CisisRunResult } from "./types.js";

export interface WorkerRunRequest {
  type: "run";
  id: number;
  moduleUrl: string;
  request: CisisRunRequest;
}

export interface WorkerRunSuccess {
  type: "result";
  id: number;
  result: CisisRunResult;
}

export interface WorkerRunFailure {
  type: "error";
  id: number;
  error: string;
}

export type WorkerRunResponse = WorkerRunSuccess | WorkerRunFailure;
