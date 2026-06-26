import { create } from "zustand";

import type { LiveControllerSnapshot } from "../services/liveSnapshots";

export type {
  LiveAtlasPreviewState,
  LiveControllerSnapshot,
  LiveIncisionOverlayState,
  LiveReconState,
  LiveRenderSettings,
  LiveRouteState,
  LiveSourceState,
} from "../services/liveSnapshots";

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
