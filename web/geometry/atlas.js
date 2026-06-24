// 2D 图谱映射 + 人脸三角面可见性 + 线集合校验。
// 对应 Python 端 lines/mapping.py 与 rendering/occlusion.py 的忠实移植（纯函数、无 DOM）。
// 拆分自原 web/geometry.js（见 #49）。

// 共享标量/索引来自 constants.py 的生成物（跨语言单一真源，见 #30）。
import {
  DEFAULT_OCCLUSION_THRESHOLD,
  INNER_LIP as INNER_LIP_IDX,
  NOSE_TIP,
  TOPOLOGY_ID,
  TOPOLOGY_VERSION,
} from "../constants_generated.js";

export { NOSE_TIP }; // MediaPipe 鼻尖关键点索引（保留 barrel 导出）

// 关键点（归一化 x,y in [0,1], z）→ 图像像素 (x*W, y*H, z*W)
export function toPixels(landmarks, W, H) {
  const out = new Array(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const l = landmarks[i];
    out[i] = [l.x * W, l.y * H, l.z * W];
  }
  return out;
}

// 图谱 → 图像空间（分片仿射 / 重心插值变形）。与 Python map_atlas 一致。
// lines: [{name, points:[[tri,u,v],...]}], landmarksPx:[[x,y,z]...], triangles:[[i0,i1,i2]...]
export function mapAtlas(lines, landmarksPx, triangles) {
  const result = [];
  if (!Array.isArray(lines)) return result;   // 注入空/坏图谱时不让 for...of 抛错崩掉整帧
  for (const ln of lines) {
    const pts = [];
    const tris = [];
    for (const p of ln.points) {
      const tri = p[0], u = p[1], v = p[2], w = 1 - u - v;
      const t = triangles[tri];
      if (!t) continue;                          // 越界三角面：跳过该点而非崩溃整帧
      const a = landmarksPx[t[0]], b = landmarksPx[t[1]], c = landmarksPx[t[2]];
      if (!a || !b || !c) continue;              // 关键点缺失：跳过该点
      pts.push([
        u * a[0] + v * b[0] + w * c[0],
        u * a[1] + v * b[1] + w * c[1],
        u * a[2] + v * b[2] + w * c[2],
      ]);
      tris.push(tri);
    }
    result.push({ name: ln.name, pts, tris });
  }
  return result;
}

// 注入预览前的最小边界校验：判断一份图谱线集合能否安全喂给 mapAtlas，
// 避免医生画的内存图谱里出现越界三角面 / 非法重心坐标而让渲染循环抛错黑屏。
// 要求：非空数组；每条线 points 为数组；每点 [tri,u,v] 的 tri 为 triangles 内合法整数、u/v 有限。
export function validateAtlasLines(atlasOrLines, triangles, { expectedTopologyId, expectedTopologyVersion } = {}) {
  const atlas = atlasOrLines && typeof atlasOrLines === "object" && !Array.isArray(atlasOrLines)
    ? atlasOrLines
    : null;
  if (expectedTopologyId && atlas && (atlas.topologyId ?? TOPOLOGY_ID) !== expectedTopologyId) {
    return false;
  }
  if (expectedTopologyVersion && atlas && (atlas.topologyVersion ?? TOPOLOGY_VERSION) !== expectedTopologyVersion) {
    return false;
  }
  const lines = atlas ? atlas.lines : atlasOrLines;
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const triCount = Array.isArray(triangles) ? triangles.length : 0;
  for (const ln of lines) {
    if (!ln || !Array.isArray(ln.points)) return false;
    for (const p of ln.points) {
      if (!Array.isArray(p) || p.length < 3) return false;
      const tri = p[0], u = p[1], v = p[2];
      if (!Number.isInteger(tri) || tri < 0 || tri >= triCount) return false;
      if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

// 预计算包含鼻尖的三角面索引
export function noseTriangles(triangles) {
  const out = [];
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    if (t[0] === NOSE_TIP || t[1] === NOSE_TIP || t[2] === NOSE_TIP) out.push(i);
  }
  return out;
}

// 内唇关键点集合（上唇下缘 + 下唇上缘 + 口角）。三个顶点全在此集合内的三角面
// 横跨口裂：闭口时近乎退化、张嘴时拉开横跨口腔空洞，落在其上的图谱点会跳进口内/牙齿。
// 单一事实来源：索引由 constants.py 的 INNER_LIP 生成（见 #30/#38），此处仅包成 Set。
export const INNER_LIP = new Set(INNER_LIP_IDX);

// 预计算「≥2 个顶点属于 INNER_LIP」的口裂三角面索引集合（渲染期据此排除）。
// 按 triangles 数组引用 memoize：拓扑全程不变，故只在首帧计算一次，不必每帧重算。
const _innerMouthCache = new WeakMap();
export function innerMouthTriangles(triangles) {
  let s = _innerMouthCache.get(triangles);
  if (s) return s;
  s = new Set();
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    let n = 0;
    if (INNER_LIP.has(t[0])) n++;
    if (INNER_LIP.has(t[1])) n++;
    if (INNER_LIP.has(t[2])) n++;
    if (n >= 2) s.add(i);
  }
  _innerMouthCache.set(triangles, s);
  return s;
}

// 背面剔除：返回 Uint8Array(每个三角面是否朝向相机)。移植自 Python rendering/occlusion.py BackfaceCuller。
// threshold 默认值来自 constants.py 的 DEFAULT_OCCLUSION_THRESHOLD（生成，见 #30）。
export function visibleTriangles(landmarksPx, triangles, noseTris, threshold = DEFAULT_OCCLUSION_THRESHOLD) {
  const M = triangles.length;
  const nz = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const t = triangles[i];
    const a = landmarksPx[t[0]], b = landmarksPx[t[1]], c = landmarksPx[t[2]];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    nz[i] = e1x * e2y - e1y * e2x; // cross(e1,e2).z
  }
  let ref = 0;
  if (noseTris.length) {
    for (const i of noseTris) ref += nz[i];
    ref /= noseTris.length;
  }
  const sign = ref >= 0 ? 1 : -1;
  const vis = new Uint8Array(M);
  for (let i = 0; i < M; i++) vis[i] = sign * nz[i] >= threshold ? 1 : 0;
  return vis;
}

// 把折线按可见性切成连续可见子段（与 Python _visible_runs 一致）
export function visibleRuns(pts, visMask) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (visMask[i] && isFinite(p[0]) && isFinite(p[1])) {
      cur.push(p);
    } else {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
