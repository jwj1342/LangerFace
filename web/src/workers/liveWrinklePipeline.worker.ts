import { refineNoseHybrid } from '../services/personalized/noseHybridRefinement.ts';
import * as Comlink from "comlink";
import ortWasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import ortWasmBinaryUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";

import { extractFineWrinkleLines } from
  "../services/personalized/fineWrinkleLines.ts";
import { keepFaceRegionWrinkleLines, keepTargetWrinkleLines } from
  "../services/personalized/crowFeetFilter.ts";
import {
  classifySingleClassWrinkleLines,
  hasSingleClassWrinkleMask,
  normalizeHorizontalForeheadGuidanceLines,
  routeGenericWrinkleLines,
} from
  "../services/personalized/singleClassWrinkleAdapter.ts";
import {
  buildPrecomputedFineWrinkleEvidence,
  validatedPrecomputedFineWrinkleSummary,
  type PrecomputedFineWrinkleEvidence,
  type PrecomputedFineWrinklePayload,
} from "../services/personalized/precomputedFineWrinkleEvidence.ts";
import { refineForeheadTrajectories, auditFinalForeheadAttraction } from "../services/personalized/foreheadTrajectoryAttraction.ts";
import { refineV6 } from "../services/personalized/v6RstlRefinementV9.ts";
import { refinementOutputHashes } from "../services/personalized/refinementOutputHash.ts";
import {
  latestV9RstlRefinementOptions,
  LATEST_WRINKLE_REFINEMENT_PROFILE,
  yoloGuidedV9RstlRefinementOptions,
  YOLO_GUIDED_WRINKLE_REFINEMENT_PROFILE,
} from "../services/personalized/v9RstlRefinementProfile.ts";
import {
  YoloWrinkleOnnx,
  requestedWrinkleConfidence,
  YOLO_WRINKLE_ONNX_VERSION,
} from "../services/personalized/yoloWrinkleOnnx.ts";
import {
  guardMergedYoloGuidedRstlCurves,
  isYoloGuidedForeheadSeed,
  isYoloGuidedGlabellarSeed,
  isYoloGuidedRstlSeed,
  mergeYoloGuidedRstlCurves,
  reconcileYoloGuidedAuditAfterGlobalGuard,
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
  LiveWrinkleDetectionResult,
  LiveWrinklePrecomputedRequest,
  LiveWrinkleWorkerCurve,
  LiveWrinkleWorkerEvent,
  LiveWrinkleWorkerEventSink,
  LiveWrinkleWorkerEvidence,
  LiveWrinkleWorkerRequest,
  LiveWrinkleRefinementRequest,
  LiveWrinkleRefinementPerformance,
  LiveWrinkleRefinementResult,
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

const wrinkleConfidence = requestedWrinkleConfidence();
const detector = new YoloWrinkleOnnx({
  confidenceThreshold: wrinkleConfidence,
  wasmPaths: { mjs: ortWasmModuleUrl, wasm: ortWasmBinaryUrl },
});
let fullDetectionSequence = 0;
let cachedFullDetection: { id: string; payload: DynamicFourRegionPayload } | null = null;
let yoloDetectionSequence = 0;
let cachedYoloDetection: {
  id: string;
  foreheadEvidence: PrecomputedFineWrinkleEvidence | null;
  glabellarEvidence: PrecomputedFineWrinkleEvidence | null;
  noseDorsumLines: LiveWrinkleWorkerEvidence["lines"];
} | null = null;

function buildYoloGuidanceEvidence(
  lines: LiveWrinkleWorkerEvidence["lines"],
  className: "forehead" | "frown" | "wrinkle",
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
  const noseHybrid = refineNoseHybrid({
    curves: refined.curves.map(c=>({...c,pts:c.pts.map((p:number[])=>[p[0],p[1]] as [number,number])})),
    lines:noseLines.map(l=>({id:l.id,points:l.points as [number,number][]})),
    size:request.size,faceWidthPx:request.faceWidthPx,
    eyePolygons:[LEFT_EYE_CONTOUR,RIGHT_EYE_CONTOUR].map(indices=>indices.map(i=>landmarks[i]).filter(Boolean)),
  });
  const directNose=noseHybrid.direct;
  const curves: LiveWrinkleWorkerCurve[] = [
    ...noseHybrid.curves.map((curve) => ({
      name: curve.name,
      region: curve.region,
      pts: curve.pts.map((point: number[]) => [point[0], point[1]] as [number, number]),
      hiddenPointRuns: [] as Array<[number, number]>,
    })),
    ...(directNose?.curves || []).map((curve) => ({
      name: curve.name,
      region: curve.region,
      pts: curve.pts.map((point) => [point[0], point[1]] as [number, number]),
      hiddenPointRuns: [] as Array<[number, number]>,
    })),
  ];
  Object.assign(refined.diagnostics, {
    refinement_profile: LATEST_WRINKLE_REFINEMENT_PROFILE,
    four_region_detector: payload.detectorVersion,
    source_nose_dorsum_wrinkles_excluded_from_refinement: true,
    direct_nose_dorsum_rstl: directNose?.diagnostics || null,
    nose_hybrid_refinement: noseHybrid.diagnostics,
    direct_nose_dorsum_generated_curve_count: directNose?.curves.length || 0,
    nose_root_intersection_visibility: null,
  });
  Object.assign(refined.audit, {
    directNoseDorsumRstl: directNose?.diagnostics || null,
    noseRootIntersectionVisibility: null,
  });
  return curves;
}

async function seedYoloEvidence(
  request: LiveWrinklePrecomputedRequest,
): Promise<LiveWrinkleDetectionResult> {
  const detectionLandmarks = request.landmarks.map((point) => [
    point[0] * request.size,
    point[1] * request.size,
    point[2] * request.size,
  ]);
  const singleClassLines = request.lines.length > 0
    && request.lines.every((line) => line.class === "wrinkled");
  const adaptedLines = singleClassLines
    ? classifySingleClassWrinkleLines(request.lines, detectionLandmarks).lines
    : request.lines;
  const visibleLines = keepFaceRegionWrinkleLines(adaptedLines, detectionLandmarks);
  if (!visibleLines.length) throw new Error("YOLO 未提取到有效皱纹中心线");
  const browserBaselineSha256 = typeof request.summary.browserBaselineSha256 === "string"
    ? request.summary.browserBaselineSha256
    : await sha256Json(request.lines);
  const evidence: LiveWrinkleWorkerEvidence = {
    lines: visibleLines.map((line) => ({
      id: line.id,
      class: line.class,
      anatomicalClass: line.class,
      points: line.points.map((point) => [point[0], point[1]]),
    })),
    summary: {
      ...request.summary,
      fineLineCount: visibleLines.length,
      adaptedLineCount: adaptedLines.length,
      visibleLineCount: visibleLines.length,
      sourceConnectedComponents: new Set(visibleLines.map((line) => line.sourceComponentId)).size,
      excludedNonTargetLineCount: adaptedLines.length - visibleLines.length,
      singleClassModel: singleClassLines,
      browserBaselineSha256,
    },
  };
  let detectionId: string | null = null;
  if (request.cacheForRefinement && !request.debugUnfilteredPreview) {
  const guidanceLines = keepTargetWrinkleLines(
    normalizeHorizontalForeheadGuidanceLines(adaptedLines, detectionLandmarks),
    detectionLandmarks,
  );
    if (guidanceLines.some((line) =>
      line.class === "forehead" || line.class === "frown" || line.class === "wrinkle")) {
      const cacheKey = `yolo-guidance-${++yoloDetectionSequence}`;
      detectionId = `yolo-${yoloDetectionSequence}`;
      cachedYoloDetection = {
        id: detectionId,
        foreheadEvidence: buildYoloGuidanceEvidence(
          guidanceLines, "forehead", request.size, `${cacheKey}-forehead`, request.summary,
        ),
        glabellarEvidence: buildYoloGuidanceEvidence(
          guidanceLines, "frown", request.size, `${cacheKey}-glabellar`, request.summary,
        ),
        noseDorsumLines: guidanceLines.filter((line) => line.class === "wrinkle")
          .map((line) => ({
            id: line.id,
            class: line.class,
            anatomicalClass: "nasal_dorsum",
            points: line.points.map((point) => [point[0], point[1]]),
          })),
      };
    } else {
      cachedYoloDetection = null;
    }
  }
  return {
    executionThread: "web_worker",
    detectorVersion: request.detectorVersion,
    detectionId,
    mode: "yolo-only",
    provider: null,
    timings: request.timings,
    evidence,
  };
}

function adaptSingleClassLines(
  lines: ReturnType<typeof extractFineWrinkleLines>["lines"],
  classMasks: Record<string, ArrayLike<number>>,
  landmarks: Array<[number, number, number]>,
) {
  if (!hasSingleClassWrinkleMask(classMasks)) return lines;
  return classifySingleClassWrinkleLines(lines, landmarks).lines;
}

function countActivePixels(field: ArrayLike<number> | null | undefined): number {
  if (!field) return 0;
  let count = 0;
  for (let index = 0; index < field.length; index += 1) {
    if (Number(field[index]) > 0) count += 1;
  }
  return count;
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
      ? await detector.detectClassMasks(imageData, {
        confidenceThreshold: wrinkleConfidence, preserveInstanceMasks: true,
      })
      : await detector.detect(imageData, {
        confidenceThreshold: wrinkleConfidence, preserveInstanceMasks: true,
      });
    if (detection.version !== YOLO_WRINKLE_ONNX_VERSION) {
      throw new Error(`皱纹检测器版本不匹配：${detection.version}`);
    }
    const yoloDetectionMs = performance.now() - yoloStart;
    const baselineStart = performance.now();
    const singleClassModel = hasSingleClassWrinkleMask(detection.classMasks);
    const baseline = extractFineWrinkleLines(
      detection.classMasks,
      request.size,
      request.size,
      {
        minimumLineLengthPx: 20,
        minimumLineLengthPxByClass: { frown: 16 },
        resampleSpacingPx: 1,
        maximumSkeletonIterations: 96,
        sourceImageRgba: request.mode === "yolo-only" ? undefined : request.pixels,
        outputMode: "summary",
        classes: singleClassModel ? ["wrinkled"] : undefined,
        instanceMasks: "instanceMasks" in detection ? detection.instanceMasks : undefined,
      },
    );
    if (!baseline.lines.length || !baseline.validation.passed) {
      throw new Error("YOLO 未提取到有效皱纹中心线");
    }
    const adaptedResult = singleClassModel
      ? classifySingleClassWrinkleLines(
        baseline.lines,
        request.landmarks.map((point) => [
          point[0] * request.size,
          point[1] * request.size,
          point[2] * request.size,
        ]),
      )
      : (() => {
        const routed = routeGenericWrinkleLines(baseline.lines, request.landmarks.map((point) => [
          point[0] * request.size,
          point[1] * request.size,
          point[2] * request.size,
        ]));
        return {
          lines: routed.lines,
          rejectedLineCount: 0,
          lineCountByClass: baseline.summary.lineCountByClass,
          genericForeheadReroutedCount: routed.reclassifiedForeheadCount,
          genericFrownReroutedCount: routed.reclassifiedFrownCount,
        };
      })();
    const adaptedLines = adaptedResult.lines;
    if (singleClassModel && !adaptedLines.length) {
      throw new Error("单类别皱纹中心线未落入额头、眉间或鼻背区域");
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
      const result = await seedYoloEvidence({
        debugUnfilteredPreview: request.debugUnfilteredPreview,
        lines: adaptedLines,
        summary: {
          ...baseline.summary,
          sourceConnectedComponents: baseline.validation.renderedConnectedComponents,
          singleClassModel,
          singleClassRejectedLineCount: singleClassModel
            ? adaptedResult.rejectedLineCount : 0,
          rawDetectionCount: detection.detections.length,
          rawYoloClassMaskPixels: countActivePixels(detection.classMasks.wrinkled),
          baselineLineCount: baseline.lines.length,
          baselineRejectedComponentCount: baseline.rejectedComponents.length,
          genericForeheadReroutedCount: Number((adaptedResult as { genericForeheadReroutedCount?: number }).genericForeheadReroutedCount || 0),
          genericFrownReroutedCount: Number((adaptedResult as { genericFrownReroutedCount?: number }).genericFrownReroutedCount || 0),
          adaptedLineCount: adaptedLines.length,
          adaptedLineCountByClass: adaptedResult.lineCountByClass,
          browserBaselineSha256,
          yoloDiagnostics: detection.diagnostics || {},
          yoloScores,
        },
        size: request.size,
        landmarks: request.landmarks,
        detectorVersion: detection.version,
        cacheForRefinement: request.cacheForRefinement,
        timings: {
          modelLoadMs,
          yoloDetectionMs,
          baselineExtractionMs,
          fourRegionDetectionMs: 0,
          evidenceBuildMs: 0,
          totalMs: performance.now() - totalStart,
        },
      });
      const evidence = result.evidence;
      emit(onEvent, { type: "evidence", evidence });
      return result;
    }

    // Acquire the short-lived direct-upload ticket only after local model work,
    // so slow first-load devices cannot expire it before the image POST begins.
    const session = await providerSession();
    const provider = session.capability;
    if (onEvent) await onEvent({ type: "provider-ready", capability: provider });
    emit(onEvent, { type: "pipeline-progress", stage: "four-region" });
    const fourRegionStart = performance.now();
    const payload = await dynamicFourRegionDetection(request, adaptedLines, session);
    const fourRegionDetectionMs = performance.now() - fourRegionStart;
    const evidenceStart = performance.now();
    const displaySummary = validatedPrecomputedFineWrinkleSummary(
      payload,
      request.size,
      payload.source.imageSha256,
    );
    const evidence: LiveWrinkleWorkerEvidence = {
      lines: payload.lines,
      summary: {
        ...displaySummary,
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

  seedYoloEvidence,

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
      const profile: LiveWrinkleRefinementPerformance | undefined = request.performanceMode ? {
        forehead: null, glabellar: null, globalGuardMs: 0, noseAndVisibilityMs: 0, refinementMs: 0,
      } : undefined;
      const refineChannel = (
        seeds: typeof eligibleSeeds,
        evidence: PrecomputedFineWrinkleEvidence | null,
        channel: "forehead" | "glabellar",
      ) => channel === "glabellar" && seeds.length && evidence
        ? refineForeheadTrajectories({
          mode: "glabellar",
          seeds: seeds.map(({ seed }) => seed),
          lines: evidence.lines,
          size: request.size,
          // Solve the local glabellar bundle first.  Other facial regions are
          // checked by the merged global guard after this solve; injecting all
          // of them here clamps the nearest candidate back to its baseline.
          fixedCurves: [],
        })
        : seeds.length && evidence ? refineV6({
          seeds: seeds.map(({ seed }) => seed),
          wrinkleMask: evidence.mask,
          confidenceMap: evidence.confidence,
          directionQ: evidence.directionQ,
          size: request.size,
          faceWidthPx: request.faceWidthPx,
          options: yoloGuidedV9RstlRefinementOptions(request.faceWidthPx),
          performance: profile ? (profile[channel] = {}) : undefined,
          cacheGeometry: request.performanceMode !== "baseline",
        }) : null;
      const glabellar = refineChannel(glabellarSeeds, cachedYolo.glabellarEvidence, "glabellar");
      // Resolve the unchanged regional pipeline first; forehead treats its final
      // geometry as fixed obstacles rather than pushing it aside after the solve.
      const glabellarByIndex = new Map(glabellarSeeds.map(({ index }, i) =>
        [index, glabellar?.curves[i]]));
      const regionalGuard = guardMergedYoloGuidedRstlCurves(request.seeds,
        request.seeds.map((seed, index) => ({ name: String(seed.name || ""),
          region: String(seed.region || ""),
          pts: glabellarByIndex.get(index)?.pts || seed.pts as [number, number][] })));
      // The regional guard is retained for preparing forehead obstacles, but
      // it must not become the source geometry for glabellar curves. Its
      // conservative whole-face rollback can erase a valid local frown
      // deformation before the authoritative final global guard runs.
      const glabellarOutputByIndex = new Map(glabellarSeeds.map(({ index }, i) =>
        [index, glabellar?.curves[i]]));
      const forehead = cachedYolo.foreheadEvidence && foreheadSeeds.length
        ? refineForeheadTrajectories({ seeds: foreheadSeeds.map(({ seed }) => seed),
          lines: cachedYolo.foreheadEvidence.lines, size: request.size,
          fixedCurves: regionalGuard.curves.filter((_, i) => !isYoloGuidedForeheadSeed(request.seeds[i])) }) : null;
      const channelCurves = new Map<number, { name: string; region: string; pts: [number, number][] }>();
      foreheadSeeds.forEach(({ index }, scopedIndex) => {
        if (forehead) channelCurves.set(index, forehead.curves[scopedIndex]);
      });
      glabellarSeeds.forEach(({ index }) => {
        if (glabellar) channelCurves.set(index, glabellarOutputByIndex.get(index)!);
      });
      const scopedCurves = eligibleSeeds.map(({ seed, index }) =>
        channelCurves.get(index) || { ...seed, pts: Array.isArray(seed.pts) ? seed.pts : [] });
      const mergedCurves = mergeYoloGuidedRstlCurves(
        request.seeds,
        scopedCurves,
      );
      const guardStart = profile ? performance.now() : 0;
      const globalGuard = guardMergedYoloGuidedRstlCurves(request.seeds, mergedCurves, {
        cacheGeometry: request.performanceMode !== "baseline",
        performance: profile ? (profile.globalGuard = {}) : undefined,
      });
      if (profile) profile.globalGuardMs = performance.now() - guardStart;
      const standardCurves: LiveWrinkleWorkerCurve[] = globalGuard.curves;
      if (forehead) auditFinalForeheadAttraction(forehead,
        foreheadSeeds.map(({ index }) => ({ ...standardCurves[index], region: standardCurves[index].region || "" })), request.size);
      const foreheadAudit = reconcileYoloGuidedAuditAfterGlobalGuard(
        forehead?.audit, foreheadSeeds.map(({ index }) => index),
        globalGuard.rolledBackCurveIndices,
      );
      const glabellarAudit = reconcileYoloGuidedAuditAfterGlobalGuard(
        glabellar?.audit, glabellarSeeds.map(({ index }) => index),
        globalGuard.rolledBackCurveIndices,
      );
      const channelResults = [forehead, glabellar].filter(
        (result): result is NonNullable<typeof result> => Boolean(result),
      );
      if (!channelResults.length && !cachedYolo.noseDorsumLines.length) throw new Error("缓存中没有可用皱纹证据");
      const nonForeheadChannelResults = channelResults.filter((result) => result !== forehead);
      const noseStart = profile ? performance.now() : 0;
      const landmarks = pixelLandmarks(request);
      const noseHybrid = refineNoseHybrid({curves:standardCurves,
        lines:cachedYolo.noseDorsumLines.map(l=>({id:l.id,points:l.points as [number,number][]})),
        size:request.size, faceWidthPx:request.faceWidthPx,
        eyePolygons:[LEFT_EYE_CONTOUR,RIGHT_EYE_CONTOUR].map(indices=>indices.map(i=>landmarks[i]).filter(Boolean))});
      const directNose = noseHybrid.direct;
      const curves: LiveWrinkleWorkerCurve[] = [
        ...noseHybrid.curves,
        ...(directNose?.curves.map((curve) => ({
          name: curve.name,
          region: curve.region,
          pts: curve.pts.map((point) => [point[0], point[1]] as [number, number]),
          hiddenPointRuns: [] as Array<[number, number]>,
        })) || []),
      ];
      if (profile) profile.noseAndVisibilityMs = performance.now() - noseStart;
      const diagnostics = {
        ...glabellar?.diagnostics,
        ...forehead?.diagnostics,
        refinement_scope: YOLO_GUIDED_RSTL_SCOPE,
        refinement_scope_seed_count: eligibleSeeds.length,
        excluded_rstl_curve_count: request.seeds.length - eligibleSeeds.length,
        guidance_channels_isolated: true,
        forehead_evidence_line_count: cachedYolo.foreheadEvidence?.lines.length || 0,
        glabellar_evidence_line_count: cachedYolo.glabellarEvidence?.lines.length || 0,
        generic_forehead_rerouted_count: Number(
          cachedYolo.foreheadEvidence?.summary.genericForeheadReroutedCount ||
          cachedYolo.glabellarEvidence?.summary.genericForeheadReroutedCount || 0,
        ),
        generic_frown_rerouted_count: Number(
          cachedYolo.glabellarEvidence?.summary.genericFrownReroutedCount || 0,
        ),
        nose_bridge_evidence_line_count: cachedYolo.noseDorsumLines.length,
        forehead_multi_curve_attraction: forehead?.diagnostics.forehead_multi_curve_attraction === true,
        non_forehead_maximum_selected_rstl_curves_per_wrinkle: Math.max(0, ...nonForeheadChannelResults.map(
          (result) => Number(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle || 0),
        )),
        non_forehead_curve_unique_wrinkle_ownership: nonForeheadChannelResults.every((result) =>
          result.diagnostics.curve_unique_wrinkle_ownership === true),
        forehead_moved_curve_count: standardCurves.filter((curve, index) =>
          isYoloGuidedForeheadSeed(request.seeds[index]) &&
          JSON.stringify(curve.pts) !== JSON.stringify(request.seeds[index].pts)).length,
        glabellar_moved_curve_count: standardCurves.filter((curve, index) =>
          isYoloGuidedGlabellarSeed(request.seeds[index]) &&
          JSON.stringify(curve.pts) !== JSON.stringify(request.seeds[index].pts)).length,
        nose_bridge_moved_curve_count: noseHybrid.diagnostics.movedExistingCurveCount,
        nose_hybrid_refinement: noseHybrid.diagnostics,
        direct_nose_dorsum_generated_curve_count: directNose?.curves.length || 0,
        direct_nose_dorsum_rstl: directNose?.diagnostics || null,
        nose_root_intersection_visibility: null,
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
        glabellar_selected_curve_count: Array.isArray(glabellarAudit?.matchRecords)
          ? new Set(glabellarAudit.matchRecords.filter(
            (record: Record<string, unknown>) => record.final_accepted === true,
          ).map((record: Record<string, unknown>) => Number(record.wrinkle_segment_id))).size
          : 0,
        glabellar_match_statuses: Array.isArray(glabellarAudit?.matchRecords)
          ? glabellarAudit.matchRecords.reduce(
            (counts: Record<string, number>, record: Record<string, unknown>) => {
              const status = String(record.final_status || record.rejection_reason || "unknown");
              counts[status] = (counts[status] || 0) + 1;
              return counts;
            },
            {},
          )
          : {},
        glabellar_local_rollback_indices: (glabellar?.diagnostics as Record<string, any> | undefined)?.forehead_attraction_rollback_indices || [],
        glabellar_local_boundary_failures: (glabellar?.diagnostics as Record<string, any> | undefined)?.forehead_boundary_failures || [],
        moved_curve_count: standardCurves.filter((curve, index) =>
          JSON.stringify(curve.pts) !== JSON.stringify(request.seeds[index].pts)).length,
        moved_point_count: standardCurves.reduce((sum, curve, index) => sum + curve.pts.filter(
          (point, pointIndex) => {
            const seedPoints = Array.isArray(request.seeds[index].pts) ?
              request.seeds[index].pts as ArrayLike<number>[] : [];
            const prior = seedPoints[pointIndex];
            return prior && Math.hypot(point[0] - Number(prior[0]),
              point[1] - Number(prior[1])) > 0.05;
          },
        ).length, 0),
        global_intersection_guard_enabled: true,
        global_intersection_rollback_curve_count: globalGuard.rolledBackCurveIndices.length,
        global_intersection_rollback_curve_indices: globalGuard.rolledBackCurveIndices,
        maximum_selected_rstl_curves_per_wrinkle: Math.max(...channelResults.map((result) =>
          Number(result.diagnostics.maximum_selected_rstl_curves_per_wrinkle || 0))),
        curve_unique_wrinkle_ownership: channelResults.every((result) =>
          result.diagnostics.curve_unique_wrinkle_ownership === true),
        wrinkle_with_single_side_selected_count: nonForeheadChannelResults.reduce((sum, result) =>
          sum + Number(result.diagnostics.wrinkle_with_single_side_selected_count || 0), 0),
        nose_bridge_single_curve_selected_count: 0,
        crows_feet_single_curve_selected_count: 0,
        bundle_follower_moved_curve_count: nonForeheadChannelResults.reduce((sum, result) =>
          sum + Number(result.diagnostics.bundle_follower_moved_curve_count || 0), 0),
        curvature_fairing_enabled: glabellar ? glabellar.diagnostics.curvature_fairing_enabled === true : true,
        topology_contract_preserved: channelResults.every((result) =>
          result.diagnostics.topology_contract_preserved === true),
        post_export_new_intersection_pair_count: globalGuard.newIntersectionPairCount,
        post_export_new_self_cross_curve_count: globalGuard.newSelfCrossCurveCount,
      };
      const result: LiveWrinkleRefinementResult = {
        executionThread: "web_worker",
        detectorVersion: YOLO_WRINKLE_ONNX_VERSION,
        refinementProfile: YOLO_GUIDED_WRINKLE_REFINEMENT_PROFILE,
        refinementMs: performance.now() - refinementStart,
        noseAndVisibilityMs: 0,
        refined: {
          curves,
          diagnostics,
          audit: {
            forehead: foreheadAudit,
            glabellar: glabellarAudit,
            directNoseDorsumRstl: directNose?.diagnostics || null,
            noseRootIntersectionVisibility: null,
            globalIntersectionGuard: {
              rollbackReason: "global_intersection_guard",
              rolledBackCurveIndices: globalGuard.rolledBackCurveIndices,
            },
          },
          standardCurveCount: request.seeds.length,
        },
      };
      if (profile) {
        profile.refinementMs = result.refinementMs;
        const hashStart = performance.now();
        profile.outputHashes = await refinementOutputHashes(result.refined);
        profile.outputHashMs = performance.now() - hashStart;
        result.performance = profile;
      }
      return result;
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
