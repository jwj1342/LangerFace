import * as THREE from "three";

import { barycentric, type AnnotationLine, type AnnotationModel, type AnnotationPoint } from "./annotationModel.ts";
import { addSkinLighting, configureSkinRenderer, createSkinMaterial } from "./skinMaterial.ts";
import type { Triangle, Vec3 } from "./softBody";

type RGB = [number, number, number];

export interface AnnotatorMeshOptions {
  showSurface?: boolean;
  colors?: RGB[] | null;
}

interface DisposableRenderable extends THREE.Object3D {
  geometry?: { dispose?: () => void };
  material?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
}

interface ClosestTriangle {
  xyz: Vec3;
  tri: number;
  d: number;
}

const FINISHED_COLOR: RGB = [0.78, 0.15, 1.0];
const CURRENT_COLOR: RGB = [1.0, 0.78, 0.2];

function normalizedColors(colors: RGB[] | null | undefined, count: number): RGB[] | null {
  if (!Array.isArray(colors) || colors.length !== count) return null;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const out: RGB[] = [];
  for (const color of colors) {
    if (!Array.isArray(color) || color.length < 3) return null;
    const scale = Math.max(color[0], color[1], color[2]) > 1 ? 255 : 1;
    out.push([clamp(color[0] / scale), clamp(color[1] / scale), clamp(color[2] / scale)]);
  }
  return out;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const renderable = child as DisposableRenderable;
    renderable.geometry?.dispose?.();
    if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose?.());
    else renderable.material?.dispose?.();
  });
}

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dist2 = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const ap = sub3(p, a);
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = sub3(p, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add3(a, scale3(ab, d1 / (d1 - d3)));

  const cp = sub3(p, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add3(a, scale3(ac, d2 / (d2 - d6)));

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    return add3(b, scale3(sub3(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return add3(a, add3(scale3(ab, v), scale3(ac, w)));
}

export class Annotator3D {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  verts: Vec3[] | null;
  tris: Triangle[] | null;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  linesObj: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  markersObj: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null;
  model: AnnotationModel | null;
  rotX: number;
  rotY: number;
  private _vertexFaces: number[][] | null;
  private _center: Vec3 | null;
  private _dist: number;
  private _minDist: number;
  private _maxDist: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
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
    this._center = null;
    this._dist = 3;
    this._minDist = 0.2;
    this._maxDist = 50;
  }

  setMesh(verts: Vec3[], tris: Triangle[], { showSurface = true, colors = null }: AnnotatorMeshOptions = {}): void {
    this.verts = verts;
    this.tris = tris;
    this._vertexFaces = Array.from({ length: verts.length }, () => []);
    for (let i = 0; i < tris.length; i++) {
      const triangle = tris[i];
      this._vertexFaces[triangle[0]]?.push(i);
      this._vertexFaces[triangle[1]]?.push(i);
      this._vertexFaces[triangle[2]]?.push(i);
    }
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }

    const lo: Vec3 = [1e9, 1e9, 1e9];
    const hi: Vec3 = [-1e9, -1e9, -1e9];
    for (const vertex of verts) {
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(lo[axis], vertex[axis]);
        hi[axis] = Math.max(hi[axis], vertex[axis]);
      }
    }
    this._center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    this.group.position.set(-this._center[0], -this._center[1], -this._center[2]);
    const diag = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    this._dist = diag * 1.6;
    this._minDist = diag * 0.35;
    this._maxDist = diag * 8;
    this.camera.near = Math.max(0.001, diag / 5000);
    this.camera.far = Math.max(100, diag * 12);
    this.camera.updateProjectionMatrix();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    geometry.setIndex(tris.flat());
    const vertexColors = normalizedColors(colors, verts.length);
    if (vertexColors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors.flat(), 3));
    geometry.computeVertexNormals();
    const material = createSkinMaterial(verts, {
      showSurface,
      vertexColors: Boolean(vertexColors),
      fallbackColor: showSurface ? 0xd6aa8f : 0x9aa6b2,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.group.add(this.mesh);
    this.model?.setSurface?.(verts, tris);
    this.rebuildLines();
  }

  setAnnotation(model: AnnotationModel): void {
    this.model = model;
    if (this.verts && this.tris) this.model?.setSurface?.(this.verts, this.tris);
    this.rebuildLines();
  }

  hasMesh(): boolean {
    return Boolean(this.mesh && this.verts && this.tris);
  }

  raycast(ndcX: number, ndcY: number): AnnotationPoint | null {
    const mesh = this.mesh;
    const verts = this.verts;
    const tris = this.tris;
    if (!mesh || !verts || !tris) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = ray.intersectObject(mesh, false);
    if (!hits.length) return null;
    const hit = hits[0];
    if (hit.faceIndex == null) return null;
    const local = mesh.worldToLocal(hit.point.clone());
    const point: Vec3 = [local.x, local.y, local.z];
    const tri = hit.faceIndex;
    const triangle = tris[tri];
    const bary = barycentric(point, verts[triangle[0]], verts[triangle[1]], verts[triangle[2]]);
    return { xyz: point, tri, bary };
  }

  snapToSurface(xyz: Vec3): AnnotationPoint | null {
    const verts = this.verts;
    const tris = this.tris;
    if (!this.hasMesh() || !verts || !tris) return null;
    let bestVertex = 0;
    let bestVertexD2 = Infinity;
    for (let i = 0; i < verts.length; i++) {
      const d = dist2(xyz, verts[i]);
      if (d < bestVertexD2) {
        bestVertexD2 = d;
        bestVertex = i;
      }
    }

    const candidates = this._vertexFaces?.[bestVertex] || [];
    let best: ClosestTriangle | null = null;
    for (const tri of candidates) {
      const triangle = tris[tri];
      const cp = closestPointOnTriangle(xyz, verts[triangle[0]], verts[triangle[1]], verts[triangle[2]]);
      const d = dist2(xyz, cp);
      if (!best || d < best.d) best = { xyz: cp, tri, d };
    }
    if (!best) return { xyz: verts[bestVertex], tri: null, bary: null };

    const triangle = tris[best.tri];
    return {
      xyz: best.xyz,
      tri: best.tri,
      bary: barycentric(best.xyz, verts[triangle[0]], verts[triangle[1]], verts[triangle[2]]),
    };
  }

  rebuildLines(): void {
    this.disposeAnnotationObjects();
    if (!this.model) return;

    const segPos: number[] = [];
    const segCol: number[] = [];
    const markerPos: number[] = [];
    const markerCol: number[] = [];
    const addLine = (line: AnnotationLine, color: RGB) => {
      const points = line.points || [];
      const controls = line.controls || points;
      for (let i = 0; i + 1 < points.length; i++) {
        segPos.push(...points[i].xyz, ...points[i + 1].xyz);
        segCol.push(...color, ...color);
      }
      for (const point of controls) {
        markerPos.push(...point.xyz);
        markerCol.push(...color);
      }
    };
    for (const line of this.model.lines) addLine(line, FINISHED_COLOR);
    if (this.model.current) addLine(this.model.current, CURRENT_COLOR);

    if (segPos.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(segPos, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(segCol, 3));
      this.linesObj = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, toneMapped: false }),
      );
      this.linesObj.renderOrder = 3;
      this.group.add(this.linesObj);
    }
    if (markerPos.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(markerPos, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(markerCol, 3));
      const size = this._dist * 0.012;
      this.markersObj = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ vertexColors: true, size, depthTest: false, sizeAttenuation: true, toneMapped: false }),
      );
      this.markersObj.renderOrder = 4;
      this.group.add(this.markersObj);
    }
  }

  orbit(dx: number, dy: number): void {
    this.rotY += dx * 0.01;
    this.rotX = Math.max(-1.4, Math.min(1.4, this.rotX + dy * 0.01));
  }

  zoom(factor: number): void {
    this._dist = Math.max(this._minDist, Math.min(this._maxDist, this._dist * factor));
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.group.rotation.x = this.rotX;
    this.group.rotation.y = this.rotY;
    this.camera.position.set(0, 0, this._dist);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    disposeObject(this.scene);
    this.renderer.dispose();
  }

  private disposeAnnotationObjects(): void {
    if (this.linesObj) {
      this.group.remove(this.linesObj);
      this.linesObj.geometry.dispose();
      this.linesObj = null;
    }
    if (this.markersObj) {
      this.group.remove(this.markersObj);
      this.markersObj.geometry.dispose();
      this.markersObj = null;
    }
  }
}
