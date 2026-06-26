import { create } from "zustand";

import type { AnnotateControllerSnapshot } from "../services/annotateSnapshots";

export type {
  AnnotateControllerSnapshot,
  AnnotateDraftState,
  AnnotateExportState,
  AnnotateMeshActionsState,
  AnnotateMeshState,
  AnnotateSavedLineSummary,
  AnnotateSavedSummary,
} from "../services/annotateSnapshots";

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
