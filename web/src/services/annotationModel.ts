import { ATLAS_VERSION, TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import type { Triangle, Vec3 } from "./softBody";

export interface AnnotationPoint {
  xyz: Vec3;
  tri?: number | null;
  bary?: [number, number, number] | null;
  exportable?: boolean;
  fallback?: boolean;
}

export interface AnnotationLine {
  name: string;
  region: string;
  points: AnnotationPoint[];
  controls?: AnnotationPoint[];
  fallback?: boolean;
}

export interface AnnotationTopology {
  topologyId?: string;
  topologyVersion?: string;
}

export interface AddLineOptions {
  name?: string;
  region?: string;
  points?: AnnotationPoint[];
  controls?: AnnotationPoint[];
}

export interface AtlasExportOptions {
  version?: string;
  provenance?: string;
  topologyId?: string;
  topologyVersion?: string;
}

export interface AtlasExport {
  system: string;
  version: string;
  topologyId: string;
  topologyVersion: string;
  provenance: string;
  validated: false;
  lines: Array<{
    name: string;
    region: string;
    points: Array<[number, number, number]>;
  }>;
}

export interface XyzExport {
  system: string;
  lines: Array<{
    name: string;
    region: string;
    points: Vec3[];
  }>;
}

interface VertexRef {
  tri: number;
  bary: [number, number, number];
}

interface SurfaceGraph {
  verts: Vec3[];
  tris: Triangle[];
  adj: Array<Map<number, number>>;
  vertexRefs: Array<VertexRef | null>;
}

interface SurfacePathResult {
  points: AnnotationPoint[];
  fallback: boolean;
}

export function barycentric(p: Vec3, a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  const v0: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01 || 1e-12;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function vertexPoint(surface: SurfaceGraph, vertexIndex: number, exportable: boolean): AnnotationPoint {
  const ref = surface.vertexRefs[vertexIndex];
  return {
    xyz: surface.verts[vertexIndex].slice() as Vec3,
    tri: ref?.tri ?? null,
    bary: ref?.bary ?? null,
    exportable,
  };
}

function buildSurface(verts: Vec3[], tris: Triangle[]): SurfaceGraph {
  const adj = Array.from({ length: verts.length }, () => new Map<number, number>());
  const vertexRefs = Array.from({ length: verts.length }, () => null as VertexRef | null);
  const addEdge = (a: number, b: number) => {
    const weight = dist3(verts[a], verts[b]);
    const prev = adj[a].get(b);
    if (prev == null || weight < prev) {
      adj[a].set(b, weight);
      adj[b].set(a, weight);
    }
  };
  tris.forEach((triangle, tri) => {
    for (let i = 0; i < 3; i++) {
      const vertexIndex = triangle[i];
      if (!vertexRefs[vertexIndex]) {
        const bary: [number, number, number] = [0, 0, 0];
        bary[i] = 1;
        vertexRefs[vertexIndex] = { tri, bary };
      }
    }
    addEdge(triangle[0], triangle[1]);
    addEdge(triangle[1], triangle[2]);
    addEdge(triangle[2], triangle[0]);
  });
  return { verts, tris, adj, vertexRefs };
}

function nearestSurfacePath(
  surface: SurfaceGraph | null,
  a: AnnotationPoint,
  b: AnnotationPoint,
): SurfacePathResult {
  if (!surface || a.tri == null || b.tri == null || !Array.isArray(a.bary) || !Array.isArray(b.bary)) {
    return { points: [a, b], fallback: true };
  }
  if (a.tri === b.tri) return { points: [a, b], fallback: false };

  const startVerts = surface.tris[a.tri] || [];
  const endVerts = surface.tris[b.tri] || [];
  if (startVerts.length !== 3 || endVerts.length !== 3) return { points: [a, b], fallback: true };

  const count = surface.verts.length;
  const dist = new Float64Array(count);
  dist.fill(Infinity);
  const prev = new Int32Array(count);
  prev.fill(-1);
  const visited = new Uint8Array(count);
  const heap: Array<[number, number]> = [];
  const push = (node: number, score: number) => {
    heap.push([node, score]);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][1] <= score) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
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
        const left = 2 * i + 1;
        const right = left + 1;
        if (left < heap.length && heap[left][1] < heap[best][1]) best = left;
        if (right < heap.length && heap[right][1] < heap[best][1]) best = right;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return root;
  };

  for (const vertexIndex of startVerts) {
    const d = dist3(a.xyz, surface.verts[vertexIndex]);
    if (d < dist[vertexIndex]) {
      dist[vertexIndex] = d;
      push(vertexIndex, d);
    }
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
      if (total < bestTotal) {
        bestTotal = total;
        bestEnd = u;
      }
    }
    if (du > bestTotal) break;
    for (const [v, weight] of surface.adj[u]) {
      const nextDistance = du + weight;
      if (nextDistance < dist[v]) {
        dist[v] = nextDistance;
        prev[v] = u;
        push(v, nextDistance);
      }
    }
  }
  if (bestEnd < 0) return { points: [a, b], fallback: true };

  const vertexPath: number[] = [];
  for (let u = bestEnd; u >= 0; u = prev[u]) vertexPath.push(u);
  vertexPath.reverse();

  const exportable = a.exportable !== false && b.exportable !== false;
  const out = [a];
  for (const vertexIndex of vertexPath) {
    const point = vertexPoint(surface, vertexIndex, exportable);
    if (dist3(out[out.length - 1].xyz, point.xyz) > 1e-9 && dist3(point.xyz, b.xyz) > 1e-9) out.push(point);
  }
  if (dist3(out[out.length - 1].xyz, b.xyz) > 1e-9) out.push(b);
  return { points: out, fallback: false };
}

function controlsOf(line: AnnotationLine): AnnotationPoint[] {
  return line.controls || line.points;
}

export class AnnotationModel {
  system: string;
  topologyId: string;
  topologyVersion: string;
  lines: AnnotationLine[];
  current: AnnotationLine | null;
  private surface: SurfaceGraph | null;

  constructor(system = "rstl", { topologyId = TOPOLOGY_ID, topologyVersion = TOPOLOGY_VERSION }: AnnotationTopology = {}) {
    this.system = system;
    this.topologyId = topologyId;
    this.topologyVersion = topologyVersion;
    this.lines = [];
    this.current = null;
    this.surface = null;
  }

  setTopology({ topologyId = TOPOLOGY_ID, topologyVersion = TOPOLOGY_VERSION }: AnnotationTopology = {}): void {
    this.topologyId = topologyId;
    this.topologyVersion = topologyVersion;
  }

  setSurface(verts: Vec3[], tris: Triangle[]): void {
    this.surface = buildSurface(verts, tris);
    for (const line of this.lines) this._rebuildLinePoints(line);
    if (this.current) this._rebuildLinePoints(this.current);
  }

  startLine({ name, region }: { name?: string; region?: string } = {}): void {
    this.current = {
      name: name || `line_${this.lines.length + 1}`,
      region: region || "",
      points: [],
      controls: [],
      fallback: false,
    };
  }

  addPoint(point: AnnotationPoint): { fallback: boolean } {
    if (!this.current) this.startLine();
    const current = this.current as AnnotationLine & { controls: AnnotationPoint[] };
    current.controls.push(point);
    if (current.controls.length === 1) {
      current.points = [point];
      current.fallback = false;
      return { fallback: false };
    }
    const controls = current.controls;
    const { points, fallback } = nearestSurfacePath(this.surface, controls[controls.length - 2], point);
    current.points.push(...points.slice(1));
    current.fallback = Boolean(current.fallback || fallback);
    return { fallback };
  }

  addLine({ name, region, points, controls }: AddLineOptions): AnnotationLine | null {
    const lineControls = Array.isArray(controls) ? controls : points;
    if (!Array.isArray(lineControls) || lineControls.length < 2) return null;
    const line: AnnotationLine = {
      name: name || `line_${this.lines.length + 1}`,
      region: region || "",
      controls: lineControls,
      points: [],
    };
    this._rebuildLinePoints(line);
    this.lines.push(line);
    return line;
  }

  undoPoint(): void {
    if (!this.current) return;
    if (this.current.controls) {
      this.current.controls.pop();
      this._rebuildLinePoints(this.current);
    } else if (this.current.points.length) {
      this.current.points.pop();
    }
  }

  finishLine(): AnnotationLine | null {
    if (this.current && controlsOf(this.current).length >= 2) this.lines.push(this.current);
    const done = this.current;
    this.current = null;
    return done;
  }

  cancelLine(): void {
    this.current = null;
  }

  deleteLine(index: number): void {
    if (index >= 0 && index < this.lines.length) this.lines.splice(index, 1);
  }

  clear(): void {
    this.lines = [];
    this.current = null;
  }

  hasBarycentric(): boolean {
    return this.lines.length > 0 && this.lines.every(
      (line) => line.points.every((point) => point.exportable !== false && point.tri != null && Array.isArray(point.bary)),
    );
  }

  toAtlasJSON({
    version = ATLAS_VERSION,
    provenance = "web-annotator",
    topologyId = this.topologyId,
    topologyVersion = this.topologyVersion,
  }: AtlasExportOptions = {}): AtlasExport {
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
      lines: this.lines.map((line) => ({
        name: line.name,
        region: line.region,
        points: line.points.map((point) => [
          point.tri as number,
          round6((point.bary as [number, number, number])[0]),
          round6((point.bary as [number, number, number])[1]),
        ]),
      })),
    };
  }

  toXyzJSON(): XyzExport {
    return {
      system: this.system,
      lines: this.lines.map((line) => ({
        name: line.name,
        region: line.region,
        points: line.points.map((point) => [round6(point.xyz[0]), round6(point.xyz[1]), round6(point.xyz[2])] as Vec3),
      })),
    };
  }

  _rebuildLinePoints(line: AnnotationLine): { fallback: boolean } {
    const controls = controlsOf(line);
    line.controls = controls;
    line.points = [];
    let fallback = false;
    for (let i = 0; i < controls.length; i++) {
      const point = controls[i];
      if (!line.points.length) {
        line.points.push(point);
      } else {
        const path = nearestSurfacePath(this.surface, controls[i - 1], point);
        line.points.push(...path.points.slice(1));
        if (path.fallback) fallback = true;
      }
    }
    line.fallback = fallback;
    return { fallback };
  }
}
