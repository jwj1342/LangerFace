import type { AnnotationModel, AnnotationPoint } from "./annotate_model.js";
import type { Triangle, Vec3 } from "./soft_body.js";

export class Annotator3D {
  constructor(canvas: HTMLCanvasElement);
  setMesh(
    verts: Vec3[],
    tris: Triangle[],
    options?: { showSurface?: boolean; colors?: Array<[number, number, number]> | null },
  ): void;
  setAnnotation(model: AnnotationModel): void;
  hasMesh(): boolean;
  raycast(ndcX: number, ndcY: number): AnnotationPoint | null;
  snapToSurface(point: Vec3): AnnotationPoint | null;
  rebuildLines(): void;
  orbit(dx: number, dy: number): void;
  zoom(factor: number): void;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}
