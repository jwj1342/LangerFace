// 外物遮挡（手/器械）：凸包掩膜。纯函数、无 DOM。拆分自原 web/geometry.js（见 #49）。
// 在前方的手/器械会被 MediaPipe 当作"看不见的脸"继续预测关键点，导致线画到手上。
// 对策：用遮挡物的关键点求凸包，落在凸包内的脸部线点一律剔除。

// Andrew 单调链求凸包，返回逆时针顶点 [[x,y],...]
export function convexHull(pts) {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// 沿质心方向把凸包向外扩张 margin 像素（覆盖手边缘/模糊/运动）
export function expandHull(hull, margin) {
  if (hull.length < 3 || margin <= 0) return hull;
  let cx = 0, cy = 0;
  for (const v of hull) { cx += v[0]; cy += v[1]; }
  cx /= hull.length; cy /= hull.length;
  return hull.map((v) => {
    const dx = v[0] - cx, dy = v[1] - cy, d = Math.hypot(dx, dy) || 1;
    return [v[0] + margin * dx / d, v[1] + margin * dy / d];
  });
}

// 点是否在逆时针凸包内（含边界）
export function pointInConvex(p, hull) {
  const n = hull.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
}

export function pointInHulls(p, hulls) {
  for (const h of hulls) if (pointInConvex(p, h)) return true;
  return false;
}

// 点到线段距离
function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
const _d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// MediaPipe 手部拓扑：手掌点 + 各指骨段
const PALM_IDX = [0, 1, 2, 5, 9, 13, 17];
const HAND_BONES = [
  [1, 2], [2, 3], [3, 4],          // 拇指
  [5, 6], [6, 7], [7, 8],          // 食指
  [9, 10], [10, 11], [11, 12],     // 中指
  [13, 14], [14, 15], [15, 16],    // 无名指
  [17, 18], [18, 19], [19, 20],    // 小指
  [0, 1], [0, 5], [0, 17],         // 掌根连接
];

// 用 21 个手部关键点构造**贴合手形**的掩膜（手掌凸包 + 各手指胶囊），
// 而非整只手的大凸包——这样张开的手指之间的缝隙不会被遮挡。
export function buildHandMasks(hands_px, scaleR = 0.16, margin = 4) {
  const masks = [];
  for (const h of hands_px) {
    if (!h || h.length < 21) continue;
    const palm = expandHull(convexHull(PALM_IDX.map((i) => h[i])), margin);
    const r = _d(h[5], h[17]) * scaleR + margin;   // 单指半径 ≈ 掌宽的一定比例
    const bones = HAND_BONES.map(([a, b]) => [h[a][0], h[a][1], h[b][0], h[b][1]]);
    masks.push({ palm, bones, r });
  }
  return masks;
}

// 点是否被任一手掩膜覆盖（手掌内 或 距某根指骨 < 半径）
export function pointInHandMasks(p, masks) {
  for (const m of masks) {
    if (pointInConvex(p, m.palm)) return true;
    for (const s of m.bones) if (distPointSeg(p[0], p[1], s[0], s[1], s[2], s[3]) <= m.r) return true;
  }
  return false;
}

// 把若干遮挡物的关键点列表转成扩张后的凸包列表
export function buildOccluderHulls(occluders_px, margin) {
  const hulls = [];
  for (const pts of occluders_px) {
    if (pts && pts.length >= 3) hulls.push(expandHull(convexHull(pts), margin));
  }
  return hulls;
}
