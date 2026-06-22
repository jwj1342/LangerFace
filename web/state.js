// 共享运行期状态（单一可变对象，各模块导入同一引用）。
import { OneEuro } from "./geometry.js";

export const S = {
  system: "rstl", clip: true, handOcc: true, mirror: true, bands: true, zoom: true, meshPts: false,
  zoomCards: [],
  densityFrac: 1, smoothLevel: 0.6, opacity: 0.92,
  landmarker: null, handLandmarker: null, triangles: null, noseTris: null, atlases: {},
  smoother: new OneEuro({ minCutoff: 1.5, beta: 0.05 }),
  source: null, sourceKind: null,      // 'camera' | 'video' | 'image'
  running: false, paused: false, presence: 0,
  lastLM: null, imageCacheLM: null, imageHulls: null, recorder: null, chunks: [],
  // 3D Beta
  route: "2d", head3d: null, reconVerts: null, mode3d: "view",
  viewerRAF: null, rot: { x: 0, y: 0 }, scan: null,
};
