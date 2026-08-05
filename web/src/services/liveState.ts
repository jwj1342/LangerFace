import { MotionStabilizedOneEuro } from "./geometrySmoothing.ts";
import type { LiveZoomCard } from "./render2d.ts";
import type { CanvasRecordingController } from "./canvasRecording";
import type { IncisionOverlayPayload } from "./dataSource";
import type { Vec3 } from "./softBody";
import type {
  CurveRefinementTransport,
  RefineLine,
  RefinePoint,
  RefineViewportCrop,
} from "./liveRefineMath";

type AnyRecord = Record<string, any>;

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
  liveTransport: CurveRefinementTransport | null;
  selected: RefinePick | null;
  dirty: boolean;
  undoStack: RefineHistoryEntry[];
  drag: RefineDrag | null;
}

export interface LiveSourceState {
  source: any;
  sourceKind: "camera" | "video" | "image" | null;
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

export interface LiveReconState {
  route: "2d" | "3d";
  head3d: AnyRecord | null;
  reconVerts: any;
  reconFaces: any;
  reconAtlasLines: any;
  reconColors: any;
  reconProjectable: boolean;
  reconDisplaySpace: string;
  mode3d: string;
  viewerRAF: number | null;
  rot: { x: number; y: number };
  scan: AnyRecord | null;
  flameFit: any;
  flameNeutral: any;
  flameBasis: any;
  flameBeta: any;
  twinMode: string;
  twinTexture: boolean;
  [key: string]: unknown;
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
    liveTransport: null,
    selected: null,
    dirty: false,
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
  source: null,
  sourceKind: null,
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

export const recordingState: LiveRecordingState = {
  recorder: null,
};

export const reconState: LiveReconState = {
  route: "2d",
  head3d: null,
  reconVerts: null,
  reconFaces: null,
  reconAtlasLines: null,
  reconColors: null,
  reconProjectable: false,
  reconDisplaySpace: "screen",
  mode3d: "view",
  viewerRAF: null,
  rot: { x: 0, y: 0 },
  scan: null,
  flameFit: null,
  flameNeutral: null,
  flameBasis: null,
  flameBeta: null,
  twinMode: "individual",
  twinTexture: false,
};
