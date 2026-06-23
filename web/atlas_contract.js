import { ATLAS_VERSION } from "./constants.js";

const BARY_EPS = 1e-3;

export function validateAtlas(atlas, numTriangles, { expectedSystem, expectedVersion = ATLAS_VERSION } = {}) {
  const issues = [];
  if (!atlas || typeof atlas !== "object") return ["图谱不是对象"];
  if (expectedSystem && atlas.system !== expectedSystem) {
    issues.push(`图谱 system=${JSON.stringify(atlas.system)}，期望 ${JSON.stringify(expectedSystem)}`);
  }
  if (expectedVersion !== null && atlas.version !== expectedVersion) {
    issues.push(`图谱 version=${JSON.stringify(atlas.version)}，期望 ${JSON.stringify(expectedVersion)}`);
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
