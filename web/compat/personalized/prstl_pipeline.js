/**
 * 浏览器端个性化二维 RSTL — 纯算法（无 DOM）
 *
 * 文档：docs/tracks/PERSONALIZED_RSTL.md
 * UI：./personalized.js
 *
 * 管线：个人基线 → 结构张量 + 块匹配光流 → 保守融合 q0 → 先验锚定重追
 */
import { mapAtlas, umeyama, applySim } from "../shared/geometry.js";

export const SIZE = 320;
export const TEXTURE_SIZE = 640;
export const ACTION_ORDER = [
  "raise_brows", "frown", "squint", "smile", "puff", "purse", "open_mouth",
];
export const ACTION_LABELS = {
  raise_brows: "抬眉", frown: "皱眉", squint: "眯眼", smile: "微笑",
  puff: "鼓腮", purse: "撅嘴", open_mouth: "张嘴",
};
const ACTION_BLEND = {
  raise_brows: ["browInnerUp", "browOuterUpLeft", "browOuterUpRight"],
  frown: ["browDownLeft", "browDownRight"],
  squint: ["eyeSquintLeft", "eyeSquintRight"],
  smile: ["mouthSmileLeft", "mouthSmileRight"],
  // cheekPuff 在很多摄像头上几乎不触发，辅以 squint / pucker
  puff: ["cheekPuff", "cheekSquintLeft", "cheekSquintRight", "mouthPucker"],
  purse: ["mouthPucker", "mouthFunnel", "mouthPressLeft", "mouthPressRight"],
  open_mouth: ["jawOpen"],
};
const THRESHOLDS = {
  // MediaPipe browDown is consistently weaker than the other action channels
  // on front-facing phone cameras. 0.13 yields a neutral-relative gate of
  // 0.0715 while the remaining tracking/lighting/registration gates still
  // reject head-motion and low-quality captures.
  raise_brows: 0.18, frown: 0.13, squint: 0.18, smile: 0.22,
  puff: 0.06, purse: 0.08, open_mouth: 0.18,
};
// 这些动作的 blendshape 在不同手机和眉形上不够稳定：点击开始后按计时完成，
// 再由图像变化、跟踪、光照和配准质量门控决定是否接收。
// 皱眉不能只依赖 browDown，否则部分用户会一直停在动作启动阈值之前。
export const TIMED_ACTIONS = new Set(["frown", "puff", "purse"]);
export const CORE_ACTIONS = new Set(["raise_brows", "frown", "squint", "smile", "purse"]);
export const REGION_NAMES = [
  "forehead", "glabella", "left_periocular", "right_periocular",
  "left_cheek", "right_cheek", "nose", "perioral", "chin",
];
export const ACTION_REGION_WEIGHT = Object.freeze({
  raise_brows: { forehead: 1.0, glabella: 0.4 },
  frown: { glabella: 1.0, forehead: 0.4, nose: 0.3 },
  squint: { left_periocular: 1.0, right_periocular: 1.0 },
  smile: {
    left_periocular: 0.6, right_periocular: 0.6,
    left_cheek: 1.0, right_cheek: 1.0, perioral: 0.8,
  },
  // 鼓腮是拉伸验证，不作为主要褶皱生成动作。
  puff: { left_cheek: 0.65, right_cheek: 0.65, perioral: 0.2 },
  purse: { perioral: 1.0, chin: 0.25 },
  // 张嘴主要验证下巴/下颌运动；口周方向证据降权。
  open_mouth: { chin: 1.0, perioral: 0.25 },
});

export const QUALITY_THRESHOLDS = Object.freeze({
  tracking: 0.62,
  illumination: 0.55,
  returnConsistency: 0.58,
  minPeakFrames: 4,
});

export const ACTION_RETURN_LANDMARKS = Object.freeze({
  raise_brows: [46, 52, 53, 55, 63, 65, 66, 70, 105, 107, 276, 282, 283, 285, 293, 295, 296, 300, 334, 336],
  frown: [9, 55, 65, 66, 105, 107, 151, 285, 295, 296, 334, 336],
  squint: [33, 133, 144, 153, 158, 160, 263, 362, 373, 380, 385, 387],
  smile: [50, 61, 101, 118, 205, 291, 280, 308, 330, 347, 425],
  puff: [50, 101, 118, 205, 280, 330, 347, 425],
  purse: [0, 13, 14, 17, 61, 78, 82, 87, 291, 308, 312, 317],
  open_mouth: [0, 13, 14, 17, 61, 78, 82, 87, 291, 308, 312, 317],
});

// 用于跨表情全局配准的稳定锚点。眉毛、眼睑、嘴唇和下颌点会随动作
// 明显移动，不能参与整体相似变换的拟合；局部表情形变仍由三角网格处理。
export const CANONICAL_REGISTRATION_ANCHORS = Object.freeze([
  1, 4, 5, 6, 33, 133, 263, 362, 168, 195, 197,
]);
// MediaPipe 静息底噪常到 0.25–0.40（尤其眯眼/微笑），不能用过严阈值
const NEUTRAL_MAX = 0.45;
export { THRESHOLDS, NEUTRAL_MAX };

// ── 轴向场 ──────────────────────────────────────────────────────────────────
export function angleToQ(th) {
  return [Math.cos(2 * th), Math.sin(2 * th)];
}
export function qToAngle(q) {
  return 0.5 * Math.atan2(q[1], q[0]);
}
export function normalizeQ(q, eps = 1e-8) {
  const n = Math.hypot(q[0], q[1]);
  return n > eps ? [q[0] / n, q[1] / n] : [0, 0];
}

/**
 * 双角度轴向夹角（度），范围 [0, 90]。
 * q=(cos2θ,sin2θ) 已处理 θ~θ+π 等价；勿对 dot 取 abs（否则 90° 会被当成 0°）。
 */
export function axialDiffDeg(qa, qb) {
  const a = normalizeQ(qa), b = normalizeQ(qb);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
  return 0.5 * (Math.acos(dot) * 180 / Math.PI);
}

// ── 掩膜 ────────────────────────────────────────────────────────────────────
/** 固定椭圆回退（无网格时） */
export function buildMasks(size = SIZE) {
  const skin = new Uint8Array(size * size);
  const forbidden = new Uint8Array(size * size);
  const holes = [
    [0.37, 0.38, 0.085, 0.052],
    [0.63, 0.38, 0.085, 0.052],
    [0.50, 0.62, 0.105, 0.058],
    [0.50, 0.48, 0.045, 0.035],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1), ny = y / (size - 1);
      const inSkin = ((nx - 0.5) / 0.455) ** 2 + ((ny - 0.49) / 0.495) ** 2 <= 1;
      let forb = false;
      for (const [ex, ey, rx, ry] of holes) {
        if (((nx - ex) / rx) ** 2 + ((ny - ey) / ry) ** 2 < 1) { forb = true; break; }
      }
      const i = y * size + x;
      forbidden[i] = forb ? 1 : 0;
      skin[i] = inSkin && !forb ? 1 : 0;
    }
  }
  return { skin, forbidden };
}

/** MediaPipe 关键点索引：眼/唇/鼻禁区 + 脸部椭圆皮肤 */
const MASK_LEFT_EYE = [33, 133, 160, 159, 158, 157, 173, 155, 154, 153, 145, 144, 163, 7];
const MASK_RIGHT_EYE = [362, 263, 387, 386, 385, 384, 398, 382, 381, 380, 374, 373, 390, 249];
const MASK_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 78, 95, 88, 178, 87, 14, 317, 402, 318];
const MASK_NOSE = [1, 2, 98, 327, 168, 6, 197, 195, 5, 4];
// 鼻翼、鼻孔和鼻唇交界不是皱纹。单独保留较完整的边界关键点集合，
// 供皱纹候选阶段建立比通用皮肤掩膜更宽的语义排除带。
const MASK_NOSE_BOUNDARY = [
  1, 2, 4, 5, 6, 19, 45, 48, 49, 64, 94, 97, 98, 115, 168, 195, 197,
  220, 275, 278, 279, 294, 326, 327, 344, 440,
];
const MASK_LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const MASK_RIGHT_BROW = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];
const MASK_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

function stampDisk(forbidden, size, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) forbidden[y * size + x] = 1;
    }
  }
}

function regionRadius(mesh, idxs, size, scale = 1.15) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, n = 0;
  for (const i of idxs) {
    const p = mesh[i];
    if (!p) continue;
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
    n++;
  }
  if (!n) return { cx: size / 2, cy: size / 2, r: size * 0.04 };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const r = Math.max(3, 0.5 * Math.hypot(maxX - minX, maxY - minY) * scale);
  return { cx, cy, r };
}

/** 随用户关键点生成皮肤/禁区掩膜（canonical 像素坐标） */
export function buildMasksFromMesh(meshXY, size = SIZE) {
  if (!meshXY || meshXY.length < 200) return buildMasks(size);
  const skin = new Uint8Array(size * size);
  const forbidden = new Uint8Array(size * size);

  // 脸部皮肤：oval 点凸包近似 → 椭圆包围
  let sx = 0, sy = 0, n = 0;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const i of MASK_OVAL) {
    const p = meshXY[i];
    if (!p) continue;
    sx += p[0]; sy += p[1]; n++;
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  if (n < 8) return buildMasks(size);
  const cx = sx / n, cy = sy / n;
  const rx = Math.max(8, (maxX - minX) * 0.52);
  const ry = Math.max(8, (maxY - minY) * 0.56);

  const le = regionRadius(meshXY, MASK_LEFT_EYE, size, 1.3);
  const re = regionRadius(meshXY, MASK_RIGHT_EYE, size, 1.3);
  const lips = regionRadius(meshXY, MASK_LIPS, size, 1.25);
  const nose = regionRadius(meshXY, MASK_NOSE, size, 1.1);
  const lb = regionRadius(meshXY, MASK_LEFT_BROW, size, 1.25);
  const rb = regionRadius(meshXY, MASK_RIGHT_BROW, size, 1.25);
  stampDisk(forbidden, size, le.cx, le.cy, le.r);
  stampDisk(forbidden, size, re.cx, re.cy, re.r);
  stampDisk(forbidden, size, lips.cx, lips.cy, lips.r);
  stampDisk(forbidden, size, nose.cx, nose.cy, nose.r * 0.85);
  // 眉毛：毛发方向易被误当褶皱，纳入禁区
  stampDisk(forbidden, size, lb.cx, lb.cy, lb.r);
  stampDisk(forbidden, size, rb.cx, rb.cy, rb.r);
  // 上部发际/刘海带：canonical 顶部 ~12% 视作毛发遮挡
  const hairY = Math.round(size * 0.12);
  for (let y = 0; y < hairY; y++) {
    for (let x = 0; x < size; x++) forbidden[y * size + x] = 1;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const inSkin = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      skin[i] = inSkin && !forbidden[i] ? 1 : 0;
    }
  }
  return { skin, forbidden };
}

/**
 * 面部区域掩膜。区域用于限定动作证据，不替代皮肤/遮挡掩膜。
 * 坐标基于冻结后的 canonical 脸框，因此 320/640 两层可以共享同一比例定义。
 */
export function buildRegionMasks(meshXY, skin, size = SIZE) {
  const masks = Object.fromEntries(REGION_NAMES.map((name) => [name, new Float32Array(size * size)]));
  let minX = size * 0.08, minY = size * 0.08, maxX = size * 0.92, maxY = size * 0.94;
  if (meshXY?.length) {
    const pts = MASK_OVAL.map((i) => meshXY[i]).filter(Boolean);
    if (pts.length >= 8) {
      minX = Math.min(...pts.map((p) => p[0])); maxX = Math.max(...pts.map((p) => p[0]));
      minY = Math.min(...pts.map((p) => p[1])); maxY = Math.max(...pts.map((p) => p[1]));
    }
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const ell = (nx, ny, cx, cy, rx, ry) => {
    const d = ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2;
    return d >= 1 ? 0 : Math.max(0, 1 - d);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (skin && !skin[i]) continue;
      const nx = (x - minX) / w, ny = (y - minY) / h;
      masks.forehead[i] = ell(nx, ny, 0.50, 0.18, 0.36, 0.22);
      masks.glabella[i] = ell(nx, ny, 0.50, 0.36, 0.15, 0.17);
      masks.left_periocular[i] = ell(nx, ny, 0.31, 0.40, 0.22, 0.15);
      masks.right_periocular[i] = ell(nx, ny, 0.69, 0.40, 0.22, 0.15);
      masks.left_cheek[i] = ell(nx, ny, 0.30, 0.61, 0.27, 0.23);
      masks.right_cheek[i] = ell(nx, ny, 0.70, 0.61, 0.27, 0.23);
      masks.nose[i] = ell(nx, ny, 0.50, 0.52, 0.16, 0.24);
      masks.perioral[i] = ell(nx, ny, 0.50, 0.73, 0.27, 0.18);
      masks.chin[i] = ell(nx, ny, 0.50, 0.88, 0.25, 0.14);
    }
  }
  return masks;
}

/**
 * Tight glabellar wrinkle ROI for evidence extraction.
 *
 * This is intentionally narrower than the action region: the latter answers
 * "which facial area did the expression affect", while this mask answers
 * "where may a vertical glabellar groove be measured".  The mask is expressed
 * in canonical, face-relative coordinates, so no camera-pixel threshold is
 * involved.  Eyebrow/nose/hair exclusions remain controlled by `skin`.
 */
export function buildGlabellaWrinkleMask(meshXY, skin, size = SIZE) {
  const mask = new Float32Array(size * size);
  let minX = size * 0.08, minY = size * 0.08, maxX = size * 0.92, maxY = size * 0.94;
  if (meshXY?.length) {
    const oval = MASK_OVAL.map((index) => meshXY[index]).filter(Boolean);
    if (oval.length >= 8) {
      minX = Math.min(...oval.map((point) => point[0]));
      maxX = Math.max(...oval.map((point) => point[0]));
      minY = Math.min(...oval.map((point) => point[1]));
      maxY = Math.max(...oval.map((point) => point[1]));
    }
  }
  const faceWidth = Math.max(1, maxX - minX), faceHeight = Math.max(1, maxY - minY);
  const centerX = minX + 0.50 * faceWidth;
  const centerY = minY + 0.315 * faceHeight;
  const radiusX = 0.105 * faceWidth;
  const radiusY = 0.135 * faceHeight;
  const browPoints = meshXY?.length
    ? [...MASK_LEFT_BROW, ...MASK_RIGHT_BROW].map((index) => meshXY[index]).filter(Boolean)
    : [];
  const browMargin = Math.max(2, 0.010 * faceWidth);
  const nearestBrowPoint = (x) => {
    let nearest = null, distance = Infinity;
    for (const point of browPoints) {
      const nextDistance = Math.abs(point[0] - x);
      if (nextDistance < distance) { distance = nextDistance; nearest = point; }
    }
    return nearest;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      // The general skin mask deliberately removes a generous eyebrow disk.
      // For wrinkle extraction that disk is too broad: it also deletes the
      // oblique corrugator folds immediately above the inner brows. Recover
      // only skin above the nearest brow landmark while retaining a tight
      // hair margin; eye/nose pixels below the brow remain excluded.
      let allowedSkin = !skin || !!skin[index];
      if (!allowedSkin && browPoints.length) {
        const brow = nearestBrowPoint(x);
        allowedSkin = !!brow && y < brow[1] - browMargin;
      }
      if (!allowedSkin) continue;
      const dx = (x - centerX) / radiusX, dy = (y - centerY) / radiusY;
      const distance = dx * dx + dy * dy;
      if (distance >= 1) continue;
      // A squared cosine-like taper prevents a hard ROI boundary from becoming
      // an artificial image edge while keeping the central glabella dominant.
      mask[index] = (1 - distance) ** 2;
    }
  }
  return mask;
}

/** Action-specific skin zones where an expression may reveal real grooves. */
export function buildActionWrinkleMask(action, meshXY, skin, size = SIZE) {
  if (action === "frown") return buildGlabellaWrinkleMask(meshXY, skin, size);
  const mask = new Float32Array(size * size);
  let minX = size * 0.08, minY = size * 0.08, maxX = size * 0.92, maxY = size * 0.94;
  if (meshXY?.length) {
    const oval = MASK_OVAL.map((index) => meshXY[index]).filter(Boolean);
    if (oval.length >= 8) {
      minX = Math.min(...oval.map((point) => point[0]));
      maxX = Math.max(...oval.map((point) => point[0]));
      minY = Math.min(...oval.map((point) => point[1]));
      maxY = Math.max(...oval.map((point) => point[1]));
    }
  }
  const faceWidth = Math.max(1, maxX - minX), faceHeight = Math.max(1, maxY - minY);
  const featureBox = (indices, padX, padY) => {
    const points = meshXY?.length ? indices.map((index) => meshXY[index]).filter(Boolean) : [];
    if (!points.length) return null;
    const x0 = Math.min(...points.map((point) => point[0])) - padX * faceWidth;
    const x1 = Math.max(...points.map((point) => point[0])) + padX * faceWidth;
    const y0 = Math.min(...points.map((point) => point[1])) - padY * faceHeight;
    const y1 = Math.max(...points.map((point) => point[1])) + padY * faceHeight;
    return { cx: 0.5 * (x0 + x1), cy: 0.5 * (y0 + y1), rx: 0.5 * (x1 - x0), ry: 0.5 * (y1 - y0) };
  };
  const insideBoxEllipse = (x, y, box) => box &&
    ((x - box.cx) / Math.max(1, box.rx)) ** 2 + ((y - box.cy) / Math.max(1, box.ry)) ** 2 <= 1;
  // Wrinkle extraction needs a wider exclusion band than rendering/optimization:
  // a moving eyelid, nostril or lip boundary remains highly repeatable after warp.
  const mouthAction = action === "purse" || action === "open_mouth";
  const featureExclusions = [
    featureBox(MASK_LEFT_EYE, 0.040, 0.065),
    featureBox(MASK_RIGHT_EYE, 0.040, 0.065),
    featureBox(MASK_LEFT_BROW, 0.022, 0.032),
    featureBox(MASK_RIGHT_BROW, 0.022, 0.032),
    featureBox(MASK_NOSE_BOUNDARY, mouthAction ? 0.070 : 0.050, mouthAction ? 0.075 : 0.060),
    featureBox(MASK_LIPS, mouthAction ? 0.105 : 0.070, mouthAction ? 0.090 : 0.070),
  ].filter(Boolean);
  const ell = (nx, ny, cx, cy, rx, ry) => {
    const distance = ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2;
    return distance >= 1 ? 0 : (1 - distance) ** 2;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x;
    if (skin && !skin[index]) continue;
    if (featureExclusions.some((box) => insideBoxEllipse(x, y, box))) continue;
    const nx = (x - minX) / faceWidth, ny = (y - minY) / faceHeight;
    let value = 0;
    if (action === "raise_brows") {
      // Forehead only. The lower glabella/brow band is handled by frown.
      value = ell(nx, ny, 0.50, 0.19, 0.34, 0.145);
    } else if (action === "squint") {
      // Crow's-feet zones lateral to the canthi; eyelids and tear troughs are
      // deliberately excluded instead of treating eye closure edges as wrinkles.
      value = Math.max(
        ell(nx, ny, 0.17, 0.405, 0.115, 0.105),
        ell(nx, ny, 0.83, 0.405, 0.115, 0.105),
      );
    } else if (action === "smile") {
      value = Math.max(
        ell(nx, ny, 0.17, 0.405, 0.11, 0.10), ell(nx, ny, 0.83, 0.405, 0.11, 0.10),
        ell(nx, ny, 0.31, 0.64, 0.105, 0.16), ell(nx, ny, 0.69, 0.64, 0.105, 0.16),
      );
    } else if (action === "puff") {
      // Puff stretches skin. It is a contradiction/quality action, not a
      // positive wrinkle source, so it must not emit wrinkle centerlines.
      value = 0;
    } else if (action === "purse") {
      value = Math.max(
        ell(nx, ny, 0.30, 0.73, 0.12, 0.15), ell(nx, ny, 0.70, 0.73, 0.12, 0.15),
        ell(nx, ny, 0.50, 0.87, 0.16, 0.09),
      );
    } else if (action === "open_mouth") {
      value = Math.max(
        ell(nx, ny, 0.31, 0.75, 0.11, 0.14), ell(nx, ny, 0.69, 0.75, 0.11, 0.14),
        ell(nx, ny, 0.50, 0.89, 0.18, 0.08),
      );
    }
    mask[index] = value;
  }
  return mask;
}

export function actionRegionField(action, regionMasks, size = SIZE) {
  const out = new Float32Array(size * size);
  const weights = ACTION_REGION_WEIGHT[action] || {};
  for (const [name, weight] of Object.entries(weights)) {
    const mask = regionMasks?.[name];
    if (!mask) continue;
    for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], mask[i] * weight);
  }
  return out;
}

export function createRegionEvidenceState() {
  return Object.fromEntries(REGION_NAMES.map((name) => [name, {
    staticConfidence: 0,
    dynamicConfidence: 0,
    deformationConfidence: 0,
    repeatability: 0,
    conflict: 0,
    coverage: 0,
    finalConfidence: 0,
  }]));
}

export function chooseNextAction(regionState, completed = [], skipped = [], attempts = {}) {
  const done = new Set(completed);
  const skip = new Set(skipped);
  const coreFinished = [...CORE_ACTIONS].every((action) => done.has(action) || skip.has(action));
  let best = null, bestScore = -Infinity;
  for (let order = 0; order < ACTION_ORDER.length; order++) {
    const action = ACTION_ORDER[order];
    if (done.has(action) || skip.has(action)) continue;
    if (!CORE_ACTIONS.has(action) && !coreFinished) continue;
    const weights = ACTION_REGION_WEIGHT[action] || {};
    let gain = 0, low = 0, conflict = 0, norm = 0;
    for (const [region, weight] of Object.entries(weights)) {
      const s = regionState?.[region] || {};
      const c = s.finalConfidence || 0;
      gain += weight * (1 - c);
      low += weight * Math.max(0, 0.55 - c);
      conflict += weight * (s.conflict || 0);
      norm += weight;
    }
    if (!norm) continue;
    if (!CORE_ACTIONS.has(action) && gain / norm < 0.45 && conflict / norm < 0.25) continue;
    const optionalPenalty = CORE_ACTIONS.has(action) ? 0 : 0.18;
    const score = gain / norm + 0.55 * low / norm + 0.35 * conflict / norm
      - 0.12 * (attempts[action] || 0) - optionalPenalty - order * 1e-4;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  return { action: best, score: bestScore };
}

/**
 * 粗姿态质量：用双眼外角 + 鼻尖估计 roll / 左右不对称（yaw 代理）。
 * 返回 { ok, rollDeg, yawProxy, scale }；超限时 ok=false。
 */
export function estimatePoseQuality(lmPx) {
  if (!lmPx || lmPx.length < 264) {
    return { ok: false, rollDeg: 0, yawProxy: 0, scale: 0 };
  }
  const L = lmPx[33], R = lmPx[263], N = lmPx[1];
  if (!L || !R || !N) return { ok: false, rollDeg: 0, yawProxy: 0, scale: 0 };
  const dx = R[0] - L[0], dy = R[1] - L[1];
  const scale = Math.hypot(dx, dy) || 1;
  const rollDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  // 鼻尖相对双眼中点的水平偏移 / 眼距
  const midX = (L[0] + R[0]) / 2;
  const yawProxy = (N[0] - midX) / scale;
  const ok = Math.abs(rollDeg) < 18 && Math.abs(yawProxy) < 0.22 && scale > 40;
  return { ok, rollDeg, yawProxy, scale };
}

// ── 图像工具 ────────────────────────────────────────────────────────────────
export function grayFromImageData(img) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

export function downsampleGray(src, srcW, srcH, dstW, dstH) {
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * srcH / dstH), y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcH / dstH));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * srcW / dstW), x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcW / dstW));
      let sum = 0, n = 0;
      for (let yy = y0; yy < Math.min(srcH, y1); yy++) {
        for (let xx = x0; xx < Math.min(srcW, x1); xx++) { sum += src[yy * srcW + xx]; n++; }
      }
      out[y * dstW + x] = n ? sum / n : 0;
    }
  }
  return out;
}

/** 小样本逐像素中位数；复用工作数组，避免每像素分配对象。 */
export function temporalMedianGray(frames) {
  if (!frames?.length) return new Float32Array(0);
  const len = frames[0].length, n = frames.length;
  const out = new Float32Array(len);
  const work = new Float32Array(n);
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < n; k++) work[k] = frames[k][i];
    for (let k = 1; k < n; k++) {
      const v = work[k]; let j = k - 1;
      while (j >= 0 && work[j] > v) { work[j + 1] = work[j]; j--; }
      work[j + 1] = v;
    }
    out[i] = work[n >> 1];
  }
  return out;
}

/**
 * Brightness/contrast invariant return-to-neutral similarity with a small
 * translation search. This prevents minor camera motion from failing return.
 */
export function normalizedReturnConsistency(reference, current, mask, width, height, maxShift = 2) {
  if (!reference || !current || reference.length !== current.length) return 0;
  let best = -1;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let ar = 0, ac = 0, count = 0;
      for (let y = maxShift; y < height - maxShift; y++) {
        for (let x = maxShift; x < width - maxShift; x++) {
          const i = y * width + x, j = (y + dy) * width + x + dx;
          if (mask && (!mask[i] || !mask[j])) continue;
          ar += reference[i]; ac += current[j]; count++;
        }
      }
      if (count < 50) continue;
      const mr = ar / count, mc = ac / count;
      let cov = 0, vr = 0, vc = 0;
      for (let y = maxShift; y < height - maxShift; y++) {
        for (let x = maxShift; x < width - maxShift; x++) {
          const i = y * width + x, j = (y + dy) * width + x + dx;
          if (mask && (!mask[i] || !mask[j])) continue;
          const r = reference[i] - mr, c = current[j] - mc;
          cov += r * c; vr += r * r; vc += c * c;
        }
      }
      const corr = cov / Math.sqrt(Math.max(1e-9, vr * vc));
      best = Math.max(best, corr);
    }
  }
  return Math.max(0, Math.min(1, 0.5 + 0.5 * best));
}
function gaussianBlurGray(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2));
  const kernel = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v); sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        acc += src[y * w + xx] * kernel[k + r];
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[yy * w + x] * kernel[k + r];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}
function sobel(src, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gx[i] =
        -src[i - w - 1] + src[i - w + 1]
        - 2 * src[i - 1] + 2 * src[i + 1]
        - src[i + w - 1] + src[i + w + 1];
      gy[i] =
        -src[i - w - 1] - 2 * src[i - w] - src[i - w + 1]
        + src[i + w - 1] + 2 * src[i + w] + src[i + w + 1];
    }
  }
  return { gx, gy };
}

// ── 分片仿射 warp 到 canonical ──────────────────────────────────────────────
export function landmarksToCanonicalXY(lmPx, size, refXY = null, options = {}) {
  // lmPx: [[x,y,z],...] image pixels; return mesh in canonical pixels
  const n = Math.min(468, lmPx.length);
  const src = lmPx.slice(0, n).map((p) => [p[0], p[1], 0]);
  let dst;
  if (refXY) {
    dst = refXY.slice(0, n).map((p) => [p[0], p[1], 0]);
  } else {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const p of src) {
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
    }
    const pad = 0.08;
    const bw = maxX - minX || 1, bh = maxY - minY || 1;
    dst = src.map(([x, y]) => [
      ((x - minX) / bw * (1 - 2 * pad) + pad) * (size - 1),
      ((y - minY) / bh * (1 - 2 * pad) + pad) * (size - 1),
      0,
    ]);
  }
  const requestedAnchors = Array.isArray(options?.anchorIndices)
    ? options.anchorIndices
    : null;
  const anchorIndices = requestedAnchors?.length
    ? requestedAnchors.filter((index) => index >= 0 && index < n && src[index] && dst[index])
    : null;
  const fitSrc = anchorIndices?.length >= 3 ? anchorIndices.map((index) => src[index]) : src;
  const fitDst = anchorIndices?.length >= 3 ? anchorIndices.map((index) => dst[index]) : dst;
  const sim = umeyama(fitSrc, fitDst);
  return applySim(sim, src).map((p) => [p[0], p[1]]);
}

export function warpToCanonical(videoOrCanvas, srcXY, dstXY, triangles, size) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);

  // 源图画到临时 canvas
  const srcC = document.createElement("canvas");
  const sw = videoOrCanvas.videoWidth || videoOrCanvas.width;
  const sh = videoOrCanvas.videoHeight || videoOrCanvas.height;
  srcC.width = sw; srcC.height = sh;
  const sctx = srcC.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(videoOrCanvas, 0, 0);

  const n = Math.min(468, srcXY.length, dstXY.length);
  for (const tri of triangles) {
    const i0 = tri[0], i1 = tri[1], i2 = tri[2];
    if (i0 >= n || i1 >= n || i2 >= n) continue;
    const s0 = srcXY[i0], s1 = srcXY[i1], s2 = srcXY[i2];
    const d0 = dstXY[i0], d1 = dstXY[i1], d2 = dstXY[i2];
    const area = (d1[0] - d0[0]) * (d2[1] - d0[1]) - (d2[0] - d0[0]) * (d1[1] - d0[1]);
    if (Math.abs(area) < 1) continue;

    // 目标包围盒
    const minX = Math.max(0, Math.floor(Math.min(d0[0], d1[0], d2[0])));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(d0[0], d1[0], d2[0])));
    const minY = Math.max(0, Math.floor(Math.min(d0[1], d1[1], d2[1])));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(d0[1], d1[1], d2[1])));
    if (maxX <= minX || maxY <= minY) continue;

    // 用 canvas 裁剪路径 + transform 近似：逐三角 setTransform
    const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
    if (Math.abs(den) < 1e-3) continue;

    // 仿射：src -> dst
    // 解 2x3 矩阵
    const A = [
      [s0[0], s0[1], 1, 0, 0, 0],
      [0, 0, 0, s0[0], s0[1], 1],
      [s1[0], s1[1], 1, 0, 0, 0],
      [0, 0, 0, s1[0], s1[1], 1],
      [s2[0], s2[1], 1, 0, 0, 0],
      [0, 0, 0, s2[0], s2[1], 1],
    ];
    const b = [d0[0], d0[1], d1[0], d1[1], d2[0], d2[1]];
    const m = solve6(A, b);
    if (!m) continue;

    // 裁剪三角向外扩 ~0.8px：相邻三角重叠覆盖接缝，消除黑色网格边
    const cx = (d0[0] + d1[0] + d2[0]) / 3;
    const cy = (d0[1] + d1[1] + d2[1]) / 3;
    const EXP = 0.8;
    const push = (d) => {
      const vx = d[0] - cx, vy = d[1] - cy;
      const l = Math.hypot(vx, vy) || 1;
      return [d[0] + (vx / l) * EXP, d[1] + (vy / l) * EXP];
    };
    const e0 = push(d0), e1 = push(d1), e2 = push(d2);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(e0[0], e0[1]);
    ctx.lineTo(e1[0], e1[1]);
    ctx.lineTo(e2[0], e2[1]);
    ctx.closePath();
    ctx.clip();
    // setTransform(a,b,c,d,e,f) maps src -> dest: x' = a*x + c*y + e（仿射仍用原三角解）
    ctx.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
    ctx.drawImage(srcC, 0, 0);
    ctx.restore();
  }
  return ctx.getImageData(0, 0, size, size);
}

function solve6(A, b) {
  // 高斯消元 6x6
  const M = A.map((row, i) => row.concat([b[i]]));
  const n = 6;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-8) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * 点 → 网格三角重心坐标。用于把 canonical 曲线锚到网格拓扑，
 * 之后可映射到任意帧的关键点（消除坐标系漂移）。返回 {tri,u,v} 或 null。
 */
export function pointToBary(pt, meshXY, triangles) {
  if (!pt || !meshXY || !triangles) return null;
  const px = pt[0], py = pt[1];
  const n = meshXY.length;
  let bestTri = -1, bestU = 0, bestV = 0, bestSlack = -Infinity;
  for (let t = 0; t < triangles.length; t++) {
    const i0 = triangles[t][0], i1 = triangles[t][1], i2 = triangles[t][2];
    if (i0 >= n || i1 >= n || i2 >= n) continue;
    const a = meshXY[i0], b = meshXY[i1], c = meshXY[i2];
    if (!a || !b || !c) continue;
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-9) continue;
    const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
    const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
    const w = 1 - u - v;
    const slack = Math.min(u, v, w);
    if (slack >= -1e-4) return { tri: t, u, v };
    // 记录最接近的三角，容忍轻微越界
    if (slack > bestSlack) { bestSlack = slack; bestTri = t; bestU = u; bestV = v; }
  }
  if (bestTri >= 0 && bestSlack > -0.05) return { tri: bestTri, u: bestU, v: bestV };
  return null;
}

/** 重心坐标 → 目标网格上的点。meshXY 可为任意帧（如实时关键点）。 */
export function baryToPoint(bary, meshXY, triangles) {
  if (!bary || !meshXY || !triangles) return null;
  const tri = triangles[bary.tri];
  if (!tri) return null;
  const a = meshXY[tri[0]], b = meshXY[tri[1]], c = meshXY[tri[2]];
  if (!a || !b || !c) return null;
  const w = 1 - bary.u - bary.v;
  return [
    bary.u * a[0] + bary.v * b[0] + w * c[0],
    bary.u * a[1] + bary.v * b[1] + w * c[1],
  ];
}

export function meshFlowField(srcXY, dstXY, triangles, size) {
  // U = dst - src 在 dst 坐标上插值
  const u = new Float32Array(size * size);
  const v = new Float32Array(size * size);
  const wgt = new Float32Array(size * size);
  const n = Math.min(468, srcXY.length, dstXY.length);
  for (const tri of triangles) {
    const i0 = tri[0], i1 = tri[1], i2 = tri[2];
    if (Math.max(i0, i1, i2) >= n) continue;
    const d0 = dstXY[i0], d1 = dstXY[i1], d2 = dstXY[i2];
    const f0 = [dstXY[i0][0] - srcXY[i0][0], dstXY[i0][1] - srcXY[i0][1]];
    const f1 = [dstXY[i1][0] - srcXY[i1][0], dstXY[i1][1] - srcXY[i1][1]];
    const f2 = [dstXY[i2][0] - srcXY[i2][0], dstXY[i2][1] - srcXY[i2][1]];
    const minX = Math.max(0, Math.floor(Math.min(d0[0], d1[0], d2[0])));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(d0[0], d1[0], d2[0])));
    const minY = Math.max(0, Math.floor(Math.min(d0[1], d1[1], d2[1])));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(d0[1], d1[1], d2[1])));
    const den = (d1[0] - d0[0]) * (d2[1] - d0[1]) - (d2[0] - d0[0]) * (d1[1] - d0[1]);
    if (Math.abs(den) < 1e-6) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const v0x = d1[0] - d0[0], v0y = d1[1] - d0[1];
        const v1x = d2[0] - d0[0], v1y = d2[1] - d0[1];
        const v2x = x - d0[0], v2y = y - d0[1];
        const d00 = v0x * v0x + v0y * v0y;
        const d01 = v0x * v1x + v0y * v1y;
        const d11 = v1x * v1x + v1y * v1y;
        const d20 = v2x * v0x + v2y * v0y;
        const d21 = v2x * v1x + v2y * v1y;
        const inv = d00 * d11 - d01 * d01;
        if (Math.abs(inv) < 1e-8) continue;
        const bu = (d11 * d20 - d01 * d21) / inv;
        const bv = (d00 * d21 - d01 * d20) / inv;
        const bw = 1 - bu - bv;
        if (bu < -0.02 || bv < -0.02 || bw < -0.02) continue;
        const idx = y * size + x;
        u[idx] += bw * f0[0] + bu * f1[0] + bv * f2[0];
        v[idx] += bw * f0[1] + bu * f1[1] + bv * f2[1];
        wgt[idx] += 1;
      }
    }
  }
  for (let i = 0; i < wgt.length; i++) {
    if (wgt[i] > 0) { u[i] /= wgt[i]; v[i] /= wgt[i]; }
  }
  return { u, v };
}

/**
 * 由中性网格到当前网格的三角形 Jacobian 计算粗尺度形变标量。
 * 该分支不输出 RSTL 方向，只用于支持或否决纹理证据。
 */
export function meshDeformationSupport(refXY, currentXY, triangles, size = SIZE) {
  const compression = new Float32Array(size * size);
  const stretch = new Float32Array(size * size);
  const shear = new Float32Array(size * size);
  const support = new Float32Array(size * size);
  const weight = new Float32Array(size * size);
  const n = Math.min(refXY?.length || 0, currentXY?.length || 0, 468);
  if (n < 3) return { compression, stretch, shear, support };
  for (const tri of triangles || []) {
    const [i0, i1, i2] = tri;
    if (Math.max(i0, i1, i2) >= n) continue;
    const r0 = refXY[i0], r1 = refXY[i1], r2 = refXY[i2];
    const c0 = currentXY[i0], c1 = currentXY[i1], c2 = currentXY[i2];
    if (!r0 || !r1 || !r2 || !c0 || !c1 || !c2) continue;
    const a = r1[0] - r0[0], b = r2[0] - r0[0];
    const c = r1[1] - r0[1], d = r2[1] - r0[1];
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-6) continue;
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
    const ca = c1[0] - c0[0], cb = c2[0] - c0[0];
    const cc = c1[1] - c0[1], cd = c2[1] - c0[1];
    const j00 = ca * ia + cb * ic, j01 = ca * ib + cb * id;
    const j10 = cc * ia + cd * ic, j11 = cc * ib + cd * id;
    const exx = j00 - 1, eyy = j11 - 1, exy = 0.5 * (j01 + j10);
    const mean = 0.5 * (exx + eyy);
    const rad = Math.sqrt((0.5 * (exx - eyy)) ** 2 + exy ** 2);
    const eigMax = mean + rad, eigMin = mean - rad;
    const comp = Math.min(1, Math.max(0, -eigMin) / 0.10);
    const str = Math.min(1, Math.max(0, eigMax) / 0.14);
    const shr = Math.min(1, Math.abs(exy) / 0.10);
    const sup = Math.min(1, 0.50 * comp + 0.30 * shr + 0.20 * str);
    const minX = Math.max(0, Math.floor(Math.min(r0[0], r1[0], r2[0])));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(r0[0], r1[0], r2[0])));
    const minY = Math.max(0, Math.floor(Math.min(r0[1], r1[1], r2[1])));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(r0[1], r1[1], r2[1])));
    const area = (r1[0] - r0[0]) * (r2[1] - r0[1]) - (r2[0] - r0[0]) * (r1[1] - r0[1]);
    if (Math.abs(area) < 1e-6) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const u = ((r1[0] - x) * (r2[1] - y) - (r2[0] - x) * (r1[1] - y)) / area;
        const v = ((r2[0] - x) * (r0[1] - y) - (r0[0] - x) * (r2[1] - y)) / area;
        const w = 1 - u - v;
        if (u < -0.02 || v < -0.02 || w < -0.02) continue;
        const idx = y * size + x;
        compression[idx] += comp; stretch[idx] += str; shear[idx] += shr; support[idx] += sup; weight[idx]++;
      }
    }
  }
  for (let i = 0; i < weight.length; i++) {
    if (!weight[i]) continue;
    compression[i] /= weight[i]; stretch[i] /= weight[i]; shear[i] /= weight[i]; support[i] /= weight[i];
  }
  return { compression, stretch, shear, support };
}

// ── 结构张量方向 ────────────────────────────────────────────────────────────
export function textureOrientation(refGray, curGray, w, h, skin) {
  const refB = gaussianBlurGray(refGray, w, h, 1.5);
  const curB = gaussianBlurGray(curGray, w, h, 1.5);
  const delta = new Float32Array(w * h);
  for (let i = 0; i < delta.length; i++) delta[i] = (curGray[i] - curB[i]) - (refGray[i] - refB[i]);
  const { gx, gy } = sobel(delta, w, h);
  const jxx = gaussianBlurGray(mul(gx, gx), w, h, 1.2);
  const jyy = gaussianBlurGray(mul(gy, gy), w, h, 1.2);
  const jxy = gaussianBlurGray(mul(gx, gy), w, h, 1.2);
  const q = new Float32Array(w * h * 2);
  const coh = new Float32Array(w * h);
  const amp = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!skin[i]) continue;
    const ang = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i] + 1e-8) + Math.PI / 2;
    const qq = angleToQ(ang);
    q[i * 2] = qq[0]; q[i * 2 + 1] = qq[1];
    const tmp = Math.sqrt((jxx[i] - jyy[i]) ** 2 + 4 * jxy[i] * jxy[i]);
    coh[i] = tmp / (jxx[i] + jyy[i] + 1e-6);
    amp[i] = Math.sqrt(jxx[i] + jyy[i]);
  }
  return { q, coh, amp };
}

/** 中性中位图上的静态线结构，不把光流或表情差分当作方向。 */
export function staticTextureEvidence(neutralGray, w, h, skin) {
  const low = gaussianBlurGray(neutralGray, w, h, 2.2);
  const high = new Float32Array(w * h);
  for (let i = 0; i < high.length; i++) high[i] = neutralGray[i] - low[i];
  const { gx, gy } = sobel(high, w, h);
  const jxx = gaussianBlurGray(mul(gx, gx), w, h, 1.4);
  const jyy = gaussianBlurGray(mul(gy, gy), w, h, 1.4);
  const jxy = gaussianBlurGray(mul(gx, gy), w, h, 1.4);
  const q = new Float32Array(w * h * 2);
  const confidence = new Float32Array(w * h);
  const ridge = new Float32Array(w * h);
  let ampMean = 0, count = 0;
  for (let i = 0; i < w * h; i++) {
    if (skin && !skin[i]) continue;
    const energy = Math.sqrt(jxx[i] + jyy[i]);
    ampMean += energy; count++;
  }
  ampMean = (count ? ampMean / count : 1) + 1e-6;
  for (let i = 0; i < w * h; i++) {
    if (skin && !skin[i]) continue;
    const tmp = Math.sqrt((jxx[i] - jyy[i]) ** 2 + 4 * jxy[i] * jxy[i]);
    const coh = tmp / (jxx[i] + jyy[i] + 1e-6);
    const energy = Math.sqrt(jxx[i] + jyy[i]);
    const ang = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i] + 1e-8) + Math.PI / 2;
    const qq = angleToQ(ang);
    q[i * 2] = qq[0]; q[i * 2 + 1] = qq[1];
    ridge[i] = Math.min(1, energy / (ampMean * 3.0));
    confidence[i] = Math.min(1, 0.65 * coh + 0.35 * ridge[i]);
  }
  return { q, confidence, ridge };
}

/**
 * Build neutral-face evidence that must survive time, illumination and scale.
 *
 * The single-image structure tensor above is intentionally kept as the line
 * detector. This wrapper decides whether that line is a stable personal skin
 * structure rather than a transient highlight, compression edge or broad
 * shadow. Frames are already warped to the frozen neutral mesh by the caller.
 */
export function stableStaticTextureEvidence(neutralGray, frames, w, h, skin) {
  const base = staticTextureEvidence(neutralGray, w, h, skin);
  const n = w * h;
  const confidence = new Float32Array(n);
  const ridge = new Float32Array(n);
  const temporalStability = new Float32Array(n);
  const temporalPersistence = new Float32Array(n);
  const valid = (frames || []).filter((frame) => frame?.length === n);
  const selected = valid.length <= 12
    ? valid
    : Array.from({ length: 12 }, (_, i) => valid[Math.round(i * (valid.length - 1) / 11)]);

  if (selected.length < 3) {
    for (let i = 0; i < n; i++) {
      if (skin && !skin[i]) continue;
      temporalStability[i] = 0.25;
      confidence[i] = 0.35 * base.confidence[i];
      ridge[i] = 0.35 * base.ridge[i];
    }
    return {
      q: base.q,
      confidence,
      ridge,
      temporalStability,
      temporalPersistence,
      illuminationStability: 0.25,
      frameCount: selected.length,
    };
  }

  const statsOf = (frame) => {
    let sum = 0, sum2 = 0, count = 0;
    for (let i = 0; i < n; i += 2) {
      if (skin && !skin[i]) continue;
      const value = frame[i];
      sum += value; sum2 += value * value; count++;
    }
    const mean = count ? sum / count : 0;
    const variance = count ? Math.max(1, sum2 / count - mean * mean) : 1;
    return { mean, std: Math.sqrt(variance) };
  };
  const referenceStats = statsOf(neutralGray);
  const frameStats = selected.map(statsOf);
  let meanDrift = 0, contrastDrift = 0;
  for (const stats of frameStats) {
    meanDrift += Math.abs(stats.mean - referenceStats.mean);
    contrastDrift += Math.abs(stats.std / Math.max(1, referenceStats.std) - 1);
  }
  meanDrift /= frameStats.length;
  contrastDrift /= frameStats.length;
  const illuminationStability = Math.max(0, Math.min(1,
    // Mean exposure drift is the primary lighting cue. Contrast is deliberately
    // softer because a small moving occluder must not invalidate the whole face.
    Math.exp(-meanDrift / 28 - contrastDrift / 1.00)
  ));

  const fineLow = gaussianBlurGray(neutralGray, w, h, 2.0);
  const broadLow = gaussianBlurGray(neutralGray, w, h, 6.0);
  const at = (frame, x, y) => frame[
    Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (skin && !skin[i]) continue;
      const refNorm = (neutralGray[i] - referenceStats.mean) / Math.max(1, referenceStats.std);
      const refNeighbour = (
        at(neutralGray, x - 1, y) + at(neutralGray, x + 1, y) +
        at(neutralGray, x, y - 1) + at(neutralGray, x, y + 1)
      ) * 0.25;
      const refHigh = (neutralGray[i] - refNeighbour) / Math.max(1, referenceStats.std);
      let residual = 0, samePolarity = 0, visible = 0;
      for (let k = 0; k < selected.length; k++) {
        const frame = selected[k], stats = frameStats[k];
        const norm = (frame[i] - stats.mean) / Math.max(1, stats.std);
        residual += Math.abs(norm - refNorm);
        const neighbour = (
          at(frame, x - 1, y) + at(frame, x + 1, y) +
          at(frame, x, y - 1) + at(frame, x, y + 1)
        ) * 0.25;
        const high = (frame[i] - neighbour) / Math.max(1, stats.std);
        if (Math.abs(high) >= 0.018) {
          visible++;
          if (Math.abs(refHigh) < 0.012 || high * refHigh >= 0) samePolarity++;
        }
      }
      const photoStability = Math.exp(-(residual / selected.length) / 0.34);
      const persistence = visible / selected.length * (visible ? samePolarity / visible : 0);
      temporalPersistence[i] = Math.max(0, Math.min(1, persistence));
      temporalStability[i] = Math.max(0, Math.min(1,
        illuminationStability * photoStability * (0.30 + 0.70 * persistence)
      ));

      // Fine-to-broad scale ratio rejects wide shading boundaries while
      // retaining narrow grooves and skin-line pairs.
      const fine = Math.abs(neutralGray[i] - fineLow[i]);
      const broad = Math.abs(neutralGray[i] - broadLow[i]);
      const thinLine = Math.max(0, Math.min(1, 1.45 * fine / (broad + 2.5)));
      const lineStructure = 0.50 * thinLine + 0.50 * base.ridge[i];
      const reliability = temporalStability[i] * (0.42 + 0.58 * lineStructure);
      confidence[i] = Math.max(0, Math.min(1, base.confidence[i] * reliability));
      ridge[i] = Math.max(0, Math.min(1, base.ridge[i] * reliability));
    }
  }
  return {
    q: base.q,
    confidence,
    ridge,
    temporalStability,
    temporalPersistence,
    illuminationStability,
    frameCount: selected.length,
  };
}

/** 把高分辨率轴向证据保守聚合到几何层。 */
export function downsampleAxialEvidence(q, conf, ridge, srcW, srcH, dstW, dstH) {
  const outQ = new Float32Array(dstW * dstH * 2);
  const outC = new Float32Array(dstW * dstH);
  const outR = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * srcH / dstH), y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcH / dstH));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * srcW / dstW), x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcW / dstW));
      let sx = 0, sy = 0, sw = 0, sr = 0, n = 0;
      for (let yy = y0; yy < Math.min(srcH, y1); yy++) {
        for (let xx = x0; xx < Math.min(srcW, x1); xx++) {
          const i = yy * srcW + xx, c = conf?.[i] || 0;
          sx += (q?.[i * 2] || 0) * c; sy += (q?.[i * 2 + 1] || 0) * c;
          sw += c; sr += ridge?.[i] || 0; n++;
        }
      }
      const j = y * dstW + x, nq = normalizeQ([sx, sy]);
      outQ[j * 2] = nq[0]; outQ[j * 2 + 1] = nq[1];
      outC[j] = n ? Math.min(1, sw / n) : 0;
      outR[j] = n ? Math.min(1, sr / n) : 0;
    }
  }
  return { q: outQ, confidence: outC, ridge: outR };
}

/** Seed the shared evidence accumulator with static skin-line evidence. */
export function initializeStaticEvidence(q0, evidence, skin, state) {
  const n = skin.length;
  const q = q0.slice();
  const confidence = new Float32Array(n);
  state.staticQ = evidence.q.slice();
  state.staticConfidence = evidence.confidence.slice();
  state.staticRidge = evidence.ridge.slice();
  state.dynamicValidation = new Float32Array(n);
  state.dynamicRidge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = skin[i] ? Math.max(0, Math.min(1, evidence.confidence[i] || 0)) : 0;
    if (c < 0.16) continue;
    const w = 0.55 * c;
    state.moment[i * 2] += w * evidence.q[i * 2];
    state.moment[i * 2 + 1] += w * evidence.q[i * 2 + 1];
    state.weight[i] += w;
    state.ridgeMoment[i] += w * (evidence.ridge[i] || 0);
    state.ridgeWeight[i] += w;
    const obs = normalizeQ([evidence.q[i * 2], evidence.q[i * 2 + 1]]);
    const prior = [q0[i * 2], q0[i * 2 + 1]];
    const mixed = normalizeQ([0.82 * prior[0] + 0.18 * c * obs[0], 0.82 * prior[1] + 0.18 * c * obs[1]]);
    q[i * 2] = mixed[0]; q[i * 2 + 1] = mixed[1];
    confidence[i] = 1 - Math.exp(-state.weight[i] * 0.85);
  }
  state.fieldQ = q;
  state.fieldC = confidence;
  state.ridgeField = evidence.ridge.slice();
  return { q, conf: confidence, ridge: state.ridgeField };
}
function mul(a, b) {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] * b[i];
  return o;
}

// ── 块匹配运动门控（非完整 DIS；u/v 会进入融合）────────────────────────────
function blockSSD(refG, curG, w, h, bx, by, dx, dy, block) {
  let ssd = 0, n = 0;
  for (let y = 0; y < block; y++) {
    for (let x = 0; x < block; x++) {
      const i0 = (by + y) * w + (bx + x);
      const xx = bx + x + dx, yy = by + y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const d = refG[i0] - curG[yy * w + xx];
      ssd += d * d; n++;
    }
  }
  return n ? ssd / n : 1e18;
}

/**
 * 块匹配：返回位移场 u,v 与置信度。
 * 置信度综合：残差、最佳/次佳比、反向一致性；不是完整光流算法。
 */
export function blockMatchFlow(refG, curG, w, h, skin, block = 8, search = 4) {
  const u = new Float32Array(w * h);
  const v = new Float32Array(w * h);
  const conf = new Float32Array(w * h);
  for (let by = block; by < h - block; by += block) {
    for (let bx = block; bx < w - block; bx += block) {
      if (!skin[by * w + bx]) continue;
      let best = 1e18, second = 1e18, bu = 0, bv = 0;
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          const ssd = blockSSD(refG, curG, w, h, bx, by, dx, dy, block);
          if (ssd < best - 1e-9) {
            second = best; best = ssd; bu = dx; bv = dy;
          } else if (Math.abs(ssd - best) <= 1e-9) {
            // 并列最优：优先更小位移（平坦图避免落到搜索角 (-s,-s)）
            if (Math.hypot(dx, dy) < Math.hypot(bu, bv)) { bu = dx; bv = dy; }
            // second 保持与 best 同级
            if (second > best) second = best;
          } else if (ssd < second) {
            second = ssd;
          }
        }
      }
      // 反向：从 cur 匹配回 ref，不一致则降权
      let bestB = 1e18, bbu = 0, bbv = 0;
      const cx0 = bx + bu, cy0 = by + bv;
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          const ssd = blockSSD(curG, refG, w, h, cx0, cy0, dx, dy, block);
          if (ssd < bestB - 1e-9) { bestB = ssd; bbu = dx; bbv = dy; }
          else if (Math.abs(ssd - bestB) <= 1e-9 && Math.hypot(dx, dy) < Math.hypot(bbu, bbv)) {
            bbu = dx; bbv = dy;
          }
        }
      }
      const fbErr = Math.hypot(bu + bbu, bv + bbv);
      const mag = Math.hypot(bu, bv);
      let c = Math.max(0, 1 - best / 350);
      // 最佳/次佳比：eps 避免 best=second=0 时 ratio→0 被当成「唯一清晰」
      const eps = 1e-3;
      const ratio = (best + eps) / (second + eps);
      if (ratio > 0.92) c *= 0.25;
      else if (ratio > 0.8) c *= 0.55;
      // 前后向不一致
      if (fbErr > 1.5) c *= 0.4;
      else if (fbErr > 0.5) c *= 0.75;
      // 几乎无位移 → 门控弱
      if (mag < 0.5) c *= 0.35;
      // 贴搜索边界可疑
      if (mag >= search - 0.1) c *= 0.5;
      c = Math.max(0, Math.min(1, c));
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const i = (by + y) * w + (bx + x);
          u[i] = bu; v[i] = bv; conf[i] = c;
        }
      }
    }
  }
  return { u, v, conf };
}

// ── 先验栅格化 ──────────────────────────────────────────────────────────────
export function rasterizePrior(atlasLines, refXY, triangles, size, options = {}) {
  const mapped = mapAtlas(atlasLines, refXY.map((p) => [p[0], p[1], 0]), triangles, options);
  const qAcc = new Float32Array(size * size * 2);
  const wt = new Float32Array(size * size);
  const seeds = [];
  mapped.forEach((ln, id) => {
    if (ln.pts.length < 2) return;
    const pts = ln.pts.map((p) => [p[0], p[1]]);
    seeds.push({ name: ln.name, id, pts: resample(pts, 2) });
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      const th = Math.atan2(dy, dx);
      const qq = angleToQ(th);
      for (const [x, y] of [pts[i], pts[i + 1]]) {
        const ix = Math.round(x), iy = Math.round(y);
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const xx = ix + ox, yy = iy + oy;
            if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
            const j = yy * size + xx;
            qAcc[j * 2] += qq[0]; qAcc[j * 2 + 1] += qq[1]; wt[j] += 1;
          }
        }
      }
    }
  });
  const q0 = new Float32Array(size * size * 2);
  for (let i = 0; i < wt.length; i++) {
    if (wt[i] > 0) {
      const nq = normalizeQ([qAcc[i * 2], qAcc[i * 2 + 1]]);
      q0[i * 2] = nq[0]; q0[i * 2 + 1] = nq[1];
    }
  }
  // 简单扩散
  for (let iter = 0; iter < 6; iter++) {
    const copy = q0.slice();
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (wt[i] > 0) continue;
        let sx = 0, sy = 0, c = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const j = (y + oy) * size + (x + ox);
            if (copy[j * 2] || copy[j * 2 + 1]) {
              sx += copy[j * 2]; sy += copy[j * 2 + 1]; c++;
            }
          }
        }
        if (c) {
          const nq = normalizeQ([sx / c, sy / c]);
          q0[i * 2] = nq[0]; q0[i * 2 + 1] = nq[1];
          wt[i] = 0.1;
        }
      }
    }
  }
  return { q0, seeds };
}

function resample(pts, spacing) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    let x0 = pts[i - 1][0], y0 = pts[i - 1][1];
    const x1 = pts[i][0], y1 = pts[i][1];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg < 1e-6) continue;
    let t = spacing - dist;
    while (t <= seg) {
      const a = t / seg;
      out.push([x0 + a * (x1 - x0), y0 + a * (y1 - y0)]);
      t += spacing;
    }
    dist = (dist + seg) % spacing;
  }
  return out;
}

// ── 融合（先验保持，偏保守以稳住结果）──────────────────────────────────────
export function evaluateQualityGate(quality = {}, thresholds = QUALITY_THRESHOLDS) {
  const reasons = [];
  if ((quality.tracking ?? 0) < thresholds.tracking) reasons.push("tracking");
  if ((quality.illumination ?? 0) < thresholds.illumination) reasons.push("illumination");
  if ((quality.returnConsistency ?? 0) < thresholds.returnConsistency) reasons.push("return_consistency");
  if ((quality.validPeakFrames ?? 0) < thresholds.minPeakFrames) reasons.push("peak_frames");
  return { valid: reasons.length === 0, reasons };
}

export function dynamicConfidenceScore(parts = {}) {
  const value =
    0.25 * (parts.temporalPersistence ?? 0) +
    0.22 * (parts.repetitionConsistency ?? 0) +
    0.18 * (parts.wrinkleVisibility ?? 0) +
    0.15 * (parts.deformationSupport ?? 0) +
    0.08 * (parts.expressionAmplitudeQuality ?? 0) +
    0.12 * (parts.neutralReturnConsistency ?? 0);
  return Math.max(0, Math.min(1, value));
}

/** Action-specific decision for two-cycle directional repeatability. */
export function decideRepeatability(action, score, previousRetries = 0) {
  const threshold = action === "squint" ? 0.50 : 0.60;
  if (score >= threshold) {
    return { accept: true, retry: false, directionValidated: true, threshold, mode: "direction_validated" };
  }
  // Periocular wrinkles are often weak or partially occluded. After one
  // guided retry, finish conservatively without changing their direction.
  if (action === "squint" && previousRetries >= 1) {
    return { accept: true, retry: false, directionValidated: false, threshold, mode: "prior_preserved" };
  }
  return { accept: false, retry: true, directionValidated: false, threshold, mode: "retry" };
}

/**
 * Validate neutral static candidates with repeated expression evidence.
 *
 * Dynamic texture never becomes a final RSTL direction by itself. It may only
 * raise confidence and ridge support where a temporally stable neutral
 * candidate already exists. The final direction remains a soft blend of the
 * anatomical atlas and that neutral candidate.
 */
export function fuseEvidence(q0, qTex, flow, texCoh, texAmp, skin, state, options = {}) {
  const n = skin.length;
  const size = Math.sqrt(n);
  const gate = options.qualityGate || { valid: true, reasons: [] };
  if (!gate.valid) {
    return {
      q: state.fieldQ ? state.fieldQ.slice() : q0.slice(),
      conf: state.fieldC ? state.fieldC.slice() : new Float32Array(n),
      rejected: true,
      reasons: gate.reasons || [],
    };
  }
  const regionWeight = options.regionWeight;
  const deformationSupport = options.deformationSupport;
  const repeatability = Math.max(0, Math.min(1, options.repeatability ?? 0.5));
  const temporalPersistence = Math.max(0, Math.min(1, options.temporalPersistence ?? 0.5));
  const amplitudeQuality = Math.max(0, Math.min(1, options.expressionAmplitudeQuality ?? 0.5));
  const neutralReturnConsistency = Math.max(0, Math.min(1,
    Number.isFinite(options.returnConsistency) ? options.returnConsistency : 0
  ));
  const effectiveSampleCount = Math.max(1, Math.min(12, options.effectiveSampleCount ?? 1));
  const sampleMass = Math.sqrt(effectiveSampleCount);
  const ridge = options.ridge;
  let flowConf = null;
  if (flow && flow.conf) {
    flowConf = flow.conf;
  } else {
    flowConf = flow;
  }

  let ampMed = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (skin[i] && texAmp[i] > 0) { ampMed += texAmp[i]; cnt++; }
  ampMed = (cnt ? ampMed / cnt : 1) + 1e-3;

  const staticQ = state.staticQ || q0;
  const staticConfidence = state.staticConfidence || new Float32Array(n);
  const staticRidge = state.staticRidge || new Float32Array(n);
  if (!state.dynamicValidation || state.dynamicValidation.length !== n) {
    state.dynamicValidation = new Float32Array(n);
  }
  if (!state.dynamicRidge || state.dynamicRidge.length !== n) {
    state.dynamicRidge = new Float32Array(n);
  }

  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue;
    const rw = regionWeight ? (regionWeight[i] || 0) : 1;
    if (rw <= 0) continue;
    const visibility = Math.max(0, Math.min(1,
      0.55 * Math.min(1, texCoh[i] / 0.42) +
      0.45 * Math.min(1, texAmp[i] / ampMed)
    ));
    const trackingSupport = flowConf ? Math.max(0, Math.min(1, flowConf[i] || 0)) : 0.5;
    // Residual block matching is a reliability cue, not an anatomical veto.
    // Repeated texture/deformation evidence must survive low-texture flow areas.
    const trackingReliability = 0.35 + 0.65 * trackingSupport;
    const deform = deformationSupport ? Math.max(0, Math.min(1, deformationSupport[i] || 0)) : 0.5;
    const staticC = Math.max(0, Math.min(1, staticConfidence[i] || 0));
    // Dynamic-only evidence is intentionally non-committing. A faint neutral
    // candidate may be rescued, but an absent neutral candidate cannot create
    // a new line or direction.
    if (staticC < 0.08) continue;
    const perSampleConfidence = rw * trackingReliability * dynamicConfidenceScore({
      temporalPersistence,
      repetitionConsistency: repeatability,
      wrinkleVisibility: visibility,
      deformationSupport: deform,
      expressionAmplitudeQuality: amplitudeQuality,
      neutralReturnConsistency,
    });
    // The UI aggregates several selected frames from two repeated cycles into
    // one field. Preserve their statistical mass instead of counting the merged
    // field as a single observation. sqrt(n) avoids linear overconfidence.
    const cObs = perSampleConfidence * sampleMass;
    if (cObs < 0.14) continue;

    // Dynamic direction is used only as an agreement test.
    const qObs = [qTex[i * 2], qTex[i * 2 + 1]];
    const q0i = [q0[i * 2], q0[i * 2 + 1]];
    const qStatic = [staticQ[i * 2], staticQ[i * 2 + 1]];
    const anchorQ = (qStatic[0] || qStatic[1]) ? qStatic : q0i;
    if (!(anchorQ[0] || anchorQ[1]) || !(qObs[0] || qObs[1])) continue;
    const validationStrength = Math.max(0, Math.min(1,
      0.45 * repeatability + 0.35 * deform + 0.20 * temporalPersistence
    ));
    const angularScale = 18 + 32 * validationStrength;
    const directionAgreement = Math.exp(-0.5 * (axialDiffDeg(qObs, anchorQ) / angularScale) ** 2);
    const anatomicalAgreement = (q0i[0] || q0i[1])
      ? Math.exp(-0.5 * (axialDiffDeg(anchorQ, q0i) / 58) ** 2)
      : 0.65;
    const staticGate = Math.max(0, Math.min(1, (staticC - 0.08) / 0.32));
    const validationMass = cObs * directionAgreement * (0.55 + 0.45 * anatomicalAgreement) * staticGate;
    if (validationMass < 0.06) continue;
    state.dynamicValidation[i] = 1 - (1 - state.dynamicValidation[i]) * Math.exp(-0.42 * validationMass);
    if (ridge) {
      state.dynamicRidge[i] = Math.max(state.dynamicRidge[i],
        Math.max(0, Math.min(1, ridge[i] || 0)) * directionAgreement);
    }
  }

  const qFinal = new Float32Array(n * 2);
  const conf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const staticC = Math.max(0, Math.min(1, staticConfidence[i] || 0));
    const dynamicV = Math.max(0, Math.min(1, state.dynamicValidation[i] || 0));
    const staticBase = 1 - Math.exp(-1.20 * staticC);
    conf[i] = Math.max(0, Math.min(1, staticBase * (0.78 + 0.42 * dynamicV)));
    const qv = normalizeQ([staticQ[i * 2], staticQ[i * 2 + 1]]);
    const q0i = [q0[i * 2], q0[i * 2 + 1]];
    const alpha = Math.max(0, Math.min(0.82,
      conf[i] * (0.28 + 0.72 * staticC) * (0.82 + 0.18 * dynamicV)
    ));
    let raw = normalizeQ([(1 - alpha) * q0i[0] + alpha * qv[0], (1 - alpha) * q0i[1] + alpha * qv[1]]);
    if (conf[i] < 0.22 || !(q0i[0] || q0i[1])) raw = q0i;
    qFinal[i * 2] = raw[0]; qFinal[i * 2 + 1] = raw[1];
  }
  for (let iter = 0; iter < 3; iter++) {
    const sm = qFinal.slice();
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (!skin[i]) continue;
        let sx = 0, sy = 0, c = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const j = (y + oy) * size + (x + ox);
            sx += sm[j * 2]; sy += sm[j * 2 + 1]; c++;
          }
        }
        const nq = normalizeQ([sx / c, sy / c]);
        const q0i = [q0[i * 2], q0[i * 2 + 1]];
        const mix = normalizeQ([0.7 * nq[0] + 0.3 * q0i[0], 0.7 * nq[1] + 0.3 * q0i[1]]);
        qFinal[i * 2] = mix[0]; qFinal[i * 2 + 1] = mix[1];
      }
    }
  }
  state.fieldQ = qFinal;
  state.fieldC = conf;
  state.ridgeField = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const staticC = Math.max(0, Math.min(1, staticConfidence[i] || 0));
    const staticGate = Math.max(0, Math.min(1, (staticC - 0.08) / 0.32));
    const dynamicV = Math.max(0, Math.min(1, state.dynamicValidation[i] || 0));
    state.ridgeField[i] = Math.max(0, Math.min(1,
      (staticRidge[i] || 0) * (0.80 + 0.45 * dynamicV) +
      0.18 * staticGate * dynamicV * (state.dynamicRidge[i] || 0)
    ));
  }
  return {
    q: qFinal,
    conf,
    dynamicValidation: state.dynamicValidation,
    rejected: false,
    reasons: [],
  };
}

/** 选差异最大且不太糊的表情帧，避免 onset/噪声帧污染 */
export function pickBestFrames(neutralGray, frames, skin, k = 3, options = {}) {
  if (!frames?.length || !neutralGray || !skin) return [];
  const scored = [];
  for (let idx = 0; idx < frames.length; idx++) {
    const fr = frames[idx];
    if (!fr?.image?.data || !fr.image.width) continue;
    let g;
    try { g = grayFromImageData(fr.image); }
    catch (_) { continue; }
    if (g.length !== neutralGray.length) continue;
    let acc = 0, n = 0;
    for (let i = 0; i < skin.length; i++) {
      if (!skin[i]) continue;
      const d = g[i] - neutralGray[i];
      acc += d * d; n++;
    }
    const imageDifferenceScore = n ? acc / n : 0;
    const registrationResidualPx = Number(fr.registrationResidualPx);
    scored.push({ fr, idx, score: imageDifferenceScore, imageDifferenceScore,
      registrationResidualPx: Number.isFinite(registrationResidualPx) ? registrationResidualPx : null,
      gray: g });
  }
  if (!scored.length) return [];
  const maxDifference = Math.max(...scored.map((item) => item.imageDifferenceScore), 1);
  const registrationWeight = Math.max(0, Math.min(0.8, Number(options.registrationWeight ?? 0.35)));
  const residualLimit = Math.max(1, Number(options.registrationResidualLimitPx ?? 6));
  for (const item of scored) {
    const differenceQuality = Math.sqrt(Math.max(0, item.imageDifferenceScore) / maxDifference);
    const residualQuality = item.registrationResidualPx == null
      ? 1
      : Math.exp(-item.registrationResidualPx / residualLimit);
    item.selectionScore = (1 - registrationWeight) * differenceQuality +
      registrationWeight * residualQuality;
  }
  scored.sort((a, b) => b.selectionScore - a.selectionScore || b.score - a.score);
  const usable = scored.filter((s) => s.score > 4);
  const pool = usable.length ? usable : scored;
  return pool.slice(0, Math.min(k, pool.length));
}

function resamplePoly(pts, n) {
  if (!pts || pts.length < 2 || n < 2) {
    if (pts?.length === 1 && pts[0]) return Array.from({ length: Math.max(2, n) }, () => [pts[0][0], pts[0][1]]);
    return [];
  }
  const dens = resample(pts, 1.0);
  const src = dens.length >= 2 ? dens : pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const f = t * (src.length - 1);
    const j0 = Math.max(0, Math.min(src.length - 1, Math.floor(f)));
    const j1 = Math.max(0, Math.min(src.length - 1, j0 + 1));
    const a = f - j0;
    const p0 = src[j0], p1 = src[j1];
    if (!p0 || !p1) continue;
    out.push([p0[0] * (1 - a) + p1[0] * a, p0[1] * (1 - a) + p1[1] * a]);
  }
  return out.length >= 2 ? out : pts.map((p) => [p[0], p[1]]);
}

function smoothPolyline(pts, passes = 2) {
  if (!pts || pts.length < 3) return pts || [];
  let cur = pts.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]]);
  if (cur.length < 3) return cur;
  for (let p = 0; p < passes; p++) {
    const nxt = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      nxt.push([
        (cur[i - 1][0] + cur[i][0] * 2 + cur[i + 1][0]) / 4,
        (cur[i - 1][1] + cur[i][1] * 2 + cur[i + 1][1]) / 4,
      ]);
    }
    nxt.push(cur[cur.length - 1]);
    cur = nxt;
  }
  return cur;
}

/**
 * Compact, image-free diagnostics for a scalar evidence field.
 * `weights` may be a binary mask or an action-region weight map.
 */
export function summarizeWeightedField(field, weights = null, thresholds = [0.25, 0.5, 0.75]) {
  if (!field?.length) return { count: 0, mean: 0, min: 0, p50: 0, p90: 0, max: 0, ratios: {} };
  const bins = new Float64Array(101);
  const ratios = Object.fromEntries(thresholds.map((threshold) => [String(threshold), 0]));
  let count = 0, weightSum = 0, sum = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const weight = weights ? Math.max(0, Number(weights[i]) || 0) : 1;
    const value = Number(field[i]);
    if (!(weight > 0) || !Number.isFinite(value)) continue;
    count++;
    weightSum += weight;
    sum += value * weight;
    min = Math.min(min, value);
    max = Math.max(max, value);
    bins[Math.round(Math.max(0, Math.min(1, value)) * 100)] += weight;
    for (const threshold of thresholds) if (value >= threshold) ratios[String(threshold)] += weight;
  }
  if (!(weightSum > 0)) return { count: 0, mean: 0, min: 0, p50: 0, p90: 0, max: 0, ratios: {} };
  const quantile = (target) => {
    let acc = 0;
    for (let i = 0; i < bins.length; i++) {
      acc += bins[i];
      if (acc >= weightSum * target) return i / 100;
    }
    return 1;
  };
  for (const threshold of thresholds) ratios[String(threshold)] /= weightSum;
  return {
    count,
    mean: sum / weightSum,
    min,
    p50: quantile(0.5),
    p90: quantile(0.9),
    max,
    ratios,
  };
}

/** Summarize how far directly-optimized curves moved from their matched priors. */
export function summarizeCurveDisplacements(curves = [], movementEps = 0.05) {
  let pointCount = 0, movedPoints = 0, sum = 0, max = 0;
  const perLine = [];
  for (const curve of curves || []) {
    const prior = curve?.priorPts || curve?.pts || [];
    const final = curve?.pts || [];
    let lineCount = 0, lineMoved = 0, lineSum = 0, lineMax = 0;
    for (let i = 0; i < Math.min(prior.length, final.length); i++) {
      if (!prior[i] || !final[i]) continue;
      const distance = Math.hypot(final[i][0] - prior[i][0], final[i][1] - prior[i][1]);
      if (!Number.isFinite(distance)) continue;
      pointCount++;
      lineCount++;
      sum += distance;
      lineSum += distance;
      max = Math.max(max, distance);
      lineMax = Math.max(lineMax, distance);
      if (distance > movementEps) { movedPoints++; lineMoved++; }
    }
    perLine.push({
      name: curve?.name || null,
      points: lineCount,
      moved_points: lineMoved,
      moved_fraction: lineCount ? lineMoved / lineCount : 0,
      mean_offset_px: lineCount ? lineSum / lineCount : 0,
      max_offset_px: lineMax,
    });
  }
  return {
    lines: curves?.length || 0,
    points: pointCount,
    moved_points: movedPoints,
    moved_fraction: pointCount ? movedPoints / pointCount : 0,
    mean_offset_px: pointCount ? sum / pointCount : 0,
    max_offset_px: max,
    per_line: perLine,
  };
}

// refined 需要的最小证据置信度（低于则本点只是先验回退，不算个体证据）
export const REFINE_CONF = 0.22;

/**
 * 逐点分类：refined（有证据）/ prior（无证据回退）/ occluded（眼口/毛发禁区或非皮肤）。
 * evidenceOk=false 时，本线整体属先验回退，除遮挡点外全部 prior。
 */
function classifyPts(pts, fieldC, skin, forbidden, size, evidenceOk) {
  return pts.map((p) => {
    if (!p) return "prior";
    const ix = Math.max(0, Math.min(size - 1, Math.round(p[0])));
    const iy = Math.max(0, Math.min(size - 1, Math.round(p[1])));
    const idx = iy * size + ix;
    if (!skin[idx] || forbidden[idx]) return "occluded";
    if (evidenceOk && fieldC && fieldC[idx] >= REFINE_CONF) return "refined";
    return "prior";
  });
}

/** 单点混合系数：conf<REFINE_CONF → 0（严格保留先验）；否则 smoothstep(0..1)。 */
export function pointAlpha(conf) {
  if (!(conf >= REFINE_CONF)) return 0;
  const t = Math.min(1, (conf - REFINE_CONF) / (0.72 - REFINE_CONF));
  const smooth = t * t * (3 - 2 * t);
  // Passing the hard evidence gate should remain visible; confidence then
  // controls the remaining amplitude instead of collapsing it near zero.
  return 0.18 + 0.82 * smooth;
}

// ── 曲线个性化：直接沿原曲线法向优化，不重新积分或生成新线 ─
//
// 契约（与项目目标一致）：
//   · 每条初始曲线严格对应一条最终曲线（out.length === seeds.length，name 顺序一致）。
//   · 有可靠证据(conf≥REFINE_CONF 且非遮挡) → 数据项与尺度自适应软先验共同决定法向位移。
//   · 脸宽与邻线距离只定义正则化尺度，不构成位置、方向或曲率的固定硬帽。
//   · 低置信 / 眼口毛发遮挡 / 追踪失败 → alpha=0，该点严格保留原始 atlas 位置。
//   · 132 条曲线始终连续存在；遮挡表示“无个体观测”，不删点、不断线。
//   · kinds 仅作置信度/遮挡元数据（refined/prior/occluded），不决定是否绘制。
export function optimizePriorCurves(fieldQ, fieldC, ridge, q0, seeds, skin, forbidden, size, options = {}) {
  const out = [];
  const allSeedPoints = seeds.flatMap((seed) => seed?.pts || []);
  const xs = allSeedPoints.map((p) => p[0]).filter(Number.isFinite);
  const faceWidth = xs.length ? Math.max(1, Math.max(...xs) - Math.min(...xs)) : size;
  const owner = new Int32Array(size * size);
  owner.fill(-1);
  const sampled = seeds.map((seed) => {
    const src = seed?.pts || [];
    const count = Math.max(12, Math.min(64, src.length || 12));
    return src.length >= 2 ? resamplePoly(src, count) : src.map((p) => [p[0], p[1]]);
  });
  for (let ci = 0; ci < sampled.length; ci++) {
    for (const p of sampled[ci]) {
      const x = Math.max(0, Math.min(size - 1, Math.round(p[0])));
      const y = Math.max(0, Math.min(size - 1, Math.round(p[1])));
      owner[y * size + x] = ci;
    }
  }
  const scalarAt = (arr, x, y) => {
    if (!arr) return 0;
    const ix = Math.max(0, Math.min(size - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(size - 1, Math.round(y)));
    return arr[iy * size + ix] || 0;
  };
  const isBlocked = (p) => {
    const x = Math.max(0, Math.min(size - 1, Math.round(p[0])));
    const y = Math.max(0, Math.min(size - 1, Math.round(p[1])));
    const i = y * size + x;
    return !skin[i] || !!forbidden[i];
  };
  const localSpacingAt = (p, curveIndex) => {
    const cx = Math.round(p[0]), cy = Math.round(p[1]);
    const searchRadius = Math.min(Math.ceil(size / 3), 64);
    for (let r = 2; r <= searchRadius; r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const o = owner[y * size + x];
          if (o >= 0 && o !== curveIndex) return r;
        }
      }
    }
    return Math.max(4, faceWidth * 0.12);
  };
  const anatomicalOffsetBounds = (p, nx, ny) => {
    const scan = (sign) => {
      let last = 0;
      for (let distance = 0.5; distance <= size * Math.SQRT2; distance += 0.5) {
        const x = p[0] + sign * nx * distance;
        const y = p[1] + sign * ny * distance;
        if (x < 0 || y < 0 || x >= size || y >= size || isBlocked([x, y])) break;
        last = distance;
      }
      return last;
    };
    return { min: -scan(-1), max: scan(1) };
  };

  const signedDirectionDelta = (observedQ, priorQ) => {
    let delta = qToAngle(observedQ) - qToAngle(priorQ);
    while (delta > Math.PI / 2) delta -= Math.PI;
    while (delta <= -Math.PI / 2) delta += Math.PI;
    return delta;
  };
  const tangentAt = (pts, index) => {
    const p0 = pts[Math.max(0, index - 1)], p1 = pts[Math.min(pts.length - 1, index + 1)];
    const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    return [(p1[0] - p0[0]) / length, (p1[1] - p0[1]) / length];
  };
  const turnAngle = (pts, index) => {
    if (index <= 0 || index >= pts.length - 1) return 0;
    const a = pts[index - 1], b = pts[index], c = pts[index + 1];
    const ax = b[0] - a[0], ay = b[1] - a[1];
    const bx = c[0] - b[0], by = c[1] - b[1];
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  };

  for (let ci = 0; ci < seeds.length; ci++) {
    const seed = seeds[ci] || {};
    const priorPts = sampled[ci].map((p) => [p[0], p[1]]);
    if (priorPts.length < 2) {
      out.push({
        name: seed.name,
        pts: priorPts,
        priorPts: priorPts.map((p) => [...p]),
        kinds: priorPts.map(() => "prior"),
        audit: priorPts.map(() => ({ kind: "prior", reason: "insufficient_prior_points", final_offset_px: 0 })),
        optimizedOk: false,
        refinedFrac: 0,
        meanEvidence: 0,
        maxDirectionChangeDeg: 0,
        maxCurvatureChangeDeg: 0,
        rollbackReason: null,
      });
      continue;
    }
    const targetOffsets = new Float32Array(priorPts.length);
    const offsets = new Float32Array(priorPts.length);
    const offsetMins = new Float32Array(priorPts.length);
    const offsetMaxs = new Float32Array(priorPts.length);
    const regularizationScales = new Float32Array(priorPts.length);
    const targetSlopes = new Float32Array(priorPts.length);
    const directionProfiles = new Float32Array(priorPts.length);
    const evidenceStrength = new Float32Array(priorPts.length);
    const directSupport = new Uint8Array(priorPts.length);
    const audit = new Array(priorPts.length);
    let confSum = 0, supportedCount = 0;
    for (let i = 0; i < priorPts.length; i++) {
      const p = priorPts[i];
      if (isBlocked(p)) {
        audit[i] = { kind: "occluded", reason: "blocked_or_non_skin", final_offset_px: 0 };
        continue;
      }
      const [tx, ty] = tangentAt(priorPts, i);
      const nx = -ty, ny = tx;
      const bounds = anatomicalOffsetBounds(p, nx, ny);
      offsetMins[i] = bounds.min;
      offsetMaxs[i] = bounds.max;
      const localSpacing = localSpacingAt(p, ci);
      const regularizationScale = Math.max(1.5, faceWidth * 0.01, localSpacing * 0.45);
      regularizationScales[i] = regularizationScale;
      const priorQ = angleToQ(Math.atan2(ty, tx));
      let bestOffset = 0, bestScore = -Infinity, bestConf = 0, bestRidge = 0, bestQ = priorQ;
      let bestStaticConfidence = 0, bestDynamicValidation = 0;
      // Search first, gate second: a real personal crease may sit beside the
      // atlas curve, so confidence at the original point cannot be required.
      for (let d = bounds.min; d <= bounds.max + 1e-6; d += 0.5) {
        const x = p[0] + nx * d, y = p[1] + ny * d;
        if (x < 0 || y < 0 || x >= size || y >= size || isBlocked([x, y])) continue;
        const c = scalarAt(fieldC, x, y);
        if (c < REFINE_CONF) continue;
        const ridgeValue = Math.max(0, scalarAt(ridge, x, y));
        const q = sampleQ(fieldQ || q0, x, y, size);
        const directionDifference = axialDiffDeg(q, priorQ);
        const directionFit = Math.exp(-0.5 * (directionDifference / 55) ** 2);
        const lineSupport = c * (0.45 + 0.55 * ridgeValue);
        const normalizedOffset = Math.abs(d) / regularizationScale;
        const positionCost = normalizedOffset <= 1
          ? 0.5 * normalizedOffset ** 2
          : normalizedOffset - 0.5;
        const priorPenalty = (0.028 + 0.10 * (1 - c)) * positionCost;
        const score = 0.62 * lineSupport + 0.28 * c * directionFit + 0.10 * c - priorPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestOffset = d;
          bestConf = c;
          bestRidge = ridgeValue;
          bestQ = q;
          bestStaticConfidence = scalarAt(options.staticConfidence, x, y);
          bestDynamicValidation = scalarAt(options.dynamicValidation, x, y);
        }
      }
      if (!(bestConf >= REFINE_CONF)) {
        audit[i] = { kind: "prior", reason: "no_validated_local_evidence", final_offset_px: 0 };
        continue;
      }
      const alpha = pointAlpha(bestConf);
      const directionDelta = signedDirectionDelta(bestQ, priorQ);
      targetOffsets[i] = bestOffset * alpha;
      offsets[i] = targetOffsets[i];
      // sin(delta) is a numerically stable local slope request. Its influence is
      // evidence-weighted below; it is not clipped by a fixed angular threshold.
      targetSlopes[i] = Math.sin(directionDelta) * alpha;
      evidenceStrength[i] = Math.max(REFINE_CONF, Math.min(1, bestConf * (0.55 + 0.45 * bestRidge)));
      directSupport[i] = 1;
      confSum += bestConf;
      supportedCount++;
      audit[i] = {
        kind: "supported",
        reason: "three_source_validated_neutral_evidence",
        evidence_confidence: bestConf,
        static_confidence: bestStaticConfidence,
        dynamic_validation: bestDynamicValidation,
        ridge_strength: bestRidge,
        candidate_offset_px: bestOffset,
        local_spacing_px: localSpacing,
        regularization_scale_px: regularizationScale,
        anatomical_offset_range_px: [bounds.min, bounds.max],
        requested_direction_delta_deg: directionDelta * 180 / Math.PI,
        final_offset_px: 0,
      };
    }

    // Taper each supported run into exact-prior neighbours. This confines the
    // update to the evidenced region without creating a kink at its boundary.
    for (let i = 0; i < directSupport.length; i++) {
      if (!directSupport[i]) continue;
      let left = 0, right = 0;
      while (left < 6 && i - left - 1 >= 0 && directSupport[i - left - 1]) left++;
      while (right < 6 && i + right + 1 < directSupport.length && directSupport[i + right + 1]) right++;
      const reachesCurveStart = i - left - 1 < 0;
      const reachesCurveEnd = i + right + 1 >= directSupport.length;
      const boundaryDistance = Math.min(
        reachesCurveStart ? Infinity : left,
        reachesCurveEnd ? Infinity : right
      );
      const taper = Number.isFinite(boundaryDistance)
        ? Math.sin(Math.min(1, (boundaryDistance + 1) / 7) * Math.PI / 2) ** 2
        : 1;
      targetOffsets[i] *= taper;
      offsets[i] *= taper;
      targetSlopes[i] *= taper;
    }

    // Integrate local tangent evidence into a zero-mean normal-offset profile
    // per supported run. This permits a bounded local rotation/asymmetry while
    // keeping the run anchored to the neutral atlas position.
    for (let start = 0; start < directSupport.length;) {
      while (start < directSupport.length && !directSupport[start]) start++;
      if (start >= directSupport.length) break;
      let end = start;
      while (end + 1 < directSupport.length && directSupport[end + 1]) end++;
      directionProfiles[start] = 0;
      for (let i = start + 1; i <= end; i++) {
        const ds = Math.hypot(priorPts[i][0] - priorPts[i - 1][0], priorPts[i][1] - priorPts[i - 1][1]) || 1;
        directionProfiles[i] = directionProfiles[i - 1] + 0.5 * (targetSlopes[i - 1] + targetSlopes[i]) * ds;
      }
      let mean = 0;
      for (let i = start; i <= end; i++) mean += directionProfiles[i];
      mean /= Math.max(1, end - start + 1);
      for (let i = start; i <= end; i++) {
        directionProfiles[i] = Math.max(offsetMins[i], Math.min(offsetMaxs[i], directionProfiles[i] - mean));
      }
      start = end + 1;
    }

    // One-dimensional variational solve. Position targets, tangent-direction
    // targets, smoothness and the atlas prior are combined without free warp.
    for (let pass = 0; pass < 12; pass++) {
      const copy = offsets.slice();
      for (let i = 0; i < offsets.length; i++) {
        if (!directSupport[i]) continue;
        const strength = evidenceStrength[i];
        const dataWeight = 1.2 + 1.8 * strength;
        const smoothWeight = 1.4 + 1.1 * (1 - strength);
        const directionWeight = 0.45 + 1.05 * strength;
        const normalizedOffset = Math.abs(copy[i]) / Math.max(1e-6, regularizationScales[i]);
        const priorWeight = 0.18 + 0.55 * (1 - strength) + 0.12 * Math.max(0, normalizedOffset - 1);
        let smoothTarget = 0, smoothCount = 0;
        if (i > 0) { smoothTarget += copy[i - 1]; smoothCount++; }
        if (i + 1 < copy.length) { smoothTarget += copy[i + 1]; smoothCount++; }
        smoothTarget /= Math.max(1, smoothCount);
        const directionTarget = Math.max(offsetMins[i], Math.min(offsetMaxs[i], targetOffsets[i] + directionProfiles[i]));
        let next = (
          dataWeight * targetOffsets[i] +
          smoothWeight * smoothTarget +
          directionWeight * directionTarget
        ) / (dataWeight + smoothWeight + directionWeight + priorWeight);
        next = Math.max(offsetMins[i], Math.min(offsetMaxs[i], next));
        offsets[i] = next;
      }
    }
    const buildPoints = () => priorPts.map((p, i) => {
      if (!directSupport[i] || Math.abs(offsets[i]) < 0.025) return [p[0], p[1]];
      const [tx, ty] = tangentAt(priorPts, i);
      let offset = offsets[i];
      let candidate = [p[0] - ty * offset, p[1] + tx * offset];
      // Skin/occlusion validity is a hard anatomical constraint. If raster
      // rounding puts a solved point across the boundary, retract only that
      // point along its normal instead of applying an arbitrary global cap.
      while (Math.abs(offset) >= 0.025 && (
        candidate[0] < 0 || candidate[1] < 0 || candidate[0] >= size || candidate[1] >= size || isBlocked(candidate)
      )) {
        offset *= 0.8;
        candidate = [p[0] - ty * offset, p[1] + tx * offset];
      }
      return Math.abs(offset) < 0.025 ? [p[0], p[1]] : candidate;
    });
    const meanConf = confSum / Math.max(1, supportedCount);
    const measureShape = (candidate) => {
      let maxDirectionChange = 0, maxCurvatureChange = 0;
      for (let i = 1; i < candidate.length - 1; i++) {
        const priorTangent = tangentAt(priorPts, i), nextTangent = tangentAt(candidate, i);
        const priorAngle = Math.atan2(priorTangent[1], priorTangent[0]);
        const nextAngle = Math.atan2(nextTangent[1], nextTangent[0]);
        maxDirectionChange = Math.max(maxDirectionChange, axialDiffDeg(angleToQ(priorAngle), angleToQ(nextAngle)));
        let turnDelta = turnAngle(candidate, i) - turnAngle(priorPts, i);
        while (turnDelta > Math.PI) turnDelta -= 2 * Math.PI;
        while (turnDelta < -Math.PI) turnDelta += 2 * Math.PI;
        maxCurvatureChange = Math.max(maxCurvatureChange, Math.abs(turnDelta) * 180 / Math.PI);
      }
      return { maxDirectionChange, maxCurvatureChange };
    };
    const pts = buildPoints();
    const shape = measureShape(pts);
    const kinds = priorPts.map((p, i) => {
      if (isBlocked(p)) return "occluded";
      const movement = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]);
      return directSupport[i] && movement > 0.05 ? "refined" : "prior";
    });
    for (let i = 0; i < audit.length; i++) {
      if (!audit[i]) audit[i] = { kind: kinds[i], reason: "prior_preserved", final_offset_px: 0 };
      const movement = Math.hypot(pts[i][0] - priorPts[i][0], pts[i][1] - priorPts[i][1]);
      audit[i].kind = kinds[i];
      audit[i].final_offset_px = movement;
      if (directSupport[i] && movement <= 0.05) audit[i].reason = "evidence_confirms_prior_or_limited_to_zero";
    }
    const refinedCount = kinds.filter((kind) => kind === "refined").length;
    out.push({
      name: seed.name,
      pts,
      priorPts,
      kinds,
      audit,
      optimizedOk: refinedCount > 0,
      refinedFrac: pts.length ? refinedCount / pts.length : 0,
      meanEvidence: meanConf,
      maxDirectionChangeDeg: shape.maxDirectionChange,
      maxCurvatureChangeDeg: shape.maxCurvatureChange,
      rollbackReason: null,
    });
  }

  // Global safety guard: reject only newly introduced self/cross intersections.
  // Existing atlas junctions are preserved and are not treated as new faults.
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const segmentCrosses = (a, b, c, d) => {
    const minAx = Math.min(a[0], b[0]), maxAx = Math.max(a[0], b[0]);
    const minAy = Math.min(a[1], b[1]), maxAy = Math.max(a[1], b[1]);
    const minCx = Math.min(c[0], d[0]), maxCx = Math.max(c[0], d[0]);
    const minCy = Math.min(c[1], d[1]), maxCy = Math.max(c[1], d[1]);
    if (maxAx < minCx || maxCx < minAx || maxAy < minCy || maxCy < minAy) return false;
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    return o1 * o2 < -1e-6 && o3 * o4 < -1e-6;
  };
  const polylinesCross = (a, b) => {
    const bounds = (pts) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
      }
      return { minX, minY, maxX, maxY };
    };
    const aa = bounds(a), bb = bounds(b);
    if (aa.maxX < bb.minX || bb.maxX < aa.minX || aa.maxY < bb.minY || bb.maxY < aa.minY) return false;
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = 0; j < b.length - 1; j++) {
        if (segmentCrosses(a[i], a[i + 1], b[j], b[j + 1])) return true;
      }
    }
    return false;
  };
  const selfCrosses = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        if (segmentCrosses(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
      }
    }
    return false;
  };
  const rollback = (curve, reason) => {
    curve.pts = curve.priorPts.map((p) => [...p]);
    curve.kinds = curve.kinds.map((kind) => kind === "occluded" ? "occluded" : "prior");
    curve.optimizedOk = false;
    curve.refinedFrac = 0;
    curve.rollbackReason = reason;
    for (const item of curve.audit || []) {
      item.kind = item.kind === "occluded" ? "occluded" : "prior";
      item.final_offset_px = 0;
      item.reason = reason;
    }
  };
  if (options.intersectionGuard !== false) {
    for (const curve of out) {
      if (selfCrosses(curve.pts) && !selfCrosses(curve.priorPts)) rollback(curve, "self_intersection_guard");
    }
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (!polylinesCross(out[i].pts, out[j].pts)) continue;
          if (polylinesCross(out[i].priorPts, out[j].priorPts)) continue;
          const loser = (out[i].meanEvidence || 0) <= (out[j].meanEvidence || 0) ? out[i] : out[j];
          if (!loser.rollbackReason) { rollback(loser, "cross_curve_intersection_guard"); changed = true; }
        }
      }
      if (!changed) break;
    }
  }
  return out;
}

function sampleQ(q, x, y, size) {
  const ix = Math.max(0, Math.min(size - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(size - 1, Math.round(y)));
  const i = iy * size + ix;
  return [q[i * 2], q[i * 2 + 1]];
}
// ── 动作状态机（个人相对基线）──────────────────────────────────────────────
export function actionScore(bs, action) {
  const keys = ACTION_BLEND[action] || [];
  if (!keys.length || !bs) return 0;
  let m = 0;
  for (const k of keys) m = Math.max(m, bs[k] || 0);
  return m;
}

/** 相对个人静息的动作分：max(0, raw - baseline) */
export function relativeScore(bs, action, baseline) {
  const raw = actionScore(bs, action);
  const base = baseline?.[action] ?? 0;
  return Math.max(0, raw - base);
}

/** 从多帧 blendshape 估计个人静息基线 */
export function estimateBaseline(bsList) {
  const out = {};
  if (!bsList?.length) {
    for (const a of ACTION_ORDER) out[a] = 0;
    return out;
  }
  for (const a of ACTION_ORDER) {
    const vals = bsList.map((bs) => actionScore(bs, a)).sort((x, y) => x - y);
    out[a] = vals[vals.length >> 1]; // 中位数
  }
  return out;
}

/**
 * 个人阈值：在静息基线上再抬一点即可。
 * 眉眼间距大的人静息 brow 通道常偏高，绝对阈值会一直嫌「不够」。
 */
export function personalThreshold(action, baseline) {
  const abs = THRESHOLDS[action] ?? 0.18;
  const base = baseline?.[action] ?? 0;
  // 相对增量：约 55% 绝对阈值，且至少 0.06；基线很高时略放宽
  let rel = Math.max(0.06, abs * 0.55);
  if (base > 0.25) rel *= 0.85;
  if (base > 0.4) rel *= 0.8;
  return rel;
}

export function dominantExpression(bs, baseline = null) {
  let best = 0, name = null;
  for (const a of ACTION_ORDER) {
    const s = baseline ? relativeScore(bs, a, baseline) : actionScore(bs, a);
    if (s > best) { best = s; name = a; }
  }
  return { score: best, action: name };
}

export function isNeutral(bs, baseline = null) {
  if (baseline) {
    // 相对个人静息：各通道增量都很小才算中性
    return ACTION_ORDER.every((a) => relativeScore(bs, a, baseline) < personalThreshold(a, baseline) * 0.7);
  }
  return dominantExpression(bs).score < NEUTRAL_MAX;
}

function medianValue(values) {
  if (!values.length) return Infinity;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

/**
 * Residual expression motion after the caller has similarity-aligned the live
 * mesh to the frozen neutral mesh. Camera translation/scale/roll are therefore
 * excluded before the return-to-neutral decision.
 */
export function actionMeshResidual(referenceXY, alignedXY, action) {
  const indices = ACTION_RETURN_LANDMARKS[action] || [];
  if (!referenceXY || !alignedXY || !indices.length) return Infinity;
  const distances = [];
  for (const index of indices) {
    const a = referenceXY[index], b = alignedXY[index];
    if (!a || !b) continue;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (Number.isFinite(d)) distances.push(d);
  }
  return medianValue(distances);
}

/** Neutral jitter-derived threshold in canonical pixels, with safe bounds. */
export function estimateReturnMeshThreshold(samples) {
  const finite = (samples || []).filter(Number.isFinite);
  if (!finite.length) return 2.4;
  const med = medianValue(finite);
  const mad = medianValue(finite.map((value) => Math.abs(value - med)));
  return Math.max(1.4, Math.min(4.5, med + Math.max(0.8, 3.5 * 1.4826 * mad)));
}

/**
 * Robust multi-frame return gate. The performed action must return close to
 * baseline, while a minority of noisy blendshape channels may be ignored.
 */
export function robustReturnNeutral(bsHistory, action, baseline, windowSize = 7) {
  const frames = (bsHistory || []).slice(-windowSize);
  if (frames.length < Math.min(5, windowSize)) {
    return { stable: false, actionRatio: Infinity, globalRatio: Infinity, samples: frames.length };
  }
  const actionRatios = [];
  const globalRatios = [];
  for (const bs of frames) {
    actionRatios.push(relativeScore(bs, action, baseline) / Math.max(0.01, personalThreshold(action, baseline)));
    const ratios = ACTION_ORDER.map((name) =>
      relativeScore(bs, name, baseline) / Math.max(0.01, personalThreshold(name, baseline))
    ).sort((a, b) => a - b);
    // Median channel load tolerates isolated camera-motion spikes.
    globalRatios.push(ratios[ratios.length >> 1]);
  }
  const actionRatio = medianValue(actionRatios);
  const globalRatio = medianValue(globalRatios);
  return {
    // Only the performed action is a hard condition. Other blendshape
    // channels are advisory because camera-relative motion can perturb them.
    stable: actionRatio <= 0.72,
    actionRatio,
    globalRatio,
    samples: frames.length,
  };
}

export function createSessionState(size = SIZE) {
  const n = size * size;
  return {
    size,
    stage: "neutral", // neutral | actions | done
    actionIndex: 0,
    phase: "wait_neutral",
    done: [],
    apexPeak: 0,
    apexT0: null,
    neutralFrames: [],
    neutralGrayFramesHi: [],
    neutralBs: [],
    neutralMeshResiduals: Object.fromEntries(ACTION_ORDER.map((action) => [action, []])),
    returnMeshThresholds: Object.fromEntries(ACTION_ORDER.map((action) => [action, 2.4])),
    baseline: null,
    cycleFrames: [],
    returnFrames: [],
    returnBsHistory: [],
    returnStableMisses: 0,
    actionCycles: {},
    actionValidation: {},
    directionRetries: {},
    attempts: {},
    regionState: createRegionEvidenceState(),
    refXY: null,
    q0: null,
    seeds: [],
    moment: new Float32Array(n * 2),
    weight: new Float32Array(n),
    ridgeMoment: new Float32Array(n),
    ridgeWeight: new Float32Array(n),
    ridgeField: new Float32Array(n),
    staticQ: new Float32Array(n * 2),
    staticConfidence: new Float32Array(n),
    staticRidge: new Float32Array(n),
    dynamicValidation: new Float32Array(n),
    dynamicRidge: new Float32Array(n),
    fieldQ: null,
    fieldC: null,
    curves: [],
    message: "请正脸放松，采集静息基线…",
    skin: null,
    forbidden: null,
    algorithmVersion: "prstl-neutral-template-0.5.0",
    parameterVersion: "expert-review-2026-07-15-r8-three-source-evidence-fusion",
    rejectedCycles: [],
    cycleDiagnostics: [],
    debugEvents: [],
    debugSequence: 0,
    startedAt: new Date().toISOString(),
    recordingEnabled: false,
    recordedClips: [],
    activeRecording: null,
    recordingErrors: [],
  };
}

export function blendDict(categories) {
  const out = {};
  if (!categories) return out;
  for (const c of categories) out[c.categoryName] = c.score;
  return out;
}
