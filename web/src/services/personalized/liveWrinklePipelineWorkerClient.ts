import * as Comlink from "comlink";

import type {
  LiveWrinkleDetectionResult,
  LiveWrinklePipelineWorkerApi,
  LiveWrinkleWorkerEvent,
  LiveWrinklePrecomputedRequest,
  LiveWrinkleRefinementRequest,
  LiveWrinkleRefinementResult,
} from "../../workers/liveWrinklePipelineWorkerContract.ts";

export interface LiveWrinkleWorkerAnalysisInput {
  imageData: ImageData;
  size: number;
  landmarks?: Array<[number, number, number]>;
  mode: "full" | "yolo-only";
  includeFingerprint?: boolean;
  cacheForRefinement?: boolean;
}

export interface LiveWrinklePipelineWorkerClient {
  detect(
    input: LiveWrinkleWorkerAnalysisInput,
    onEvent?: (event: LiveWrinkleWorkerEvent) => void,
  ): Promise<LiveWrinkleDetectionResult>;
  seedYoloEvidence(input: LiveWrinklePrecomputedRequest): Promise<LiveWrinkleDetectionResult>;
  refine(input: LiveWrinkleRefinementRequest): Promise<LiveWrinkleRefinementResult>;
  dispose(): void;
}

export function createLiveWrinklePipelineWorkerClient(): LiveWrinklePipelineWorkerClient {
  const worker = new Worker(new URL("../../workers/liveWrinklePipeline.worker.ts", import.meta.url), {
    type: "module",
    name: "langerface-live-wrinkle-pipeline",
  });
  const api = Comlink.wrap<LiveWrinklePipelineWorkerApi>(worker);
  let disposed = false;
  const debugUnfilteredPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("wrinklePreview") === "unfiltered";

  return {
    detect(input, onEvent) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      const request = {
        pixels: input.imageData.data,
        width: input.imageData.width,
        height: input.imageData.height,
        size: input.size,
        // Landmarks constrain generic YOLO wrinkles to the nose bridge before
        // evidence is displayed or cached for refinement.
        landmarks: input.landmarks || [],
        mode: input.mode,
        includeFingerprint: input.includeFingerprint,
        cacheForRefinement: input.cacheForRefinement,
        debugUnfilteredPreview,
      };
      const eventSink = onEvent ? Comlink.proxy(onEvent) : undefined;
      return api.detect(
        Comlink.transfer(request, [request.pixels.buffer as ArrayBuffer]),
        eventSink,
      );
    },

    seedYoloEvidence(input) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      return api.seedYoloEvidence({ ...input, debugUnfilteredPreview });
    },

    refine(input) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      return api.refine(input);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      const releasable = api as Comlink.Remote<LiveWrinklePipelineWorkerApi> & {
        [Comlink.releaseProxy]?: () => void;
      };
      releasable[Comlink.releaseProxy]?.();
      worker.terminate();
    },
  };
}
