import * as Comlink from "comlink";

import type {
  LiveWrinkleDetectionResult,
  LiveWrinklePipelineWorkerApi,
  LiveWrinkleWorkerEvent,
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

  return {
    detect(input, onEvent) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      const request = {
        pixels: input.imageData.data,
        width: input.imageData.width,
        height: input.imageData.height,
        size: input.size,
        // YOLO-only extraction never reads landmarks. Avoid cloning hundreds
        // of nested point arrays across the worker boundary on every correction.
        landmarks: input.mode === "full" ? input.landmarks || [] : [],
        mode: input.mode,
        includeFingerprint: input.includeFingerprint,
        cacheForRefinement: input.cacheForRefinement,
      };
      const eventSink = onEvent ? Comlink.proxy(onEvent) : undefined;
      return api.detect(
        Comlink.transfer(request, [request.pixels.buffer as ArrayBuffer]),
        eventSink,
      );
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
