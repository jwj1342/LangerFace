import { create } from "zustand";

export { INCISION_CONTROLLER_STATE_EVENT } from "../lib/controllerEvents";

import type { IncisionControllerSnapshot } from "../services/incisionSnapshots";

export type {
  IncisionAssetLoadingState,
  IncisionCandidateSummary,
  IncisionControllerSnapshot,
  IncisionEditState,
  IncisionHeadAssetState,
  IncisionProviderState,
  IncisionPrivacyAuditState,
  IncisionResultViewState,
  IncisionReviewState,
  IncisionSavedCandidateSummary,
  IncisionSecondaryCueState,
  IncisionTumorState,
  IncisionWorkflowRuntime,
} from "../services/incisionSnapshots";

interface IncisionStoreState {
  snapshot: IncisionControllerSnapshot | null;
  setControllerSnapshot: (snapshot: IncisionControllerSnapshot) => void;
  clearControllerSnapshot: () => void;
}

export const INCISION_STORE_BOUNDARY_NOTE = [
  "Zustand stores low-frequency incision workbench state only.",
  "No Three.js objects, WebGL contexts, MediaPipe task instances, canonical vertices, triangles, or per-frame arrays belong here.",
].join(" ");

export const useIncisionStore = create<IncisionStoreState>((set) => ({
  snapshot: null,
  setControllerSnapshot: (snapshot) => set({ snapshot }),
  clearControllerSnapshot: () => set({ snapshot: null }),
}));
