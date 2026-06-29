import type { AssetProgressEvent } from "./assetLoader";
import { dataSource } from "./dataSource";
import { loadFlameBasisAsset, mediaPipeAtlasToFlamePreviewAtlas } from "./flameHeadAssets";
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
    dataSource.getHeadMesh("flame-2023", { onProgress }),
    dataSource.loadAtlas("rstl", { onProgress }),
    loadFlameBasisAsset({ label: "高精度三维头模基底", onProgress }),
  ]).then(([mediaPipeHead, flameHead, atlas, basis]) => ({
    verts: flameHead.vertices as Vec3[],
    tris: flameHead.triangles as Triangle[],
    atlas: mediaPipeAtlasToFlamePreviewAtlas({
      atlas,
      mediaPipeHead,
      flameHead,
      basis,
    }) as RstlAtlas,
  }));
}
