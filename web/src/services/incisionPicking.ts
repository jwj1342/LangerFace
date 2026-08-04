import * as THREE from "three";

import {
  cross3,
  dot3,
  normalize3,
  type VectorLike,
} from "./incisionSceneGeometry.ts";
import type { Vec3 } from "./softBody";

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface PickingViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PickingScene {
  camera: THREE.Camera;
  group: THREE.Object3D;
  mesh: THREE.Object3D | null;
  scene: THREE.Scene;
}

export interface FaceSurfaceHit {
  point: Vec3;
  face: NonNullable<THREE.Intersection["face"]>;
}

export function pointerToNdc(
  pointer: PointerPosition,
  viewport: PickingViewport,
): THREE.Vector2 {
  return new THREE.Vector2(
    ((pointer.clientX - viewport.left) / viewport.width) * 2 - 1,
    -((pointer.clientY - viewport.top) / viewport.height) * 2 + 1,
  );
}

function prepareRay(
  pointer: PointerPosition,
  viewport: PickingViewport,
  camera: THREE.Camera,
  scene: THREE.Scene,
  raycaster: THREE.Raycaster,
): void {
  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(pointerToNdc(pointer, viewport), camera);
}

export function pickFaceSurface(
  pointer: PointerPosition,
  viewport: PickingViewport,
  head: PickingScene,
  raycaster: THREE.Raycaster,
): FaceSurfaceHit | null {
  if (!head.mesh) return null;
  prepareRay(pointer, viewport, head.camera, head.scene, raycaster);
  const hit = raycaster.intersectObject(head.mesh, false)[0];
  if (!hit?.face) return null;
  const local = head.group.worldToLocal(hit.point.clone());
  return { point: [local.x, local.y, local.z], face: hit.face };
}

export function pickEndpointHandle(
  pointer: PointerPosition,
  viewport: PickingViewport,
  camera: THREE.Camera,
  scene: THREE.Scene,
  handles: THREE.Object3D[],
  raycaster: THREE.Raycaster,
): number | null {
  prepareRay(pointer, viewport, camera, scene, raycaster);
  const hit = raycaster.intersectObjects(handles.filter((handle) => handle.visible), false)[0];
  const handle = hit?.object?.userData?.handle;
  return Number.isInteger(handle) ? Number(handle) : null;
}

export function signedAngleDegrees(
  firstAxis: VectorLike,
  secondAxis: VectorLike,
  normal: VectorLike,
): number {
  const perpendicular = normalize3(cross3(normal, firstAxis));
  return Math.atan2(
    dot3(secondAxis, perpendicular),
    dot3(secondAxis, firstAxis),
  ) * 180 / Math.PI;
}
