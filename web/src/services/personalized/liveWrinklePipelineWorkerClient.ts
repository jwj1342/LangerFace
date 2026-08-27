import * as Comlink from "comlink";

import type { V6Seed } from "./v6RstlRefinementV9.ts";
import type {
  LiveWrinklePipelineWorkerApi,
  LiveWrinkleWorkerEvent,
  LiveWrinkleWorkerResult,
} from "../../workers/liveWrinklePipelineWorkerContract.ts";

export interface LiveWrinkleWorkerAnalysisInput {
  imageData: ImageData;
  seeds: V6Seed[];
  size: number;
  faceWidthPx: number;
}

export interface LiveWrinklePipelineWorkerClient {
  analyze(
    input: LiveWrinkleWorkerAnalysisInput,
    onEvent?: (event: LiveWrinkleWorkerEvent) => void,
  ): Promise<LiveWrinkleWorkerResult>;
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
    analyze(input, onEvent) {
      if (disposed) return Promise.reject(new Error("皱纹 Worker 已关闭"));
      const request = {
        pixels: input.imageData.data,
        width: input.imageData.width,
        height: input.imageData.height,
        seeds: input.seeds,
        size: input.size,
        faceWidthPx: input.faceWidthPx,
      };
      const eventSink = onEvent ? Comlink.proxy(onEvent) : undefined;
      return api.analyze(
        Comlink.transfer(request, [request.pixels.buffer as ArrayBuffer]),
        eventSink,
      );
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
