import type { V6Seed, V6RefinementPerformance } from "../services/personalized/v6RstlRefinementV9.ts";
import type { LiveWrinkleModelProgress } from
  "../services/personalized/liveWrinklePipeline.ts";
import type { WrinkleV10ProviderCapability } from
  "../services/personalized/wrinkleV10Provider.ts";
import type { YoloGuidedGuardPerformance } from "../services/personalized/yoloGuidedRstlScope.ts";

export interface LiveWrinkleWorkerRequest {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  size: number;
  landmarks: Array<[number, number, number]>;
  mode: "full" | "yolo-only";
  includeFingerprint?: boolean;
  cacheForRefinement?: boolean;
}

export interface LiveWrinkleWorkerEvidence {
  lines: Array<{
    id: string;
    class: string;
    anatomicalClass?: string;
    points: Array<[number, number]>;
  }>;
  summary: Record<string, unknown>;
}

export interface LiveWrinklePrecomputedRequest {
  lines: Array<{
    id: string;
    sourceComponentId: string;
    class: string;
    lengthPx: number;
    points: Array<[number, number]>;
  }>;
  summary: Record<string, unknown>;
  size: number;
  landmarks: Array<[number, number, number]>;
  detectorVersion: string;
  cacheForRefinement?: boolean;
  timings: LiveWrinkleWorkerTimings;
}

export type LiveWrinkleWorkerEvent =
  | { type: "model-progress"; progress: LiveWrinkleModelProgress }
  | { type: "provider-ready"; capability: WrinkleV10ProviderCapability }
  | { type: "pipeline-progress"; stage: "four-region" | "refining" }
  | { type: "evidence"; evidence: LiveWrinkleWorkerEvidence };

export type LiveWrinkleWorkerEventSink = (
  event: LiveWrinkleWorkerEvent,
) => void | Promise<void>;

export interface LiveWrinkleWorkerCurve {
  name: string;
  region?: string;
  pts: Array<[number, number]>;
  hiddenPointRuns?: Array<[number, number]>;
}

export interface LiveWrinkleWorkerTimings {
  modelLoadMs: number;
  yoloDetectionMs: number;
  baselineExtractionMs: number;
  fourRegionDetectionMs: number;
  evidenceBuildMs: number;
  totalMs: number;
}

export interface LiveWrinkleDetectionResult {
  executionThread: "web_worker";
  detectorVersion: string;
  detectionId: string | null;
  mode: "full" | "yolo-only";
  provider: WrinkleV10ProviderCapability | null;
  timings: LiveWrinkleWorkerTimings;
  evidence: LiveWrinkleWorkerEvidence;
}

export interface LiveWrinkleRefinementRequest {
  detectionId: string;
  seeds: V6Seed[];
  size: number;
  faceWidthPx: number;
  landmarks: Array<[number, number, number]>;
  performanceMode?: "baseline" | "cached";
}

export interface LiveWrinkleRefinementPerformance {
  forehead: V6RefinementPerformance | null;
  glabellar: V6RefinementPerformance | null;
  globalGuardMs: number;
  globalGuard?: YoloGuidedGuardPerformance;
  noseAndVisibilityMs: number;
  refinementMs: number;
  outputHashMs?: number;
  outputHashes?: Record<string, string>;
  requestAndWorkerMs?: number;
  mainThreadApplyMs?: number;
  redrawDispatchMs?: number;
  readyForPaintMs?: number;
}

export interface LiveWrinkleRefinementResult {
  executionThread: "web_worker";
  detectorVersion: string;
  refinementProfile: string;
  refinementMs: number;
  noseAndVisibilityMs: number;
  performance?: LiveWrinkleRefinementPerformance;
  refined: {
    curves: LiveWrinkleWorkerCurve[];
    diagnostics: Record<string, unknown>;
    audit: Record<string, unknown>;
    standardCurveCount: number;
  };
}

export interface LiveWrinklePipelineWorkerApi {
  detect(
    request: LiveWrinkleWorkerRequest,
    onEvent?: LiveWrinkleWorkerEventSink,
  ): Promise<LiveWrinkleDetectionResult>;
  seedYoloEvidence(request: LiveWrinklePrecomputedRequest): Promise<LiveWrinkleDetectionResult>;
  refine(request: LiveWrinkleRefinementRequest): Promise<LiveWrinkleRefinementResult>;
  close(): Promise<void>;
}
