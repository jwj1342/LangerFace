// 网页 3D 标注的纯数据模型（无 Three.js / DOM 依赖，可 node 单测）。
// 在 3D 头模/标准脸上画 RSTL/Langer 候选线，导出项目图谱草案（重心坐标）
// 或通用 3D 折线（xyz）。网页导出的图谱保持 validated:false，临床复核另走评审流程。

// 3D 点 p 在三角形 (a,b,c) 中的重心坐标 [u,v,w]，满足 p ≈ u·a + v·b + w·c。
// 约定与 langerface 的图谱一致：点存为 [tri, u, v]，w = 1 - u - v。
import { ATLAS_VERSION, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.js";

export function barycentric(p, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01 || 1e-12;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function vertexPoint(surface, vi, exportable) {
  const ref = surface.vertexRefs[vi];
  return {
    xyz: surface.verts[vi].slice(),
    tri: ref?.tri ?? null,
    bary: ref?.bary ?? null,
    exportable,
  };
}

function buildSurface(verts, tris) {
  const adj = Array.from({ length: verts.length }, () => new Map());
  const vertexRefs = Array.from({ length: verts.length }, () => null);
  const addEdge = (a, b) => {
    const w = dist3(verts[a], verts[b]);
    const prev = adj[a].get(b);
    if (prev == null || w < prev) { adj[a].set(b, w); adj[b].set(a, w); }
  };
  tris.forEach((t, tri) => {
    for (let i = 0; i < 3; i++) {
      const vi = t[i];
      if (!vertexRefs[vi]) {
        const bary = [0, 0, 0];
        bary[i] = 1;
        vertexRefs[vi] = { tri, bary };
      }
    }
    addEdge(t[0], t[1]);
    addEdge(t[1], t[2]);
    addEdge(t[2], t[0]);
  });
  return { verts, tris, adj, vertexRefs };
}

// 返回 { points, fallback }：points 为 a→b 的折线；fallback=true 表示无法沿网格
// 表面路由，已退回空间直线 [a, b]（缺拓扑、三角退化，或两点位于不同连通分量），
// 由调用方上抛，UI 可据此提示「可能穿面」，避免静默穿脸。
function nearestSurfacePath(surface, a, b) {
  if (!surface || a.tri == null || b.tri == null || !Array.isArray(a.bary) || !Array.isArray(b.bary)) {
    return { points: [a, b], fallback: true };
  }
  if (a.tri === b.tri) return { points: [a, b], fallback: false };

  const startVerts = surface.tris[a.tri] || [];
  const endVerts = surface.tris[b.tri] || [];
  if (startVerts.length !== 3 || endVerts.length !== 3) return { points: [a, b], fallback: true };

  const n = surface.verts.length;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const prev = new Int32Array(n);
  prev.fill(-1);
  const visited = new Uint8Array(n);
  const heap = [];
  const push = (node, score) => {
    heap.push([node, score]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][1] <= score) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    if (!heap.length) return null;
    const root = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let best = i;
        const l = 2 * i + 1, r = l + 1;
        if (l < heap.length && heap[l][1] < heap[best][1]) best = l;
        if (r < heap.length && heap[r][1] < heap[best][1]) best = r;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return root;
  };

  for (const vi of startVerts) {
    const d = dist3(a.xyz, surface.verts[vi]);
    if (d < dist[vi]) { dist[vi] = d; push(vi, d); }
  }

  const endSet = new Set(endVerts);
  let bestEnd = -1;
  let bestTotal = Infinity;
  while (heap.length) {
    const item = pop();
    if (!item) break;
    const [u, du] = item;
    if (visited[u] || du !== dist[u]) continue;
    visited[u] = 1;
    if (endSet.has(u)) {
      const total = du + dist3(surface.verts[u], b.xyz);
      if (total < bestTotal) { bestTotal = total; bestEnd = u; }
    }
    if (du > bestTotal) break;
    for (const [v, w] of surface.adj[u]) {
      const nd = du + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        push(v, nd);
      }
    }
  }
  if (bestEnd < 0) return { points: [a, b], fallback: true };

  const vertexPath = [];
  for (let u = bestEnd; u >= 0; u = prev[u]) vertexPath.push(u);
  vertexPath.reverse();

  const exportable = a.exportable !== false && b.exportable !== false;
  const out = [a];
  for (const vi of vertexPath) {
    const vp = vertexPoint(surface, vi, exportable);
    if (dist3(out[out.length - 1].xyz, vp.xyz) > 1e-9 && dist3(vp.xyz, b.xyz) > 1e-9) out.push(vp);
  }
  if (dist3(out[out.length - 1].xyz, b.xyz) > 1e-9) out.push(b);
  return { points: out, fallback: false };
}

function controlsOf(line) {
  return line.controls || line.points;
}

// 一个标注点：xyz=世界坐标；tri/bary 仅在标注于已知三角拓扑（如标准脸）时存在。
//   { xyz:[x,y,z], tri:int|null, bary:[u,v,w]|null }
export class AnnotationModel {
  constructor(system = "rstl", { topologyId = TOPOLOGY_ID, topologyVersion = TOPOLOGY_VERSION } = {}) {
    this.system = system;
    this.topologyId = topologyId;
    this.topologyVersion = topologyVersion;
    this.lines = [];      // 已完成的线：{ name, region, points:[pt,...] }
    this.current = null;  // 正在画的线
    this.surface = null;  // 可选：用于把控制点之间展开成网格表面路径
  }

  setTopology({ topologyId = TOPOLOGY_ID, topologyVersion = TOPOLOGY_VERSION } = {}) {
    this.topologyId = topologyId;
    this.topologyVersion = topologyVersion;
  }

  setSurface(verts, tris) {
    this.surface = buildSurface(verts, tris);
    for (const line of this.lines) this._rebuildLinePoints(line);
    if (this.current) this._rebuildLinePoints(this.current);
  }

  startLine({ name, region } = {}) {
    this.current = { name: name || `line_${this.lines.length + 1}`, region: region || "", points: [], controls: [], fallback: false };
  }

  // 返回 { fallback }：fallback=true 表示这一段无法沿表面路由、已退回直线（可能穿面），
  // 由 UI 据此提示医生。
  addPoint(pt) {
    if (!this.current) this.startLine();
    this.current.controls.push(pt);
    if (this.current.controls.length === 1) {
      this.current.points = [pt];
      this.current.fallback = false;
      return { fallback: false };
    }
    const controls = this.current.controls;
    const { points, fallback } = nearestSurfacePath(this.surface, controls[controls.length - 2], pt);
    this.current.points.push(...points.slice(1));
    this.current.fallback = this.current.fallback || fallback;
    return { fallback };
  }

  addLine({ name, region, points, controls }) {
    const lineControls = Array.isArray(controls) ? controls : points;
    if (!Array.isArray(lineControls) || lineControls.length < 2) return null;
    const line = {
      name: name || `line_${this.lines.length + 1}`,
      region: region || "",
      controls: lineControls,
      points: [],
    };
    this._rebuildLinePoints(line);
    this.lines.push(line);
    return line;
  }

  undoPoint() {
    if (!this.current) return;
    if (this.current.controls) {
      this.current.controls.pop();
      this._rebuildLinePoints(this.current);
    } else if (this.current.points.length) {
      this.current.points.pop();
    }
  }

  finishLine() {
    if (this.current && controlsOf(this.current).length >= 2) this.lines.push(this.current);
    const done = this.current;
    this.current = null;
    return done;
  }

  cancelLine() { this.current = null; }

  deleteLine(i) { if (i >= 0 && i < this.lines.length) this.lines.splice(i, 1); }

  clear() { this.lines = []; this.current = null; }

  // 每条已完成线的每个点是否都带三角拓扑（决定能否导出图谱格式）
  hasBarycentric() {
    return this.lines.length > 0 && this.lines.every(
      (l) => l.points.every((p) => p.exportable !== false && p.tri != null && Array.isArray(p.bary)),
    );
  }

  // 导出为 langerface 图谱格式（点 = [tri, u, v]）。需所有点带重心坐标。
  toAtlasJSON({
    version = ATLAS_VERSION,
    provenance = "web-annotator",
    topologyId = this.topologyId,
    topologyVersion = this.topologyVersion,
  } = {}) {
    if (!this.hasBarycentric()) {
      throw new Error("存在不含三角拓扑的点，无法导出图谱格式（请在标准脸网格上标注）");
    }
    return {
      system: this.system,
      version,
      topologyId,
      topologyVersion,
      provenance,
      validated: false,
      lines: this.lines.map((l) => ({
        name: l.name,
        region: l.region,
        points: l.points.map((p) => [p.tri, round6(p.bary[0]), round6(p.bary[1])]),
      })),
    };
  }

  // 导出为通用 3D 折线（xyz），用于任意头模（与 headspace 管线的 *_xyz 兼容）。
  toXyzJSON() {
    return {
      system: this.system,
      lines: this.lines.map((l) => ({
        name: l.name,
        region: l.region,
        points: l.points.map((p) => [round6(p.xyz[0]), round6(p.xyz[1]), round6(p.xyz[2])]),
      })),
    };
  }

  // 返回 { fallback }：fallback=true 表示重建出的某段已退回直线（可能穿面）。
  _rebuildLinePoints(line) {
    const controls = controlsOf(line);
    line.controls = controls;
    line.points = [];
    let fallback = false;
    for (let i = 0; i < controls.length; i++) {
      const pt = controls[i];
      if (!line.points.length) {
        line.points.push(pt);
      } else {
        const path = nearestSurfacePath(this.surface, controls[i - 1], pt);
        line.points.push(...path.points.slice(1));
        if (path.fallback) fallback = true;
      }
    }
    line.fallback = fallback;
    return { fallback };
  }
}
