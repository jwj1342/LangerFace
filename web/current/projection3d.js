// 3D 投影适配层：无 DOM、无数据源控制，只负责把重建网格配准到当前帧。
import { RIGID3D } from "./constants.js";
import { applySim, umeyama } from "./geometry.js";
import { reconState } from "./state.js";

export function projectVerts(lm) {
  const verts = reconState.reconProjectVerts || reconState.reconVerts;
  if (reconState.route === "3d" && reconState.mode3d === "project" && verts && reconState.reconProjectable) {
    const sim = umeyama(RIGID3D.map((i) => verts[i]), RIGID3D.map((i) => lm[i]));
    return applySim(sim, verts);
  }
  return lm;
}
