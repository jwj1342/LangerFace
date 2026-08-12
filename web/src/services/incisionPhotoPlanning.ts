import { mapAtlas, visibleRuns, type AtlasLine, type MappedAtlasLine } from "./geometryAtlas.ts";
import {
  buildForeheadSkinVisibility,
  buildHeadVisibility,
  EXTENDED_FOREHEAD_REGIONS,
  stabilizeForeheadMask,
  type VisibilityPredicate,
} from "./foreheadVisibility.ts";
import { mapSurfaceRefs, pointToSurfaceRef, type SurfaceRef } from "./incisionOverlay.ts";
import type { Triangle, Vec3 } from "./softBody.ts";

export const INCISION_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const INCISION_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

export interface IncisionPhotoGeometry {
  rstl: MappedAtlasLine[];
  center: Vec3 | null;
  diameterEstimate: Vec3[];
  boundary: Vec3[];
  candidate: Vec3[];
  endpoints: Vec3[];
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
  return (points || [])
    .map((point) => pointToSurfaceRef(point, vertices, triangles))
    .filter((ref): ref is SurfaceRef => ref !== null);
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
}: Omit<IncisionPhotoRenderInput, "context" | "source" | "sourceWidth" | "sourceHeight" | "devicePixelRatio">): IncisionPhotoGeometry {
  return {
    rstl: mapAtlas(atlasLines, landmarks, triangles),
    center: centerRef ? mapSurfaceRefs([centerRef], landmarks, triangles).pts[0] || null : null,
    diameterEstimate: mapSurfaceRefs(diameterEstimateRefs, landmarks, triangles).pts,
    boundary: mapSurfaceRefs(boundaryRefs, landmarks, triangles).pts,
    candidate: mapSurfaceRefs(candidateRefs, landmarks, triangles).pts,
    endpoints: mapSurfaceRefs(endpointRefs, landmarks, triangles).pts,
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

export function visibleIncisionPhotoRstlRuns(
  line: MappedAtlasLine,
  landmarks: Vec3[],
  skinVisible: VisibilityPredicate = () => true,
): Vec3[][] {
  if (line.pts.length < 2) return [];
  if (!EXTENDED_FOREHEAD_REGIONS.has(line.region)) return [line.pts];
  const headVisible = buildHeadVisibility(landmarks);
  const rawMask = line.pts.map((point) => headVisible(point) && skinVisible(point));
  const mask = rawMask.length >= 8 ? stabilizeForeheadMask(rawMask) : rawMask;
  return visibleRuns(line.pts, mask.map((visible) => visible ? 1 : 0));
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

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const skinVisible = canvasForeheadSkinVisibility(context, sourceWidth, sourceHeight, input.landmarks);

  for (const line of geometry.rstl) {
    for (const run of visibleIncisionPhotoRstlRuns(line, input.landmarks, skinVisible)) {
      drawPath(context, run, "rgba(103, 232, 249, 0.95)", Math.max(2, sourceWidth / 1300));
    }
  }
  if (geometry.diameterEstimate.length >= 2) {
    context.setLineDash([8, 6]);
    drawPath(context, geometry.diameterEstimate, "rgba(3, 7, 18, 0.92)", 6, true);
    drawPath(context, geometry.diameterEstimate, "#facc15", 3, true);
    context.setLineDash([]);
  }
  if (geometry.boundary.length >= 2) {
    drawPath(context, geometry.boundary, "rgba(3, 7, 18, 0.92)", 6, geometry.boundary.length >= 6);
    drawPath(context, geometry.boundary, "#facc15", 3, geometry.boundary.length >= 6);
  }
  if (geometry.candidate.length >= 2) {
    drawPath(context, geometry.candidate, "rgba(3, 7, 18, 0.95)", 8);
    drawPath(context, geometry.candidate, "#34d399", 4);
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
  const endpointRadius = Math.max(4, input.endpointRadius || 9);
  for (const endpoint of geometry.endpoints) {
    context.beginPath();
    context.arc(endpoint[0], endpoint[1], endpointRadius + 3, 0, Math.PI * 2);
    context.fillStyle = "rgba(3, 7, 18, 0.96)";
    context.fill();
    context.beginPath();
    context.arc(endpoint[0], endpoint[1], endpointRadius, 0, Math.PI * 2);
    context.fillStyle = "#f8fafc";
    context.strokeStyle = "#34d399";
    context.lineWidth = Math.max(3, endpointRadius * 0.28);
    context.fill();
    context.stroke();
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  return geometry;
}
