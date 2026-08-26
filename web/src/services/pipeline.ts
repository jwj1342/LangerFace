import { resolveAtlasForInjection } from "./atlasContract.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import { logWarn } from "./logger.ts";
import { requestFrame } from "./pipelineLoop.ts";
import { modelState, renderState } from "./liveState.ts";
import type { Triangle } from "./softBody";
import { buildRstlSourceContract } from "./rstlSourceContract.ts";

export { ensureAssetsReady, ensureImageReady, ensureReady } from "./pipelineModels.ts";
export { handleFile, setSource, showCameraPlaceholder, startCamera, stopSource } from "./pipelineSource.ts";
export { cancelFrame, detectHands, loop, redrawPausedFrame, requestFrame } from "./pipelineLoop.ts";

function requestRedraw(): void {
  requestFrame();
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
  const payload = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines
    : {
      system,
      topologyId: expectedTopologyId,
      topologyVersion: expectedTopologyVersion,
      provenance: "runtime_lines_unattributed",
      lines: res.lineList,
    };
  modelState.atlasContracts[system] = buildRstlSourceContract(payload, {
    provenance: "runtime_lines_unattributed",
    topologyId: expectedTopologyId,
    topologyVersion: expectedTopologyVersion,
  });
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
  modelState.atlasContracts[system] = modelState.officialAtlasContracts[system];
  requestRedraw();
  return true;
}
