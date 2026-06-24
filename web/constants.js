// 静态常量：CDN、配色、细节放大区域（web 专有）。
// 与 Python 共享的版本号 / 拓扑标识 / 3D 刚性锚点 RIGID3D 从 constants.py 的生成物 re-export
// （跨语言单一真源，见 #30），故此处不再手写这些字面量。
export { ATLAS_VERSION, RIGID3D, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants_generated.js";

export const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";

// 单色（按模板）；开启分区着色时按面部上/中/下分色
export const SOLID = { rstl: "#c026d3", langer: "#06b6d4" };
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
