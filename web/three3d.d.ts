export function vertexNormals(
  verts: Array<[number, number, number]>,
  tris: Array<[number, number, number]>,
): Array<[number, number, number]>;

export function buildLineGeometry(
  atlasLines: Array<{
    points?: Array<[number, number, number]>;
    points3d?: Array<[number, number, number]>;
  }>,
  verts: Array<[number, number, number]>,
  tris: Array<[number, number, number]>,
  normals: Array<[number, number, number]>,
  bands?: boolean,
): import("three").BufferGeometry;

export class Head3D {
  canvas: HTMLCanvasElement;
  renderer: import("three").WebGLRenderer;
  scene: import("three").Scene;
  camera: import("three").PerspectiveCamera;
  group: import("three").Group;
  grid: import("three").GridHelper;
  mesh: import("three").Mesh | null;
  lines: import("three").LineSegments | null;
  incisionOverlay: import("three").Object3D | null;
  rotX: number;
  rotY: number;
  constructor(canvas: HTMLCanvasElement);
  setGeometry(
    verts: Array<[number, number, number]>,
    tris: Array<[number, number, number]>,
    atlasLines: Array<Record<string, any>>,
    options?: { showSurface?: boolean; bands?: boolean; vertexColors?: Array<[number, number, number]> | null },
  ): void;
  clearIncisionOverlay(): void;
  setIncisionOverlay(
    overlay: Record<string, any> | null,
    verts: Array<[number, number, number]>,
    tris: Array<[number, number, number]>,
  ): Record<string, any>;
  setIncisionOverlayPoints(overlay3d: Record<string, any> | null): Record<string, any>;
  updateVerts(verts: Array<[number, number, number]>, colors?: Array<[number, number, number]> | null): void;
  setRotation(rx: number, ry: number): void;
  zoom(factor: number): void;
  resetView(): void;
  resize(w: number, h: number): void;
  render(): void;
  dispose(): void;
}
