import { ATLAS_VERSION, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import { validateAtlasLines } from "./geometryAtlas.ts";
import type { Triangle } from "./softBody";

const BARY_EPS = 1e-3;

export interface AtlasPointLine {
  name?: string;
  region?: string;
  points?: Array<[number, number, number]>;
}

export interface AtlasContractPayload {
  system?: string;
  version?: string;
  topologyId?: string;
  topologyVersion?: string;
  lines?: AtlasPointLine[];
}

export interface ValidateAtlasOptions {
  expectedSystem?: string;
  expectedVersion?: string | null;
  expectedTopologyId?: string;
  expectedTopologyVersion?: string | null;
}

export interface ResolveAtlasOptions {
  expectedSystem?: string;
  expectedTopologyId?: string;
  expectedTopologyVersion?: string;
}

export type ResolveAtlasFailureReason = "atlas" | "lines";

export interface ResolveAtlasForInjectionResult {
  ok: boolean;
  reason: ResolveAtlasFailureReason | null;
  issues: string[] | null;
  lineList: AtlasPointLine[] | null;
}

function atlasTopologyId(atlas: AtlasContractPayload): string {
  return atlas.topologyId ?? TOPOLOGY_ID;
}

function atlasTopologyVersion(atlas: AtlasContractPayload): string {
  return atlas.topologyVersion ?? TOPOLOGY_VERSION;
}

export function validateAtlas(
  atlas: unknown,
  numTriangles: number,
  {
    expectedSystem,
    expectedVersion = ATLAS_VERSION,
    expectedTopologyId,
    expectedTopologyVersion = null,
  }: ValidateAtlasOptions = {},
): string[] {
  const issues: string[] = [];
  if (!atlas || typeof atlas !== "object") return ["图谱不是对象"];
  const payload = atlas as AtlasContractPayload;
  if (expectedSystem && payload.system !== expectedSystem) {
    issues.push(`图谱 system=${JSON.stringify(payload.system)}，期望 ${JSON.stringify(expectedSystem)}`);
  }
  if (expectedVersion !== null && payload.version !== expectedVersion) {
    issues.push(`图谱 version=${JSON.stringify(payload.version)}，期望 ${JSON.stringify(expectedVersion)}`);
  }
  if (expectedTopologyId && atlasTopologyId(payload) !== expectedTopologyId) {
    issues.push(`图谱 topologyId=${JSON.stringify(atlasTopologyId(payload))}，期望 ${JSON.stringify(expectedTopologyId)}`);
  }
  if (expectedTopologyVersion !== null && atlasTopologyVersion(payload) !== expectedTopologyVersion) {
    issues.push(
      `图谱 topologyVersion=${JSON.stringify(atlasTopologyVersion(payload))}，期望 ${JSON.stringify(expectedTopologyVersion)}`,
    );
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    issues.push("图谱不含任何曲线");
    return issues;
  }

  for (const line of payload.lines) {
    const name = line && line.name ? line.name : "<unnamed>";
    if (!Array.isArray(line?.points)) {
      issues.push(`曲线 ${name} 缺少 points`);
      continue;
    }
    if (line.points.length < 2) issues.push(`曲线 ${name} 点数 < 2`);

    for (const point of line.points) {
      if (!Array.isArray(point) || point.length < 3) {
        issues.push(`曲线 ${name} 点格式不是 [tri,u,v]`);
        continue;
      }
      const [tri, u, v] = point;
      const w = 1 - u - v;
      if (!Number.isInteger(tri) || tri < 0 || tri >= numTriangles) {
        issues.push(`曲线 ${name} 三角面索引越界`);
        break;
      }
      if (![u, v, w].every(Number.isFinite)
        || u < -BARY_EPS
        || v < -BARY_EPS
        || w < -BARY_EPS
        || u > 1 + BARY_EPS
        || v > 1 + BARY_EPS
        || w > 1 + BARY_EPS) {
        issues.push(`曲线 ${name} 重心坐标越界 [0,1]`);
        break;
      }
    }
  }
  return issues;
}

export function resolveAtlasForInjection(
  atlasOrLines: AtlasContractPayload | AtlasPointLine[] | unknown,
  triangles: Triangle[],
  { expectedSystem, expectedTopologyId, expectedTopologyVersion }: ResolveAtlasOptions = {},
): ResolveAtlasForInjectionResult {
  const atlas = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines as AtlasContractPayload
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
  return { ok: true, reason: null, issues: null, lineList: lineList as AtlasPointLine[] };
}
