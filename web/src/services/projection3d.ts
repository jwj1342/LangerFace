import { RIGID3D } from "../../constants.js";
import { applySim, type Vec3, umeyama } from "../../geometry.js";
import { reconState } from "../../state.js";

export function projectVerts(lm: Vec3[]): Vec3[] {
  const reconVerts = reconState.reconVerts;
  if (
    reconState.route === "3d"
    && reconState.mode3d === "project"
    && reconState.reconProjectable
    && Array.isArray(reconVerts)
    && reconVerts.length >= 468
  ) {
    const verts = reconVerts as Vec3[];
    const sim = umeyama(RIGID3D.map((i) => verts[i]), RIGID3D.map((i) => lm[i]));
    return applySim(sim, verts);
  }
  return lm;
}
