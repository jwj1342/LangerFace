import { ATLAS_VERSION, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.js";
import { validateAtlasLines } from "./geometry.js";

const BARY_EPS = 1e-3;

function atlasTopologyId(atlas) {
  return atlas?.topologyId ?? TOPOLOGY_ID;
}

function atlasTopologyVersion(atlas) {
  return atlas?.topologyVersion ?? TOPOLOGY_VERSION;
}

export function validateAtlas(
  atlas,
  numTriangles,
  {
    expectedSystem,
    expectedVersion = ATLAS_VERSION,
    expectedTopologyId,
    expectedTopologyVersion = null,
  } = {},
) {
  const issues = [];
  if (!atlas || typeof atlas !== "object") return ["图谱不是对象"];
  if (expectedSystem && atlas.system !== expectedSystem) {
    issues.push(`图谱 system=${JSON.stringify(atlas.system)}，期望 ${JSON.stringify(expectedSystem)}`);
  }
  if (expectedVersion !== null && atlas.version !== expectedVersion) {
    issues.push(`图谱 version=${JSON.stringify(atlas.version)}，期望 ${JSON.stringify(expectedVersion)}`);
  }
  if (expectedTopologyId && atlasTopologyId(atlas) !== expectedTopologyId) {
    issues.push(`图谱 topologyId=${JSON.stringify(atlasTopologyId(atlas))}，期望 ${JSON.stringify(expectedTopologyId)}`);
  }
  if (expectedTopologyVersion !== null && atlasTopologyVersion(atlas) !== expectedTopologyVersion) {
    issues.push(
      `图谱 topologyVersion=${JSON.stringify(atlasTopologyVersion(atlas))}，期望 ${JSON.stringify(expectedTopologyVersion)}`,
    );
  }
  if (!Array.isArray(atlas.lines) || atlas.lines.length === 0) {
    issues.push("图谱不含任何曲线");
    return issues;
  }

  for (const line of atlas.lines) {
    const name = line && line.name ? line.name : "<unnamed>";
    if (!Array.isArray(line?.points)) {
      issues.push(`曲线 ${name} 缺少 points`);
      continue;
    }
    if (line.points.length < 2) issues.push(`曲线 ${name} 点数 < 2`);

    for (const p of line.points) {
      if (!Array.isArray(p) || p.length < 3) {
        issues.push(`曲线 ${name} 点格式不是 [tri,u,v]`);
        continue;
      }
      const [tri, u, v] = p;
      const w = 1 - u - v;
      if (!Number.isInteger(tri) || tri < 0 || tri >= numTriangles) {
        issues.push(`曲线 ${name} 三角面索引越界`);
        break;
      }
      if (![u, v, w].every(Number.isFinite) ||
          u < -BARY_EPS || v < -BARY_EPS || w < -BARY_EPS ||
          u > 1 + BARY_EPS || v > 1 + BARY_EPS || w > 1 + BARY_EPS) {
        issues.push(`曲线 ${name} 重心坐标越界 [0,1]`);
        break;
      }
    }
  }
  return issues;
}

// 判定一份「待注入图谱」能否安全成为活动图谱。入参可为完整 atlas 对象（带 system/version/topology
// 信封，走完整 validateAtlas）或裸 lines 数组（老注入路径，仅走 validateAtlasLines 边界，无拓扑信封
// 则不校验拓扑——保持向后兼容）。返回 { ok, reason:'atlas'|'lines'|null, issues, lineList }。
// 纯函数、无 DOM/状态：供 setActiveAtlas（运行时）与单测共用——否则注入判定只活在 pipeline.js 内，
// 因其 DOM 依赖无法被 Node 覆盖（见 #65 review 的运行时分支缺测）。
export function resolveAtlasForInjection(
  atlasOrLines,
  triangles,
  { expectedSystem, expectedTopologyId, expectedTopologyVersion } = {},
) {
  const atlas = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines
    : null;
  const numTriangles = Array.isArray(triangles) ? triangles.length : 0;
  if (atlas) {
    const issues = validateAtlas(atlas, numTriangles, { expectedSystem, expectedTopologyId, expectedTopologyVersion });
    if (issues.length) return { ok: false, reason: "atlas", issues, lineList: null };
  }
  const lineList = atlas ? atlas.lines : atlasOrLines;
  if (!validateAtlasLines(lineList, triangles, { expectedTopologyId, expectedTopologyVersion })) {
    return { ok: false, reason: "lines", issues: null, lineList: null };
  }
  return { ok: true, reason: null, issues: null, lineList };
}
