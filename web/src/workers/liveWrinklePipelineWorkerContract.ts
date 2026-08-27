import type { FineWrinkleExtraction } from
  "../services/personalized/fineWrinkleLines.ts";
import type {
  refineV6,
  V6Seed,
} from "../services/personalized/v6RstlRefinementV9.ts";
import type { LiveWrinkleModelProgress } from
  "../services/personalized/liveWrinklePipeline.ts";

export interface LiveWrinkleWorkerRequest {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  seeds: V6Seed[];
  size: number;
  faceWidthPx: number;
}

export interface LiveWrinkleWorkerEvidence {
  lines: FineWrinkleExtraction["lines"];
  summary: FineWrinkleExtraction["summary"];
}

export type LiveWrinkleWorkerEvent =
  | { type: "model-progress"; progress: LiveWrinkleModelProgress }
  | { type: "evidence"; evidence: LiveWrinkleWorkerEvidence };

export type LiveWrinkleWorkerEventSink = (
  event: LiveWrinkleWorkerEvent,
) => void | Promise<void>;

type RefinedPipelineResult = ReturnType<typeof refineV6>;

export interface LiveWrinkleWorkerResult {
  executionThread: "web_worker";
  detectorVersion: string;
  refinementProfile: string;
  evidence: LiveWrinkleWorkerEvidence;
  refined: Pick<RefinedPipelineResult, "curves" | "diagnostics" | "audit">;
}

export interface LiveWrinklePipelineWorkerApi {
  analyze(
    request: LiveWrinkleWorkerRequest,
    onEvent?: LiveWrinkleWorkerEventSink,
  ): Promise<LiveWrinkleWorkerResult>;
  close(): Promise<void>;
}
