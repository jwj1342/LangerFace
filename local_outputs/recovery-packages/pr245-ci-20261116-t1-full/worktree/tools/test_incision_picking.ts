import assert from "node:assert/strict";

import {
  pickEndpointHandle,
  pickFaceSurface,
  pointerToNdc,
  signedAngleDegrees,
} from "../web/src/services/incisionPicking.ts";

const center = pointerToNdc(
  { clientX: 60, clientY: 70 },
  { left: 10, top: 20, width: 100, height: 100 },
);
assert.deepEqual(center.toArray(), [0, 0]);

const topLeft = pointerToNdc(
  { clientX: 10, clientY: 20 },
  { left: 10, top: 20, width: 100, height: 100 },
);
assert.deepEqual(topLeft.toArray(), [-1, 1]);

assert.equal(signedAngleDegrees([1, 0, 0], [0, 1, 0], [0, 0, 1]), 90);
assert.equal(signedAngleDegrees([1, 0, 0], [0, -1, 0], [0, 0, 1]), -90);

const viewport = { left: 0, top: 0, width: 100, height: 100 };
const pointer = { clientX: 50, clientY: 50 };
const cameraUpdates: boolean[] = [];
const sceneUpdates: boolean[] = [];
const camera = {
  updateMatrixWorld(force: boolean) {
    cameraUpdates.push(force);
  },
};
const scene = {
  updateMatrixWorld(force: boolean) {
    sceneUpdates.push(force);
  },
};
const mesh = { id: "face-mesh" };
const group = {
  worldToLocal(point: { x: number; y: number; z: number }) {
    point.x -= 1;
    point.y -= 2;
    point.z -= 3;
    return point;
  },
};
const rayInputs: unknown[] = [];
const face = { a: 0, b: 1, c: 2, normal: { x: 0, y: 0, z: 1 } };
const faceRaycaster = {
  setFromCamera(ndc: unknown, selectedCamera: unknown) {
    rayInputs.push(ndc, selectedCamera);
  },
  intersectObject(selectedMesh: unknown, recursive: boolean) {
    assert.equal(selectedMesh, mesh);
    assert.equal(recursive, false);
    return [{
      face,
      point: {
        x: 4,
        y: 6,
        z: 8,
        clone() {
          return { x: this.x, y: this.y, z: this.z };
        },
      },
    }];
  },
};

const faceHit = pickFaceSurface(pointer, viewport, {
  camera,
  group,
  mesh,
  scene,
}, faceRaycaster);
assert.deepEqual(faceHit, { point: [3, 4, 5], face });
assert.deepEqual(cameraUpdates, [true]);
assert.deepEqual(sceneUpdates, [true]);
assert.equal(rayInputs[1], camera);

assert.equal(pickFaceSurface(pointer, viewport, {
  camera,
  group,
  mesh: null,
  scene,
}, faceRaycaster), null);

const visibleHandle = { visible: true, userData: { handle: 1 } };
const hiddenHandle = { visible: false, userData: { handle: 0 } };
const handleRaycaster = {
  setFromCamera() {},
  intersectObjects(handles: unknown[], recursive: boolean) {
    assert.deepEqual(handles, [visibleHandle]);
    assert.equal(recursive, false);
    return [{ object: visibleHandle }];
  },
};
assert.equal(
  pickEndpointHandle(
    pointer,
    viewport,
    camera,
    scene,
    [hiddenHandle, visibleHandle],
    handleRaycaster,
  ),
  1,
);
visibleHandle.visible = false;
assert.equal(
  pickEndpointHandle(
    pointer,
    viewport,
    camera,
    scene,
    [hiddenHandle, visibleHandle],
    {
      setFromCamera() {},
      intersectObjects(handles: unknown[]) {
        assert.deepEqual(handles, []);
        return [];
      },
    },
  ),
  null,
);

console.log("test_incision_picking: NDC, local face hit, visible handles, and angle assertions passed");
