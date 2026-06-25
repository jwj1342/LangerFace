import { create } from "zustand";

export const useAppStore = create((set) => ({
  activeWorkspace: "incision",
  routeStatus: "待机",
  assetStatus: "未加载",
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setRouteStatus: (routeStatus) => set({ routeStatus }),
  setAssetStatus: (assetStatus) => set({ assetStatus }),
}));

export const STATE_BOUNDARY_NOTE = [
  "React/Zustand stores low-frequency UI and route state only.",
  "Three.js objects, MediaPipe tasks, WebGL contexts and per-frame arrays stay outside persisted stores.",
  "Renderer loops use refs or renderer-owned state to avoid 60fps React re-render pressure.",
].join(" ");
