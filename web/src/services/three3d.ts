import * as THREE from "three";

import { addSkinLighting, configureSkinRenderer, createSkinMaterial } from "../../skin_material.js";
import type { Triangle, Vec3 } from "./softBody";

type RGB = [number, number, number];
type AtlasBaryPoint = [number, number, number];

export interface AtlasLine3D {
  points?: AtlasBaryPoint[];
  points3d?: Vec3[];
}

export interface SurfaceRef {
  tri?: number;
  u?: number;
  v?: number;
  w?: number;
}

export interface IncisionOverlayPayload3D {
  candidate_type?: "linear" | "fusiform" | string;
  tumor?: {
    center_ref?: SurfaceRef | null;
    boundary_refs?: SurfaceRef[];
  } | null;
  candidate?: {
    polyline_refs?: SurfaceRef[];
  } | null;
}

export interface IncisionOverlayPointsPayload {
  schema_version?: string;
  candidate_type?: "linear" | "fusiform" | string;
  tumor_center_point?: Vec3 | null;
  tumor_boundary_points?: Vec3[];
  candidate_points?: Vec3[];
}

export interface IncisionOverlayRenderSummary {
  schema_version: "incision-overlay-3d-view/v0.1";
  rendered: boolean;
  reason: string;
  candidate_point_count?: number;
  boundary_point_count?: number;
  tumor_center_rendered?: boolean;
  clinical_boundary?: string;
}

export interface Head3DGeometryOptions {
  showSurface?: boolean;
  bands?: boolean;
  vertexColors?: RGB[] | null;
}

const BAND: Record<"top" | "mid" | "low", RGB> = {
  top: [0.94, 0.76, 0.29],
  mid: [0.34, 0.74, 0.95],
  low: [0.25, 0.83, 0.62],
};

const INCISION_COLORS = {
  tumor: 0xfacc15,
  linear: 0x22c55e,
  fusiform: 0x5eead4,
} as const;

interface Bounds {
  lo: Vec3;
  hi: Vec3;
  size: number;
}

interface DisposableRenderable extends THREE.Object3D {
  geometry?: { dispose?: () => void };
  material?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
}

function isVec3(value: Vec3 | null): value is Vec3 {
  return Array.isArray(value) && value.length >= 3;
}

function normalizeColor(colors: RGB[] | null | undefined, index: number): RGB {
  return colors?.[index] || [0, 0, 0];
}

// Per-vertex normals lift overlay lines slightly away from the mesh to avoid z-fighting.
export function vertexNormals(verts: Vec3[], tris: Triangle[]): Vec3[] {
  const normals = verts.map(() => [0, 0, 0] as Vec3);
  for (const [a, b, c] of tris) {
    const va = verts[a];
    const vb = verts[b];
    const vc = verts[c];
    const e1: Vec3 = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]];
    const e2: Vec3 = [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    for (const i of [a, b, c]) {
      normals[i][0] += cx;
      normals[i][1] += cy;
      normals[i][2] += cz;
    }
  }
  for (const normal of normals) {
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    normal[0] /= length;
    normal[1] /= length;
    normal[2] /= length;
  }
  return normals;
}

function bbox(verts: Vec3[]): Bounds {
  const lo: Vec3 = [1e9, 1e9, 1e9];
  const hi: Vec3 = [-1e9, -1e9, -1e9];
  for (const vertex of verts) {
    for (let axis = 0; axis < 3; axis++) {
      lo[axis] = Math.min(lo[axis], vertex[axis]);
      hi[axis] = Math.max(hi[axis], vertex[axis]);
    }
  }
  return { lo, hi, size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}

function mapBaryPoint(point: AtlasBaryPoint, verts: Vec3[], tris: Triangle[], normals: Vec3[], eps: number): Vec3 {
  const [triIndex, u, v] = point;
  const w = 1 - u - v;
  const tri = tris[triIndex];
  const A = verts[tri[0]];
  const B = verts[tri[1]];
  const C = verts[tri[2]];
  const nA = normals[tri[0]];
  const nB = normals[tri[1]];
  const nC = normals[tri[2]];
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

export function buildLineGeometry(
  atlasLines: AtlasLine3D[],
  verts: Vec3[],
  tris: Triangle[],
  normals: Vec3[],
  bands = true,
): THREE.BufferGeometry {
  const bb = bbox(verts);
  const eps = bb.size * 0.004;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const line of atlasLines) {
    const pts3 = Array.isArray(line.points3d)
      ? line.points3d
      : (line.points || []).map((point) => mapBaryPoint(point, verts, tris, normals, eps));
    if (pts3.length < 2) continue;
    let meanY = 0;
    for (const point of pts3) meanY += point[1];
    meanY = (meanY / pts3.length - bb.lo[1]) / ((bb.hi[1] - bb.lo[1]) || 1);
    const color = bands ? (meanY > 0.64 ? BAND.top : meanY > 0.34 ? BAND.mid : BAND.low) : [0.78, 0.15, 1.0] as RGB;
    for (let i = 0; i + 1 < pts3.length; i++) {
      positions.push(...pts3[i], ...pts3[i + 1]);
      colors.push(...color, ...color);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const renderable = child as DisposableRenderable;
    renderable.geometry?.dispose?.();
    if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose?.());
    else renderable.material?.dispose?.();
  });
}

function mapSurfaceRef3d(
  ref: SurfaceRef | null | undefined,
  verts: Vec3[],
  tris: Triangle[],
  normals: Vec3[],
  eps: number,
): Vec3 | null {
  const triIndex = Number(ref?.tri);
  const tri = Number.isInteger(triIndex) ? tris[triIndex] : undefined;
  if (!tri || tri.length < 3) return null;
  const A = verts[tri[0]];
  const B = verts[tri[1]];
  const C = verts[tri[2]];
  const nA = normals[tri[0]];
  const nB = normals[tri[1]];
  const nC = normals[tri[2]];
  if (!A || !B || !C || !nA || !nB || !nC) return null;
  const u = Number(ref?.u);
  const v = Number(ref?.v);
  const w = Number(ref?.w ?? (1 - u - v));
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

function buildOverlayLine(points: Vec3[], color: THREE.ColorRepresentation, closed = false): THREE.Line | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const pts = closed ? [...points, points[0]] : points;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.98,
    toneMapped: false,
  });
  const obj = new THREE.Line(geometry, material);
  obj.renderOrder = 5;
  return obj;
}

export class Head3D {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  grid: THREE.GridHelper;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  incisionOverlay: THREE.Object3D | null;
  rotX: number;
  rotY: number;
  private _dist: number;
  private _minDist: number;
  private _maxDist: number;

  constructor(canvas: HTMLCanvasElement) {
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
    const gridMaterial = this.grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.38;
    this.scene.add(this.grid);
    this.mesh = null;
    this.lines = null;
    this.incisionOverlay = null;
    this.rotX = 0;
    this.rotY = 0;
    this._dist = 3;
    this._minDist = 0.8;
    this._maxDist = 8;
  }

  setGeometry(
    verts: Vec3[],
    tris: Triangle[],
    atlasLines: AtlasLine3D[],
    { showSurface = true, bands = true, vertexColors = null }: Head3DGeometryOptions = {},
  ): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.lines) {
      this.group.remove(this.lines);
      this.lines.geometry.dispose();
      this.lines = null;
    }
    this.clearIncisionOverlay();
    const normals = vertexNormals(verts, tris);
    const bb = bbox(verts);
    const center: Vec3 = [
      (bb.lo[0] + bb.hi[0]) / 2,
      (bb.lo[1] + bb.hi[1]) / 2,
      (bb.lo[2] + bb.hi[2]) / 2,
    ];
    this.group.position.set(-center[0], -center[1], -center[2]);

    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    meshGeometry.setIndex(tris.flat());
    const hasVertexColors = Array.isArray(vertexColors) && vertexColors.length === verts.length;
    if (hasVertexColors) meshGeometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors.flat(), 3));
    meshGeometry.computeVertexNormals();
    const material = createSkinMaterial(verts, {
      showSurface,
      vertexColors: hasVertexColors,
    });
    this.mesh = new THREE.Mesh(meshGeometry, material);
    this.group.add(this.mesh);

    const lineGeometry = buildLineGeometry(atlasLines, verts, tris, normals, bands);
    this.lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    this.lines.renderOrder = 2;
    this.group.add(this.lines);

    this._dist = bb.size * 1.6;
    this._minDist = Math.max(0.35, bb.size * 0.8);
    this._maxDist = Math.max(this._minDist * 1.5, bb.size * 3.5);
    this.grid.scale.setScalar(Math.max(0.7, bb.size * 0.75));
    this.grid.position.y = -Math.max(0.45, bb.size * 0.38);
  }

  clearIncisionOverlay(): void {
    if (!this.incisionOverlay) return;
    this.group.remove(this.incisionOverlay);
    disposeObject(this.incisionOverlay);
    this.incisionOverlay = null;
  }

  setIncisionOverlay(overlay: IncisionOverlayPayload3D | null, verts: Vec3[], tris: Triangle[]): IncisionOverlayRenderSummary {
    if (!overlay) {
      this.clearIncisionOverlay();
      return { rendered: false, reason: "missing_overlay", schema_version: "incision-overlay-3d-view/v0.1" };
    }
    const normals = vertexNormals(verts, tris);
    const bb = bbox(verts);
    const eps = bb.size * 0.008;
    const mapRefs = (refs?: Array<SurfaceRef | null | undefined>): Vec3[] => (
      refs || []
    ).map((ref) => mapSurfaceRef3d(ref, verts, tris, normals, eps)).filter(isVec3);
    return this.setIncisionOverlayPoints({
      schema_version: "incision-overlay-3d-points/v0.1",
      candidate_type: overlay.candidate_type,
      tumor_center_point: mapRefs([overlay.tumor?.center_ref])[0] || null,
      tumor_boundary_points: mapRefs(overlay.tumor?.boundary_refs || []),
      candidate_points: mapRefs(overlay.candidate?.polyline_refs || []),
    });
  }

  setIncisionOverlayPoints(overlay3d: IncisionOverlayPointsPayload | null): IncisionOverlayRenderSummary {
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

  updateVerts(verts: Vec3[], colors: RGB[] | null = null): void {
    if (!this.mesh) return;
    const geometry = this.mesh.geometry;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const positionArray = position.array as Float32Array;
    const count = Math.min(verts.length, positionArray.length / 3);
    for (let i = 0; i < count; i++) {
      positionArray[i * 3] = verts[i][0];
      positionArray[i * 3 + 1] = verts[i][1];
      positionArray[i * 3 + 2] = verts[i][2];
    }
    position.needsUpdate = true;
    const colorAttribute = geometry.attributes.color as THREE.BufferAttribute | undefined;
    if (colors && colorAttribute) {
      const colorArray = colorAttribute.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const color = normalizeColor(colors, i);
        colorArray[i * 3] = color[0];
        colorArray[i * 3 + 1] = color[1];
        colorArray[i * 3 + 2] = color[2];
      }
      colorAttribute.needsUpdate = true;
    }
    geometry.computeVertexNormals();
  }

  setRotation(rx: number, ry: number): void {
    this.rotX = rx;
    this.rotY = ry;
  }

  zoom(factor: number): void {
    this._dist = Math.max(this._minDist, Math.min(this._maxDist, this._dist * factor));
  }

  resetView(): void {
    this.rotX = 0;
    this.rotY = 0;
    this._dist = Math.max(this._minDist, Math.min(this._maxDist, this._maxDist / 2.2));
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
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
    this.clearIncisionOverlay();
    disposeObject(this.scene);
    this.renderer.dispose();
  }
}
