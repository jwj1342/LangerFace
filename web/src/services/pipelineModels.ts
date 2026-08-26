import { FaceLandmarker, HandLandmarker } from "@mediapipe/tasks-vision";

import { validateAtlas } from "./atlasContract.ts";
import { assetUrls } from "./assetLoader.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import { dataSource } from "./dataSource.ts";
import { noseTriangles } from "./geometryAtlas.ts";
import type { Triangle } from "./softBody.ts";
import { countMetric, logInfo, logWarn, recordMetricSample, setAssetVersions } from "./logger.ts";
import { modelState } from "./liveState.ts";
import { buildRstlSourceContract } from "./rstlSourceContract.ts";

type Delegate = "GPU" | "CPU";
type VisionWasmFileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];
type TopologyPayload = {
  topologyId?: string;
  topologyVersion?: string;
  triangles?: Triangle[];
};
type AtlasPayload = {
  version?: string;
  atlasVersion?: string;
  lines: unknown[];
};

let readyPromise: Promise<void> | null = null;
let imageReadyPromise: Promise<void> | null = null;
let assetsReadyPromise: Promise<void> | null = null;
const localVisionWasmFileset: VisionWasmFileset = {
  wasmLoaderPath: new URL(
    "../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js",
    import.meta.url,
  ).href,
  wasmBinaryPath: new URL(
    "../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm",
    import.meta.url,
  ).href,
};
let visionResolver: VisionWasmFileset | null = null;

async function initializeAssetsReady(): Promise<void> {
  const startedAt = performance.now();
  const [topologyRaw, rstlRaw, langerRaw] = await Promise.all([
    dataSource.loadTopology("mediapipe-468"),
    dataSource.loadAtlas("rstl"),
    dataSource.loadAtlas("langer"),
  ]);
  const topology = topologyRaw as TopologyPayload | Triangle[];
  const rstl = rstlRaw as AtlasPayload;
  const langer = langerRaw as AtlasPayload;
  const tri = (Array.isArray(topology) ? topology : topology.triangles) as Triangle[];
  const topologyId = (!Array.isArray(topology) && topology?.topologyId) || TOPOLOGY_ID;
  const topologyVersion = (!Array.isArray(topology) && topology?.topologyVersion) || TOPOLOGY_VERSION;
  const loadAtlas = (system: string, atlas: AtlasPayload) => {
    const issues = validateAtlas(
      atlas,
      tri.length,
      { expectedSystem: system, expectedTopologyId: topologyId, expectedTopologyVersion: topologyVersion },
    );
    if (issues.length) {
      logWarn(`图谱 ${system} 校验失败。`, { issues });
      throw new Error(`图谱 ${system} 校验失败：${issues.join("；")}`);
    }
    return atlas.lines;
  };
  modelState.topology = { ...(Array.isArray(topology) ? {} : topology), topologyId, topologyVersion, triangles: tri };
  modelState.triangles = tri;
  modelState.noseTris = noseTriangles(tri);
  modelState.atlases.rstl = loadAtlas("rstl", rstl);
  modelState.atlases.langer = loadAtlas("langer", langer);
  modelState.officialAtlases.rstl = modelState.atlases.rstl;
  modelState.officialAtlases.langer = modelState.atlases.langer;
  modelState.atlasContracts.rstl = buildRstlSourceContract(rstl, { provenance: "bundled_standard_rstl_prior" });
  modelState.atlasContracts.langer = buildRstlSourceContract(langer, { provenance: "bundled_standard_langer_prior" });
  modelState.officialAtlasContracts.rstl = modelState.atlasContracts.rstl;
  modelState.officialAtlasContracts.langer = modelState.atlasContracts.langer;
  setAssetVersions({
    topology: topologyId,
    topologyVersion,
    triangles: tri.length,
    rstlAtlasVersion: rstl.atlasVersion ?? rstl.version ?? "unknown",
    langerAtlasVersion: langer.atlasVersion ?? langer.version ?? "unknown",
    faceLandmarker: "mediapipe/tasks-vision@0.10.35",
    handLandmarker: "mediapipe/tasks-vision@0.10.35",
  });
  visionResolver = localVisionWasmFileset;
  recordMetricSample("model.assetsAndVisionReadyMs", performance.now() - startedAt);
  logInfo("图谱与 MediaPipe Vision 运行时加载完成。", {
    triangles: tri.length,
    rstlLines: rstl.lines.length,
    langerLines: langer.lines.length,
  });
}

export function ensureAssetsReady(): Promise<void> {
  if (assetsReadyPromise) return assetsReadyPromise;
  if (visionResolver && modelState.triangles?.length) return Promise.resolve();
  assetsReadyPromise = initializeAssetsReady().catch((error: unknown) => {
    assetsReadyPromise = null;
    visionResolver = null;
    throw error;
  });
  return assetsReadyPromise;
}

async function initializeReady(): Promise<void> {
  await ensureAssetsReady();
  if (!visionResolver) throw new Error("MediaPipe Vision 运行时尚未就绪");
  const resolver = visionResolver;
  const build = (delegate: Delegate) => FaceLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.faceLandmarkerTask, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    modelState.landmarker = await build("GPU");
  } catch (error) {
    countMetric("faceLandmarker.gpuFallback");
    logWarn("Face Landmarker GPU 初始化失败，回退到 CPU。", error);
    modelState.landmarker = await build("CPU");
  }

  const buildHand = (delegate: Delegate) => HandLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.handLandmarkerTask, delegate },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    modelState.handLandmarker = await buildHand("GPU");
  } catch (error) {
    countMetric("handLandmarker.gpuFallback");
    logWarn("Hand Landmarker GPU 初始化失败，回退到 CPU。", error);
    try {
      modelState.handLandmarker = await buildHand("CPU");
    } catch (err) {
      countMetric("handLandmarker.loadFailure");
      logWarn("手部模型加载失败，手部遮挡功能将暂不可用。", err);
    }
  }

  logInfo("连续帧 MediaPipe 模型加载完成。", {
    handOcclusionReady: Boolean(modelState.handLandmarker),
  });
}

export function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  if (modelState.landmarker) return Promise.resolve();
  readyPromise = initializeReady().catch((error: unknown) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}

async function initializeImageFaceReady(): Promise<void> {
  if (modelState.imageLandmarker) return;
  if (!visionResolver) throw new Error("MediaPipe Vision 运行时尚未就绪");
  const build = (delegate: Delegate) => FaceLandmarker.createFromOptions(visionResolver!, {
    baseOptions: { modelAssetPath: assetUrls.faceLandmarkerTask, delegate },
    runningMode: "IMAGE",
    numFaces: 2,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
  });
  try {
    modelState.imageLandmarker = await build("GPU");
  } catch (error) {
    countMetric("faceLandmarker.imageGpuFallback");
    logWarn("静态图片 Face Landmarker GPU 初始化失败，回退到 CPU。", error);
    modelState.imageLandmarker = await build("CPU");
  }
}

async function initializeImageHandReady(): Promise<void> {
  if (modelState.imageHandLandmarker) return;
  if (!visionResolver) throw new Error("MediaPipe Vision 运行时尚未就绪");
  const buildHand = (delegate: Delegate) => HandLandmarker.createFromOptions(visionResolver!, {
    baseOptions: { modelAssetPath: assetUrls.handLandmarkerTask, delegate },
    runningMode: "IMAGE",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
  });
  try {
    modelState.imageHandLandmarker = await buildHand("GPU");
  } catch (error) {
    countMetric("handLandmarker.imageGpuFallback");
    logWarn("静态图片 Hand Landmarker GPU 初始化失败，回退到 CPU。", error);
    try {
      modelState.imageHandLandmarker = await buildHand("CPU");
    } catch (err) {
      countMetric("handLandmarker.imageLoadFailure");
      logWarn("静态图片手部模型加载失败，照片手部遮挡功能将暂不可用。", err);
    }
  }
}

async function initializeImageReady(): Promise<void> {
  const startedAt = performance.now();
  await ensureAssetsReady();
  const modelStartedAt = performance.now();
  await Promise.all([
    initializeImageFaceReady(),
    initializeImageHandReady(),
  ]);
  const completedAt = performance.now();
  recordMetricSample("model.imageFaceAndHandReadyMs", completedAt - modelStartedAt);
  recordMetricSample("model.imageColdReadyMs", completedAt - startedAt);
  logInfo("静态图片 MediaPipe 模型加载完成。", {
    handOcclusionReady: Boolean(modelState.imageHandLandmarker),
    elapsedMs: Math.round(completedAt - startedAt),
  });
}

export function ensureImageReady(): Promise<void> {
  if (imageReadyPromise) return imageReadyPromise;
  if (modelState.imageLandmarker) return Promise.resolve();
  imageReadyPromise = initializeImageReady().catch((error: unknown) => {
    imageReadyPromise = null;
    throw error;
  });
  return imageReadyPromise;
}
