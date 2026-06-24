// 资产加载 + MediaPipe 模型初始化：拉取拓扑/图谱资产，构建 FaceLandmarker /
// HandLandmarker（含 GPU→CPU 回退）。从 pipeline.js 原样拆出（SRP，见 #45）。
import { FaceLandmarker, HandLandmarker, FilesetResolver }
  from "@mediapipe/tasks-vision";
import { validateAtlas } from "../atlas_contract.js";
import { assetUrls } from "../assets.js";
import { CDN, TOPOLOGY_ID, TOPOLOGY_VERSION } from "../constants.js";
import { els } from "../dom.js";
import { noseTriangles } from "../geometry.js";
import { countMetric, logInfo, logWarn, setAssetVersions } from "../logger.js";
import { modelState } from "../state.js";

// ── 资产 / 模型加载 ───────────────────────────────────────────────────────────
export async function ensureReady() {
  if (modelState.landmarker) return;
  const [topology, rstl, langer] = await Promise.all([
    fetch(assetUrls.topology).then((r) => r.json()),
    fetch(assetUrls.atlasRstl).then((r) => r.json()),
    fetch(assetUrls.atlasLanger).then((r) => r.json()),
  ]);
  const tri = Array.isArray(topology) ? topology : topology.triangles;
  const topologyId = topology?.topologyId ?? TOPOLOGY_ID;
  const topologyVersion = topology?.topologyVersion ?? TOPOLOGY_VERSION;
  const loadAtlas = (system, atlas) => {
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
  modelState.topology = { ...topology, topologyId, topologyVersion, triangles: tri };
  modelState.triangles = tri; modelState.noseTris = noseTriangles(tri);
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
  const build = (delegate) => FaceLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.faceLandmarkerTask, delegate },
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,  // jawOpen 等驱动实时孪生表情/张嘴
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { modelState.landmarker = await build("GPU"); }
  catch (e) {
    countMetric("faceLandmarker.gpuFallback");
    logWarn("Face Landmarker GPU 初始化失败，回退到 CPU。", e);
    modelState.landmarker = await build("CPU");
  }

  // 手部检测器（用于前方手部遮挡）。失败不阻塞主流程。
  const buildHand = (delegate) => HandLandmarker.createFromOptions(resolver, {
    baseOptions: { modelAssetPath: assetUrls.handLandmarkerTask, delegate },
    runningMode: "VIDEO", numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { modelState.handLandmarker = await buildHand("GPU"); }
  catch (e) {
    countMetric("handLandmarker.gpuFallback");
    logWarn("Hand Landmarker GPU 初始化失败，回退到 CPU。", e);
    try { modelState.handLandmarker = await buildHand("CPU"); }
    catch (err) {
      countMetric("handLandmarker.loadFailure");
      logWarn("手部模型加载失败，手部遮挡功能将暂不可用。", err);
    }
  }

  els.badge.textContent = "模型就绪"; els.badge.classList.remove("loading");
  logInfo("模型与图谱加载完成。", {
    triangles: tri.length,
    rstlLines: rstl.lines.length,
    langerLines: langer.lines.length,
    handOcclusionReady: Boolean(modelState.handLandmarker),
  });
}
