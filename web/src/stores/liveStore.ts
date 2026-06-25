import { create } from "zustand";

export interface LiveSourceState {
  kind: "camera" | "video" | "image" | null;
  running: boolean;
  paused: boolean;
  liveLabel: string;
}

export interface LiveRouteState {
  route: "2d" | "3d" | string;
  mode3d: string;
  hint: string;
}

export interface LiveRenderSettings {
  system: string;
  densityPct: number;
  smoothLabel: string;
  opacityPct: number;
  mirror: boolean;
  zoom: boolean;
  meshPts: boolean;
  bands: boolean;
}

export interface LiveReconState {
  has3dModel: boolean;
  projectable: boolean;
  scanActive: boolean;
  twinMode: string;
  twinTexture: boolean;
  status: string;
}

export interface LiveAtlasPreviewState {
  active: boolean;
  source: string | null;
  validated: boolean | null;
  count: number | null;
}

export interface LiveIncisionOverlayState {
  loaded: boolean;
  qaLabel: string | null;
}

export interface LiveControllerSnapshot {
  schema_version: "react-live-controller-snapshot/v0.1";
  reason: string;
  modelBadge: string;
  overlayMessage: string;
  source: LiveSourceState;
  route: LiveRouteState;
  render: LiveRenderSettings;
  recon: LiveReconState;
  atlasPreview: LiveAtlasPreviewState;
  incisionOverlay: LiveIncisionOverlayState;
  recording: boolean;
  updatedAt: string;
}

interface LiveStoreState {
  snapshot: LiveControllerSnapshot | null;
  setControllerSnapshot: (snapshot: LiveControllerSnapshot) => void;
  clearControllerSnapshot: () => void;
}

export const LIVE_CONTROLLER_STATE_EVENT = "langerface:live-state";

export const LIVE_STORE_BOUNDARY_NOTE = [
  "Zustand stores low-frequency live workbench state only.",
  "No MediaPipe task instances, landmarks, hand hulls, canvas contexts, Three.js objects, mesh vertices, triangles, or fps frame counters belong here.",
].join(" ");

export const useLiveStore = create<LiveStoreState>((set) => ({
  snapshot: null,
  setControllerSnapshot: (snapshot) => set({ snapshot }),
  clearControllerSnapshot: () => set({ snapshot: null }),
}));
