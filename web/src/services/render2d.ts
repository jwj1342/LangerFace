// 2D 渲染：线条叠加、细节放大窗、统计面板。
import { SOLID, BAND, ZOOM_REGIONS } from "./constants.ts";
import { liveBenchmark, sampleBenchmarkLines } from "./liveBenchmark.ts";
import { LivePreviewCadence } from "./livePreviewCadence.ts";
import type { ZoomRegion } from "./constants.ts";
import { ctx as boundCtx, els } from "./liveDom.ts";
import {
  estimateFacePoseQuality,
  faceBBox,
} from "./geometryPoseQuality.ts";
import {
  innerMouthTriangles,
  mapAtlas,
  visibleRuns,
  visibleTriangles,
  type MappedAtlasLine,
} from "./geometryAtlas.ts";
import { pointInHandMasks, type HandMask, type Point2 } from "./geometryOccluders.ts";
import {
  buildForeheadSkinVisibility,
  buildFaceHullVisibility,
  buildFaceOvalVisibility,
  buildChinAppearanceVisibility,
  buildHeadVisibility,
  EXTENDED_FOREHEAD_REGIONS,
  stabilizeForeheadMask,
} from "./foreheadVisibility.ts";
import type { Triangle, Vec3 } from "./softBody.ts";
import { mapSurfaceRefs, measureIncisionOverlayJitter, measureIncisionOverlayRegistration } from "./incisionOverlay.ts";
import type { SurfaceRef } from "./incisionOverlay.ts";
import { incisionOverlayScreenStyle } from "./incisionOverlayStyle.ts";
import { countMetric, recordMetricSample, setDiagnosticSection } from "./logger.ts";
import { lineIndicesForDensity } from "./lineDensity.ts";
import { clipRstlRunToPhotoHair, currentRstlPhotoHairMask } from "./rstlPhotoHairOcclusion.ts";
import {
  getDisplayLines,
  isRefineActive,
  isPointRefineMode,
  selectedLineIndex,
  selectedPointIndex,
  selectedPointWindow,
  setLatestAutoLines,
  setRefineAvailability,
  showSymmetryAxis,
  symmetryAxisX,
  symmetryPartnerIndex,
} from "./liveRefine2d";
import { modelState, renderState, sourceState } from "./liveState.ts";
import {
  mobileIncisionCandidateVisible,
  mobileRstlLayerVisible,
  mobileWorkflowViewportActive,
  mobileWrinkleLayerVisible,
} from "./mobileWorkflowVisibility.ts";
import { setIncisionOverlayQa, setLive } from "./liveUi.ts";
import type { IncisionOverlayPayload } from "./dataSource";
import {
  getWrinkleEvidenceLines,
  getRefinementHighlightColor,
  shouldDrawRstlLayer,
  shouldDrawWrinkleLayer,
} from "./liveWrinkleAnalysis.ts";
import { RSTL_STANDARD_MAPPING_OPTIONS } from "./rstlStandardContract.ts";
import { createStaticAtlasMappingCache } from "./staticAtlasMappingCache.ts";

const staticAtlasMapping = createStaticAtlasMappingCache();
let browGuardDiagnosticKey = "";
let crossPairExperimentDiagnosticKey = "";
let rstlCrossDebugPoints: Array<{ x: number; y: number }> = [];

const RSTL_0119_NAMES = new Set([
  "standard_field_0119_left",
  "standard_field_0119_right",
]);
const RSTL_0118_NAMES = new Set([
  "standard_field_0118_left",
  "standard_field_0118_right",
]);
type DisplayMappedLine = MappedAtlasLine & {
  hidden?: boolean;
  hiddenPointRuns?: Array<[number, number]>;
};

/**
 * The 0119 cheek fan seeds have an endpoint zig-zag after surface projection.
 * Smooth only a short window at both ends for display; the atlas and mapped
 * middle section remain unchanged. Z is preserved so occlusion/depth ordering
 * continues to use the original surface depth.
 */
function smooth0119EndpointDisplayLines(lines: readonly DisplayMappedLine[], height: number): DisplayMappedLine[] {
  return lines.map((line) => {
    const is0119 = RSTL_0119_NAMES.has(line.name);
    const is0118 = RSTL_0118_NAMES.has(line.name);
    if ((!is0119 && !is0118) || line.pts.length < 12) return line;
    let points = line.pts.map((point) => [...point] as Vec3);
    // Keep the correction local. A wider/stronger pass can move a cheek line
    // into the face-hull edge or its neighbour and make it appear missing.
    const passes = 6;
    const window = Math.min(is0118 ? 24 : 12, Math.floor(points.length / 4));
    // Include the join sample in the 0118 smoothing pass. Otherwise the
    // original direction jump can simply move to the first untouched point.
    const startWindow = is0118 ? window + 1 : window;
    for (let pass = 0; pass < passes; pass += 1) {
      const next = points.map((point) => [...point] as Vec3);
      for (let index = 1; index < startWindow; index += 1) {
        next[index][0] = 0.25 * points[index - 1][0] + 0.5 * points[index][0] + 0.25 * points[index + 1][0];
        next[index][1] = 0.25 * points[index - 1][1] + 0.5 * points[index][1] + 0.25 * points[index + 1][1];
      }
      for (let index = is0118 ? points.length : points.length - window + 1;
        index < points.length - 1; index += 1) {
        next[index][0] = 0.25 * points[index - 1][0] + 0.5 * points[index][0] + 0.25 * points[index + 1][0];
        next[index][1] = 0.25 * points[index - 1][1] + 0.5 * points[index][1] + 0.25 * points[index + 1][1];
      }
      points = next;
    }
    // The nose-side endpoint is the first sample for the 0119 cheek fan.
    // Rebuild only that short cap with a cubic Hermite segment so its tangent
    // joins the untouched middle smoothly instead of flattening into a bump.
    const startCount = startWindow - 1;
    const start0 = [...points[0]] as Vec3;
    const startN = [...points[startCount]] as Vec3;
    const tangentSpan = Math.min(4, startCount);
    const startTangent = [
      (points[tangentSpan][0] - start0[0]) * (startCount / tangentSpan),
      (points[tangentSpan][1] - start0[1]) * (startCount / tangentSpan),
    ];
    const outsideSpan = Math.min(tangentSpan, points.length - 1 - startCount);
    const endTangent = [
      (points[startCount + outsideSpan][0] - startN[0]) * (startCount / outsideSpan),
      (points[startCount + outsideSpan][1] - startN[1]) * (startCount / outsideSpan),
    ];
    for (let index = 1; index < startCount; index += 1) {
      const t = index / startCount;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      points[index][0] = h00 * start0[0] + h10 * startTangent[0]
        + h01 * startN[0] + h11 * endTangent[0];
      points[index][1] = h00 * start0[1] + h10 * startTangent[1]
        + h01 * startN[1] + h11 * endTangent[1];
    }
    if (is0118) return { ...line, pts: points };
    // Lower only the outer endpoint tail. The displacement ramps from zero
    // at the join to a few pixels at the endpoint, so the middle and tangent
    // remain unchanged.
    const tailStart = points.length - window;
    const maxDown = Math.max(1, Math.min(7, height * 0.0044));
    for (let index = tailStart; index < points.length; index += 1) {
      const t = (index - tailStart) / Math.max(1, points.length - 1 - tailStart);
      points[index][1] += maxDown * t;
    }
    // Remove the residual end-cap rebound. Rebuild only the tail's vertical
    // travel with a monotone smoothstep, so it cannot rise again at the last
    // samples after the downward offset is applied.
    const tailStartY = points[tailStart][1];
    const tailEndY = Math.max(points.at(-1)![1], tailStartY + 1);
    for (let index = tailStart; index < points.length; index += 1) {
      const t = (index - tailStart) / Math.max(1, points.length - 1 - tailStart);
      const eased = t * t * (3 - 2 * t);
      points[index][1] = tailStartY + (tailEndY - tailStartY) * eased;
    }
    return { ...line, pts: points };
  });
}

type AnyRecord = Record<string, any>;
type IncisionZoomRegion = { kind: "incision_overlay" };
type RenderRegion = ZoomRegion | IncisionZoomRegion | null;
const SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V69 = "supraorbital_medial_short_arc_v69";
const GLABELLA_BROW_UPTURN_REGION_V11 = "orbital_brow_upturn_v11";
const MEDIAL_UPWARD_EXTENSION_REGIONS = new Set([
  SUPRAORBITAL_MEDIAL_SHORT_ARC_REGION_V69,
  GLABELLA_BROW_UPTURN_REGION_V11,
]);
const TEMPORARY_CHEEK_EXPERIMENT_REGIONS = new Set([
  "cheek_long_arc_fan_v24",
  "cheek_long_arc_density_v41",
  "cheek_lower_divergent_arc_v44",
  "cheek_gap_density_v53",
  "cheek_nasal_transition_density_v56",
  "cheek_alar_gap_fill_v95",
  "nasolabial_mandibular_guide_v14",
]);

function temporaryAlarExperimentEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("hideCheekHalf") === "1"
    || params.get("hideCheekHalf2") === "1"
    || params.get("hideCheekHalf3") === "1"
    || params.get("hideCheekHalf4") === "1"
    || params.get("hideCheekHalf5") === "1"
    || params.get("hideCheekHalf6") === "1"
    || params.get("hideCheekHalf7") === "1"
    || params.get("hideCheekHalf8") === "1"
    || params.get("hideCheekCleanA") === "1";
}

function temporaryCrossPairExperimentEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("hideRstlPair0111_0146Left") === "1"
    || params.get("hideRstlPair0111_0146Right") === "1"
    || params.get("hideRstlPair0111_0148Right") === "1";
}

function temporarySingleLineExperimentEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("hideRstlLine");
}

function temporarySingleLineHidden(name: unknown): boolean {
  if (!temporarySingleLineExperimentEnabled()) return false;
  const wanted = new URLSearchParams(window.location.search).get("hideRstlLine");
  return Boolean(wanted && String(name || "") === wanted);
}

function temporaryCrossPairLineHidden(name: unknown): boolean {
  if (!temporaryCrossPairExperimentEnabled()) return false;
  const id = String(name || "");
  const params = new URLSearchParams(window.location.search);
  const side = params.get("hideRstlPair0111_0146Right") === "1"
    || params.get("hideRstlPair0111_0148Right") === "1" ? "right" : "left";
  const second = params.get("hideRstlPair0111_0148Right") === "1" ? "0148" : "0146";
  return id.includes(`standard_field_0111_${side}`) || id.includes(`standard_field_${second}_${side}`);
}
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Bounds extends Rect {
  w: number;
  h: number;
}

interface LocalRegionMask {
  id: string;
  label?: string;
  action: string;
  opacityScale: number;
  boxes: Rect[];
}

interface LocalRegionActionResult {
  action: "normal" | "dim" | "freeze";
  opacityScale: number;
}

/** Convert a desired on-screen stroke width to the canvas's source pixels. */
function strokeWidthForDisplay(cssPixels: number, sourceWidth: number): number {
  const displayWidth = els.canvas.getBoundingClientRect().width;
  if (!(displayWidth > 0) || !(sourceWidth > 0)) return cssPixels;
  return cssPixels * sourceWidth / displayWidth;
}

/** Keep wrinkle highlights proportional to the visible face across image sizes. */
function wrinkleStrokeWidthForFace(faceWidth: number, sourceWidth: number): number {
  const displayWidth = els.canvas.getBoundingClientRect().width;
  if (!(displayWidth > 0) || !(sourceWidth > 0) || !(faceWidth > 0)) {
    return strokeWidthForDisplay(2.4, sourceWidth);
  }
  const displayFaceWidth = faceWidth * displayWidth / sourceWidth;
  const displayPixels = Math.max(2, Math.min(4, displayFaceWidth * 0.006));
  return strokeWidthForDisplay(displayPixels, sourceWidth);
}

interface ZoomItem {
  label: string;
  region: RenderRegion;
}

export interface LiveZoomCard {
  region: RenderRegion;
  card: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function currentCtx(): CanvasRenderingContext2D {
  if (!boundCtx) throw new Error("Live canvas context is not bound.");
  return boundCtx;
}

const ctx = new Proxy({} as CanvasRenderingContext2D, {
  get(_target, key: PropertyKey) {
    const value = (currentCtx() as AnyRecord)[key as keyof CanvasRenderingContext2D];
    return typeof value === "function" ? value.bind(currentCtx()) : value;
  },
  set(_target, key: PropertyKey, value: unknown) {
    (currentCtx() as AnyRecord)[key as keyof CanvasRenderingContext2D] = value;
    return true;
  },
});

const modelTriangles = (): Triangle[] => modelState.triangles as Triangle[];
const modelNoseTris = (): number[] => modelState.noseTris as number[];
const toPoint2 = (point: number[]): Point2 => [Number(point[0]), Number(point[1])];
const surfaceRefs = (refs: unknown): SurfaceRef[] => (Array.isArray(refs) ? refs as SurfaceRef[] : []);
const optionalSurfaceRef = (ref: unknown): SurfaceRef[] => (ref ? [ref as SurfaceRef] : []);
const isIncisionZoomRegion = (region: RenderRegion): region is IncisionZoomRegion => (
  Boolean(region && "kind" in region && region.kind === "incision_overlay")
);

const focusScratch = document.createElement("canvas");
const focusCtx = focusScratch.getContext("2d") as CanvasRenderingContext2D;
const foreheadScratch = document.createElement("canvas");
const foreheadCtx = foreheadScratch.getContext("2d", {
  willReadFrequently: true,
}) as CanvasRenderingContext2D;
const FOREHEAD_SAMPLE_MAX_WIDTH = 320;
const focusZoomRange = { min: 1, max: 4.5 };
/** 读取当前帧像素供肤色判定使用；跨源画布读取失败时返回 null（退化为不按肤色裁剪）。 */
function readForeheadImageData(W: number, H: number): {
  image: ImageData;
  scale: number;
} | null {
  if (!(W > 0 && H > 0) || !foreheadCtx) return null;
  try {
    const scale = Math.min(1, FOREHEAD_SAMPLE_MAX_WIDTH / W);
    const width = Math.max(1, Math.round(W * scale));
    const height = Math.max(1, Math.round(H * scale));
    if (foreheadScratch.width !== width) foreheadScratch.width = width;
    if (foreheadScratch.height !== height) foreheadScratch.height = height;
    foreheadCtx.drawImage(els.canvas, 0, 0, width, height);
    return { image: foreheadCtx.getImageData(0, 0, width, height), scale };
  } catch {
    // 跨源图像在更早阶段就被拒绝，这里只是保证读取失败不会中断渲染。
    return null;
  }
}
const INCISION_ZOOM_REGION: IncisionZoomRegion = { kind: "incision_overlay" };
const INCISION_OVERLAY_STABILITY_FRAMES = 8;
const LIVE_OCCLUSION_MIN_TRIANGLE_AREA_PX2 = 1;
const LOCAL_REGION_RENDER_GROUPS: Record<string, string[]> = {
  brow_eye: ["额·眉间", "右眼周", "左眼周"],
  mouth: ["口周"],
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const renderQualityDiagnostics: { source: unknown; previousFrame: Vec3[] | null } = { source: null, previousFrame: null };
const overlayRuntimeDiagnostics: { key: string | null; landmarkFrames: Vec3[][] } = { key: null, landmarkFrames: [] };

function fmtPx(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 0 : 1)}px` : "—";
}

function compactReason(reason: unknown): string {
  return String(reason || "unknown").replaceAll("_", " ");
}

function fmtRatio(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function fmtPercent(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

function currentFaceExpression() {
  return {
    jawOpen: sourceState.jawOpen,
    eyeBlinkLeft: sourceState.eyeBlinkLeft,
    eyeBlinkRight: sourceState.eyeBlinkRight,
  };
}

function orientation2d(a: Vec3, b: Vec3, c: Vec3): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Strict crossing test for projected RSTL segments. Endpoint touches are
 * deliberately excluded: neighbouring samples often share a pixel after a
 * side-pose projection and should not create artificial gaps. */
function projectedSegmentsCross(a: [Vec3, Vec3], b: [Vec3, Vec3]): boolean {
  const ab = orientation2d(a[0], a[1], b[0]);
  const ac = orientation2d(a[0], a[1], b[1]);
  const ba = orientation2d(b[0], b[1], a[0]);
  const bb = orientation2d(b[0], b[1], a[1]);
  const scale = Math.max(
    Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]),
    Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]),
    1,
  );
  const eps = scale * 1e-5;
  return ((ab > eps && ac < -eps) || (ab < -eps && ac > eps))
    && ((ba > eps && bb < -eps) || (ba < -eps && bb > eps));
}

function fillShortVisibilityGaps(mask: number[], maxGap = 2): void {
  for (let start = 1; start < mask.length - 1;) {
    if (mask[start]) { start++; continue; }
    let end = start;
    while (end < mask.length && !mask[end]) end++;
    if (start > 0 && end < mask.length && end - start <= maxGap && mask[start - 1] && mask[end]) {
      for (let index = start; index < end; index++) mask[index] = 1;
    }
    start = end;
  }
}

function pointSegmentDistance2d(point: Vec3, segment: [Vec3, Vec3]): number {
  const [a, b] = segment;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 1e-9
    ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
    : 0;
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function segmentDistance2d(
  first: [Vec3, Vec3],
  second: [Vec3, Vec3],
): number {
  if (projectedSegmentsCross(first, second)) return 0;
  return Math.min(
    pointSegmentDistance2d(first[0], second),
    pointSegmentDistance2d(first[1], second),
    pointSegmentDistance2d(second[0], first),
    pointSegmentDistance2d(second[1], first),
  );
}

/** Stop the brow-side bundle before it enters the forehead-line corridor. */
function stopBrowMasksBeforeForehead(lines: MappedAtlasLine[], masks: number[][]): void {
  const forehead = lines.filter(line => line.region === "forehead_bridge_arc_v15"
    || line.region === "forehead_lower_long_arc_v13");
  const brow = lines.filter(line => (
    (line.region === "orbital_brow_upturn_v11"
      && /standard_field_(0105|0106|0107|0108|0109|0154|0155)_/.test(line.name))
    || line.region === "brow_temporal_fan_v94"
  ));
  if (!forehead.length || !brow.length) return;
  const foreheadSegments = forehead.flatMap(line => line.pts.slice(1).map((point, index) => [
    line.pts[index], point,
  ] as [Vec3, Vec3]));
  const allY = [...forehead, ...brow].flatMap(line => line.pts.map(point => point[1]));
  // Keep the near-touch guard at stroke scale. A large face-relative band
  // incorrectly shortened independent brow-tail lines on frontal faces.
  const clearance = Math.max(1.5, Math.min(3.5, (Math.max(...allY) - Math.min(...allY)) * 0.003));
  const centerX = (Math.min(...forehead.flatMap(line => line.pts.map(point => point[0])))
    + Math.max(...forehead.flatMap(line => line.pts.map(point => point[0])))) * 0.5;
  const conflicts = (segment: [Vec3, Vec3]): boolean => foreheadSegments.some(other => {
    const minX = Math.min(segment[0][0], segment[1][0]) - clearance;
    const maxX = Math.max(segment[0][0], segment[1][0]) + clearance;
    const minY = Math.min(segment[0][1], segment[1][1]) - clearance;
    const maxY = Math.max(segment[0][1], segment[1][1]) + clearance;
    if (maxX < Math.min(other[0][0], other[1][0]) || minX > Math.max(other[0][0], other[1][0])
        || maxY < Math.min(other[0][1], other[1][1]) || minY > Math.max(other[0][1], other[1][1])) return false;
    return segmentDistance2d(segment, other) <= clearance;
  });
  const endpointDistanceToForehead = (point: Vec3): number => Math.min(
    ...foreheadSegments.map(segment => pointSegmentDistance2d(point, segment)),
  );
  const debugEnabled = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("wrinkleDebug");
  const diagnosticKey = `${forehead.length}:${brow.map(line => line.name).join(",")}`;
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const line of brow) {
    const lineIndex = lines.indexOf(line);
    const mask = masks[lineIndex];
    if (!mask || line.pts.length < 4) continue;
    // Under yaw, screen-space centerX does not reliably identify the outer
    // endpoint. Preserve the endpoint farther from the forehead bundle so the
    // photo/skin mask cannot remove the retained stub entirely.
    const outerFirst = endpointDistanceToForehead(line.pts[0])
      >= endpointDistanceToForehead(line.pts.at(-1)!);
    const ordered = outerFirst ? line.pts : [...line.pts].reverse();
    let firstConflict = -1;
    let truncated = false;
    for (let index = 1; index < ordered.length; index++) {
      if (!conflicts([ordered[index - 1], ordered[index]])) continue;
      firstConflict = index;
      // A conflict in the first few samples is usually a side-pose projection
      // ambiguity, but the line still needs to stop before it enters the
      // forehead bundle. Keep a short outer stub so the line remains visible;
      // never turn this case into an invisible line or let it pass through.
      const minimumRetainedSamples = 8;
      const retained = Math.min(Math.max(index, minimumRetainedSamples), ordered.length - 1);
      // Keep the original geometry intact; only the displayed run ends here.
      const originalIndex = outerFirst ? retained : line.pts.length - retained - 1;
      if (outerFirst) {
        for (let point = originalIndex; point < mask.length; point++) mask[point] = 0;
      } else {
        for (let point = 0; point <= originalIndex; point++) mask[point] = 0;
      }
      truncated = true;
      break;
    }
    if (debugEnabled) diagnostics.push({
      name: line.name,
      region: line.region,
      points: line.pts.length,
      visibleAfter: mask.filter(Boolean).length,
      firstConflict,
      truncated,
      outerFirst,
    });
  }
  if (debugEnabled && diagnosticKey !== browGuardDiagnosticKey) {
    browGuardDiagnosticKey = diagnosticKey;
    console.info("[rstl-brow-guard] " + JSON.stringify({ forehead: forehead.length, brow: diagnostics }));
  }
}

/**
 * Keep the displayed 2D line bundle planar after a strong yaw projection.
 * The atlas remains untouched: this returns per-frame draw masks only. When
 * two visible projected segments cross, the segment farther from the camera
 * is suppressed for one sample, leaving the front line continuous. A short
 * visibility hole is filled before this pass, which removes the isolated
 * eye-orbit breaks caused by alternating triangle winding.
 */
function buildTopologySafeRstlMasks(
  lines: MappedAtlasLine[],
  masks: number[][],
): number[][] {
  const crossDebug = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("rstlCrossDebug") === "1";
  const crossDebugAll = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("rstlCrossDebugAll") === "1";
  const crossDebugNear = typeof window !== "undefined"
    && (new URLSearchParams(window.location.search).get("rstlCrossDebugNear") === "1"
      || new URLSearchParams(window.location.search).get("rstlCrossDebugAll") === "1");
  const crossPairs = new Map<string, { x: number; y: number }>();
  const safe = masks.map(mask => mask.slice());
  safe.forEach(mask => fillShortVisibilityGaps(mask));
  stopBrowMasksBeforeForehead(lines, safe);
  type SegmentRecord = {
    id: number;
    lineIndex: number;
    segmentIndex: number;
    points: [Vec3, Vec3];
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  const records: SegmentRecord[] = [];
  const protectedRegions = new Set([
    "brow_temporal_fan_v94",
    "orbital_brow_upturn_v11",
    "forehead_bridge_arc_v15",
    "forehead_lower_long_arc_v13",
  ]);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    for (let segmentIndex = 0; segmentIndex + 1 < line.pts.length; segmentIndex++) {
      if (!safe[lineIndex]?.[segmentIndex] || !safe[lineIndex]?.[segmentIndex + 1]) continue;
      const a = line.pts[segmentIndex];
      const b = line.pts[segmentIndex + 1];
      records.push({
        id: records.length,
        lineIndex,
        segmentIndex,
        points: [a, b],
        x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]),
        x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]),
      });
    }
  }
  // Projected RSTL segments are short and local. A coarse screen-space grid
  // reduces the former all-pairs comparison to nearby candidates only; this
  // keeps the guard cheap enough to run on every live frame.
  const CELL = 32;
  const buckets = new Map<string, number[]>();
  const cellKey = (x: number, y: number): string => `${x},${y}`;
  for (const record of records) {
    const minX = Math.floor(record.x0 / CELL);
    const maxX = Math.floor(record.x1 / CELL);
    const minY = Math.floor(record.y0 / CELL);
    const maxY = Math.floor(record.y1 / CELL);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = cellKey(x, y);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(record.id);
        else buckets.set(key, [record.id]);
      }
    }
  }
  const segment = (record: SegmentRecord): [Vec3, Vec3] | null => (
    safe[record.lineIndex]?.[record.segmentIndex]
      && safe[record.lineIndex]?.[record.segmentIndex + 1] ? record.points : null
  );
  // A segment is removed at most once, and neighbouring removals are kept
  // apart. This is the important distinction from the old batch pass: after
  // one segment is hidden, it cannot trigger a second suppression through a
  // stale conflict record and turn a short occlusion into a long break.
  const suppressed = lines.map(() => new Set<number>());
  const suppress = (lineIndex: number, segmentIndex: number): boolean => {
    const mask = safe[lineIndex];
    if (!mask || segmentIndex < 0 || segmentIndex + 1 >= mask.length
      || !mask[segmentIndex] || !mask[segmentIndex + 1]) return false;
    if (suppressed[lineIndex].has(segmentIndex)
      || suppressed[lineIndex].has(segmentIndex - 1)
      || suppressed[lineIndex].has(segmentIndex + 1)) return false;
    // Keep at least one visible sample on either side when the crossing is
    // interior. At an endpoint there is no artificial mid-line break to
    // protect. This prevents a dense cluster of projected crossings from
    // erasing a whole eye-orbit run.
    const hasLeft = segmentIndex > 0 && Boolean(mask[segmentIndex - 1]);
    const hasRight = segmentIndex + 2 < mask.length && Boolean(mask[segmentIndex + 2]);
    if (hasLeft && hasRight && suppressed[lineIndex].size > 0) return false;
    mask[segmentIndex] = 0;
    mask[segmentIndex + 1] = 0;
    suppressed[lineIndex].add(segmentIndex);
    return true;
  };
  for (const firstRecord of records) {
    const minX = Math.floor(firstRecord.x0 / CELL);
    const maxX = Math.floor(firstRecord.x1 / CELL);
    const minY = Math.floor(firstRecord.y0 / CELL);
    const maxY = Math.floor(firstRecord.y1 / CELL);
    const candidates = new Set<number>();
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (const candidate of buckets.get(cellKey(x, y)) || []) {
          if (candidate > firstRecord.id) candidates.add(candidate);
        }
      }
    }
    const firstSegment = segment(firstRecord);
    if (!firstSegment) continue;
    for (const candidateId of candidates) {
      const secondRecord = records[candidateId];
      if (secondRecord.lineIndex === firstRecord.lineIndex
          && secondRecord.segmentIndex <= firstRecord.segmentIndex + 1) continue;
      if (secondRecord.x0 > firstRecord.x1 || secondRecord.x1 < firstRecord.x0
          || secondRecord.y0 > firstRecord.y1 || secondRecord.y1 < firstRecord.y0) continue;
      const secondSegment = segment(secondRecord);
      if (!secondSegment) continue;
      const strictCross = projectedSegmentsCross(firstSegment, secondSegment);
      if (crossDebugNear && firstRecord.lineIndex !== secondRecord.lineIndex
          && !strictCross && segmentDistance2d(firstSegment, secondSegment) <= 3) {
        const first = lines[firstRecord.lineIndex];
        const second = lines[secondRecord.lineIndex];
        const pair = [first.name, second.name].sort().join(" × ");
        const point = firstSegment[1];
        crossPairs.set(`near:${pair}`, { x: point[0], y: point[1] });
      }
      if (!strictCross) continue;
      if (crossDebugAll && firstRecord.lineIndex !== secondRecord.lineIndex) {
        const first = lines[firstRecord.lineIndex];
        const second = lines[secondRecord.lineIndex];
        const pair = [first.name, second.name].sort().join(" × ");
        const [a, b] = firstSegment;
        const [c, d] = secondSegment;
        const denominator = (b[0] - a[0]) * (d[1] - c[1])
          - (b[1] - a[1]) * (d[0] - c[0]);
        if (Math.abs(denominator) > 1e-6) {
          const t = ((c[0] - a[0]) * (d[1] - c[1])
            - (c[1] - a[1]) * (d[0] - c[0])) / denominator;
          crossPairs.set(`all:${pair}`, { x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]) });
        }
      }
      if (protectedRegions.has(lines[firstRecord.lineIndex].region)
          || protectedRegions.has(lines[secondRecord.lineIndex].region)) continue;
      if (crossDebug && firstRecord.lineIndex !== secondRecord.lineIndex) {
        const first = lines[firstRecord.lineIndex];
        const second = lines[secondRecord.lineIndex];
        const pair = [first.name, second.name].sort().join(" × ");
        const [a, b] = firstSegment;
        const [c, d] = secondSegment;
        const denominator = (b[0] - a[0]) * (d[1] - c[1])
          - (b[1] - a[1]) * (d[0] - c[0]);
        if (!crossPairs.has(pair) && Math.abs(denominator) > 1e-6) {
          const t = ((c[0] - a[0]) * (d[1] - c[1])
            - (c[1] - a[1]) * (d[0] - c[0])) / denominator;
          crossPairs.set(pair, { x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]) });
        }
      }
      if (secondRecord.lineIndex === firstRecord.lineIndex) {
        // For a self-crossing loop, retain the longer outer run and remove
        // the later segment that folds back through it.
        suppress(firstRecord.lineIndex, secondRecord.segmentIndex);
        continue;
      }
      const firstDepth = (firstSegment[0][2] + firstSegment[1][2]) * 0.5;
      const secondDepth = (secondSegment[0][2] + secondSegment[1][2]) * 0.5;
      // MediaPipe z is negative toward the camera. Ties use stable atlas
      // order, making the result deterministic across repeated renders.
      const loser = firstDepth > secondDepth + 1e-3
        ? [firstRecord.lineIndex, firstRecord.segmentIndex]
        : [secondRecord.lineIndex, secondRecord.segmentIndex];
      suppress(loser[0], loser[1]);
    }
  }
  if ((crossDebug || crossDebugAll || crossDebugNear) && crossPairs.size) {
    rstlCrossDebugPoints = [...crossPairs.values()];
    console.info("[rstl-cross-debug] " + JSON.stringify([...crossPairs.entries()].sort()));
  } else if (crossDebug || crossDebugAll || crossDebugNear) {
    rstlCrossDebugPoints = [];
  }
  return safe;
}

function estimateRenderQualityGate(lm: Vec3[], W: number, H: number): AnyRecord {
  if (renderQualityDiagnostics.source !== sourceState.source) {
    renderQualityDiagnostics.source = sourceState.source;
    renderQualityDiagnostics.previousFrame = null;
  }
  const gate = estimateFacePoseQuality(lm, W, H, {
    presence: sourceState.presence,
    sourceKind: sourceState.sourceKind,
    previousLandmarks: renderQualityDiagnostics.previousFrame,
    expression: currentFaceExpression(),
  });
  renderQualityDiagnostics.previousFrame = cloneLandmarkFrame(lm);
  sourceState.qualityGate = gate;
  sourceState.localRegionQuality = gate.local_region_quality || null;
  return gate;
}

export function draw(lm: Vec3[], W: number, H: number, masks: HandMask[] = []): number {
  // Resolve once per frame, avoiding proxy lookups and method binding per point.
  const ctx = currentCtx();
  const benchmark = liveBenchmark();
  const sample = benchmark?.current;
  const begin = sample ? performance.now() : 0;
  // modelState.atlases 存的是 lines 数组本身（pipelineModels 的 loadAtlas 返回 atlas.lines），
  // 不是 atlas payload。名字写成 atlasLines 是因为写成 atlas 时曾经诱发过 `atlas?.lines` 这个
  // 恒为 undefined 的取值，导致密度筛选返回空集、整页一条线都不画（#141）。
  const atlasLines = modelState.atlases[renderState.system];
  const vis = renderState.clip
    ? visibleTriangles(lm, modelTriangles(), modelNoseTris(), undefined, {
      minTriangleAreaPx2: LIVE_OCCLUSION_MIN_TRIANGLE_AREA_PX2,
    })
    : null;
  const innerMouth = innerMouthTriangles(modelTriangles()); // 口裂三角面（张嘴会落进口内/牙齿），永久排除
  const staticFrame = sourceState.sourceKind === "image" || sourceState.paused;
  if (!staticFrame) staticAtlasMapping.clear();
  const rawMapped = (staticFrame ? staticAtlasMapping.map : mapAtlas)(
    atlasLines, lm, modelTriangles(), RSTL_STANDARD_MAPPING_OPTIONS,
  );
  // Apply the 0119 display correction after any frozen-frame/refinement
  // cache lookup as well. In image mode getDisplayLines() may return cached
  // lines instead of rawMapped, which would otherwise bypass this correction.
  const mapped = rawMapped;
  if (sample) sample.stages.rstlMapping = performance.now() - begin;
  const refineActive = isRefineActive();
  const allDisplayLines = smooth0119EndpointDisplayLines(getDisplayLines(mapped), H);
  if (sourceState.sourceKind === "image" || sourceState.paused) setLatestAutoLines(allDisplayLines);
  const cheekExperimentLines = allDisplayLines.filter((line) =>
    TEMPORARY_CHEEK_EXPERIMENT_REGIONS.has(line.region));
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const firstHalfCount = Math.ceil(cheekExperimentLines.length / 2);
  const secondExperiment = params?.get("hideCheekHalf2") === "1";
  const thirdExperiment = params?.get("hideCheekHalf3") === "1";
  const fourthExperiment = params?.get("hideCheekHalf4") === "1";
  const fifthExperiment = params?.get("hideCheekHalf5") === "1";
  const sixthExperiment = params?.get("hideCheekHalf6") === "1";
  const seventhExperiment = params?.get("hideCheekHalf7") === "1";
  const eighthExperiment = params?.get("hideCheekHalf8") === "1";
  const cleanAExperiment = params?.get("hideCheekCleanA") === "1";
  const candidateHalf = cheekExperimentLines.slice(0, firstHalfCount);
  const secondCandidateHalf = candidateHalf.slice(0, Math.ceil(candidateHalf.length / 2));
  const thirdCandidateHalf = candidateHalf.slice(secondCandidateHalf.length);
  const hiddenExperimentLines = cleanAExperiment
    ? candidateHalf.slice(0, 2)
    : eighthExperiment
    ? thirdCandidateHalf.slice(6, 7)
    : seventhExperiment
      ? thirdCandidateHalf.slice(5, 6)
    : sixthExperiment
    ? [
      ...secondCandidateHalf.slice(0, Math.ceil(secondCandidateHalf.length / 2)),
      ...thirdCandidateHalf.slice(0, 2),
      ...thirdCandidateHalf.slice(2, 5),
    ]
    : fifthExperiment
    ? [
      ...secondCandidateHalf.slice(0, Math.ceil(secondCandidateHalf.length / 2)),
      ...thirdCandidateHalf.slice(0, 2),
    ]
    : fourthExperiment
      ? [
        ...secondCandidateHalf.slice(0, Math.ceil(secondCandidateHalf.length / 2)),
        ...thirdCandidateHalf.slice(0, Math.ceil(thirdCandidateHalf.length / 2)),
      ]
      : thirdExperiment
        ? secondCandidateHalf.slice(0, Math.ceil(secondCandidateHalf.length / 2))
        : secondExperiment
          ? secondCandidateHalf
          : candidateHalf;
  const hiddenCheekHalf = new Set(
    hiddenExperimentLines.map((line) => line.name),
  );
  const experimentDisplayLines = temporaryAlarExperimentEnabled()
    ? allDisplayLines.filter((line) => !hiddenCheekHalf.has(line.name))
    : allDisplayLines;
  const pairFilteredLines = temporaryCrossPairExperimentEnabled()
    ? experimentDisplayLines.filter((line) => !temporaryCrossPairLineHidden(line.name))
    : experimentDisplayLines;
  const displayLines = temporarySingleLineExperimentEnabled()
    ? pairFilteredLines.filter((line) => !temporarySingleLineHidden(line.name))
    : pairFilteredLines;
  if (temporaryCrossPairExperimentEnabled() && crossPairExperimentDiagnosticKey !== `${experimentDisplayLines.length}:${displayLines.length}`) {
    crossPairExperimentDiagnosticKey = `${experimentDisplayLines.length}:${displayLines.length}`;
    console.info("[rstl-cross-hide] " + JSON.stringify({
      before: experimentDisplayLines.length,
      after: displayLines.length,
      names: experimentDisplayLines.map((line, index) => ({ index, name: line.name })).filter((entry) =>
        temporaryCrossPairLineHidden(entry.name)),
    }));
  }
  if (benchmark && !benchmark.seedRstl) benchmark.seedRstl = sampleBenchmarkLines(displayLines);
  if (sample) sample.rstl = sampleBenchmarkLines(displayLines);
  const selectedLine = refineActive ? selectedLineIndex() : null;
  const selectedPoint = refineActive ? selectedPointIndex() : null;
  const pointMode = refineActive && isPointRefineMode();
  const pointWindow = pointMode ? selectedPointWindow() : null;
  const symmetryPartner = refineActive ? symmetryPartnerIndex() : null;
  const bb = faceBBox(lm);
  const visibleLineIndices = refineActive ? null : lineIndicesForDensity(displayLines || [], renderState.densityFrac);
  const hasMasks = masks.length > 0;
  // 外推的额头弧线要按头部包络 + 肤色再裁一次，否则会画到头发/背景/脸外（#141）
  const foreheadSample = shouldDrawRstlLayer() ? readForeheadImageData(W, H) : null;
  const photoHairMask = sourceState.sourceKind === "image" ? currentRstlPhotoHairMask() : null;
  const skinVisible = buildForeheadSkinVisibility(
    photoHairMask ? null : foreheadSample?.image || null,
    W,
    H,
    lm,
    foreheadSample?.scale || 1,
    sourceState.sourceKind === "camera" || sourceState.sourceKind === "video",
  );
  const headVisible = buildHeadVisibility(lm);
  const faceHullVisible = buildFaceHullVisibility(lm, 10);
  const faceOvalVisible = buildFaceOvalVisibility(lm, 4);
  const glabellaCenterX = Number.isFinite(lm[9]?.[0]) && Number.isFinite(lm[10]?.[0])
    ? (lm[9][0] + lm[10][0]) * 0.5
    : W * 0.5;
  const glabellaBand = Math.max(24, bb.w * 0.30);
  const v69SkinFallback = (point: Vec3): boolean => headVisible(point)
    && faceOvalVisible(point)
    && Math.abs(point[0] - glabellaCenterX) <= glabellaBand;
  const lipBottomY = lm[17]?.[1];
  const chinBottomY = lm[152]?.[1];
  const lowerFaceVisible = (point: Vec3): boolean => {
    if (!Number.isFinite(lipBottomY) || !Number.isFinite(chinBottomY)) return true;
    if (point[1] <= lipBottomY + (chinBottomY - lipBottomY) * 0.55) return true;
    return faceOvalVisible(point) && point[1] <= chinBottomY + Math.max(2, Math.min(W, H) * 0.002);
  };
  const chinAppearanceVisible = sourceState.sourceKind === "image"
    ? buildChinAppearanceVisibility(foreheadSample?.image || null, lm, foreheadSample?.scale || 1)
    : () => true;
  const frameQualityGate = estimateRenderQualityGate(lm, W, H);
  const canDrawAtlas = sourceState.sourceKind === "image" || frameQualityGate.passed;
  const localRegionQuality = frameQualityGate.local_region_quality;
  const localRegionMasks = buildLocalRegionMasks(lm, localRegionQuality);
  const frozenBoxes = localRegionMasks.filter((region) => region.action === "freeze").flatMap((region) => region.boxes);
  const dimRegions = localRegionMasks.filter((region) => region.action === "dim");
  const linesStart = sample ? performance.now() : 0;

  ctx.save();
  ctx.globalAlpha = renderState.opacity; ctx.lineWidth = Math.max(2, W / 1300);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  let count = 0;
  if (canDrawAtlas && shouldDrawRstlLayer() && mobileRstlLayerVisible()) {
    const drawEntries: Array<{
      line: MappedAtlasLine;
      index: number;
      mask: number[];
      action: ReturnType<typeof localActionForPoints>;
      selected: boolean;
      partner: boolean;
    }> = [];
    const rawMasks = displayLines.map(() => [] as number[]);
    for (let li = 0; li < displayLines.length; li++) {
      if (visibleLineIndices && !visibleLineIndices.has(li)) continue;
      const ln = displayLines[li];
      // Final draw-path guard for the reversible cross-pair experiment.
      if (temporaryCrossPairLineHidden(ln.name) || temporarySingleLineHidden(ln.name)) continue;
      if (ln.hidden) continue;
      const isSelected = refineActive && li === selectedLine;
      const isPartner = refineActive && li === symmetryPartner;
      // 每点可见性 = 朝向相机(背面剔除) 且 不属于口裂三角面 且 不在前方手部凸包内
      // 外推的额头弧线额外要求落在头部包络内且采样点是皮肤，再做一次段稳定化（#141）
      const extendedForehead = EXTENDED_FOREHEAD_REGIONS.has(ln.region);
      let onVisibleSkin: boolean[] = ln.pts.map(() => true);
      if (extendedForehead) {
        const rawForeheadVisibility = ln.pts.map((p) => headVisible(p) && skinVisible(p)
          || (MEDIAL_UPWARD_EXTENSION_REGIONS.has(ln.region) && v69SkinFallback(p)));
        // These points are an intentional continuation of a vertical
        // glabellar line. The generic forehead stabilizer can treat the new
        // points as an isolated short arc and remove the whole continuation;
        // keep the geometric head/oval gate while preserving this line's
        // continuous extension.
        onVisibleSkin = MEDIAL_UPWARD_EXTENSION_REGIONS.has(ln.region)
          ? rawForeheadVisibility
          : stabilizeForeheadMask(rawForeheadVisibility);
      }
      const mask = ln.pts.map((p, i) => {
        if (ln.hiddenPointRuns?.some(([start, length]) =>
          i >= start && i < start + length)) return 0;
        const triangleIndex = ln.tris[i];
        const v = vis && Number.isInteger(triangleIndex) ? vis[triangleIndex] : 1;
        if (innerMouth.has(ln.tris[i])) return 0; // 口裂三角面无论朝向都排除（#38）
        if (!onVisibleSkin[i]) return 0;
        if (photoHairMask && !extendedForehead
            && (!faceHullVisible(p) || !lowerFaceVisible(p) || !chinAppearanceVisible(p))) return 0;
        if (frozenBoxes.some((box) => pointInBox(p, box))) return 0;
        return v && !(hasMasks && pointInHandMasks(toPoint2(p), masks)) ? 1 : 0;
      });
      rawMasks[li] = mask;
      drawEntries.push({ line: ln, index: li, mask, action: localActionForPoints(ln.pts, dimRegions),
        selected: isSelected, partner: isPartner });
    }
    const safeMasks = buildTopologySafeRstlMasks(displayLines, rawMasks);
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("rstlCrossDebugAll") === "1") {
      ctx.save();
      ctx.fillStyle = "#ff3030";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1.5, W / 900);
      for (const point of rstlCrossDebugPoints) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(5, W / 180), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const entry of drawEntries) {
      const { line: ln, index: li, selected: isSelected, partner: isPartner } = entry;
      const mask = safeMasks[li];
      const extendedForehead = EXTENDED_FOREHEAD_REGIONS.has(ln.region);
      if (renderState.bands) {
        let my = 0; for (const p of ln.pts) my += p[1]; my = (my / ln.pts.length - bb.y0) / (bb.h || 1);
        ctx.strokeStyle = my < 0.36 ? BAND.top : my < 0.66 ? BAND.mid : BAND.low;
      } else ctx.strokeStyle = SOLID[renderState.system as keyof typeof SOLID] || SOLID.rstl;
      const refinementColor = getRefinementHighlightColor(ln, li);
      if (refinementColor) ctx.strokeStyle = refinementColor;
      if (isSelected) {
        ctx.strokeStyle = "#42be65";
        ctx.lineWidth = Math.max(2.5, W / 520);
      } else if (isPartner) {
        ctx.strokeStyle = "#78a9ff";
        ctx.lineWidth = Math.max(2, W / 680);
        ctx.setLineDash([8, 6]);
      } else {
        ctx.lineWidth = Math.max(2, W / 1300);
      }
      const localLineAction = entry.action;
      const savedAlpha = ctx.globalAlpha;
      if (localLineAction.action === "dim") ctx.globalAlpha = savedAlpha * localLineAction.opacityScale;
      for (const run of visibleRuns(ln.pts, mask)) {
        const photoRuns = photoHairMask
          ? clipRstlRunToPhotoHair(run, photoHairMask, ctx.lineWidth / 2 + 2,
            (point) => extendedForehead || (faceHullVisible(point)
              && lowerFaceVisible(point) && chinAppearanceVisible(point)))
          : [run];
        for (const photoRun of photoRuns) {
          ctx.beginPath(); ctx.moveTo(photoRun[0][0], photoRun[0][1]);
          for (let i = 1; i < photoRun.length; i++) ctx.lineTo(photoRun[i][0], photoRun[i][1]);
          ctx.stroke();
        }
      }
      if (isPartner) ctx.setLineDash([]);
      ctx.globalAlpha = savedAlpha;
      count++;
    }
  }
  if (sample) sample.stages.rstlStrokes = performance.now() - linesStart;
  const wrinklesStart = sample ? performance.now() : 0;
  if (canDrawAtlas && shouldDrawWrinkleLayer() && mobileWrinkleLayerVisible()) {
    const evidenceLines = getWrinkleEvidenceLines();
    const evidenceColors = [
      ["forehead", "#ff9f1c"],
      ["frown", "#ff4d6d"],
      ["wrinkle", "#00d4ff"],
      ["", "#ff832b"],
    ] as const;
    ctx.save();
    ctx.globalAlpha = 0.96;
    // Keep wrinkle evidence visually consistent when videos have different
    // source resolutions or aspect ratios and are fitted into the same stage.
    ctx.lineWidth = wrinkleStrokeWidthForFace(bb.w, W);
    ctx.setLineDash([]);
    for (const [className, color] of evidenceColors) {
      ctx.beginPath();
      let hasSegments = false;
      for (const line of evidenceLines) {
        if ((className ? line.className !== className :
          line.className === "forehead" || line.className === "frown" || line.className === "wrinkle")
          || line.points.length < 2) continue;
        ctx.moveTo(line.points[0][0], line.points[0][1]);
        for (let index = 1; index < line.points.length; index++) {
          ctx.lineTo(line.points[index][0], line.points[index][1]);
        }
        hasSegments = true;
        count++;
      }
      if (hasSegments) {
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  if (sample) sample.stages.wrinkleStrokes = performance.now() - wrinklesStart;
  if (showSymmetryAxis()) {
    const axis = symmetryAxisX();
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#f1c21b";
    ctx.lineWidth = Math.max(1.5, W / 900);
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(axis, 0);
    ctx.lineTo(axis, H);
    ctx.stroke();
    ctx.restore();
  }
  if (pointMode && selectedLine != null) {
    const points = displayLines[selectedLine]?.pts || [];
    ctx.save();
    ctx.globalAlpha = 0.95;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const point = points[pointIndex];
      if (!point) continue;
      const inWindow = pointWindow && pointIndex >= pointWindow.start && pointIndex <= pointWindow.end;
      ctx.fillStyle = pointIndex === selectedPoint ? "#f1c21b" : inWindow ? "#a7f0d2" : "#f4f7fb";
      ctx.strokeStyle = inWindow ? "#198754" : "#42be65";
      ctx.lineWidth = Math.max(1, W / 1200);
      ctx.beginPath();
      ctx.arc(point[0], point[1], Math.max(2.5, W / 360), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  if (refineActive && selectedLine != null && selectedPoint != null) {
    const point = displayLines[selectedLine]?.pts?.[selectedPoint];
    if (point) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#f1c21b";
      ctx.strokeStyle = "#11151c";
      ctx.lineWidth = Math.max(1.5, W / 900);
      ctx.beginPath();
      ctx.arc(point[0], point[1], Math.max(4, W / 180), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (canDrawAtlas && renderState.meshPts) {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "#d0e2ff";
    ctx.strokeStyle = "#07111f";
    ctx.lineWidth = Math.max(1, W / 1000);
    for (let i = 0; i < lm.length; i += 1) {
      if (hasMasks && pointInHandMasks(toPoint2(lm[i]), masks)) continue;
      ctx.beginPath();
      ctx.arc(lm[i][0], lm[i][1], Math.max(2, W / 650), 0, 6.283);
      ctx.fill();
      ctx.stroke();
    }
  }
  drawIncisionOverlay(lm, W, H, masks, vis, innerMouth, frameQualityGate, localRegionQuality, localRegionMasks);
  ctx.restore();
  return count;
}

function overlayMask(
  mapped: MappedAtlasLine,
  masks: HandMask[],
  vis: Uint8Array | null,
  innerMouth: Set<number>,
  localRegionMasks: LocalRegionMask[] = [],
): number[] {
  const hasMasks = masks.length > 0;
  return mapped.pts.map((p, i) => {
    const tri = mapped.tris[i];
    const front = vis ? vis[tri] : 1;
    if (innerMouth.has(tri)) return 0;
    if (localActionForPoints([p], localRegionMasks).action === "freeze") return 0;
    return front && !(hasMasks && pointInHandMasks(toPoint2(p), masks)) ? 1 : 0;
  });
}

function strokeOverlayRefs(
  refs: SurfaceRef[],
  lm: Vec3[],
  masks: HandMask[],
  vis: Uint8Array | null,
  innerMouth: Set<number>,
  style: { color: string; lineWidth: number; dash?: number[] },
  localRegionMasks: LocalRegionMask[] = [],
): void {
  const mapped = mapSurfaceRefs(refs, lm, modelTriangles());
  if (mapped.pts.length < 2) return;
  const mask = overlayMask(mapped as MappedAtlasLine, masks, vis, innerMouth, localRegionMasks);
  const localAction = localActionForPoints(mapped.pts, localRegionMasks);
  const savedAlpha = ctx.globalAlpha;
  if (localAction.action === "dim") ctx.globalAlpha = savedAlpha * localAction.opacityScale;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.dash || []);
  for (const run of visibleRuns(mapped.pts, mask)) {
    ctx.beginPath();
    ctx.moveTo(run[0][0], run[0][1]);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = savedAlpha;
}

function overlayRuntimeKey(overlay: AnyRecord | null | undefined): string {
  return [
    overlay?.schema_version || "",
    overlay?.created_at || "",
    overlay?.label || "",
    overlay?.candidate_type || "",
    overlay?.candidate?.polyline_refs?.length || 0,
    overlay?.tumor?.boundary_refs?.length || 0,
  ].join("|");
}

function cloneLandmarkFrame(lm: Vec3[] | null | undefined): Vec3[] {
  return (lm || []).map((p) => {
    const x = Number(p?.[0]);
    const y = Number(p?.[1]);
    const z = Number(p?.[2] ?? 0);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : [NaN, NaN, NaN];
  });
}

function compactRegistration(registration: AnyRecord | null | undefined): AnyRecord | null {
  if (!registration) return null;
  return {
    schema_version: registration.schema_version,
    passed: registration.passed,
    reason: registration.reason,
    reasons: registration.reasons || [],
    frame: registration.frame,
    mapped_point_count: registration.mapped_point_count,
    candidate_point_count: registration.candidate_point_count,
    tumor_center_mapped: registration.tumor_center_mapped,
    invalid_ref_count: registration.invalid_ref_count,
    missing_landmark_count: registration.missing_landmark_count,
    degenerate_triangle_count: registration.degenerate_triangle_count,
    out_of_frame_count: registration.out_of_frame_count,
    out_of_frame_fraction: registration.out_of_frame_fraction,
    bbox_px: registration.bbox_px,
    clinical_boundary: registration.clinical_boundary,
  };
}

function compactStability(stability: AnyRecord | null | undefined): AnyRecord | null {
  if (!stability) return null;
  return {
    schema_version: stability.schema_version,
    passed: stability.passed,
    reason: stability.reason,
    frame_count: stability.frame_count,
    tracked_point_count: stability.tracked_point_count,
    sample_count: stability.sample_count,
    thresholds: stability.thresholds,
    overall: stability.overall,
    by_group: stability.by_group,
  };
}

function compactPoseGate(poseGate: AnyRecord | null | undefined): AnyRecord | null {
  if (!poseGate) return null;
  return {
    schema_version: poseGate.schema_version,
    passed: poseGate.passed,
    reason: poseGate.reason,
    reasons: poseGate.reasons || [],
    source_kind: poseGate.source_kind,
    presence: poseGate.presence,
    yaw_norm: poseGate.yaw_norm,
    abs_yaw_norm: poseGate.abs_yaw_norm,
    frame_motion_norm: poseGate.frame_motion_norm,
    face_frame_fraction: poseGate.face_frame_fraction,
    expression: poseGate.expression,
    thresholds: poseGate.thresholds,
  };
}

function compactLocalRegionQuality(localRegionQuality: AnyRecord | null | undefined): AnyRecord | null {
  if (!localRegionQuality) return null;
  return {
    schema_version: localRegionQuality.schema_version,
    passed: localRegionQuality.passed,
    reason: localRegionQuality.reason,
    reasons: localRegionQuality.reasons || [],
    source_kind: localRegionQuality.source_kind,
    active_region_count: localRegionQuality.active_region_count,
    active_regions: localRegionQuality.active_regions || [],
    regions: (localRegionQuality.regions || []).map((region: AnyRecord) => ({
      id: region.id,
      label: region.label,
      action: region.action,
      opacity_scale: region.opacity_scale,
      reasons: region.reasons || [],
      motion_norm: region.motion_norm,
      expression_metric: region.expression_metric,
      expression_value: region.expression_value,
    })),
    thresholds: localRegionQuality.thresholds,
    clinical_boundary: localRegionQuality.clinical_boundary,
  };
}

function compactLandmarkSmoothing() {
  const smoother = (renderState.smoother || {}) as AnyRecord;
  const hasGlobal = Number.isFinite(smoother.globalMinCutoff) || Number.isFinite(smoother.globalBeta);
  return {
    schema_version: "landmark-motion-stabilized-smoothing/v0.1",
    enabled: renderState.smoothLevel > 0,
    smooth_level: Number(renderState.smoothLevel.toFixed(3)),
    method: hasGlobal ? "global_translation_plus_local_one_euro" : "pointwise_one_euro",
    local: {
      min_cutoff: smoother.minCutoff,
      beta: smoother.beta,
      dcutoff: smoother.dcutoff,
    },
    global: hasGlobal ? {
      min_cutoff: smoother.globalMinCutoff,
      beta: smoother.globalBeta,
      dcutoff: smoother.globalDcutoff,
      anchor_count: smoother.anchorIndices?.length || 0,
    } : null,
    exported_landmarks: false,
    clinical_boundary: "Smoothing diagnostics expose parameters only, not landmark coordinates.",
  };
}

function localQualityNeedsReview(localRegionQuality: AnyRecord | null | undefined): boolean {
  return Boolean(localRegionQuality && localRegionQuality.passed === false && localRegionQuality.active_region_count > 0);
}

function localQualitySummary(localRegionQuality: AnyRecord | null | undefined): string {
  const active = (localRegionQuality?.regions || []).filter((region: AnyRecord) => region.action !== "normal");
  if (!active.length) return "局部区域通过";
  return active
    .map((region: AnyRecord) => `${region.label || region.id}:${region.action === "freeze" ? "冻结" : "降透明"}(${compactReason(region.reasons?.[0])})`)
    .join("；");
}

function expandedBox(box: Bounds | null | undefined, padFrac = 0.18): Rect | null {
  if (!box) return null;
  const pad = Math.max(box.w, box.h) * padFrac;
  return {
    x0: box.x0 - pad,
    y0: box.y0 - pad,
    x1: box.x1 + pad,
    y1: box.y1 + pad,
  };
}

function pointInBox(p: number[] | null | undefined, box: Rect | null | undefined): boolean {
  return Boolean(p && box && p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.y0 && p[1] <= box.y1);
}

function pointMean(points: Array<number[] | null | undefined> | null | undefined): Point2 | null {
  let x = 0, y = 0, count = 0;
  for (const p of points || []) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    x += p[0]; y += p[1]; count += 1;
  }
  return count ? [x / count, y / count] : null;
}

function buildLocalRegionMasks(lm: Vec3[], localRegionQuality: AnyRecord | null | undefined): LocalRegionMask[] {
  return (localRegionQuality?.regions || [])
    .filter((region: AnyRecord) => region.action && region.action !== "normal")
    .map((region: AnyRecord) => {
      const labels = LOCAL_REGION_RENDER_GROUPS[String(region.id)] || [];
      const boxes = labels
        .map((label: string) => ZOOM_REGIONS.find((r) => r.label === label))
        .filter(Boolean)
        .map((sourceRegion) => expandedBox(regionBounds(lm, sourceRegion as ZoomRegion)))
        .filter(Boolean);
      return {
        id: region.id,
        label: region.label,
        action: region.action,
        opacityScale: Number.isFinite(region.opacity_scale) ? region.opacity_scale : 1,
        boxes,
      };
    })
    .filter((region: LocalRegionMask) => region.boxes.length);
}

function localActionForPoints(
  points: Array<number[] | null | undefined>,
  localRegionMasks: LocalRegionMask[] = [],
): LocalRegionActionResult {
  const action: LocalRegionActionResult = { action: "normal", opacityScale: 1 };
  if (!localRegionMasks.length) return action;
  const probes = [...(points || []), pointMean(points)].filter(Boolean);
  for (const region of localRegionMasks) {
    if (!probes.some((p) => region.boxes.some((box: Rect) => pointInBox(p, box)))) continue;
    if (region.action === "freeze") return { action: "freeze", opacityScale: 0 };
    if (region.action === "dim") action.action = "dim";
    action.opacityScale = Math.min(action.opacityScale, region.opacityScale);
  }
  return action;
}

function updateIncisionOverlayRuntimeDiagnostics(
  overlay: AnyRecord,
  registration: AnyRecord,
  stability: AnyRecord | null,
  poseGate: AnyRecord,
  localRegionQuality: AnyRecord | null | undefined,
): void {
  setDiagnosticSection("incision_overlay_runtime", {
    schema_version: "incision-overlay-runtime-diagnostics/v0.1",
    updated_at: new Date().toISOString(),
    raw_image_sent: false,
    exported_raw_pixels: false,
    exported_landmarks: false,
    rolling_window_frame_count: INCISION_OVERLAY_STABILITY_FRAMES,
    rolling_frame_count: overlayRuntimeDiagnostics.landmarkFrames.length,
    overlay: {
      schema_version: overlay?.schema_version || "",
      label: overlay?.label || "",
      candidate_type: overlay?.candidate_type || "",
      tumor_kind: overlay?.tumor_kind || "",
      review_status: overlay?.review?.status || "",
      guardrails_passed: overlay?.candidate?.guardrails_passed === true,
      high_guardrail_codes: overlay?.candidate?.high_guardrail_codes || [],
      live_overlay_ready: overlay?.review_gate?.live_overlay_ready === true,
    },
    pose_gate: compactPoseGate(poseGate),
    local_region_quality: compactLocalRegionQuality(localRegionQuality),
    landmark_smoothing: compactLandmarkSmoothing(),
    registration: compactRegistration(registration),
    stability: compactStability(stability),
    clinical_boundary: "Runtime overlay diagnostics are engineering QA signals, not clinical AR registration.",
  });
}

function updateIncisionOverlayQa(
  registration: AnyRecord,
  stability: AnyRecord | null,
  poseGate: AnyRecord,
  localRegionQuality: AnyRecord | null | undefined,
): void {
  if (poseGate && !poseGate.passed) {
    setIncisionOverlayQa({
      tone: "warn",
      label: "姿态需复核",
      detail: `工程 QA：${compactReason(poseGate.reason)}；${poseGateQaSummary(poseGate)}。暂不绘制候选叠加。`,
    });
    return;
  }
  if (!registration?.passed) {
    setIncisionOverlayQa({
      tone: "warn",
      label: "投射需复核",
      detail: `工程 QA：${compactReason(registration?.reason)}；映射点 ${registration?.mapped_point_count ?? 0}，出画面 ${registration?.out_of_frame_count ?? 0}。`,
    });
    return;
  }
  if (localQualityNeedsReview(localRegionQuality) && registration?.passed) {
    setIncisionOverlayQa({
      tone: "warn",
      label: "局部需复核",
      detail: `工程 QA：${localQualitySummary(localRegionQuality)}；局部线条已降透明或断开，请在静止帧复核。`,
    });
    return;
  }
  if (!stability) {
    setIncisionOverlayQa({
      label: "已投射",
      detail: `工程 QA：映射点 ${registration.mapped_point_count}；等待连续帧稳定性。`,
    });
    return;
  }
  const detail = `工程 QA：映射点 ${registration.mapped_point_count}；RMS ${fmtPx(stability.overall?.rms_px)} / P95 ${fmtPx(stability.overall?.p95_px)} / max ${fmtPx(stability.overall?.max_px)}。`;
  setIncisionOverlayQa({
    tone: stability.passed ? "ok" : "warn",
    label: stability.passed ? "叠加稳定" : "抖动需复核",
    detail: stability.passed ? detail : `${detail} 原因：${compactReason(stability.reason)}。`,
  });
}

function poseGateQaSummary(poseGate: AnyRecord): string {
  const parts = [
    `偏航 ${fmtRatio(poseGate.yaw_norm)} / 门槛 ±${fmtRatio(poseGate.thresholds?.max_abs_yaw_norm)}`,
    `检测 ${fmtPercent(poseGate.presence)}`,
  ];
  if (poseGate.frame_motion_norm != null) {
    parts.push(`运动 ${fmtRatio(poseGate.frame_motion_norm)} / 门槛 ${fmtRatio(poseGate.thresholds?.max_frame_motion_norm)}`);
  }
  if (poseGate.expression?.jaw_open != null) {
    parts.push(`张口 ${fmtPercent(poseGate.expression.jaw_open)}`);
  }
  if (poseGate.expression?.eye_blink_max != null) {
    parts.push(`眨眼 ${fmtPercent(poseGate.expression.eye_blink_max)}`);
  }
  return parts.join("，");
}

function recordIncisionOverlayRegistration(overlay: AnyRecord, lm: Vec3[], W: number, H: number): AnyRecord {
  const registration = measureIncisionOverlayRegistration(overlay, lm, modelTriangles(), {
    frameWidth: W,
    frameHeight: H,
  });
  countMetric(registration.passed ? "incisionOverlay.registration.pass" : "incisionOverlay.registration.fail");
  recordMetricSample("incisionOverlay.registration.mappedPointCount", registration.mapped_point_count, {
    passed: registration.passed,
    reason: registration.reason,
  });
  recordMetricSample("incisionOverlay.registration.outOfFrameCount", registration.out_of_frame_count, {
    passed: registration.passed,
    reason: registration.reason,
  });
  if (registration.bbox_px?.diagonal_px != null) {
    recordMetricSample("incisionOverlay.registration.bboxDiagonalPx", registration.bbox_px.diagonal_px, {
      passed: registration.passed,
      reason: registration.reason,
    });
  }
  return registration;
}

function recordIncisionOverlayStability(overlay: AnyRecord, lm: Vec3[]): AnyRecord | null {
  const key = overlayRuntimeKey(overlay);
  if (overlayRuntimeDiagnostics.key !== key) {
    overlayRuntimeDiagnostics.key = key;
    overlayRuntimeDiagnostics.landmarkFrames = [];
  }
  overlayRuntimeDiagnostics.landmarkFrames.push(cloneLandmarkFrame(lm));
  if (overlayRuntimeDiagnostics.landmarkFrames.length > INCISION_OVERLAY_STABILITY_FRAMES) {
    overlayRuntimeDiagnostics.landmarkFrames.splice(
      0,
      overlayRuntimeDiagnostics.landmarkFrames.length - INCISION_OVERLAY_STABILITY_FRAMES,
    );
  }
  if (overlayRuntimeDiagnostics.landmarkFrames.length < 2) return null;
  const stability = measureIncisionOverlayJitter(
    overlay,
    overlayRuntimeDiagnostics.landmarkFrames,
    modelTriangles(),
    { context: "live_runtime_overlay_window" },
  );
  countMetric(stability.passed ? "incisionOverlay.stability.pass" : "incisionOverlay.stability.fail");
  if (stability.overall?.rms_px != null) {
    recordMetricSample("incisionOverlay.stability.rmsPx", stability.overall.rms_px, {
      passed: stability.passed,
      reason: stability.reason,
      frameCount: stability.frame_count,
    });
  }
  if (stability.overall?.p95_px != null) {
    recordMetricSample("incisionOverlay.stability.p95Px", stability.overall.p95_px, {
      passed: stability.passed,
      reason: stability.reason,
      frameCount: stability.frame_count,
    });
  }
  if (stability.overall?.max_px != null) {
    recordMetricSample("incisionOverlay.stability.maxPx", stability.overall.max_px, {
      passed: stability.passed,
      reason: stability.reason,
      frameCount: stability.frame_count,
    });
  }
  return stability;
}

function recordIncisionOverlayPoseGate(poseGate: AnyRecord): void {
  countMetric(poseGate.passed ? "incisionOverlay.poseGate.pass" : "incisionOverlay.poseGate.blocked");
  if (poseGate.abs_yaw_norm != null) {
    recordMetricSample("incisionOverlay.poseGate.absYawNorm", poseGate.abs_yaw_norm, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.presence != null) {
    recordMetricSample("incisionOverlay.poseGate.presence", poseGate.presence, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.frame_motion_norm != null) {
    recordMetricSample("incisionOverlay.poseGate.frameMotionNorm", poseGate.frame_motion_norm, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.expression?.jaw_open != null) {
    recordMetricSample("incisionOverlay.poseGate.jawOpen", poseGate.expression.jaw_open, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
  if (poseGate.expression?.eye_blink_max != null) {
    recordMetricSample("incisionOverlay.poseGate.eyeBlinkMax", poseGate.expression.eye_blink_max, {
      passed: poseGate.passed,
      reason: poseGate.reason,
      sourceKind: poseGate.source_kind,
    });
  }
}

function recordLocalRegionQuality(localRegionQuality: AnyRecord | null | undefined): void {
  if (!localRegionQuality) return;
  countMetric(localQualityNeedsReview(localRegionQuality)
    ? "incisionOverlay.localRegionQuality.review"
    : "incisionOverlay.localRegionQuality.pass");
  recordMetricSample("incisionOverlay.localRegionQuality.activeRegionCount", localRegionQuality.active_region_count || 0, {
    passed: localRegionQuality.passed,
    reason: localRegionQuality.reason,
  });
  for (const region of localRegionQuality.regions || [] as AnyRecord[]) {
    if (region.motion_norm != null) {
      recordMetricSample("incisionOverlay.localRegionQuality.regionMotionNorm", region.motion_norm, {
        region: region.id,
        action: region.action,
        reason: region.reasons?.[0] || "local_regions_passed",
      });
    }
  }
}

function drawIncisionOverlay(
  lm: Vec3[],
  W: number,
  H: number,
  masks: HandMask[],
  vis: Uint8Array | null,
  innerMouth: Set<number>,
  poseGate: AnyRecord,
  localRegionQuality: AnyRecord | null | undefined,
  localRegionMasks: LocalRegionMask[],
): void {
  const overlay = renderState.incisionOverlay as AnyRecord | null;
  if (!overlay) {
    overlayRuntimeDiagnostics.key = null;
    overlayRuntimeDiagnostics.landmarkFrames = [];
    setDiagnosticSection("incision_overlay_runtime", null);
    setIncisionOverlayQa(null);
    return;
  }
  const key = overlayRuntimeKey(overlay);
  if (overlayRuntimeDiagnostics.key !== key) {
    overlayRuntimeDiagnostics.key = key;
    overlayRuntimeDiagnostics.landmarkFrames = [];
  }
  recordIncisionOverlayPoseGate(poseGate);
  recordLocalRegionQuality(localRegionQuality);
  const registration = recordIncisionOverlayRegistration(overlay, lm, W, H);
  let stability: AnyRecord | null = null;
  if (poseGate.passed) {
    stability = recordIncisionOverlayStability(overlay, lm);
  } else {
    overlayRuntimeDiagnostics.landmarkFrames = [];
  }
  updateIncisionOverlayRuntimeDiagnostics(overlay, registration, stability, poseGate, localRegionQuality);
  updateIncisionOverlayQa(registration, stability, poseGate, localRegionQuality);
  if (!poseGate.passed) return;
  if (sourceState.sourceKind === "image" && renderState.workflowPhotoOverlay) return;
  ctx.save();
  ctx.globalAlpha = 0.98;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const cssScale = Math.max(0.1, els.canvas.getBoundingClientRect().width / Math.max(W, 1));
  const overlayStyle = incisionOverlayScreenStyle(overlay.candidate_type, {
    compact: mobileWorkflowViewportActive(),
  });
  const boundaryRefs = surfaceRefs(overlay.tumor?.boundary_refs);
  strokeOverlayRefs(boundaryRefs, lm, masks, vis, innerMouth, {
    color: overlayStyle.boundary.haloColor,
    lineWidth: overlayStyle.boundary.haloWidth / cssScale,
  }, localRegionMasks);
  strokeOverlayRefs(boundaryRefs, lm, masks, vis, innerMouth, {
    color: overlayStyle.boundary.color,
    lineWidth: overlayStyle.boundary.lineWidth / cssScale,
  }, localRegionMasks);
  const candidateRefs = surfaceRefs(overlay.candidate?.polyline_refs);
  if (mobileIncisionCandidateVisible()) {
    strokeOverlayRefs(candidateRefs, lm, masks, vis, innerMouth, {
      color: overlayStyle.candidate.haloColor,
      lineWidth: overlayStyle.candidate.haloWidth / cssScale,
    }, localRegionMasks);
    strokeOverlayRefs(candidateRefs, lm, masks, vis, innerMouth, {
      color: overlayStyle.candidate.color,
      lineWidth: overlayStyle.candidate.lineWidth / cssScale,
    }, localRegionMasks);
  }
  const center = mapSurfaceRefs(optionalSurfaceRef(overlay.tumor?.center_ref), lm, modelTriangles()).pts[0];
  const incisionCenter = mapSurfaceRefs(optionalSurfaceRef(overlay.candidate?.center_ref), lm, modelTriangles()).pts[0];
  const centerLocalAction = localActionForPoints([center], localRegionMasks);
  const centerOccluded = Boolean(center && masks.length && pointInHandMasks(toPoint2(center), masks));
  const drawLesionCenter = () => { if (center && centerLocalAction.action !== "freeze" && !centerOccluded) {
    const savedAlpha = ctx.globalAlpha;
    if (centerLocalAction.action === "dim") ctx.globalAlpha = savedAlpha * centerLocalAction.opacityScale;
    ctx.fillStyle = overlayStyle.center.color;
    ctx.strokeStyle = overlayStyle.center.strokeColor;
    ctx.lineWidth = overlayStyle.center.strokeWidthCss / cssScale;
    ctx.beginPath();
    ctx.arc(center[0], center[1], overlayStyle.center.radiusCss / cssScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = savedAlpha;
  } };
  if (incisionCenter) {
    const radius = overlayStyle.incisionCenter.radiusCss / cssScale;
    ctx.fillStyle = overlayStyle.incisionCenter.color;
    ctx.strokeStyle = overlayStyle.incisionCenter.strokeColor;
    ctx.lineWidth = overlayStyle.incisionCenter.strokeWidthCss / cssScale;
    ctx.beginPath();
    ctx.arc(incisionCenter[0], incisionCenter[1], radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  drawLesionCenter();
  ctx.restore();
}

// ── 细节放大窗 ────────────────────────────────────────────────────────────────
export function buildZoomCards(onSelect: () => void = () => {}): void {
  els.zoomStrip.innerHTML = "";
  const zoomItems: ZoomItem[] = [
    { label: "全脸", region: null },
    ...(renderState.incisionOverlay ? [{ label: "切口候选", region: INCISION_ZOOM_REGION }] : []),
    ...ZOOM_REGIONS.map((region) => ({ label: region.label, region })),
  ];
  renderState.zoomCards = zoomItems.map((item) => {
    const card = document.createElement("div"); card.className = "zoom-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", item.region ? `进入${item.label}局部微调` : "返回全脸视图");
    card.title = item.region ? `点击进入${item.label}局部微调` : "点击返回全脸视图";
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 300;
    if (renderState.mirror) cv.classList.add("mirror");
    const tag = document.createElement("div"); tag.className = "tag"; tag.textContent = item.label;
    card.appendChild(cv); card.appendChild(tag); els.zoomStrip.appendChild(card);
    const select = () => {
      const nextRegion = item.region && renderState.focusRegion !== item.region ? item.region : null;
      setFocusRegion(nextRegion);
      onSelect();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      select();
    });
    return { region: item.region, card, canvas: cv, ctx: cv.getContext("2d") as CanvasRenderingContext2D };
  });
  syncFocusCards();
}

export function setFocusRegion(region: RenderRegion): void {
  renderState.focusRegion = region;
  setFocusCrop(null);
  syncFocusCards();
}

export function adjustFocusZoom(deltaY: number): boolean {
  if (!renderState.focusRegion) return false;
  const delta = clamp(deltaY || 0, -120, 120);
  renderState.focusZoom = clamp(renderState.focusZoom * Math.exp(-delta * 0.0018), focusZoomRange.min, focusZoomRange.max);
  return true;
}

function syncFocusCards() {
  (renderState.zoomCards as LiveZoomCard[]).forEach((zc) => {
    const active = zc.region === renderState.focusRegion;
    zc.card.classList.toggle("active", active);
    zc.card.setAttribute("aria-pressed", String(active));
  });
}

const zoomCadence = new LivePreviewCadence();
let zoomSource: unknown = null;

export function clearZooms(): void {
  zoomCadence.reset();
  for (const zc of renderState.zoomCards as LiveZoomCard[]) { zc.ctx.fillStyle = "#05070a"; zc.ctx.fillRect(0, 0, zc.canvas.width, zc.canvas.height); }
}

// 从已叠加线条的主画布上裁剪关键区域并放大到各窗口（线条随之放大显示）
export function drawZooms(lm: Vec3[], W: number): void {
  if (!renderState.zoom || !renderState.zoomCards.length) {
    zoomCadence.reset();
    return;
  }
  if (zoomSource !== sourceState.source) {
    zoomSource = sourceState.source;
    zoomCadence.reset();
  }
  if (!zoomCadence.shouldDraw(performance.now(), sourceState.sourceKind === "image" || sourceState.paused)) return;
  const faceW = faceBBox(lm).w || W;
  for (const zc of renderState.zoomCards as LiveZoomCard[]) {
    const g = zc.ctx, dw = zc.canvas.width, dh = zc.canvas.height;
    g.fillStyle = "#05070a"; g.fillRect(0, 0, dw, dh);
    if (!zc.region) {
      drawFullFrameCard(g, dw, dh, W, els.canvas.height);
      continue;
    }
    const box = zoomRegionBounds(lm, zc.region);
    if (!box) continue;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let s = Math.max(box.w, box.h) * 1.7;
    s = Math.max(s, faceW * 0.13);   // 避免过度放大、保留一点周边
    g.drawImage(els.canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, dw, dh);
  }
  syncFocusCards();
}

function drawFullFrameCard(g: CanvasRenderingContext2D, dw: number, dh: number, W: number, H: number): void {
  const scale = Math.min(dw / W, dh / H);
  const tw = W * scale;
  const th = H * scale;
  g.drawImage(els.canvas, 0, 0, W, H, (dw - tw) / 2, (dh - th) / 2, tw, th);
}

function boundsFromPoints(points: Array<number[] | null | undefined> | null | undefined): Bounds | null {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of points || []) {
    if (!p) continue;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  if (x1 < x0) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function regionBounds(lm: Vec3[], region: ZoomRegion): Bounds | null {
  const pts: Vec3[] = [];
  for (const i of region.idx) {
    const p = lm[i]; if (!p) continue;
    pts.push(p);
  }
  return boundsFromPoints(pts);
}

function incisionOverlayBounds(lm: Vec3[]): Bounds | null {
  const overlay = renderState.incisionOverlay as AnyRecord | null;
  if (!overlay) return null;
  const refs = [
    overlay.tumor?.center_ref,
    overlay.candidate?.center_ref,
    ...(overlay.tumor?.boundary_refs || []),
    ...(overlay.candidate?.polyline_refs || []),
  ].filter(Boolean);
  if (!refs.length) return null;
  return boundsFromPoints(mapSurfaceRefs(surfaceRefs(refs), lm, modelTriangles()).pts);
}

function zoomRegionBounds(lm: Vec3[], region: RenderRegion): Bounds | null {
  if (!region) return null;
  if (isIncisionZoomRegion(region)) return incisionOverlayBounds(lm);
  return regionBounds(lm, region);
}

export function drawFocusedRegion(lm: Vec3[] | null, W: number, H: number): void {
  const region = renderState.focusRegion as RenderRegion;
  if (!region || !lm) {
    setFocusCrop(null);
    return;
  }
  const crop = focusCropRect(lm, region, W, H);
  if (!crop) {
    setFocusCrop(null);
    return;
  }
  setFocusCrop(crop);

  focusScratch.width = W;
  focusScratch.height = H;
  focusCtx.drawImage(els.canvas, 0, 0);
  ctx.drawImage(focusScratch, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
}

function setFocusCrop(crop: { sx: number; sy: number; sw: number; sh: number } | null): void {
  const previous = renderState.focusCrop;
  const changed = previous === null || crop === null
    ? previous !== crop
    : Math.abs(previous.sx - crop.sx) > 0.01
      || Math.abs(previous.sy - crop.sy) > 0.01
      || Math.abs(previous.sw - crop.sw) > 0.01
      || Math.abs(previous.sh - crop.sh) > 0.01;
  renderState.focusCrop = crop;
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("langerface:focus-crop-changed"));
  }
}

function focusCropRect(lm: Vec3[], region: RenderRegion, W: number, H: number): { sx: number; sy: number; sw: number; sh: number } | null {
  const box = zoomRegionBounds(lm, region);
  if (!box) return null;
  const faceW = faceBBox(lm).w || W;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const zoom = clamp(renderState.focusZoom || 1.8, focusZoomRange.min, focusZoomRange.max);
  let sw = Math.max(box.w * 2.5, faceW * 0.42) / zoom;
  let sh = sw * (H / W);
  if (sh < box.h * 2.2) { sh = box.h * 2.2; sw = sh * (W / H); }
  sw = Math.min(W, sw); sh = Math.min(H, sh);
  return {
    sx: clamp(cx - sw / 2, 0, W - sw),
    sy: clamp(cy - sh / 2, 0, H - sh),
    sw,
    sh,
  };
}

// ── 统计 ──────────────────────────────────────────────────────────────────────
export function updateStats(lm: Vec3[] | null, W: number, H: number, lineCount: number): void {
  setRefineAvailability();
  const gate = sourceState.qualityGate as AnyRecord | null;
  const localRegionQuality = (sourceState.localRegionQuality || gate?.local_region_quality) as AnyRecord | null;
  const localNeedsReview = gate?.passed && localQualityNeedsReview(localRegionQuality) && sourceState.sourceKind !== "image";
  const rawQ = Math.round(sourceState.presence * 100);
  const q = gate && !gate.passed ? Math.min(rawQ, 44) : localNeedsReview ? Math.min(rawQ, 68) : rawQ;
  const label = gate && !gate.passed ? "需复核" : localNeedsReview ? "局部复核" : q >= 85 ? "稳定" : q >= 45 ? "一般" : q > 0 ? "寻找中" : "未开始";
  els.qualityVal.textContent = `${label} ${q}%`; els.qualityBar.style.width = q + "%";
  if (!lm || sourceState.presence <= 0) {
    sourceState.qualityGate = null;
    sourceState.localRegionQuality = null;
    renderQualityDiagnostics.previousFrame = null;
    renderQualityDiagnostics.source = sourceState.source;
    els.statState.textContent = sourceState.running ? "搜索中" : "未开始";
    els.statFace.textContent = els.statYaw.textContent = els.statLines.textContent = "—";
    setLive(sourceState.running && sourceState.sourceKind === "camera", sourceState.running ? els.live.dataset.k || "运行中" : "待机");
    return;
  }
  els.statState.textContent = gate && !gate.passed ? "需复核" : localNeedsReview ? "局部复核" : sourceState.presence > 0.85 ? "稳定" : "搜索中";
  const bb = faceBBox(lm);
  els.statFace.textContent = Math.round(100 * (bb.w * bb.h) / (W * H)) + "%";
  els.statYaw.textContent = gate?.yaw_norm != null ? gate.yaw_norm.toFixed(2) : "—";
  els.statLines.textContent = String(lineCount);
}
