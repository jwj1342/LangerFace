export const V6_EXPECTED_CURVE_COUNT = 216;
export const V6_ALGORITHM = "interval-guarded-continuous-polyline-rstl-refinement-6.0";

export type V6Point = [number, number, ...number[]];

export interface V6ResultLine {
  name?: string;
  points_prior_xy: V6Point[];
  points_xy: V6Point[];
  [key: string]: unknown;
}

export interface V6Diagnostics {
  algorithm?: string;
  topology_contract_preserved?: boolean;
  post_export_new_intersection_pair_count?: number;
  post_export_new_self_cross_curve_count?: number;
  soft_link_max_gap_px?: number;
  displacement_p90_limit_px?: number;
  mean_matched_distance_improvement_px?: number;
  mean_direction_improvement_degrees?: number;
  [key: string]: unknown;
}

export interface V6ResultPayload {
  lines: V6ResultLine[];
  diagnostics?: V6Diagnostics;
  [key: string]: unknown;
}

export interface V6ValidationMetrics {
  curveCount: number;
  pointCount: number;
  movedCurveCount: number;
  movedPointCount: number;
  movedPointRatio: number;
  p90Px: number;
  maxPx: number;
  softLinkPx: number;
  p90LimitPx: number;
  distanceGainPx: number;
  directionGainDeg: number;
  topologyPreserved: boolean;
}

export interface V6ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  lines: V6ResultLine[];
  metrics: V6ValidationMetrics;
}

export interface V6DisplacementSample {
  prior: V6Point;
  final: V6Point;
  distance: number;
}

const finitePoint = (point: unknown): point is V6Point => Array.isArray(point) && point.length >= 2
  && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

const validLine = (value: unknown): value is V6ResultLine => {
  if (!isRecord(value)) return false;
  return Array.isArray(value.points_prior_xy) && Array.isArray(value.points_xy);
};

export function percentile(values: readonly number[] | null | undefined, fraction: number): number {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

export function validateV6Result(payload: unknown): V6ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const payloadRecord = isRecord(payload) ? payload : {};
  const rawLines = Array.isArray(payloadRecord.lines) ? payloadRecord.lines : [];
  const lines = rawLines.filter(validLine);
  if (rawLines.length !== lines.length) errors.push("lines 中包含无效曲线对象");
  if (!lines.length) errors.push("JSON 中没有 lines 数组");
  if (lines.length && lines.length !== V6_EXPECTED_CURVE_COUNT) {
    errors.push(`曲线数为 ${lines.length}，预期 ${V6_EXPECTED_CURVE_COUNT}`);
  }

  const names = new Set<string>();
  let pointCount = 0;
  let movedPointCount = 0;
  let movedCurveCount = 0;
  const offsets: number[] = [];
  lines.forEach((line, curveIndex) => {
    const name = String(line?.name || `curve_${curveIndex}`);
    if (names.has(name)) errors.push(`曲线名称重复：${name}`);
    names.add(name);
    const prior = line?.points_prior_xy;
    const final = line?.points_xy;
    if (!Array.isArray(prior) || !Array.isArray(final)) {
      errors.push(`${name} 缺少 points_prior_xy 或 points_xy`);
      return;
    }
    if (prior.length !== final.length) {
      errors.push(`${name} 的微调前后点数不一致`);
      return;
    }
    let curveMoved = false;
    for (let pointIndex = 0; pointIndex < prior.length; pointIndex += 1) {
      if (!finitePoint(prior[pointIndex]) || !finitePoint(final[pointIndex])) {
        errors.push(`${name} 含无效二维点`);
        break;
      }
      const distance = Math.hypot(
        Number(final[pointIndex][0]) - Number(prior[pointIndex][0]),
        Number(final[pointIndex][1]) - Number(prior[pointIndex][1]),
      );
      pointCount += 1;
      offsets.push(distance);
      if (distance > 0.05) {
        movedPointCount += 1;
        curveMoved = true;
      }
    }
    if (curveMoved) movedCurveCount += 1;
  });

  const diagnostics = isRecord(payloadRecord.diagnostics)
    ? payloadRecord.diagnostics as V6Diagnostics
    : {};
  if (diagnostics.algorithm && diagnostics.algorithm !== V6_ALGORITHM) {
    warnings.push(`算法标识不是 V6：${diagnostics.algorithm}`);
  }
  if (diagnostics.topology_contract_preserved === false) {
    errors.push("结果诊断报告拓扑未保持");
  }
  if (Number(diagnostics.post_export_new_intersection_pair_count || 0) > 0) {
    errors.push("导出后存在新增曲线交叉");
  }
  if (Number(diagnostics.post_export_new_self_cross_curve_count || 0) > 0) {
    errors.push("导出后存在新增自交曲线");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    lines,
    metrics: {
      curveCount: lines.length,
      pointCount,
      movedCurveCount,
      movedPointCount,
      movedPointRatio: pointCount ? movedPointCount / pointCount : 0,
      p90Px: percentile(offsets.filter((value) => value > 0.05), 0.9),
      maxPx: offsets.length ? Math.max(...offsets) : 0,
      softLinkPx: Number(diagnostics.soft_link_max_gap_px || 0),
      p90LimitPx: Number(diagnostics.displacement_p90_limit_px || 0),
      distanceGainPx: Number(diagnostics.mean_matched_distance_improvement_px || 0),
      directionGainDeg: Number(diagnostics.mean_direction_improvement_degrees || 0),
      topologyPreserved: diagnostics.topology_contract_preserved !== false,
    },
  };
}

export function resultExtent(
  lines: readonly V6ResultLine[] | null | undefined,
  fallback = 768,
): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const line of lines || []) {
    for (const points of [line?.points_prior_xy, line?.points_xy]) {
      for (const point of points || []) {
        if (!finitePoint(point)) continue;
        maxX = Math.max(maxX, Number(point[0]));
        maxY = Math.max(maxY, Number(point[1]));
      }
    }
  }
  return {
    width: Math.max(1, Math.ceil(maxX || fallback)),
    height: Math.max(1, Math.ceil(maxY || fallback)),
  };
}

export function displacementSamples(
  line: V6ResultLine | null | undefined,
  minimumPx = 0.25,
  targetCount = 14,
): V6DisplacementSample[] {
  const prior = line?.points_prior_xy || [];
  const final = line?.points_xy || [];
  const count = Math.min(prior.length, final.length);
  const stride = Math.max(1, Math.floor(count / targetCount));
  const samples: V6DisplacementSample[] = [];
  for (let index = 0; index < count; index += stride) {
    if (!finitePoint(prior[index]) || !finitePoint(final[index])) continue;
    const distance = Math.hypot(final[index][0] - prior[index][0], final[index][1] - prior[index][1]);
    if (distance >= minimumPx) samples.push({ prior: prior[index], final: final[index], distance });
  }
  return samples;
}
