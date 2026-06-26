// 3D Beta：用 Three.js 渲染重建出的 3D 人头，并把张力线贴到其表面。
// 既支持「可旋转查看」模式，也支持「投影到实时画面」（深度缓冲精确自遮挡）模式。
import * as THREE from "three";
import { addSkinLighting, configureSkinRenderer, createSkinMaterial } from "./skin_material.js";

const BAND = { top: [0.94, 0.76, 0.29], mid: [0.34, 0.74, 0.95], low: [0.25, 0.83, 0.62] };
const INCISION_COLORS = {
  tumor: 0xfacc15,
  linear: 0x22c55e,
  fusiform: 0x5eead4,
};

// 每顶点法向（用于把线条沿法向轻微抬离表面，避免与网格 z-fighting）
function vertexNormals(verts, tris) {
  const N = verts.map(() => [0, 0, 0]);
  for (const [a, b, c] of tris) {
    const va = verts[a], vb = verts[b], vc = verts[c];
    const e1 = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]];
    const e2 = [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const i of [a, b, c]) { N[i][0] += cx; N[i][1] += cy; N[i][2] += cz; }
  }
  for (const v of N) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; }
  return N;
}

function bbox(verts) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return { lo, hi, size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}

// 由图谱(重心坐标) + 顶点 生成 3D 线段几何（按高度分色，沿法向抬离）
function buildLineGeometry(atlasLines, verts, tris, normals, bands) {
  const bb = bbox(verts);
  const eps = bb.size * 0.004;
  const pos = [], col = [];
  for (const ln of atlasLines) {
    const pts3 = Array.isArray(ln.points3d)
      ? ln.points3d
      : ln.points.map((p) => {
        const [ti, u, v] = p, w = 1 - u - v, t = tris[ti];
        const A = verts[t[0]], B = verts[t[1]], C = verts[t[2]];
        const nA = normals[t[0]], nB = normals[t[1]], nC = normals[t[2]];
        const nx = u * nA[0] + v * nB[0] + w * nC[0];
        const ny = u * nA[1] + v * nB[1] + w * nC[1];
        const nz = u * nA[2] + v * nB[2] + w * nC[2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        return [
          u * A[0] + v * B[0] + w * C[0] + (nx / nl) * eps,
          u * A[1] + v * B[1] + w * C[1] + (ny / nl) * eps,
          u * A[2] + v * B[2] + w * C[2] + (nz / nl) * eps,
        ];
      });
    let my = 0; for (const q of pts3) my += q[1]; my = (my / pts3.length - bb.lo[1]) / ((bb.hi[1] - bb.lo[1]) || 1);
    const c = bands ? (my > 0.64 ? BAND.top : my > 0.34 ? BAND.mid : BAND.low) : [0.78, 0.15, 1.0];
    for (let i = 0; i + 1 < pts3.length; i++) {       // 相邻点成段
      pos.push(...pts3[i], ...pts3[i + 1]);
      col.push(...c, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function disposeObject(obj) {
  obj.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
    else child.material?.dispose?.();
  });
}

function mapSurfaceRef3d(ref, verts, tris, normals, eps) {
  const tri = tris?.[ref?.tri];
  if (!tri || tri.length < 3) return null;
  const A = verts[tri[0]], B = verts[tri[1]], C = verts[tri[2]];
  const nA = normals[tri[0]], nB = normals[tri[1]], nC = normals[tri[2]];
  if (!A || !B || !C || !nA || !nB || !nC) return null;
  const u = Number(ref.u), v = Number(ref.v), w = Number(ref.w ?? (1 - u - v));
  if (![u, v, w].every(Number.isFinite)) return null;
  const nx = u * nA[0] + v * nB[0] + w * nC[0];
  const ny = u * nA[1] + v * nB[1] + w * nC[1];
  const nz = u * nA[2] + v * nB[2] + w * nC[2];
  const nl = Math.hypot(nx, ny, nz) || 1;
  return [
    u * A[0] + v * B[0] + w * C[0] + (nx / nl) * eps,
    u * A[1] + v * B[1] + w * C[1] + (ny / nl) * eps,
    u * A[2] + v * B[2] + w * C[2] + (nz / nl) * eps,
  ];
}

function buildOverlayLine(points, color, closed = false) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const pts = closed ? [...points, points[0]] : points;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.98,
    toneMapped: false,
  });
  const obj = new THREE.Line(g, mat);
  obj.renderOrder = 5;
  return obj;
}

export class Head3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    configureSkinRenderer(this.renderer);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111820);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    addSkinLighting(this.scene);
    this.grid = new THREE.GridHelper(2, 12, 0x334155, 0x243041);
    this.grid.position.y = -0.72;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.38;
    this.scene.add(this.grid);
    this.mesh = null; this.lines = null; this.incisionOverlay = null;
    this.rotX = 0; this.rotY = 0; this._dist = 3;
    this._minDist = 0.8; this._maxDist = 8;
  }

  setGeometry(verts, tris, atlasLines, { showSurface = true, bands = true, vertexColors = null } = {}) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.lines) { this.group.remove(this.lines); this.lines.geometry.dispose(); this.lines = null; }
    this.clearIncisionOverlay();
    const normals = vertexNormals(verts, tris);
    const bb = bbox(verts);
    const center = [(bb.lo[0] + bb.hi[0]) / 2, (bb.lo[1] + bb.hi[1]) / 2, (bb.lo[2] + bb.hi[2]) / 2];
    this.group.position.set(-center[0], -center[1], -center[2]);

    // 头部网格
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    mg.setIndex(tris.flat());
    const hasVertexColors = Array.isArray(vertexColors) && vertexColors.length === verts.length;
    if (hasVertexColors) mg.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors.flat(), 3));
    mg.computeVertexNormals();
    const mat = createSkinMaterial(verts, {
      showSurface,
      vertexColors: hasVertexColors,
    });
    this.mesh = new THREE.Mesh(mg, mat);
    this.group.add(this.mesh);

    // 张力线
    const lg = buildLineGeometry(atlasLines, verts, tris, normals, bands);
    // toneMapped:false：张力线为编码临床语义的纯色，不参与 ACES 色调映射，避免分区色被偏移/去饱和。
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.lines.renderOrder = 2;
    this.group.add(this.lines);

    this._dist = bb.size * 1.6;
    this._minDist = Math.max(0.35, bb.size * 0.8);
    this._maxDist = Math.max(this._minDist * 1.5, bb.size * 3.5);
    this.grid.scale.setScalar(Math.max(0.7, bb.size * 0.75));
    this.grid.position.y = -Math.max(0.45, bb.size * 0.38);
  }

  clearIncisionOverlay() {
    if (!this.incisionOverlay) return;
    this.group.remove(this.incisionOverlay);
    disposeObject(this.incisionOverlay);
    this.incisionOverlay = null;
  }

  setIncisionOverlay(overlay, verts, tris) {
    if (!overlay) {
      this.clearIncisionOverlay();
      return { rendered: false, reason: "missing_overlay" };
    }
    const normals = vertexNormals(verts, tris);
    const bb = bbox(verts);
    const eps = bb.size * 0.008;
    const mapRefs = (refs) => (refs || []).map((ref) => mapSurfaceRef3d(ref, verts, tris, normals, eps)).filter(Boolean);
    return this.setIncisionOverlayPoints({
      schema_version: "incision-overlay-3d-points/v0.1",
      candidate_type: overlay.candidate_type,
      tumor_center_point: mapRefs([overlay.tumor?.center_ref])[0] || null,
      tumor_boundary_points: mapRefs(overlay.tumor?.boundary_refs || []),
      candidate_points: mapRefs(overlay.candidate?.polyline_refs || []),
    });
  }

  setIncisionOverlayPoints(overlay3d) {
    this.clearIncisionOverlay();
    const group = new THREE.Group();
    const boundary = overlay3d?.tumor_boundary_points || [];
    const candidate = overlay3d?.candidate_points || [];
    const center = overlay3d?.tumor_center_point || null;
    const boundaryLine = buildOverlayLine(boundary, INCISION_COLORS.tumor, boundary.length > 2);
    if (boundaryLine) group.add(boundaryLine);
    const candidateLine = buildOverlayLine(
      candidate,
      overlay3d?.candidate_type === "linear" ? INCISION_COLORS.linear : INCISION_COLORS.fusiform,
      false,
    );
    if (candidateLine) group.add(candidateLine);
    if (Array.isArray(center) && center.length >= 3) {
      const radius = Math.max(0.005, (this._maxDist || 1) * 0.006);
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 8),
        new THREE.MeshBasicMaterial({ color: INCISION_COLORS.tumor, toneMapped: false }),
      );
      sphere.position.set(center[0], center[1], center[2]);
      sphere.renderOrder = 6;
      group.add(sphere);
    }
    if (!group.children.length) {
      disposeObject(group);
      return {
        schema_version: "incision-overlay-3d-view/v0.1",
        rendered: false,
        reason: "no_renderable_overlay_points",
        candidate_point_count: candidate.length,
        boundary_point_count: boundary.length,
        tumor_center_rendered: Boolean(center),
      };
    }
    this.incisionOverlay = group;
    this.group.add(group);
    return {
      schema_version: "incision-overlay-3d-view/v0.1",
      rendered: true,
      reason: "incision_overlay_rendered_on_3d_head",
      candidate_point_count: candidate.length,
      boundary_point_count: boundary.length,
      tumor_center_rendered: Boolean(center),
      clinical_boundary: "3D incision overlay is an engineering visualization, not clinical AR registration.",
    };
  }

  // 原地更新顶点（+ 可选每顶点色）——供实时孪生每帧刷新表情 / 张嘴 / 贴脸纹理，不重建网格。
  updateVerts(verts, colors = null) {
    if (!this.mesh) return;
    const geo = this.mesh.geometry, pos = geo.attributes.position, arr = pos.array;
    const n = Math.min(verts.length, arr.length / 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = verts[i][0]; arr[i * 3 + 1] = verts[i][1]; arr[i * 3 + 2] = verts[i][2]; }
    pos.needsUpdate = true;
    if (colors && geo.attributes.color) {
      const carr = geo.attributes.color.array;
      for (let i = 0; i < n; i++) { carr[i * 3] = colors[i][0]; carr[i * 3 + 1] = colors[i][1]; carr[i * 3 + 2] = colors[i][2]; }
      geo.attributes.color.needsUpdate = true;
    }
    geo.computeVertexNormals();
  }

  setRotation(rx, ry) { this.rotX = rx; this.rotY = ry; }

  zoom(factor) {
    this._dist = Math.max(this._minDist, Math.min(this._maxDist, this._dist * factor));
  }

  resetView() {
    this.rotX = 0; this.rotY = 0;
    this._dist = Math.max(this._minDist, Math.min(this._maxDist, this._maxDist / 2.2));
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  render() {
    this.group.rotation.x = this.rotX;
    this.group.rotation.y = this.rotY;
    this.camera.position.set(0, 0, this._dist);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.clearIncisionOverlay(); this.renderer.dispose(); }
}

export { vertexNormals, buildLineGeometry };
