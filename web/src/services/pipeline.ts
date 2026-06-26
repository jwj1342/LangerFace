import { resolveAtlasForInjection } from "../../atlas_contract.js";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "../../constants.js";
import { logWarn } from "../../logger.js";
import { loop } from "../../pipeline/loop.js";
import { modelState, renderState, sourceState } from "../../state.js";
import type { Triangle } from "./softBody";

export { ensureReady } from "../../pipeline/models.js";
export { handleFile, setSource, showCameraPlaceholder, startCamera, stopSource } from "../../pipeline/source.js";
export { detectHands, loop, requestFrame } from "../../pipeline/loop.js";

function requestRedraw(): void {
  if (sourceState.running && !sourceState.paused) requestAnimationFrame(loop);
}

function isSupportedAtlasSystem(system: string): system is "rstl" | "langer" {
  return system === "rstl" || system === "langer";
}

interface TopologyState {
  topologyId?: string;
  topologyVersion?: string;
}

export function setActiveAtlas(system: string, atlasOrLines: unknown): boolean {
  if (!isSupportedAtlasSystem(system)) {
    logWarn("拒绝注入未知图谱系统。", { system });
    return false;
  }
  const topology = modelState.topology as TopologyState | null;
  const expectedTopologyId = topology?.topologyId ?? TOPOLOGY_ID;
  const expectedTopologyVersion = topology?.topologyVersion ?? TOPOLOGY_VERSION;
  const res = resolveAtlasForInjection(atlasOrLines, modelState.triangles as Triangle[], {
    expectedSystem: system,
    expectedTopologyId,
    expectedTopologyVersion,
  });
  if (!res.ok || !res.lineList) {
    logWarn("拒绝注入无效图谱。", { system, reason: res.reason, issues: res.issues });
    return false;
  }
  modelState.atlases[system] = res.lineList;
  renderState.system = system;
  requestRedraw();
  return true;
}

export function restoreOfficialAtlas(system: string): boolean {
  if (!isSupportedAtlasSystem(system) || !modelState.officialAtlases[system]) {
    logWarn("无法恢复官方图谱。", { system });
    return false;
  }
  modelState.atlases[system] = modelState.officialAtlases[system];
  requestRedraw();
  return true;
}
