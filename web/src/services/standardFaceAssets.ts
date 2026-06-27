import type { AssetProgressEvent } from "./assetLoader";
import { dataSource } from "./dataSource";
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
    dataSource.getHeadMesh("mediapipe-468", { onProgress }),
    dataSource.loadAtlas("rstl", { onProgress }),
  ]).then(([head, atlas]) => ({
    verts: head.vertices as Vec3[],
    tris: head.triangles as Triangle[],
    atlas: atlas as RstlAtlas,
  }));
}
