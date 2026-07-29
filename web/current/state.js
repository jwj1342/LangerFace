// 运行期状态按职责分片，避免所有模块共享一个无边界的可变对象。
import { OneEuro } from "../compat/shared/geometry.js";

export const modelState = {
  landmarker: null,
  handLandmarker: null,
  topology: null,
  triangles: null,
  noseTris: null,
  atlases: {},
  officialAtlases: {},
};

export const renderState = {
  system: "rstl", clip: true, handOcc: true, mirror: true, bands: false, zoom: true, meshPts: false,
  refine2d: {
    active: false,
    mode: "view",
    symmetry: true,
    showAxis: true,
    lines: null,
    latestAutoLines: null,
    liveTransport: null,
    selected: null,
    dirty: false,
    undoStack: [],
  },
  zoomCards: [],
  focusRegion: null, focusZoom: 1.8,
  imageView: {
    baseWidth: 0, baseHeight: 0, fitScale: 1,
    zoom: 1, minZoom: 1, maxZoom: 5,
    offsetX: 0, offsetY: 0,
  },
  densityFrac: 1, smoothLevel: 0.6, opacity: 0.60,
  smoother: new OneEuro({ minCutoff: 1.5, beta: 0.05 }),
};

export const sourceState = {
  source: null, sourceKind: null,      // 'camera' | 'video' | 'image'
  running: false, paused: false, presence: 0,
  lastLM: null, imageCacheLM: null, imageHulls: null, jawOpen: 0, blend: null, rawBlend: null,
  frozenFrame: null, lastHulls: [],
};

export const recordingState = {
  recorder: null,
  chunks: [],
};
