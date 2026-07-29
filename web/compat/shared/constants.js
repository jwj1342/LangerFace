// 静态常量：CDN、配色、细节放大区域、3D 刚性配准锚点。
export const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
export const ATLAS_VERSION = "0.2";
export const TOPOLOGY_ID = "mediapipe-468";
export const TOPOLOGY_VERSION = "mediapipe-canonical-468-v1";

// MediaPipe face-oval contour, ordered around the visible skin boundary.
// Keep this as the single source of truth for clipping overlays away from hair/background.
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
  234, 127, 162, 21, 54, 103, 67, 109,
];

// 单色（按模板）；开启分区着色时按面部上/中/下分色
export const SOLID = { rstl: "#c800c8" };
export const BAND = { top: "#f0c24b", mid: "#56bdf2", low: "#3fd39c" };

// 细节放大窗：关键手术参考区域（用 MediaPipe 关键点索引界定）
export const ZOOM_REGIONS = [
  { label: "额·眉间", idx: [10, 151, 9, 8, 107, 336, 69, 299] },
  { label: "右眼周", idx: [33, 133, 159, 145, 153, 246, 7, 163] },
  { label: "左眼周", idx: [362, 263, 386, 374, 380, 466, 249, 390] },
  { label: "鼻·鼻唇沟", idx: [1, 4, 98, 327, 205, 425, 2, 94] },
  { label: "口周", idx: [61, 291, 0, 17, 13, 14, 40, 270] },
  { label: "颏部", idx: [152, 377, 148, 176, 400, 378, 149, 365] },
];

// 3D 重建相似变换的刚性锚点（稳定的骨性/中线关键点）
export const RIGID3D = [33, 263, 133, 362, 168, 6, 195, 5, 4, 1, 10, 152, 234, 454, 127, 356];
