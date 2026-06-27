import { create } from "zustand";

export type Workspace = "dashboard" | "annotate" | "incision" | "live" | "surgery" | "three-preview";
export type WorkerStatus = "未连接" | "正在连接" | "已连接" | "连接失败" | "已卸载";

interface AppState {
  activeWorkspace: Workspace;
  routeStatus: string;
  assetStatus: string;
  workerStatus: WorkerStatus;
  setActiveWorkspace: (activeWorkspace: Workspace) => void;
  setRouteStatus: (routeStatus: string) => void;
  setAssetStatus: (assetStatus: string) => void;
  setWorkerStatus: (workerStatus: WorkerStatus) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeWorkspace: "incision",
  routeStatus: "待机",
  assetStatus: "未加载",
  workerStatus: "未连接",
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setRouteStatus: (routeStatus) => set({ routeStatus }),
  setAssetStatus: (assetStatus) => set({ assetStatus }),
  setWorkerStatus: (workerStatus) => set({ workerStatus }),
}));

export const STATE_BOUNDARY_NOTE = [
  "React/Zustand stores low-frequency UI and route state only.",
  "Three.js objects, MediaPipe tasks, WebGL contexts and per-frame arrays stay outside persisted stores.",
  "Renderer loops use refs or renderer-owned state to avoid 60fps React re-render pressure.",
].join(" ");
