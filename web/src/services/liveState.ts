import { MotionStabilizedOneEuro } from "./geometrySmoothing.ts";
import type { LiveZoomCard } from "./render2d.ts";
import type { CanvasRecordingController } from "./canvasRecording";
import type { IncisionOverlayPayload } from "./dataSource";
import type { Vec3 } from "./softBody";
import type { PhotoPlanningController } from "./photoPlanningController";
import type { RstlSourceContract } from "./rstlSourceContract";
import type {
  CurveRefinementTransport,
  RefineLine,
  RefinePoint,
  RefineQualityReport,
  RefineViewportCrop,
} from "./liveRefineMath";

export interface LiveModelState {
  landmarker: any;
  imageLandmarker: any;
  handLandmarker: any;
  imageHandLandmarker: any;
  topology: any;
  triangles: any;
  noseTris: any;
  atlases: Record<string, any>;
  officialAtlases: Record<string, any>;
  atlasContracts: Record<string, RstlSourceContract>;
  officialAtlasContracts: Record<string, RstlSourceContract>;
  [key: string]: unknown;
}

export interface LiveImageViewState {
  baseWidth: number;
  baseHeight: number;
  fitScale: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  offsetX: number;
  offsetY: number;
}

export interface LiveRenderState {
  system: string;
  clip: boolean;
  handOcc: boolean;
  mirror: boolean;
  bands: boolean;
  zoom: boolean;
  meshPts: boolean;
  refine2d: LiveRefine2dState;
  zoomCards: LiveZoomCard[];
  focusRegion: unknown;
  focusCrop: RefineViewportCrop | null;
  focusZoom: number;
  imageView: LiveImageViewState;
  densityFrac: number;
  smoothLevel: number;
  opacity: number;
  smoother: MotionStabilizedOneEuro;
  incisionOverlay: IncisionOverlayPayload | null;
  [key: string]: unknown;
}

export type RefineMode = "view" | "drag" | "point" | "erase";

export interface EditableRefineLine extends RefineLine {
  name: string;
  region: string;
  symmetryRole: string;
  symmetryPairId: string;
  hidden: boolean;
  hiddenPointRuns: Array<[number, number]>;
  tris: number[];
  pts: Vec3[];
}

export interface RefinePick {
  lineIndex: number;
  pointIndex: number;
  distancePx: number;
}

export interface RefineHistoryEntry {
  label: string;
  lines: EditableRefineLine[];
}

export interface RefineDrag {
  pointerId: number;
  pick: RefinePick;
  startPointer: [number, number];
  original: Vec3[];
  partnerIndex: number | null;
  originalPartner: Vec3[] | null;
  moved: boolean;
  symmetryLinkedIndex: number | null;
}

export interface LiveRefine2dState {
  active: boolean;
  mode: RefineMode;
  spread: number;
  pointCount: number;
  nudgeStep: number;
  symmetry: boolean;
  showAxis: boolean;
  lines: EditableRefineLine[] | null;
  latestAutoLines: EditableRefineLine[] | null;
  liveBaselineLines: EditableRefineLine[] | null;
  liveTransport: CurveRefinementTransport | null;
  selected: RefinePick | null;
  dirty: boolean;
  quality: RefineQualityReport | null;
  undoStack: RefineHistoryEntry[];
  drag: RefineDrag | null;
}

export interface LiveSourceState {
  planning2d: PhotoPlanningController | null;
  readonly source: unknown | null;
  readonly sourceKind: "camera" | "video" | "image" | null;
  running: boolean;
  paused: boolean;
  presence: number;
  lastLM: any;
  imageCacheLM: any;
  imageHulls: any;
  imageDetectionComplete: boolean;
  imageDetectionAttempts: number;
  jawOpen: number;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  qualityGate: any;
  localRegionQuality: any;
  frozenFrame: HTMLCanvasElement | null;
  lastHulls: any[];
  [key: string]: unknown;
}

export interface LiveRecordingState {
  recorder: CanvasRecordingController | null;
}

export const modelState: LiveModelState = {
  landmarker: null,
  imageLandmarker: null,
  handLandmarker: null,
  imageHandLandmarker: null,
  topology: null,
  triangles: null,
  noseTris: null,
  atlases: {},
  officialAtlases: {},
  atlasContracts: {},
  officialAtlasContracts: {},
};

export const renderState: LiveRenderState = {
  system: "rstl",
  clip: true,
  handOcc: true,
  mirror: true,
  bands: false,
  zoom: true,
  meshPts: false,
  refine2d: {
    active: false,
    mode: "view",
    spread: 0.28,
    pointCount: 1,
    nudgeStep: 0.5,
    symmetry: false,
    showAxis: true,
    lines: null,
    latestAutoLines: null,
    liveBaselineLines: null,
    liveTransport: null,
    selected: null,
    dirty: false,
    quality: null,
    undoStack: [],
    drag: null,
  },
  zoomCards: [],
  focusRegion: null,
  focusCrop: null,
  focusZoom: 1.8,
  imageView: {
    baseWidth: 0,
    baseHeight: 0,
    fitScale: 1,
    zoom: 1,
    minZoom: 1,
    maxZoom: 5,
    offsetX: 0,
    offsetY: 0,
  },
  densityFrac: 1,
  smoothLevel: 0.6,
  opacity: 0.60,
  smoother: new MotionStabilizedOneEuro({ minCutoff: 1.5, beta: 0.05 }),
  incisionOverlay: null,
};

export const sourceState: LiveSourceState = {
  planning2d: null,
  get source() {
    return this.planning2d?.getFrameState().source ?? null;
  },
  get sourceKind() {
    return this.planning2d?.getFrameState().kind ?? null;
  },
  running: false,
  paused: false,
  presence: 0,
  lastLM: null,
  imageCacheLM: null,
  imageHulls: null,
  imageDetectionComplete: false,
  imageDetectionAttempts: 0,
  jawOpen: 0,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  qualityGate: null,
  localRegionQuality: null,
  frozenFrame: null,
  lastHulls: [],
};

export function currentLiveSource(): unknown | null {
  return sourceState.planning2d?.getFrameState().source ?? null;
}

export function currentLiveSourceKind(): "camera" | "video" | "image" | null {
  return sourceState.planning2d?.getFrameState().kind ?? null;
}

export const recordingState: LiveRecordingState = {
  recorder: null,
};
