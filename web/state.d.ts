import type { CanvasRecordingController } from "./export_canvas.js";
import type { IncisionOverlayPayload } from "./data_source.js";
import type { LiveZoomCard } from "./render.js";

export interface LiveRenderState {
  system: string;
  clip: boolean;
  handOcc: boolean;
  mirror: boolean;
  bands: boolean;
  zoom: boolean;
  meshPts: boolean;
  zoomCards: LiveZoomCard[];
  densityFrac: number;
  smoothLevel: number;
  opacity: number;
  smoother: {
    minCutoff: number;
    beta: number;
    configureForSmoothLevel?: (smoothLevel: number) => void;
  };
  incisionOverlay: IncisionOverlayPayload | null;
  [key: string]: unknown;
}

export interface LiveSourceState {
  sourceKind: "camera" | "video" | "image" | null;
  running: boolean;
  paused: boolean;
  imageHulls: unknown;
  [key: string]: unknown;
}

export interface LiveRecordingState {
  recorder: CanvasRecordingController | null;
}

export interface LiveReconState {
  route: "2d" | "3d";
  mode3d: string;
  reconVerts: unknown;
  flameFit: unknown;
  flameNeutral: unknown;
  reconProjectable: boolean;
  scan: { active?: boolean } | null;
  twinMode: string;
  twinTexture: boolean;
  viewerRAF: number | null;
  head3d: { dispose?: () => void } | null;
  [key: string]: unknown;
}

export const renderState: LiveRenderState;
export const sourceState: LiveSourceState;
export const recordingState: LiveRecordingState;
export const reconState: LiveReconState;
