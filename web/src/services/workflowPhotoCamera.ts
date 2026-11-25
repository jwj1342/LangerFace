import type { IncisionOverlayPayload } from "./dataSource.ts";

export const workflowPhotoCameraEnabled =
  import.meta.env?.VITE_WORKFLOW_PHOTO_CAMERA_EXPERIMENT === "true";

export const workflowCameraPhotoRequired = "请先上传一张清晰的单人照片，等待人脸定位完成。";

const overlayPhotos = new WeakMap<IncisionOverlayPayload, object>();

export function rememberWorkflowOverlayPhoto(overlay: IncisionOverlayPayload, photo: object): void {
  overlayPhotos.set(overlay, photo);
}

export function workflowOverlayMatchesPhoto(overlay: IncisionOverlayPayload | null, photo: unknown): boolean {
  return overlay !== null && overlayPhotos.get(overlay) === photo;
}
