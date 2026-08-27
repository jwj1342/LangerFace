import * as Comlink from "comlink";

import { runGeneralLiveWrinklePipeline } from
  "../services/personalized/liveWrinklePipeline.ts";
import {
  YoloWrinkleOnnx,
  YOLO_WRINKLE_CONFIDENCE,
} from "../services/personalized/yoloWrinkleOnnx.ts";
import type {
  LiveWrinklePipelineWorkerApi,
  LiveWrinkleWorkerEvent,
  LiveWrinkleWorkerEventSink,
  LiveWrinkleWorkerEvidence,
} from "./liveWrinklePipelineWorkerContract.ts";

const detector = new YoloWrinkleOnnx({
  confidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
});

function emit(
  onEvent: LiveWrinkleWorkerEventSink | undefined,
  event: LiveWrinkleWorkerEvent,
): void {
  if (!onEvent) return;
  try {
    void Promise.resolve(onEvent(event)).catch(() => undefined);
  } catch {
    // The page may terminate this worker when a newer source replaces the run.
  }
}

const api: LiveWrinklePipelineWorkerApi = {
  async analyze(request, onEvent) {
    let compactEvidence: LiveWrinkleWorkerEvidence | null = null;
    const pipeline = await runGeneralLiveWrinklePipeline({
      detector,
      imageData: {
        width: request.width,
        height: request.height,
        data: request.pixels,
      } as ImageData,
      seeds: request.seeds,
      size: request.size,
      faceWidthPx: request.faceWidthPx,
      onModelProgress: (progress) => emit(onEvent, { type: "model-progress", progress }),
      onEvidence: (evidence) => {
        compactEvidence = {
          lines: evidence.lines,
          summary: evidence.summary,
        };
        emit(onEvent, { type: "evidence", evidence: compactEvidence });
      },
    });
    if (!compactEvidence) throw new Error("皱纹 Worker 未返回中心线证据");

    return {
      executionThread: "web_worker",
      detectorVersion: pipeline.detectorVersion,
      refinementProfile: pipeline.refinementProfile,
      evidence: compactEvidence,
      refined: {
        curves: pipeline.refined.curves,
        diagnostics: pipeline.refined.diagnostics,
        audit: pipeline.refined.audit,
      },
    };
  },

  async close() {
    await detector.close();
  },
};

Comlink.expose(api);
