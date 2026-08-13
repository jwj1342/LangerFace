import { mapAtlas, type AtlasLine, type MappedAtlasLine } from "./geometryAtlas.ts";
import {
  buildForeheadSkinVisibility,
  type VisibilityPredicate,
} from "./foreheadVisibility.ts";
import { mapSurfaceRefs, pointToSurfaceRef, polylineToSurfaceRefs, type SurfaceRef } from "./incisionOverlay.ts";
import { buildRstlRenderPlan, standardRstlStrokeWidth } from "./rstlRenderPlan.ts";
import { segmentsIntersect2d, type Point2 } from "./incisionPathGeometry.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

export const INCISION_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const INCISION_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

export function incisionPhotoStrokeWidths(sourceWidth: number) {
  const rstl = standardRstlStrokeWidth(sourceWidth);
  const candidate = Math.max(0.75, rstl * 0.5);
  const boundary = Math.max(0.75, rstl * 0.45);
  return {
    rstl,
    candidate,
    candidateHalo: candidate + Math.max(0.5, candidate * 0.5),
    boundary,
    boundaryHalo: boundary + Math.max(0.5, boundary * 0.5),
  };
}

export const incisionPhotoEndpointRadius = (candidateStrokeWidth: number): number =>
  Math.max(0.5, candidateStrokeWidth * 0.75);

export interface IncisionPhotoGeometry {
  rstl: MappedAtlasLine[];
  center: Vec3 | null;
  diameterEstimate: Vec3[];
  boundary: Vec3[];
  candidate: Vec3[];
  endpoints: Vec3[];
  candidateProjection: {
    valid: boolean;
    reasonCodes: string[];
  };
}

export interface IncisionPhotoRenderInput {
  context: CanvasRenderingContext2D;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  devicePixelRatio: number;
  landmarks: Vec3[];
  triangles: Triangle[];
  atlasLines: AtlasLine[] | unknown;
  centerRef: SurfaceRef | null;
  diameterEstimateRefs?: SurfaceRef[];
  boundaryRefs: SurfaceRef[];
  candidateRefs: SurfaceRef[];
  endpointRefs: SurfaceRef[];
  endpointRadius?: number;
  tumorInputInvalid?: boolean;
  candidateType?: string;
}

export function inspectPhotoCandidateProjection(
  points: readonly Vec3[],
  candidateType?: string,
): { valid: boolean; reasonCodes: string[] } {
  if (candidateType !== "fusiform" || points.length === 0) return { valid: true, reasonCodes: [] };
  const polygon = points.map((point) => [point[0], point[1]] as Point2);
  if (polygon.length > 1 && Math.hypot(
    polygon[0][0] - polygon.at(-1)![0],
    polygon[0][1] - polygon.at(-1)![1],
  ) < 1e-6) polygon.pop();
  const reasonCodes: string[] = [];
  const unique = new Set(polygon.map((point) => `${point[0].toFixed(4)}:${point[1].toFixed(4)}`));
  if (unique.size < 6) reasonCodes.push("candidate_projection_collapsed");
  const area = Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
  if (!(area >= 1)) reasonCodes.push("candidate_projection_degenerate_area");
  const segmentLengths = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]);
  }).filter((length) => length > 1e-6).sort((a, b) => a - b);
  const median = segmentLengths[Math.floor(segmentLengths.length / 2)] || 0;
  if (median > 0 && (segmentLengths.at(-1) || 0) > median * 12) {
    reasonCodes.push("candidate_projection_discontinuous");
  }
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect2d(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) {
        reasonCodes.push("candidate_projection_self_intersection");
        first = polygon.length;
        break;
      }
    }
  }

  // A generated fusiform has two corresponding sides between the same tips.
  // Validate those sides separately so pinches and local reversals that stop
  // just short of a literal self-intersection are still rejected.
  if (polygon.length >= 8 && polygon.length % 2 === 0) {
    const farTipIndex = polygon.length / 2;
    const upper = polygon.slice(0, farTipIndex + 1);
    const lower = [polygon[0], ...polygon.slice(farTipIndex + 1).reverse(), polygon[farTipIndex]];
    const widths = upper.map((point, index) => Math.hypot(
      point[0] - lower[index][0],
      point[1] - lower[index][1],
    ));
    const maxWidth = Math.max(...widths);
    const centralWidths = widths.slice(
      Math.max(1, Math.floor(widths.length * 0.25)),
      Math.min(widths.length - 1, Math.ceil(widths.length * 0.75)),
    );
    if (maxWidth > 1 && centralWidths.length && Math.min(...centralWidths) < maxWidth * 0.12) {
      reasonCodes.push("candidate_projection_pinched");
    }

    const tipAxis = [
      polygon[farTipIndex][0] - polygon[0][0],
      polygon[farTipIndex][1] - polygon[0][1],
    ];
    const tipAxisLength2 = tipAxis[0] ** 2 + tipAxis[1] ** 2;
    if (tipAxisLength2 > 1) {
      const centerlineProgress = upper.map((point, index) => {
        const midpoint = [(point[0] + lower[index][0]) / 2, (point[1] + lower[index][1]) / 2];
        return ((midpoint[0] - polygon[0][0]) * tipAxis[0]
          + (midpoint[1] - polygon[0][1]) * tipAxis[1]) / tipAxisLength2;
      });
      if (centerlineProgress.some((value, index) => index > 1
        && index < centerlineProgress.length - 1
        && value < centerlineProgress[index - 1] - 0.04)) {
        reasonCodes.push("candidate_projection_local_fold");
      }
    }

    for (const side of [upper, lower]) {
      for (let index = 2; index < side.length - 2; index += 1) {
        const before = [side[index][0] - side[index - 1][0], side[index][1] - side[index - 1][1]];
        const after = [side[index + 1][0] - side[index][0], side[index + 1][1] - side[index][1]];
        const denom = Math.hypot(...before) * Math.hypot(...after);
        if (denom > 1e-6 && (before[0] * after[0] + before[1] * after[1]) / denom < -0.2) {
          reasonCodes.push("candidate_projection_local_fold");
          break;
        }
      }
    }
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

export function validateIncisionPhotoFile(file: Pick<File, "type" | "size">): string | null {
  if (!INCISION_PHOTO_TYPES.has(file.type)) return "仅支持 JPEG 或 PNG 照片。";
  if (!Number.isFinite(file.size) || file.size <= 0) return "照片文件为空或无法读取。";
  if (file.size > INCISION_PHOTO_MAX_BYTES) return "照片超过 20 MB，请先压缩后重试。";
  return null;
}

export function pointsToSurfaceRefs(
  points: readonly Vec3[] | null | undefined,
  vertices: Vec3[],
  triangles: Triangle[],
): SurfaceRef[] {
  return polylineToSurfaceRefs(points, vertices, triangles);
}

export function candidateEndpointSurfaceRefs(
  candidatePoints: readonly Vec3[],
  candidateRefs: readonly SurfaceRef[],
  endpoints: readonly Vec3[],
  vertices: Vec3[],
  triangles: Triangle[],
): SurfaceRef[] {
  return endpoints.flatMap((endpoint) => {
    if (candidatePoints.length === candidateRefs.length && candidatePoints.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      candidatePoints.forEach((point, index) => {
        const distance = Math.hypot(
          point[0] - endpoint[0],
          point[1] - endpoint[1],
          point[2] - endpoint[2],
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      return [candidateRefs[nearestIndex]];
    }
    const ref = pointToSurfaceRef(endpoint, vertices, triangles);
    return ref ? [ref] : [];
  });
}

export function surfaceRefToModelPoint(
  ref: SurfaceRef,
  vertices: Vec3[],
  triangles: Triangle[],
): Vec3 | null {
  return mapSurfaceRefs([ref], vertices, triangles).pts[0] || null;
}

const addPoint = (first: Vec3, second: Vec3): Vec3 => [
  first[0] + second[0],
  first[1] + second[1],
  first[2] + second[2],
];
const scalePoint = (point: Vec3, scale: number): Vec3 => [
  point[0] * scale,
  point[1] * scale,
  point[2] * scale,
];
const crossPoint = (first: Vec3, second: Vec3): Vec3 => [
  first[1] * second[2] - first[2] * second[1],
  first[2] * second[0] - first[0] * second[2],
  first[0] * second[1] - first[1] * second[0],
];
const normalizePoint = (point: Vec3): Vec3 => {
  const length = Math.hypot(...point);
  return length > 1e-9 ? scalePoint(point, 1 / length) : [1, 0, 0];
};

export function buildSubcutaneousDiameterEstimateRefs({
  centerRef,
  lesionIndex,
  diameterMm,
  unitsPerMm,
  vertices,
  normals,
  triangles,
  samples = 48,
}: {
  centerRef: SurfaceRef | null;
  lesionIndex: number;
  diameterMm: number;
  unitsPerMm: number;
  vertices: Vec3[];
  normals: Vec3[];
  triangles: Triangle[];
  samples?: number;
}): SurfaceRef[] {
  const center = centerRef ? surfaceRefToModelPoint(centerRef, vertices, triangles) : vertices[lesionIndex];
  const normal = normals[lesionIndex];
  const radius = Number(diameterMm) * Number(unitsPerMm) / 2;
  if (!center || !normal || !(radius > 0) || samples < 8) return [];
  const u = normalizePoint(crossPoint(normal, [0, 1, 0]));
  const v = normalizePoint(crossPoint(normal, u));
  const points: Vec3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = index / samples * Math.PI * 2;
    points.push(addPoint(
      addPoint(center, scalePoint(u, Math.cos(angle) * radius)),
      scalePoint(v, Math.sin(angle) * radius),
    ));
  }
  return pointsToSurfaceRefs(points, vertices, triangles);
}

export function buildIncisionPhotoGeometry({
  landmarks,
  triangles,
  atlasLines,
  centerRef,
  diameterEstimateRefs = [],
  boundaryRefs,
  candidateRefs,
  endpointRefs,
  candidateType,
}: Omit<IncisionPhotoRenderInput, "context" | "source" | "sourceWidth" | "sourceHeight" | "devicePixelRatio">): IncisionPhotoGeometry {
  const candidate = mapSurfaceRefs(candidateRefs, landmarks, triangles).pts;
  return {
    rstl: mapAtlas(atlasLines, landmarks, triangles),
    center: centerRef ? mapSurfaceRefs([centerRef], landmarks, triangles).pts[0] || null : null,
    diameterEstimate: mapSurfaceRefs(diameterEstimateRefs, landmarks, triangles).pts,
    boundary: mapSurfaceRefs(boundaryRefs, landmarks, triangles).pts,
    candidate,
    endpoints: mapSurfaceRefs(endpointRefs, landmarks, triangles).pts,
    candidateProjection: inspectPhotoCandidateProjection(candidate, candidateType),
  };
}

export function nearestPhotoEndpointHandle(
  point: { x: number; y: number },
  endpoints: readonly { x: number; y: number }[],
  radiusCssPx = 12,
): number | null {
  let nearest: { index: number; distance: number } | null = null;
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const distance = Math.hypot(point.x - endpoint.x, point.y - endpoint.y);
    if (distance <= radiusCssPx && (!nearest || distance < nearest.distance)) nearest = { index, distance };
  }
  return nearest?.index ?? null;
}

function canvasForeheadSkinVisibility(
  context: CanvasRenderingContext2D,
  sourceWidth: number,
  sourceHeight: number,
  landmarks: Vec3[],
): VisibilityPredicate {
  try {
    const pixelWidth = context.canvas.width;
    const pixelHeight = context.canvas.height;
    if (pixelWidth <= 0 || pixelHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return () => true;
    const scaleX = pixelWidth / sourceWidth;
    const scaleY = pixelHeight / sourceHeight;
    const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight);
    const scaledLandmarks = landmarks.map((point) => [
      point[0] * scaleX,
      point[1] * scaleY,
      point[2],
    ] as Vec3);
    const visible = buildForeheadSkinVisibility(pixels, pixelWidth, pixelHeight, scaledLandmarks);
    return (point) => point
      ? visible([point[0] * scaleX, point[1] * scaleY, point[2]])
      : false;
  } catch {
    return () => true;
  }
}

function drawPath(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  strokeStyle: string,
  lineWidth: number,
  closed = false,
) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }
  if (closed) context.closePath();
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
}

export function renderIncisionPhotoPlanning(input: IncisionPhotoRenderInput): IncisionPhotoGeometry {
  const {
    context,
    source,
    sourceWidth,
    sourceHeight,
    devicePixelRatio,
  } = input;
  const dpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  const geometry = buildIncisionPhotoGeometry(input);
  const strokeWidths = incisionPhotoStrokeWidths(sourceWidth);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const skinVisible = canvasForeheadSkinVisibility(context, sourceWidth, sourceHeight, input.landmarks);

  const rstlRenderPlan = buildRstlRenderPlan({
    lines: geometry.rstl,
    landmarks: input.landmarks,
    triangles: input.triangles,
    clip: true,
    densityFraction: 1,
    skinVisible,
  });
  for (const entry of rstlRenderPlan) {
    for (const run of entry.runs) {
      drawPath(context, run, "rgba(103, 232, 249, 0.95)", strokeWidths.rstl);
    }
  }
  if (geometry.diameterEstimate.length >= 2) {
    context.setLineDash([8, 6]);
    drawPath(context, geometry.diameterEstimate, "rgba(3, 7, 18, 0.88)", strokeWidths.boundaryHalo, true);
    drawPath(context, geometry.diameterEstimate, input.tumorInputInvalid ? "#ef4444" : "#facc15", strokeWidths.boundary, true);
    context.setLineDash([]);
  }
  if (geometry.boundary.length >= 2) {
    drawPath(context, geometry.boundary, "rgba(3, 7, 18, 0.88)", strokeWidths.boundaryHalo, geometry.boundary.length >= 6);
    drawPath(context, geometry.boundary, input.tumorInputInvalid ? "#ef4444" : "#facc15", strokeWidths.boundary, geometry.boundary.length >= 6);
  }
  if (geometry.candidate.length >= 2 && geometry.candidateProjection.valid) {
    drawPath(context, geometry.candidate, "rgba(3, 7, 18, 0.9)", strokeWidths.candidateHalo);
    drawPath(context, geometry.candidate, "#34d399", strokeWidths.candidate);
  }
  if (geometry.center) {
    context.beginPath();
    context.arc(geometry.center[0], geometry.center[1], 7, 0, Math.PI * 2);
    context.fillStyle = "#f43f5e";
    context.strokeStyle = "rgba(3, 7, 18, 0.95)";
    context.lineWidth = 3;
    context.fill();
    context.stroke();
  }
  const endpointRadius = input.endpointRadius == null
    ? incisionPhotoEndpointRadius(strokeWidths.candidate)
    : Math.max(0.5, input.endpointRadius);
  for (const endpoint of geometry.candidateProjection.valid ? geometry.endpoints : []) {
    context.beginPath();
    context.arc(endpoint[0], endpoint[1], endpointRadius + strokeWidths.candidate * 0.5, 0, Math.PI * 2);
    context.fillStyle = "rgba(3, 7, 18, 0.96)";
    context.fill();
    context.beginPath();
    context.arc(endpoint[0], endpoint[1], endpointRadius, 0, Math.PI * 2);
    context.fillStyle = "#f8fafc";
    context.fill();
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  return geometry;
}
