// 运行期状态按职责分片，避免所有模块共享一个无边界的可变对象。
import { OneEuro } from "./geometry.js";

export const modelState = {
  landmarker: null,
  handLandmarker: null,
  triangles: null,
  noseTris: null,
  atlases: {},
  officialAtlases: {},
};

export const renderState = {
  system: "rstl", clip: true, handOcc: true, mirror: true, bands: true, zoom: true, meshPts: false,
  zoomCards: [],
  densityFrac: 1, smoothLevel: 0.6, opacity: 0.92,
  smoother: new OneEuro({ minCutoff: 1.5, beta: 0.05 }),
};

export const sourceState = {
  source: null, sourceKind: null,      // 'camera' | 'video' | 'image'
  running: false, paused: false, presence: 0,
  lastLM: null, imageCacheLM: null, imageHulls: null,
};

export const recordingState = {
  recorder: null,
  chunks: [],
};

export const reconState = {
  route: "2d", head3d: null, reconVerts: null, reconColors: null, mode3d: "view",
  viewerRAF: null, rot: { x: 0, y: 0 }, scan: null,
};
