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
  type PrecomputedFineWrinkleEvidence,
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
  isYoloGuidedForeheadSeed,
  isYoloGuidedGlabellarSeed,
  isYoloGuidedRstlSeed,
  mergeYoloGuidedRstlCurves,
  YOLO_GUIDED_RSTL_SCOPE,
} from "../services/personalized/yoloGuidedRstlScope.ts";
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
  LiveWrinkleRefinementRequest,
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
let fullDetectionSequence = 0;
let cachedFullDetection: { id: string; payload: DynamicFourRegionPayload } | null = null;
let yoloDetectionSequence = 0;
let cachedYoloDetection: {
  id: string;
  foreheadEvidence: PrecomputedFineWrinkleEvidence | null;
  glabellarEvidence: PrecomputedFineWrinkleEvidence | null;
} | null = null;

function buildYoloGuidanceEvidence(
  lines: LiveWrinkleWorkerEvidence["lines"],
  className: "forehead" | "frown",
  size: number,
  cacheKey: string,
  summary: Record<string, unknown>,
): PrecomputedFineWrinkleEvidence | null {
  const selected = lines.filter((line) => line.class === className);
  if (!selected.length) return null;
  return buildPrecomputedFineWrinkleEvidence({
    schemaVersion: "langerface.wrinkle-fine-lines.v1",
    source: { imageSha256: cacheKey, width: size, height: size },
    summary,
    lines: selected,
  }, size, cacheKey);
}

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

async function sha256Json(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) return "unavailable-in-insecure-context";
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function pixelLandmarks(
  request: Pick<LiveWrinkleRefinementRequest, "landmarks" | "size">,
): Array<[number, number]> {
  return request.landmarks.map((point) => [
    point[0] * request.size,
    point[1] * request.size,
  ]);
}

function appendDirectNoseCurves(
  request: LiveWrinkleRefinementRequest,
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
  async detect(request, onEvent) {
    const totalStart = performance.now();
    const modelLoadStart = performance.now();
    await detector.load((progress) => emit(onEvent, { type: "model-progress", progress }));
    const modelLoadMs = performance.now() - modelLoadStart;
    const yoloStart = performance.now();
    const imageData = {
      width: request.width,
      height: request.height,
      data: request.pixels,
    } as ImageData;
    const detection = request.mode === "yolo-only"
      ? await detector.detectClassMasks(imageData, { confidenceThreshold: YOLO_WRINKLE_CONFIDENCE })
      : await detector.detect(imageData, { confidenceThreshold: YOLO_WRINKLE_CONFIDENCE });
    if (detection.version !== YOLO_WRINKLE_ONNX_VERSION) {
      throw new Error(`皱纹检测器版本不匹配：${detection.version}`);
    }
    const yoloDetectionMs = performance.now() - yoloStart;
    const baselineStart = performance.now();
    const baseline = extractFineWrinkleLines(
      detection.classMasks,
      request.size,
      request.size,
      {
        minimumLineLengthPx: 20,
        resampleSpacingPx: 1,
        maximumSkeletonIterations: 96,
        sourceImageRgba: request.mode === "yolo-only" ? undefined : request.pixels,
      },
    );
    if (!baseline.lines.length || !baseline.validation.passed) {
      throw new Error("YOLO 未提取到有效皱纹中心线");
    }
    const baselineExtractionMs = performance.now() - baselineStart;
    // Periodic correction only consumes geometry and scores. Avoid creating a
    // large JSON string and digest for results that never enter reproducibility logs.
    const browserBaselineSha256 = request.includeFingerprint === false
      ? null
      : await sha256Json(baseline.lines);
    if (request.mode === "yolo-only") {
      const yoloScores = detection.detections
        .map((item) => Number(item.score))
        .filter((score) => Number.isFinite(score));
      const evidence: LiveWrinkleWorkerEvidence = {
        lines: baseline.lines.map((line) => ({
          id: line.id,
          class: line.class,
          anatomicalClass: line.class,
          points: line.points.map((point) => [point[0], point[1]]),
        })),
        summary: {
          fineLineCount: baseline.lines.length,
          sourceConnectedComponents: baseline.validation.renderedConnectedComponents,
          browserBaselineSha256,
          yoloDiagnostics: detection.diagnostics || {},
          yoloScores,
        },
      };
      let detectionId: string | null = null;
      if (request.cacheForRefinement) {
        if (baseline.lines.some((line) => line.class === "forehead" || line.class === "frown")) {
          const cacheKey = `yolo-guidance-${++yoloDetectionSequence}`;
          detectionId = `yolo-${yoloDetectionSequence}`;
          cachedYoloDetection = {
            id: detectionId,
            foreheadEvidence: buildYoloGuidanceEvidence(
              baseline.lines, "forehead", request.size, `${cacheKey}-forehead`, baseline.summary,
            ),
            glabellarEvidence: buildYoloGuidanceEvidence(
              baseline.lines, "frown", request.size, `${cacheKey}-glabellar`, baseline.summary,
            ),
          };
        } else {
          cachedYoloDetection = null;
        }
      }
      emit(onEvent, { type: "evidence", evidence });
      return {
        executionThread: "web_worker",
        detectorVersion: detection.version,
        detectionId,
        mode: request.mode,
        provider: null,
        timings: {
          modelLoadMs,
          yoloDetectionMs,
          baselineExtractionMs,
          fourRegionDetectionMs: 0,
          evidenceBuildMs: 0,
          totalMs: performance.now() - totalStart,
        },
        evidence,
      };
    }

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
      summary: {
        ...displayEvidence.summary,
        browserBaselineSha256,
        v10InputImageSha256: payload.source.imageSha256,
      },
    };
    const evidenceBuildMs = performance.now() - evidenceStart;
    emit(onEvent, { type: "evidence", evidence });
    const detectionId = `full-${++fullDetectionSequence}`;
    cachedFullDetection = { id: detectionId, payload };
    return {
      executionThread: "web_worker",
      detectorVersion: payload.detectorVersion,
      detectionId,
      mode: request.mode,
      provider,
      timings: {
        modelLoadMs,
        yoloDetectionMs,
        baselineExtractionMs,
        fourRegionDetectionMs,
        evidenceBuildMs,
        totalMs: performance.now() - totalStart,
      },
      evidence,
    };
  },

  async refine(request) {
    const cachedYolo = cachedYoloDetection;
    if (cachedYolo?.id === request.detectionId) {
      const indexedSeeds = request.seeds.map((seed, index) => ({ seed, index }));
      const foreheadSeeds = indexedSeeds.filter(({ seed }) => isYoloGuidedForeheadSeed(seed));
      const glabellarSeeds = indexedSeeds.filter(({ seed }) => isYoloGuidedGlabellarSeed(seed));
      const eligibleSeeds = indexedSeeds.filter(({ seed }) => isYoloGuidedRstlSeed(seed));
      if (!eligibleSeeds.length) {
        throw new Error("当前 RSTL 图谱中没有可用于额头或眉间微调的曲线");
      }
      const refinementStart = performance.now();
      const refineChannel = (
        seeds: typeof eligibleSeeds,
        evidence: PrecomputedFineWrinkleEvidence | null,
      ) => seeds.length && evidence ? refineV6({
          seeds: seeds.map(({ seed }) => seed),
          wrinkleMask: evidence.mask,
          confidenceMap: evidence.confidence,
          directionQ: evidence.directionQ,
          size: request.size,
          faceWidthPx: request.faceWidthPx,
          options: latestV9RstlRefinementOptions(request.faceWidthPx),
        }) : null;
      const forehead = refineChannel(foreheadSeeds, cachedYolo.foreheadEvidence);
      const glabellar = refineChannel(glabellarSeeds, cachedYolo.glabellarEvidence);
      const channelCurves = new Map<number, ReturnType<typeof refineV6>["curves"][number]>();
      foreheadSeeds.forEach(({ index }, scopedIndex) => {
        if (forehead) channelCurves.set(index, forehead.curves[scopedIndex]);
      });
      glabellarSeeds.forEach(({ index }, scopedIndex) => {
        if (glabellar) channelCurves.set(index, glabellar.curves[scopedIndex]);
      });
      const scopedCurves = eligibleSeeds.map(({ seed, index }) =>
        channelCurves.get(index) || { ...seed, pts: Array.isArray(seed.pts) ? seed.pts : [] });
      const curves: LiveWrinkleWorkerCurve[] = mergeYoloGuidedRstlCurves(
        request.seeds,
        scopedCurves,
      );
      const channelResults = [forehead, glabellar].filter(
        (result): result is NonNullable<typeof result> => Boolean(result),
      );
      if (!channelResults.length) throw new Error("缓存中没有额头或眉间皱纹证据");
      const diagnostics = {
        ...channelResults[0].diagnostics,
        refinement_scope: YOLO_GUIDED_RSTL_SCOPE,
        refinement_scope_seed_count: eligibleSeeds.length,
        excluded_rstl_curve_count: request.seeds.length - eligibleSeeds.length,
        guidance_channels_isolated: true,
        forehead_evidence_line_count: cachedYolo.foreheadEvidence?.lines.length || 0,
        glabellar_evidence_line_count: cachedYolo.glabellarEvidence?.lines.length || 0,
        forehead_moved_curve_count: Number(forehead?.diagnostics.moved_curve_count || 0),
        glabellar_moved_curve_count: Number(glabellar?.diagnostics.moved_curve_count || 0),
        glabellar_classified_trend_count: Array.isArray(glabellar?.diagnostics.wrinkle_trend_geometry)
          ? glabellar.diagnostics.wrinkle_trend_geometry.filter(
            (trend: Record<string, unknown>) => trend.classified_guided_region === "glabellar",
          ).length
          : 0,
        glabellar_candidate_pair_count: Number(
          glabellar?.diagnostics.band_candidate_pair_count || 0,
        ),
        glabellar_supported_curve_count: Array.isArray(glabellar?.diagnostics.curve_support_records)
          ? glabellar.diagnostics.curve_support_records.filter(
            (record: Record<string, unknown>) => record.minimum_support_passed === true,
          ).length
          : 0,
        glabellar_selected_curve_count: Number(
          glabellar?.diagnostics.glabellar_single_curve_selected_count || 0,
        ),
        glabellar_match_statuses: Array.isArray(glabellar?.audit.matchRecords)
          ? glabellar.audit.matchRecords.reduce(
            (counts: Record<string, number>, record: Record<string, unknown>) => {
              const status = String(record.final_status || record.rejection_reason || "unknown");
              counts[status] = (counts[status] || 0) + 1;
              return counts;
            },
            {},
          )
          : {},
        moved_curve_count: channelResults.reduce(
          (sum, result) => sum + Number(result.diagnostics.moved_curve_count || 0), 0,
        ),
        moved_point_count: channelResults.reduce(
          (sum, result) => sum + Number(result.diagnostics.moved_point_count || 0), 0,
        ),
        maximum_selected_rstl_curves_per_wrinkle: Math.max(...channelResults.map((result) =>
          Number(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle || 0))),
        curve_unique_wrinkle_ownership: channelResults.every((result) =>
          result.diagnostics.curve_unique_wrinkle_ownership === true),
        wrinkle_with_single_side_selected_count: channelResults.reduce((sum, result) =>
          sum + Number(result.diagnostics.wrinkle_with_single_side_selected_count || 0), 0),
        nose_bridge_single_curve_selected_count: 0,
        bundle_follower_moved_curve_count: channelResults.reduce((sum, result) =>
          sum + Number(result.diagnostics.bundle_follower_moved_curve_count || 0), 0),
        curvature_fairing_enabled: channelResults.every((result) =>
          result.diagnostics.curvature_fairing_enabled === true),
        topology_contract_preserved: channelResults.every((result) =>
          result.diagnostics.topology_contract_preserved === true),
        post_export_new_intersection_pair_count: channelResults.reduce((sum, result) =>
          sum + Number(result.diagnostics.post_export_new_intersection_pair_count || 0), 0),
        post_export_new_self_cross_curve_count: channelResults.reduce((sum, result) =>
          sum + Number(result.diagnostics.post_export_new_self_cross_curve_count || 0), 0),
      };
      return {
        executionThread: "web_worker",
        detectorVersion: YOLO_WRINKLE_ONNX_VERSION,
        refinementProfile: LATEST_WRINKLE_REFINEMENT_PROFILE,
        refinementMs: performance.now() - refinementStart,
        noseAndVisibilityMs: 0,
        refined: {
          curves,
          diagnostics,
          audit: { forehead: forehead?.audit || null, glabellar: glabellar?.audit || null },
          standardCurveCount: request.seeds.length,
        },
      };
    }
    const cached = cachedFullDetection;
    if (!cached || cached.id !== request.detectionId) {
      throw new Error("皱纹检测结果已失效，请重新检测后再微调");
    }
    const payload = cached.payload;
    const guidancePayload: DynamicFourRegionPayload = {
      ...payload,
      lines: payload.lines.filter((line) => line.anatomicalClass !== "nasal_dorsum"),
    };
    const guidanceEvidence = buildPrecomputedFineWrinkleEvidence(
      guidancePayload,
      request.size,
      payload.source.imageSha256,
    );
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
    const standardCurveCount = refined.curves.length;
    const noseStart = performance.now();
    const curves = appendDirectNoseCurves(request, payload, refined);
    const noseAndVisibilityMs = performance.now() - noseStart;
    return {
      executionThread: "web_worker",
      detectorVersion: payload.detectorVersion,
      refinementProfile: LATEST_WRINKLE_REFINEMENT_PROFILE,
      refinementMs,
      noseAndVisibilityMs,
      refined: {
        curves,
        diagnostics: refined.diagnostics,
        audit: refined.audit,
        standardCurveCount,
      },
    };
  },

  async close() {
    await detector.close();
  },
};

Comlink.expose(api);
