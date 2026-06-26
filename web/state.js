// 运行期状态按职责分片，避免所有模块共享一个无边界的可变对象。
import { MotionStabilizedOneEuro } from "./geometry.js";

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
  zoomCards: [],
  focusRegion: null, focusZoom: 1.8,
  imageView: {
    baseWidth: 0, baseHeight: 0, fitScale: 1,
    zoom: 1, minZoom: 1, maxZoom: 5,
    offsetX: 0, offsetY: 0,
  },
  densityFrac: 1, smoothLevel: 0.6, opacity: 0.92,
  smoother: new MotionStabilizedOneEuro({ minCutoff: 1.5, beta: 0.05 }),
  incisionOverlay: null,
};

export const sourceState = {
  source: null, sourceKind: null,      // 'camera' | 'video' | 'image'
  running: false, paused: false, presence: 0,
  lastLM: null, imageCacheLM: null, imageHulls: null,
  jawOpen: 0, eyeBlinkLeft: 0, eyeBlinkRight: 0,
  qualityGate: null,
  localRegionQuality: null,
};

export const recordingState = {
  recorder: null,
};

export const reconState = {
  route: "2d", head3d: null, reconVerts: null, reconFaces: null, reconAtlasLines: null,
  reconColors: null, reconProjectable: false, reconDisplaySpace: "screen", mode3d: "view",
  viewerRAF: null, rot: { x: 0, y: 0 }, scan: null,
  flameFit: null,      // 云端拟合出的个体 FLAME {verts, faces}
  flameNeutral: null,  // 标准 FLAME neutral {verts, faces}（缓存）
  flameBasis: null,    // 浏览器本地拟合基（flame_fit.js，一次加载）
  flameBeta: null,     // 实时孪生：身份系数（首帧拟合一次后固定）
  twinMode: "individual",  // 实时孪生右侧头：individual | standard
  twinTexture: false,      // 实时孪生：贴真实人脸纹理开关
};
