import { fitExpression, fitShape, flameForward, facesArray, projectFlameToLandmarks } from "./flame_fit.js";
import { mapAtlas } from "./geometry.js";

const crossZ = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function visibleSurfaceTriangles(vertices, triangles, referenceFaces = []) {
  const signed = new Float64Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    const [ia, ib, ic] = triangles[i];
    signed[i] = crossZ(vertices[ia], vertices[ib], vertices[ic]);
  }
  const references = referenceFaces
    .map((index) => signed[index])
    .filter((value) => Number.isFinite(value) && Math.abs(value) > 1e-9)
    .sort((a, b) => a - b);
  const median = references.length ? references[Math.floor(references.length / 2)] : 1;
  const sign = median < 0 ? -1 : 1;
  const visible = new Uint8Array(triangles.length);
  for (let i = 0; i < signed.length; i++) visible[i] = sign * signed[i] >= 0 ? 1 : 0;
  return visible;
}

export class FlameCameraOverlay {
  constructor(atlas, basis) {
    this.atlas = atlas;
    this.basis = basis;
    this.faces = facesArray(basis);
    this.beta = null;
  }

  reset() {
    this.beta = null;
  }

  project(landmarks, jawOpen = 0) {
    if (!this.beta) this.beta = fitShape(landmarks, this.basis).beta;
    const psi = fitExpression(landmarks, this.basis, this.beta).psi;
    const vertices = flameForward(this.basis, this.beta, psi, jawOpen);
    const projected = projectFlameToLandmarks(vertices, landmarks, this.basis);
    return {
      mapped: mapAtlas(this.atlas.lines, projected.vertices, this.faces),
      visible: visibleSurfaceTriangles(projected.vertices, this.faces, projected.referenceFaces),
    };
  }
}
