import { loadJsonAsset, type AssetProgressEvent } from "./assetLoader";
import type { RstlAtlas } from "./rstlField";
import type { Triangle, Vec3 } from "./softBody";

export interface StandardFaceAssets {
  verts: Vec3[];
  tris: Triangle[];
  atlas: RstlAtlas;
}

export interface LoadStandardFaceAssetsOptions {
  onProgress?: (event: AssetProgressEvent) => void;
}

export function loadStandardFaceAssets({
  onProgress,
}: LoadStandardFaceAssetsOptions = {}): Promise<StandardFaceAssets> {
  return Promise.all([
    loadJsonAsset<Vec3[]>("canonicalVertices", {
      label: "标准脸顶点",
      onProgress,
    }),
    loadJsonAsset<Triangle[]>("triangles", {
      label: "三角拓扑",
      onProgress,
    }),
    loadJsonAsset<RstlAtlas>("atlasRstl", {
      label: "RSTL 图谱",
      onProgress,
    }),
  ]).then(([verts, tris, atlas]) => ({ verts, tris, atlas }));
}
