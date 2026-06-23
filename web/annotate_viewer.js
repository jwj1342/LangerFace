// 3D 标注视图：加载头模/标准脸网格，射线拾取表面点，渲染已画的线与控制点。
// 复用项目的 three 依赖；拾取结果在网格「局部坐标系」中给出（与旋转无关）。
import * as THREE from "three";
import { barycentric } from "./annotate_model.js";
import { addSkinLighting, configureSkinRenderer, createSkinMaterial } from "./skin_material.js";

const FINISHED_COLOR = [0.78, 0.15, 1.0];   // 已完成线（品红）
const CURRENT_COLOR = [1.0, 0.78, 0.2];     // 正在画的线（琥珀）

function normalizedColors(colors, count) {
  if (!Array.isArray(colors) || colors.length !== count) return null;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const out = [];
  for (const c of colors) {
    if (!Array.isArray(c) || c.length < 3) return null;
    const scale = Math.max(c[0], c[1], c[2]) > 1 ? 255 : 1;
    out.push([clamp(c[0] / scale), clamp(c[1] / scale), clamp(c[2] / scale)]);
  }
  return out;
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dist2 = (a, b) => {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

function closestPointOnTriangle(p, a, b, c) {
  const ab = sub3(b, a), ac = sub3(c, a), ap = sub3(p, a);
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = sub3(p, b);
  const d3 = dot3(ab, bp), d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add3(a, scale3(ab, d1 / (d1 - d3)));

  const cp = sub3(p, c);
  const d5 = dot3(ab, cp), d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add3(a, scale3(ac, d2 / (d2 - d6)));

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    return add3(b, scale3(sub3(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return add3(a, add3(scale3(ab, v), scale3(ac, w)));
}

export class Annotator3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    configureSkinRenderer(this.renderer);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1016);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    addSkinLighting(this.scene);

    this.verts = null;
    this.tris = null;
    this.mesh = null;
    this._vertexFaces = null;
    this.linesObj = null;
    this.markersObj = null;
    this.model = null;
    this.rotX = 0;
    this.rotY = 0;
    this._dist = 3;
    this._minDist = 0.2;
    this._maxDist = 50;
  }

  setMesh(verts, tris, { showSurface = true, colors = null } = {}) {
    this.verts = verts;
    this.tris = tris;
    this._vertexFaces = Array.from({ length: verts.length }, () => []);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      this._vertexFaces[t[0]]?.push(i);
      this._vertexFaces[t[1]]?.push(i);
      this._vertexFaces[t[2]]?.push(i);
    }
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }

    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    this._center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    this.group.position.set(-this._center[0], -this._center[1], -this._center[2]);
    const diag = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    this._dist = diag * 1.6;
    this._minDist = diag * 0.35;
    this._maxDist = diag * 8;
    this.camera.near = Math.max(0.001, diag / 5000);
    this.camera.far = Math.max(100, diag * 12);
    this.camera.updateProjectionMatrix();

    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    mg.setIndex(tris.flat());
    const vertexColors = normalizedColors(colors, verts.length);
    if (vertexColors) mg.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors.flat(), 3));
    mg.computeVertexNormals();
    const mat = createSkinMaterial(verts, {
      showSurface,
      vertexColors: Boolean(vertexColors),
      fallbackColor: showSurface ? 0xd6aa8f : 0x9aa6b2,
    });
    this.mesh = new THREE.Mesh(mg, mat);
    this.group.add(this.mesh);
    this.model?.setSurface?.(verts, tris);
    this.rebuildLines();
  }

  setAnnotation(model) {
    this.model = model;
    if (this.verts && this.tris) this.model?.setSurface?.(this.verts, this.tris);
    this.rebuildLines();
  }

  hasMesh() { return !!(this.mesh && this.verts && this.tris); }

  // NDC (x,y ∈ [-1,1]) → { xyz(局部), tri, bary } | null
  raycast(ndcX, ndcY) {
    if (!this.mesh) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = ray.intersectObject(this.mesh, false);
    if (!hits.length) return null;
    const it = hits[0];
    const local = this.mesh.worldToLocal(it.point.clone());
    const lp = [local.x, local.y, local.z];
    const tri = it.faceIndex;
    const t = this.tris[tri];
    const bary = barycentric(lp, this.verts[t[0]], this.verts[t[1]], this.verts[t[2]]);
    return { xyz: lp, tri, bary };
  }

  snapToSurface(xyz) {
    if (!this.hasMesh()) return null;
    let bestVertex = 0, bestVertexD2 = Infinity;
    for (let i = 0; i < this.verts.length; i++) {
      const d = dist2(xyz, this.verts[i]);
      if (d < bestVertexD2) { bestVertexD2 = d; bestVertex = i; }
    }

    const candidates = this._vertexFaces?.[bestVertex] || [];
    let best = null;
    for (const tri of candidates) {
      const t = this.tris[tri];
      const cp = closestPointOnTriangle(xyz, this.verts[t[0]], this.verts[t[1]], this.verts[t[2]]);
      const d = dist2(xyz, cp);
      if (!best || d < best.d) best = { xyz: cp, tri, d };
    }
    if (!best) return { xyz: this.verts[bestVertex], tri: null, bary: null };

    const t = this.tris[best.tri];
    return {
      xyz: best.xyz,
      tri: best.tri,
      bary: barycentric(best.xyz, this.verts[t[0]], this.verts[t[1]], this.verts[t[2]]),
    };
  }

  rebuildLines() {
    for (const key of ["linesObj", "markersObj"]) {
      if (this[key]) { this.group.remove(this[key]); this[key].geometry.dispose(); this[key] = null; }
    }
    if (!this.model) return;

    const segPos = [], segCol = [], mkPos = [], mkCol = [];
    const addLine = (line, color) => {
      const pts = line.points || [];
      const controls = line.controls || pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        segPos.push(...pts[i].xyz, ...pts[i + 1].xyz);
        segCol.push(...color, ...color);
      }
      for (const p of controls) { mkPos.push(...p.xyz); mkCol.push(...color); }
    };
    for (const ln of this.model.lines) addLine(ln, FINISHED_COLOR);
    if (this.model.current) addLine(this.model.current, CURRENT_COLOR);

    if (segPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(segPos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(segCol, 3));
      this.linesObj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
      this.linesObj.renderOrder = 3;
      this.group.add(this.linesObj);
    }
    if (mkPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(mkPos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(mkCol, 3));
      const size = this._dist * 0.012;
      this.markersObj = new THREE.Points(g, new THREE.PointsMaterial({ vertexColors: true, size, depthTest: false, sizeAttenuation: true }));
      this.markersObj.renderOrder = 4;
      this.group.add(this.markersObj);
    }
  }

  orbit(dx, dy) {
    this.rotY += dx * 0.01;
    this.rotX = Math.max(-1.4, Math.min(1.4, this.rotX + dy * 0.01));
  }

  zoom(factor) {
    this._dist = Math.max(this._minDist, Math.min(this._maxDist, this._dist * factor));
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.group.rotation.x = this.rotX;
    this.group.rotation.y = this.rotY;
    this.camera.position.set(0, 0, this._dist);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
