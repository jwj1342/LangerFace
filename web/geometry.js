// 几何核心 barrel：对外保持单一入口与原有导出名/签名不变（调用方与对拍脚本零改动），
// 实现按子系统拆分到 web/geometry/* 各内聚模块（见 #49）。
//
//   atlas.js     — 图谱→图像映射 / 背面剔除 / 口裂排除 / 线集合校验（对应 Python mapping+occlusion）
//   smoothing.js — One-Euro 时间平滑（对应 Python smoothing）
//   occluders.js — 手/器械凸包掩膜（外物遮挡剔除）
//   transform.js — Jacobi/SVD/Umeyama 相似变换（仅 3D Beta 重建路线）

export * from "./geometry/atlas.js";
export * from "./geometry/smoothing.js";
export * from "./geometry/occluders.js";
export * from "./geometry/transform.js";
