import * as Comlink from "comlink";
import ortWasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import ortWasmBinaryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";

import { buildDirectNoseDorsumRstl } from
  "../services/personalized/directNoseDorsumRstl.ts";
import { extractFineWrinkleLines } from
  "../services/personalized/fineWrinkleLines.ts";
import {
  buildNoseRootIntersectionVisibilityPlan,
  noseRootVisibilityDiagnostic,
} from "../services/personalized/noseRootIntersectionVisibility.ts";
import {
  buildPrecomputedFineWrinkleEvidence,
  type PrecomputedFineWrinklePayload,
} from "../services/personalized/precomputedFineWrinkleEvidence.ts";
import { refineV6 } from "../services/personalized/v6RstlRefinementV9.ts";
import {
  latestV9RstlRefinementOptions,
  LATEST_WRINKLE_REFINEMENT_PROFILE,
} from "../services/personalized/v9RstlRefinementProfile.ts";
import {
  YoloWrinkleOnnx,
  YOLO_WRINKLE_CONFIDENCE,
  YOLO_WRINKLE_ONNX_VERSION,
} from "../services/personalized/yoloWrinkleOnnx.ts";
import {
  parseWrinkleV10ProviderSession,
  WRINKLE_V10_CHECKPOINT_SHA256,
  WRINKLE_V10_ENDPOINT,
  WRINKLE_V10_HEALTH_TIMEOUT_MS,
  WRINKLE_V10_REQUEST_TIMEOUT_MS,
  type WrinkleV10ProviderCapability,
  type WrinkleV10ProviderSession,
} from "../services/personalized/wrinkleV10Provider.ts";
import type {
  LiveWrinklePipelineWorkerApi,
  LiveWrinkleWorkerCurve,
  LiveWrinkleWorkerEvent,
  LiveWrinkleWorkerEventSink,
  LiveWrinkleWorkerEvidence,
  LiveWrinkleWorkerRequest,
} from "./liveWrinklePipelineWorkerContract.ts";

const LEFT_EYE_CONTOUR = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
const RIGHT_EYE_CONTOUR = [
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
];

interface DynamicFineLine {
  id: string;
  class: string;
  anatomicalClass: "forehead" | "glabellar" | "nasal_dorsum" | "crow_feet";
  points: Array<[number, number]>;
}

interface DynamicFourRegionPayload extends PrecomputedFineWrinklePayload {
  detectorVersion: string;
  checkpointSha256: string;
  source: {
    imageSha256: string;
    width: number;
    height: number;
  };
  lines: DynamicFineLine[];
}

const detector = new YoloWrinkleOnnx({
  confidenceThreshold: YOLO_WRINKLE_CONFIDENCE,
  wasmPaths: { mjs: ortWasmModuleUrl, wasm: ortWasmBinaryUrl },
});

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(timeoutMessage), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function providerSession(): Promise<WrinkleV10ProviderSession> {
  const response = await fetchWithTimeout(
    WRINKLE_V10_ENDPOINT,
    { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" },
    WRINKLE_V10_HEALTH_TIMEOUT_MS,
    "V10 检测服务健康检查超时",
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error;
    throw new Error(message || `V10 检测服务不可用（HTTP ${response.status}）`);
  }
  return parseWrinkleV10ProviderSession(payload);
}

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

function requestBody(
  request: LiveWrinkleWorkerRequest,
  baselineLines: LiveWrinkleWorkerEvidence["lines"],
): Uint8Array {
  const metadata = new TextEncoder().encode(JSON.stringify({
    width: request.width,
    height: request.height,
    landmarks: request.landmarks,
    baselineLines,
  }));
  const body = new Uint8Array(4 + metadata.length + request.pixels.byteLength);
  new DataView(body.buffer).setUint32(0, metadata.length, true);
  body.set(metadata, 4);
  body.set(request.pixels, 4 + metadata.length);
  return body;
}

async function dynamicFourRegionDetection(
  request: LiveWrinkleWorkerRequest,
  baselineLines: LiveWrinkleWorkerEvidence["lines"],
  session: WrinkleV10ProviderSession,
): Promise<DynamicFourRegionPayload> {
  const body = requestBody(request, baselineLines);
  if (body.byteLength > session.maximumRequestBytes) {
    throw new Error("V10 检测请求超过服务声明的 32 MB 上限");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    Accept: "application/json",
  };
  if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  const response = await fetchWithTimeout(
    session.directDetectUrl,
    {
      method: "POST",
      headers,
      body: body.buffer as ArrayBuffer,
    },
    WRINKLE_V10_REQUEST_TIMEOUT_MS,
    "V10 四区域检测超过 45 秒，任务已取消",
  );
  const payload = await response.json().catch(() => null) as
    (DynamicFourRegionPayload & { error?: string; detail?: string }) | null;
  if (!payload) throw new Error(`V10 检测服务返回了无效响应（HTTP ${response.status}）`);
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || `四区域检测服务返回 HTTP ${response.status}`);
  }
  if (payload.schemaVersion !== "langerface.wrinkle-fine-lines.v1"
      || payload.detectorVersion !== session.capability.detectorVersion
      || payload.checkpointSha256 !== WRINKLE_V10_CHECKPOINT_SHA256
      || !Array.isArray(payload.lines) || !payload.lines.length) {
    throw new Error("四区域检测服务返回了无效中心线数据");
  }
  const classes = new Set(payload.lines.map((line) => line.anatomicalClass));
  for (const name of ["forehead", "glabellar", "nasal_dorsum", "crow_feet"] as const) {
    if (!classes.has(name)) throw new Error(`四区域检测缺少 ${name}`);
  }
  return payload;
}

function pixelLandmarks(request: LiveWrinkleWorkerRequest): Array<[number, number]> {
  return request.landmarks.map((point) => [
    point[0] * request.size,
    point[1] * request.size,
  ]);
}

function appendDirectNoseCurves(
  request: LiveWrinkleWorkerRequest,
  payload: DynamicFourRegionPayload,
  refined: ReturnType<typeof refineV6>,
) {
  const noseLines = payload.lines.filter((line) => line.anatomicalClass === "nasal_dorsum");
  const landmarks = pixelLandmarks(request);
  const directNose = buildDirectNoseDorsumRstl({
    fineLines: noseLines,
    sourceFineLineIds: noseLines.map((line) => line.id),
    faceWidthPx: request.faceWidthPx,
    eyePolygons: [LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR].map((indices) =>
      indices.map((index) => landmarks[index]).filter(Boolean)),
    existingCurves: refined.curves,
    maximumTurnLimitDegrees: 8,
    auditExistingCurveIntersections: true,
  });
  const curves: LiveWrinkleWorkerCurve[] = [
    ...refined.curves.map((curve) => ({
      name: curve.name,
      region: curve.region,
      pts: curve.pts.map((point: number[]) => [point[0], point[1]] as [number, number]),
      hiddenPointRuns: [] as Array<[number, number]>,
    })),
    ...directNose.curves.map((curve) => ({
      name: curve.name,
      region: curve.region,
      pts: curve.pts.map((point) => [point[0], point[1]] as [number, number]),
      hiddenPointRuns: [] as Array<[number, number]>,
    })),
  ];
  const visibilityPlan = buildNoseRootIntersectionVisibilityPlan({
    curves: curves.map((curve, curveIndex) => ({ ...curve, curveIndex })),
    faceWidthPx: request.faceWidthPx,
  });
  for (const record of visibilityPlan.hiddenCurves) {
    const curve = curves[record.curveIndex];
    if (curve) curve.hiddenPointRuns = record.hiddenPointRuns.map((run) => [run[0], run[1]]);
  }
  Object.assign(refined.diagnostics, {
    refinement_profile: LATEST_WRINKLE_REFINEMENT_PROFILE,
    four_region_detector: payload.detectorVersion,
    source_nose_dorsum_wrinkles_excluded_from_refinement: true,
    direct_nose_dorsum_rstl: directNose.diagnostics,
    direct_nose_dorsum_generated_curve_count: directNose.curves.length,
    nose_root_intersection_visibility: noseRootVisibilityDiagnostic(visibilityPlan),
  });
  Object.assign(refined.audit, {
    directNoseDorsumRstl: directNose.diagnostics,
    noseRootIntersectionVisibility: noseRootVisibilityDiagnostic(visibilityPlan),
  });
  return curves;
}

const api: LiveWrinklePipelineWorkerApi = {
  async analyze(request, onEvent) {
    const totalStart = performance.now();
    const modelLoadStart = performance.now();
    await detector.load((progress) => emit(onEvent, { type: "model-progress", progress }));
    const modelLoadMs = performance.now() - modelLoadStart;
    const yoloStart = performance.now();
    const detection = await detector.detect({
      width: request.width,
      height: request.height,
      data: request.pixels,
    } as ImageData, { confidenceThreshold: YOLO_WRINKLE_CONFIDENCE });
    if (detection.version !== YOLO_WRINKLE_ONNX_VERSION) {
      throw new Error(`皱纹检测器版本不匹配：${detection.version}`);
    }
    const yoloDetectionMs = performance.now() - yoloStart;
    const baselineStart = performance.now();
    const baseline = extractFineWrinkleLines(
      detection.classMasks,
      request.size,
      request.size,
      { minimumLineLengthPx: 20, resampleSpacingPx: 1, maximumSkeletonIterations: 96 },
    );
    if (!baseline.lines.length || !baseline.validation.passed) {
      throw new Error("实时 YOLO 未提取到可供 V10 使用的基础中心线");
    }
    const baselineExtractionMs = performance.now() - baselineStart;
    // Acquire the short-lived direct-upload ticket only after local model work,
    // so slow first-load devices cannot expire it before the image POST begins.
    const session = await providerSession();
    const provider = session.capability;
    if (onEvent) await onEvent({ type: "provider-ready", capability: provider });
    emit(onEvent, { type: "pipeline-progress", stage: "four-region" });
    const fourRegionStart = performance.now();
    const payload = await dynamicFourRegionDetection(request, baseline.lines, session);
    const fourRegionDetectionMs = performance.now() - fourRegionStart;
    const evidenceStart = performance.now();
    const displayEvidence = buildPrecomputedFineWrinkleEvidence(
      payload,
      request.size,
      payload.source.imageSha256,
    );
    const guidancePayload: DynamicFourRegionPayload = {
      ...payload,
      lines: payload.lines.filter((line) => line.anatomicalClass !== "nasal_dorsum"),
    };
    const guidanceEvidence = buildPrecomputedFineWrinkleEvidence(
      guidancePayload,
      request.size,
      payload.source.imageSha256,
    );
    const evidence: LiveWrinkleWorkerEvidence = {
      lines: payload.lines,
      summary: displayEvidence.summary,
    };
    const evidenceBuildMs = performance.now() - evidenceStart;
    emit(onEvent, { type: "evidence", evidence });
    emit(onEvent, { type: "pipeline-progress", stage: "refining" });
    const refinementStart = performance.now();
    const refined = refineV6({
      seeds: request.seeds,
      wrinkleMask: guidanceEvidence.mask,
      confidenceMap: guidanceEvidence.confidence,
      directionQ: guidanceEvidence.directionQ,
      size: request.size,
      faceWidthPx: request.faceWidthPx,
      options: latestV9RstlRefinementOptions(request.faceWidthPx),
    });
    const refinementMs = performance.now() - refinementStart;
    const noseStart = performance.now();
    const curves = appendDirectNoseCurves(request, payload, refined);
    const noseAndVisibilityMs = performance.now() - noseStart;
    return {
      executionThread: "web_worker",
      detectorVersion: payload.detectorVersion,
      refinementProfile: LATEST_WRINKLE_REFINEMENT_PROFILE,
      provider,
      timings: {
        modelLoadMs,
        yoloDetectionMs,
        baselineExtractionMs,
        fourRegionDetectionMs,
        evidenceBuildMs,
        refinementMs,
        noseAndVisibilityMs,
        totalMs: performance.now() - totalStart,
      },
      evidence,
      refined: {
        curves,
        diagnostics: refined.diagnostics,
        audit: refined.audit,
        standardCurveCount: refined.curves.length,
      },
    };
  },

  async close() {
    await detector.close();
  },
};

Comlink.expose(api);
