import { MotionStabilizedOneEuro } from "../../geometry.js";
import type { LiveZoomCard } from "../../render.js";
import type { CanvasRecordingController } from "./canvasRecording";
import type { IncisionOverlayPayload } from "./dataSource";

type AnyRecord = Record<string, any>;

export interface LiveModelState {
  landmarker: any;
  handLandmarker: any;
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
  zoomCards: LiveZoomCard[];
  focusRegion: unknown;
  focusZoom: number;
  imageView: LiveImageViewState;
  densityFrac: number;
  smoothLevel: number;
  opacity: number;
  smoother: MotionStabilizedOneEuro;
  incisionOverlay: IncisionOverlayPayload | null;
  [key: string]: unknown;
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
  jawOpen: number;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  qualityGate: any;
  localRegionQuality: any;
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
  handLandmarker: null,
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
  zoomCards: [],
  focusRegion: null,
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
  opacity: 0.92,
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
  jawOpen: 0,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  qualityGate: null,
  localRegionQuality: null,
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
