// 浏览器实时管线（facade / barrel）：摄像头/上传 → MediaPipe FaceLandmarker(客户端) →
// 平滑 → 图谱映射 → 背面剔除 + 手部遮挡 → 画布叠加。
//
// 本文件原为 ~166 行总控文件，按 SRP 拆分为（见 #45）：
//   - ./pipeline/models.js —— 资产加载 + MediaPipe(Face/Hand) 初始化（ensureReady）。
//   - ./pipeline/source.js —— 数据源管理（startCamera/handleFile/setSource/stopSource/showCameraPlaceholder）。
//   - ./pipeline/loop.js   —— 主循环 + 渲染调度 + FPS + 手部遮挡检测（loop/requestFrame/detectHands）。
// 这里仅保留「图谱注入」职责（setActiveAtlas/restoreOfficialAtlas），并把上述模块的公开 API
// 原样再导出，使所有 importer（liveRuntime / mode3d …）无需改动其 import 路径。
//
// 后续（本 PR 之外、留给评审）：state.js 的裸可变单例改为受控接口（setter / 不变量保护），
// 以及彻底打破 mode3d → 源控制 的反向依赖（mode3d 已可改为直接依赖 ./pipeline/source.js）。
import { resolveAtlasForInjection } from "./atlas_contract.js";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.js";
import { logWarn } from "./logger.js";
import { modelState, renderState, sourceState } from "./state.js";
import { loop } from "./pipeline/loop.js";

export { ensureReady } from "./pipeline/models.js";
export { handleFile, setSource, showCameraPlaceholder, startCamera, stopSource } from "./pipeline/source.js";
export { detectHands, loop, requestFrame } from "./pipeline/loop.js";

// ── 图谱注入 ──────────────────────────────────────────────────────────────────
function requestRedraw() {
  if (sourceState.running && !sourceState.paused) requestAnimationFrame(loop);
}

function isSupportedAtlasSystem(system) {
  return system === "rstl" || system === "langer";
}

export function setActiveAtlas(system, atlasOrLines) {
  if (!isSupportedAtlasSystem(system)) {
    logWarn("拒绝注入未知图谱系统。", { system });
    return false;
  }
  const expectedTopologyId = modelState.topology?.topologyId ?? TOPOLOGY_ID;
  const expectedTopologyVersion = modelState.topology?.topologyVersion ?? TOPOLOGY_VERSION;
  const res = resolveAtlasForInjection(atlasOrLines, modelState.triangles, {
    expectedSystem: system,
    expectedTopologyId,
    expectedTopologyVersion,
  });
  if (!res.ok) {
    logWarn("拒绝注入无效图谱。", { system, reason: res.reason, issues: res.issues });
    return false;
  }
  modelState.atlases[system] = res.lineList;
  renderState.system = system;
  requestRedraw();
  return true;
}

export function restoreOfficialAtlas(system) {
  if (!isSupportedAtlasSystem(system) || !modelState.officialAtlases[system]) {
    logWarn("无法恢复官方图谱。", { system });
    return false;
  }
  modelState.atlases[system] = modelState.officialAtlases[system];
  requestRedraw();
  return true;
}
