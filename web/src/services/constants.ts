// Static web constants. Python-shared topology/version constants remain generated
// from constants.py through constantsGenerated.ts.
export { ATLAS_VERSION, RIGID3D, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constantsGenerated.ts";

export const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";

export const SOLID = { rstl: "#c026d3", langer: "#06b6d4" } as const;
export const BAND = { top: "#f0c24b", mid: "#56bdf2", low: "#3fd39c" } as const;

export interface ZoomRegion {
  label: string;
  idx: number[];
}

export const ZOOM_REGIONS: ZoomRegion[] = [
  { label: "额·眉间", idx: [10, 151, 9, 8, 107, 336, 69, 299] },
  { label: "右眼周", idx: [33, 133, 159, 145, 153, 246, 7, 163] },
  { label: "左眼周", idx: [362, 263, 386, 374, 380, 466, 249, 390] },
  { label: "鼻·鼻唇沟", idx: [1, 4, 98, 327, 205, 425, 2, 94] },
  { label: "口周", idx: [61, 291, 0, 17, 13, 14, 40, 270] },
  { label: "颏部", idx: [152, 377, 148, 176, 400, 378, 149, 365] },
];
