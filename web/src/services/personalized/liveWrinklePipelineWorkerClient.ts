import pipelineWorkerUrl from "../../workers/liveWrinklePipeline.worker.ts?worker&url";
import * as Comlink from "comlink";
import { createWorkerRequestLifetime } from "./workerRequestLifetime.ts";

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

export function wrinkleWorkerOptionsForLocation(path: string, search: string): URLSearchParams {
  const workerOptions = new URLSearchParams();
  workerOptions.set("wrinkleModel", "640");
  const queryConfidence = new URLSearchParams(search).get("wrinkleConfidence");
  const fixed640Route = path.match(/\/workflow\/640(?:-(threshold001|threshold01))?(?:\/|$)/);
  if (fixed640Route) {
    workerOptions.set("wrinkleConfidence", fixed640Route[1] === "threshold001" ? "0.001"
      : fixed640Route[1] === "threshold01" ? "0.01" : "0.1");
  } else if (path.match(/\/workflow\/640-ultralowconf(?:\/|$)/)
      || queryConfidence === "0.0001") workerOptions.set("wrinkleConfidence", "0.0001");
  else if (path.match(/\/workflow\/640-(?:lowconf|threshold001)(?:\/|$)/)
      || queryConfidence === "0.001") workerOptions.set("wrinkleConfidence", "0.001");
  else if (path.match(/\/workflow\/640-threshold01(?:\/|$)/)
      || queryConfidence === "0.01") workerOptions.set("wrinkleConfidence", "0.01");
  return workerOptions;
}

export function createLiveWrinklePipelineWorkerClient(): LiveWrinklePipelineWorkerClient {
  const workerUrl = new URL(pipelineWorkerUrl, window.location.href);
  const workerOptions = wrinkleWorkerOptionsForLocation(window.location.pathname, window.location.search);
  // Keep runtime selection out of the worker source query. Vite's OXC parser
  // otherwise attempts to parse the TypeScript module with these parameters.
  if (workerOptions.toString()) workerUrl.hash = workerOptions.toString();
  const worker = new Worker(workerUrl, {
    type: "module",
    name: "langerface-live-wrinkle-pipeline",
  });
  const api = Comlink.wrap<LiveWrinklePipelineWorkerApi>(worker);
  let disposed = false;
  const lifetime = createWorkerRequestLifetime();
  const onWorkerError = () => lifetime.close(new Error("皱纹 Worker 异常终止，请重新检测"));
  worker.addEventListener("error", onWorkerError);
  worker.addEventListener("messageerror", onWorkerError);
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
        // Landmarks are still used to select guidance for RSTL refinement.
        landmarks: input.landmarks || [],
        mode: input.mode,
        includeFingerprint: input.includeFingerprint,
        cacheForRefinement: input.cacheForRefinement,
        debugUnfilteredPreview,
      };
      const eventSink = onEvent ? Comlink.proxy(onEvent) : undefined;
      return lifetime.run(() => api.detect(
        Comlink.transfer(request, [request.pixels.buffer as ArrayBuffer]),
        eventSink,
      ));
    },

    seedYoloEvidence(input) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      return lifetime.run(() => api.seedYoloEvidence({ ...input, debugUnfilteredPreview }));
    },

    refine(input) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      return lifetime.run(() => api.refine(input));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.close(new Error("皱纹 Worker 已关闭"));
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      const releasable = api as Comlink.Remote<LiveWrinklePipelineWorkerApi> & {
        [Comlink.releaseProxy]?: () => void;
      };
      releasable[Comlink.releaseProxy]?.();
      worker.terminate();
    },
  };
}
