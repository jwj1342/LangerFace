import { fitContainSize } from "./fitMath.ts";
import type { SurfaceRef } from "./incisionOverlay";
import type { Triangle, Vec3 } from "./softBody";

export const PHOTO_PLANNING_SNAPSHOT_SCHEMA = "photo-planning-controller/v0.1" as const;

export type PhotoPlanningOwner = "live" | "incision";
export type PhotoPlanningSourceKind = "image" | "video" | "camera";
export type PhotoPlanningDetectionStatus = "idle" | "detecting" | "ready" | "failed";

export interface PhotoPlanningPoint {
  x: number;
  y: number;
}

export interface PhotoPlanningSourceInput {
  source: unknown;
  kind: PhotoPlanningSourceKind;
  width: number;
  height: number;
  release?: () => void;
}

export interface PhotoPlanningViewInput {
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth?: number;
  canvasHeight?: number;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  mirror?: boolean;
  devicePixelRatio?: number;
}

export interface PhotoPlanningTransform {
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  baseWidth: number;
  baseHeight: number;
  displayWidth: number;
  displayHeight: number;
  displayLeft: number;
  displayTop: number;
  fitScale: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  mirror: boolean;
  devicePixelRatio: number;
}

export interface PhotoPlanningSelection {
  centerRef: SurfaceRef | null;
  boundaryRefs: SurfaceRef[];
}

export interface PhotoPlanningOverlaySummary {
  rstlLineCount: number;
  tumorVisible: boolean;
  candidatePointCount: number;
}

export interface PhotoPlanningControllerSnapshot {
  schema_version: typeof PHOTO_PLANNING_SNAPSHOT_SCHEMA;
  owner: PhotoPlanningOwner;
  disposed: boolean;
  source: {
    revision: number;
    kind: PhotoPlanningSourceKind | null;
    width: number;
    height: number;
  };
  detection: {
    status: PhotoPlanningDetectionStatus;
    source_revision: number;
    landmark_count: number;
    attempts: number;
    reason: string;
  };
  selection: PhotoPlanningSelection;
  overlay: PhotoPlanningOverlaySummary;
  view: {
    ready: boolean;
    mirror: boolean;
    zoom: number;
    device_pixel_ratio: number;
  };
  audit: {
    raw_media_in_snapshot: false;
    landmarks_in_snapshot: false;
  };
}

export interface PhotoPlanningFrameState {
  revision: number;
  source: unknown | null;
  kind: PhotoPlanningSourceKind | null;
  width: number;
  height: number;
  landmarks: readonly Vec3[] | null;
  surfaceLandmarks: readonly Vec3[] | null;
  triangles: readonly Triangle[];
  transform: PhotoPlanningTransform | null;
  selection: PhotoPlanningSelection;
  overlay: PhotoPlanningOverlaySummary;
}

export interface PhotoPlanningDetectorLease {
  detector: unknown;
  release?: () => void;
}

interface PhotoPlanningControllerOptions {
  owner: PhotoPlanningOwner;
  onSnapshot?: (snapshot: PhotoPlanningControllerSnapshot) => void;
  onRender?: (frame: PhotoPlanningFrameState) => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (frameId: number) => void;
}

export interface PhotoPlanningController {
  replaceSource(input: PhotoPlanningSourceInput): number;
  clearSource(): void;
  sourceRevision(): number;
  setDetectorLease(lease: PhotoPlanningDetectorLease | null): void;
  detector(): unknown | null;
  setTopology(triangles: readonly Triangle[]): void;
  setDetection(input: {
    sourceRevision: number;
    status: PhotoPlanningDetectionStatus;
    landmarks?: readonly Vec3[] | null;
    surfaceLandmarks?: readonly Vec3[] | null;
    attempts?: number;
    reason?: string;
  }): boolean;
  setView(input: PhotoPlanningViewInput | null): PhotoPlanningTransform | null;
  setSelection(selection: Partial<PhotoPlanningSelection>): void;
  setOverlaySummary(summary: Partial<PhotoPlanningOverlaySummary>): void;
  clientToSource(point: PhotoPlanningPoint): PhotoPlanningPoint | null;
  sourceToClient(point: PhotoPlanningPoint): PhotoPlanningPoint | null;
  clientToCanvas(point: PhotoPlanningPoint): PhotoPlanningPoint | null;
  canvasToClient(point: PhotoPlanningPoint): PhotoPlanningPoint | null;
  pickSurfaceRef(point: PhotoPlanningPoint): SurfaceRef | null;
  surfaceRefToClient(ref: SurfaceRef): PhotoPlanningPoint | null;
  getFrameState(): PhotoPlanningFrameState;
  getSnapshot(): PhotoPlanningControllerSnapshot;
  dispose(): void;
}

interface ActiveSource {
  source: unknown;
  kind: PhotoPlanningSourceKind;
  width: number;
  height: number;
  release: () => void;
}

const EMPTY_SELECTION: PhotoPlanningSelection = { centerRef: null, boundaryRefs: [] };
const EMPTY_OVERLAY: PhotoPlanningOverlaySummary = {
  rstlLineCount: 0,
  tumorVisible: false,
  candidatePointCount: 0,
};

const finitePositive = (value: number, fallback = 1): number => (
  Number.isFinite(value) && value > 0 ? value : fallback
);

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

function cloneRef(ref: SurfaceRef | null | undefined): SurfaceRef | null {
  if (!ref) return null;
  return {
    tri: ref.tri,
    u: ref.u,
    v: ref.v,
    w: ref.w,
    ...(ref.distance == null ? {} : { distance: ref.distance }),
  };
}

function cloneSelection(selection: PhotoPlanningSelection): PhotoPlanningSelection {
  return {
    centerRef: cloneRef(selection.centerRef),
    boundaryRefs: selection.boundaryRefs.map((ref) => cloneRef(ref) as SurfaceRef),
  };
}

export function createPhotoPlanningTransform(
  sourceWidth: number,
  sourceHeight: number,
  input: PhotoPlanningViewInput,
): PhotoPlanningTransform | null {
  const width = finitePositive(sourceWidth);
  const height = finitePositive(sourceHeight);
  const viewportWidth = Math.max(0, finite(input.viewportWidth));
  const viewportHeight = Math.max(0, finite(input.viewportHeight));
  if (!viewportWidth || !viewportHeight) return null;

  const fit = fitContainSize(width, height, viewportWidth, viewportHeight);
  if (!fit.width || !fit.height) return null;
  const zoom = Math.max(0.01, finitePositive(input.zoom ?? 1));
  const offsetX = finite(input.offsetX ?? 0);
  const offsetY = finite(input.offsetY ?? 0);
  const displayWidth = fit.width * zoom;
  const displayHeight = fit.height * zoom;
  const viewportLeft = finite(input.viewportLeft);
  const viewportTop = finite(input.viewportTop);
  const centerX = viewportLeft + viewportWidth / 2 + offsetX;
  const centerY = viewportTop + viewportHeight / 2 + offsetY;
  const devicePixelRatio = finitePositive(input.devicePixelRatio ?? 1);

  return {
    sourceWidth: width,
    sourceHeight: height,
    canvasWidth: finitePositive(input.canvasWidth ?? width * devicePixelRatio),
    canvasHeight: finitePositive(input.canvasHeight ?? height * devicePixelRatio),
    viewportLeft,
    viewportTop,
    viewportWidth,
    viewportHeight,
    baseWidth: fit.width,
    baseHeight: fit.height,
    displayWidth,
    displayHeight,
    displayLeft: centerX - displayWidth / 2,
    displayTop: centerY - displayHeight / 2,
    fitScale: fit.scale,
    zoom,
    offsetX,
    offsetY,
    mirror: input.mirror === true,
    devicePixelRatio,
  };
}

export function clientPointToSource(
  point: PhotoPlanningPoint,
  transform: PhotoPlanningTransform,
): PhotoPlanningPoint | null {
  let x = (point.x - transform.displayLeft) / transform.displayWidth;
  const y = (point.y - transform.displayTop) / transform.displayHeight;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (transform.mirror) x = 1 - x;
  return { x: x * transform.sourceWidth, y: y * transform.sourceHeight };
}

export function sourcePointToClient(
  point: PhotoPlanningPoint,
  transform: PhotoPlanningTransform,
): PhotoPlanningPoint | null {
  if (point.x < 0 || point.x > transform.sourceWidth || point.y < 0 || point.y > transform.sourceHeight) return null;
  let x = point.x / transform.sourceWidth;
  if (transform.mirror) x = 1 - x;
  return {
    x: transform.displayLeft + x * transform.displayWidth,
    y: transform.displayTop + (point.y / transform.sourceHeight) * transform.displayHeight,
  };
}

export function sourcePointToCanvas(
  point: PhotoPlanningPoint,
  transform: PhotoPlanningTransform,
): PhotoPlanningPoint {
  return {
    x: point.x / transform.sourceWidth * transform.canvasWidth,
    y: point.y / transform.sourceHeight * transform.canvasHeight,
  };
}

export function canvasPointToSource(
  point: PhotoPlanningPoint,
  transform: PhotoPlanningTransform,
): PhotoPlanningPoint {
  return {
    x: point.x / transform.canvasWidth * transform.sourceWidth,
    y: point.y / transform.canvasHeight * transform.sourceHeight,
  };
}

function barycentric2d(point: PhotoPlanningPoint, a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const v0x = b[0] - a[0];
  const v0y = b[1] - a[1];
  const v1x = c[0] - a[0];
  const v1y = c[1] - a[1];
  const v2x = point.x - a[0];
  const v2y = point.y - a[1];
  const denominator = v0x * v1y - v1x * v0y;
  if (Math.abs(denominator) < 1e-8) return null;
  const v = (v2x * v1y - v1x * v2y) / denominator;
  const w = (v0x * v2y - v2x * v0y) / denominator;
  const u = 1 - v - w;
  return [u, v, w];
}

export function sourcePointToSurfaceRef(
  point: PhotoPlanningPoint,
  landmarks: readonly Vec3[],
  triangles: readonly Triangle[],
  tolerance = 1e-5,
): SurfaceRef | null {
  let best: { ref: SurfaceRef; score: number } | null = null;
  for (let tri = 0; tri < triangles.length; tri += 1) {
    const indices = triangles[tri];
    const a = landmarks[indices[0]];
    const b = landmarks[indices[1]];
    const c = landmarks[indices[2]];
    if (!a || !b || !c) continue;
    const weights = barycentric2d(point, a, b, c);
    if (!weights || weights.some((weight) => !Number.isFinite(weight) || weight < -tolerance || weight > 1 + tolerance)) continue;
    const score = Math.min(...weights);
    if (!best || score > best.score) {
      best = {
        ref: { tri, u: weights[0], v: weights[1], w: weights[2] },
        score,
      };
    }
  }
  return best?.ref ?? null;
}

export function surfaceRefToSourcePoint(
  ref: SurfaceRef,
  landmarks: readonly Vec3[],
  triangles: readonly Triangle[],
): PhotoPlanningPoint | null {
  const triangle = triangles[ref.tri];
  if (!triangle) return null;
  const a = landmarks[triangle[0]];
  const b = landmarks[triangle[1]];
  const c = landmarks[triangle[2]];
  if (!a || !b || !c) return null;
  const u = Number(ref.u);
  const v = Number(ref.v);
  const w = Number(ref.w ?? (1 - u - v));
  if (![u, v, w].every(Number.isFinite)) return null;
  return {
    x: u * a[0] + v * b[0] + w * c[0],
    y: u * a[1] + v * b[1] + w * c[1],
  };
}

export function createPhotoPlanningController({
  owner,
  onSnapshot,
  onRender,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (frameId) => globalThis.cancelAnimationFrame(frameId),
}: PhotoPlanningControllerOptions): PhotoPlanningController {
  let disposed = false;
  let revision = 0;
  let activeSource: ActiveSource | null = null;
  let detectorLease: PhotoPlanningDetectorLease | null = null;
  let landmarks: readonly Vec3[] | null = null;
  let surfaceLandmarks: readonly Vec3[] | null = null;
  let triangles: readonly Triangle[] = [];
  let transform: PhotoPlanningTransform | null = null;
  let selection = cloneSelection(EMPTY_SELECTION);
  let overlay = { ...EMPTY_OVERLAY };
  let renderFrameId = 0;
  let detection = {
    status: "idle" as PhotoPlanningDetectionStatus,
    sourceRevision: 0,
    landmarkCount: 0,
    attempts: 0,
    reason: "",
  };

  const ensureActive = () => {
    if (disposed) throw new Error("photo planning controller has been disposed");
  };

  const frameState = (): PhotoPlanningFrameState => ({
    revision,
    source: activeSource?.source ?? null,
    kind: activeSource?.kind ?? null,
    width: activeSource?.width ?? 0,
    height: activeSource?.height ?? 0,
    landmarks,
    surfaceLandmarks,
    triangles,
    transform,
    selection: cloneSelection(selection),
    overlay: { ...overlay },
  });

  const snapshot = (): PhotoPlanningControllerSnapshot => ({
    schema_version: PHOTO_PLANNING_SNAPSHOT_SCHEMA,
    owner,
    disposed,
    source: {
      revision,
      kind: activeSource?.kind ?? null,
      width: activeSource?.width ?? 0,
      height: activeSource?.height ?? 0,
    },
    detection: {
      status: detection.status,
      source_revision: detection.sourceRevision,
      landmark_count: detection.landmarkCount,
      attempts: detection.attempts,
      reason: detection.reason,
    },
    selection: cloneSelection(selection),
    overlay: { ...overlay },
    view: {
      ready: transform !== null,
      mirror: transform?.mirror ?? false,
      zoom: transform?.zoom ?? 1,
      device_pixel_ratio: transform?.devicePixelRatio ?? 1,
    },
    audit: {
      raw_media_in_snapshot: false,
      landmarks_in_snapshot: false,
    },
  });

  const scheduleRender = () => {
    if (!onRender || renderFrameId || disposed) return;
    renderFrameId = requestFrame(() => {
      renderFrameId = 0;
      if (!disposed) onRender(frameState());
    });
  };

  const publish = () => {
    onSnapshot?.(snapshot());
    scheduleRender();
  };

  const releaseSource = () => {
    const release = activeSource?.release;
    activeSource = null;
    release?.();
  };

  const resetForSource = () => {
    landmarks = null;
    surfaceLandmarks = null;
    transform = null;
    selection = cloneSelection(EMPTY_SELECTION);
    overlay = { ...EMPTY_OVERLAY };
    detection = {
      status: "idle",
      sourceRevision: revision,
      landmarkCount: 0,
      attempts: 0,
      reason: "",
    };
  };

  return {
    replaceSource(input) {
      ensureActive();
      const width = finitePositive(input.width, 0);
      const height = finitePositive(input.height, 0);
      if (!input.source || !width || !height) throw new Error("photo planning source requires media and positive dimensions");
      releaseSource();
      revision += 1;
      activeSource = {
        source: input.source,
        kind: input.kind,
        width,
        height,
        release: input.release ?? (() => {}),
      };
      resetForSource();
      publish();
      return revision;
    },
    clearSource() {
      if (disposed) return;
      releaseSource();
      revision += 1;
      resetForSource();
      publish();
    },
    sourceRevision: () => revision,
    setDetectorLease(lease) {
      ensureActive();
      detectorLease?.release?.();
      detectorLease = lease;
      publish();
    },
    detector: () => detectorLease?.detector ?? null,
    setTopology(nextTriangles) {
      ensureActive();
      triangles = nextTriangles;
      publish();
    },
    setDetection(input) {
      if (disposed || input.sourceRevision !== revision || !activeSource) return false;
      landmarks = input.landmarks ?? null;
      surfaceLandmarks = input.surfaceLandmarks ?? landmarks;
      detection = {
        status: input.status,
        sourceRevision: input.sourceRevision,
        landmarkCount: landmarks?.length ?? 0,
        attempts: Math.max(0, Math.floor(input.attempts ?? 0)),
        reason: input.reason ?? "",
      };
      publish();
      return true;
    },
    setView(input) {
      ensureActive();
      transform = activeSource && input
        ? createPhotoPlanningTransform(activeSource.width, activeSource.height, input)
        : null;
      publish();
      return transform;
    },
    setSelection(nextSelection) {
      ensureActive();
      selection = {
        centerRef: nextSelection.centerRef === undefined ? selection.centerRef : cloneRef(nextSelection.centerRef),
        boundaryRefs: nextSelection.boundaryRefs === undefined
          ? selection.boundaryRefs
          : nextSelection.boundaryRefs.map((ref) => cloneRef(ref) as SurfaceRef),
      };
      publish();
    },
    setOverlaySummary(summary) {
      ensureActive();
      const nextOverlay = {
        rstlLineCount: Math.max(0, Math.floor(summary.rstlLineCount ?? overlay.rstlLineCount)),
        tumorVisible: summary.tumorVisible ?? overlay.tumorVisible,
        candidatePointCount: Math.max(0, Math.floor(summary.candidatePointCount ?? overlay.candidatePointCount)),
      };
      if (
        nextOverlay.rstlLineCount === overlay.rstlLineCount
        && nextOverlay.tumorVisible === overlay.tumorVisible
        && nextOverlay.candidatePointCount === overlay.candidatePointCount
      ) return;
      overlay = nextOverlay;
      publish();
    },
    clientToSource(point) {
      return transform ? clientPointToSource(point, transform) : null;
    },
    sourceToClient(point) {
      return transform ? sourcePointToClient(point, transform) : null;
    },
    clientToCanvas(point) {
      if (!transform) return null;
      const sourcePoint = clientPointToSource(point, transform);
      return sourcePoint ? sourcePointToCanvas(sourcePoint, transform) : null;
    },
    canvasToClient(point) {
      if (!transform) return null;
      return sourcePointToClient(canvasPointToSource(point, transform), transform);
    },
    pickSurfaceRef(point) {
      if (!transform || !landmarks?.length || !triangles.length) return null;
      const sourcePoint = clientPointToSource(point, transform);
      return sourcePoint ? sourcePointToSurfaceRef(sourcePoint, surfaceLandmarks || landmarks, triangles) : null;
    },
    surfaceRefToClient(ref) {
      if (!transform || !landmarks?.length || !triangles.length) return null;
      const sourcePoint = surfaceRefToSourcePoint(ref, surfaceLandmarks || landmarks, triangles);
      return sourcePoint ? sourcePointToClient(sourcePoint, transform) : null;
    },
    getFrameState: frameState,
    getSnapshot: snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (renderFrameId) cancelFrame(renderFrameId);
      renderFrameId = 0;
      releaseSource();
      detectorLease?.release?.();
      detectorLease = null;
      landmarks = null;
      triangles = [];
      transform = null;
      selection = cloneSelection(EMPTY_SELECTION);
      overlay = { ...EMPTY_OVERLAY };
      onSnapshot?.(snapshot());
    },
  };
}
