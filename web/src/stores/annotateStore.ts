import { create } from "zustand";

export interface AnnotateMeshState {
  loaded: boolean;
  modeLabel: string;
  onCanonical: boolean;
  topologyId: string | null;
  topologyVersion: string | null;
}

export interface AnnotateDraftState {
  active: boolean;
  name: string | null;
  region: string | null;
  controlCount: number;
  pathPointCount: number;
  fallback: boolean;
}

export interface AnnotateSavedSummary {
  count: number;
  warningCount: number;
  totalControlPoints: number;
  totalPathPoints: number;
  lines: AnnotateSavedLineSummary[];
}

export interface AnnotateSavedLineSummary {
  index: number;
  title: string;
  meta: string;
  fallback: boolean;
  warning: string | null;
}

export interface AnnotateExportState {
  canExportAtlas: boolean;
  canExportXyz: boolean;
  canPreviewActiveAtlas: boolean;
}

export interface AnnotateControllerSnapshot {
  schema_version: "react-annotate-controller-snapshot/v0.1";
  reason: string;
  hint: string;
  system: string;
  mesh: AnnotateMeshState;
  draft: AnnotateDraftState;
  saved: AnnotateSavedSummary;
  export: AnnotateExportState;
  updatedAt: string;
}

interface AnnotateStoreState {
  snapshot: AnnotateControllerSnapshot | null;
  setControllerSnapshot: (snapshot: AnnotateControllerSnapshot) => void;
  clearControllerSnapshot: () => void;
}

export const ANNOTATE_CONTROLLER_STATE_EVENT = "langerface:annotate-state";

export const ANNOTATE_STORE_BOUNDARY_NOTE = [
  "Zustand stores low-frequency 3D annotation workbench state only.",
  "No Three.js objects, WebGL contexts, mesh vertices, triangles, raycasters, cameras, or per-frame render state belong here.",
].join(" ");

export const useAnnotateStore = create<AnnotateStoreState>((set) => ({
  snapshot: null,
  setControllerSnapshot: (snapshot) => set({ snapshot }),
  clearControllerSnapshot: () => set({ snapshot: null }),
}));
