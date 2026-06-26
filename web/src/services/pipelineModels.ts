import { FaceLandmarker, FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

import { validateAtlas } from "./atlasContract.ts";
import { assetUrls } from "./assetLoader.ts";
import { CDN, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import { els } from "./liveDom.ts";
import { noseTriangles } from "./geometryAtlas.ts";
import type { Triangle } from "./softBody.ts";
import { countMetric, logInfo, logWarn, setAssetVersions } from "./logger.ts";
import { modelState } from "./liveState.ts";

type Delegate = "GPU" | "CPU";
type TopologyPayload = {
  topologyId?: string;
  topologyVersion?: string;
  triangles?: Triangle[];
};
type AtlasPayload = {
  version?: string;
  lines: unknown[];
};

export async function ensureReady(): Promise<void> {
  if (modelState.landmarker) return;
  const [topologyRaw, rstlRaw, langerRaw] = await Promise.all([
    fetch(assetUrls.topology).then((response) => response.json()),
    fetch(assetUrls.atlasRstl).then((response) => response.json()),
    fetch(assetUrls.atlasLanger).then((response) => response.json()),
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
  setAssetVersions({
    topology: topologyId,
    topologyVersion,
    triangles: tri.length,
    rstlAtlasVersion: rstl.version ?? "unknown",
    langerAtlasVersion: langer.version ?? "unknown",
    faceLandmarker: "mediapipe/tasks-vision@0.10.35",
    handLandmarker: "mediapipe/tasks-vision@0.10.35",
  });
  const resolver = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
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

  els.badge.textContent = "模型就绪";
  els.badge.classList.remove("loading");
  logInfo("模型与图谱加载完成。", {
    triangles: tri.length,
    rstlLines: rstl.lines.length,
    langerLines: langer.lines.length,
    handOcclusionReady: Boolean(modelState.handLandmarker),
  });
}
